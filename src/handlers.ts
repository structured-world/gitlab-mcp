import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConnectionManager } from './services/ConnectionManager';
import { HealthMonitor } from './services/HealthMonitor';
import { logInfo, logWarn, logError, logDebug } from './logger';
import {
  handleGitLabError,
  GitLabStructuredError,
  isStructuredToolError,
  createTimeoutError,
  createConnectionFailedError,
  parseTimeoutError,
  parseGitLabApiError,
} from './utils/error-handler';
import { getRequestTracker, getConnectionTracker, getCurrentRequestId } from './logging/index';
import { LOG_FORMAT, HANDLER_TIMEOUT_MS, GITLAB_BASE_URL } from './config';

interface JsonSchemaProperty {
  type?: string;
  $ref?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  enum?: unknown[];
  oneOf?: JsonSchemaProperty[];
  anyOf?: JsonSchemaProperty[];
  [key: string]: unknown;
}

type JsonSchema = JsonSchemaProperty & {
  $schema?: string;
  properties?: Record<string, JsonSchemaProperty>;
};

/**
 * Type guard for objects with an action property
 */
function hasAction(value: unknown): value is { action: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'action' in value &&
    typeof (value as { action: unknown }).action === 'string'
  );
}

/**
 * Extract action from error or its cause chain
 */
function extractActionFromError(error: unknown): string | undefined {
  if (hasAction(error)) {
    return error.action;
  }

  // Check error cause (for wrapped errors)
  const cause = (error as Error & { cause?: unknown }).cause;
  if (hasAction(cause)) {
    return cause.action;
  }

  return undefined;
}

/**
 * Check if a tool operation is idempotent (safe to retry)
 * browse_* tools are always idempotent (read-only)
 * list_*, get_*, and download_* tools are also idempotent
 */
function isIdempotentOperation(toolName: string): boolean {
  return (
    toolName.startsWith('browse_') ||
    toolName.startsWith('list_') ||
    toolName.startsWith('get_') ||
    toolName.startsWith('download_')
  );
}

/**
 * Convert an error to a structured GitLab error response
 * Extracts tool name and action from context, parses API errors
 */
function toStructuredError(
  error: unknown,
  toolName: string,
  toolArgs?: Record<string, unknown>,
): GitLabStructuredError | null {
  // If already a structured error, return it
  if (isStructuredToolError(error)) {
    return error.structuredError;
  }

  // Check if the error cause is a structured error (for wrapped errors)
  const cause = (error as Error & { cause?: unknown }).cause;
  if (isStructuredToolError(cause)) {
    return cause.structuredError;
  }

  if (!(error instanceof Error)) return null;

  // Extract action early - needed for both timeout and API errors
  let action = extractActionFromError(error);
  if (!action && toolArgs && typeof toolArgs.action === 'string') {
    action = toolArgs.action;
  }
  action ??= 'unknown';

  // Check for timeout error first (before parseGitLabApiError)
  const timeoutMs = parseTimeoutError(error.message);
  if (timeoutMs !== null) {
    const retryable = isIdempotentOperation(toolName);
    return createTimeoutError(toolName, action, timeoutMs, retryable);
  }

  // Try to parse GitLab API error from message
  const parsed = parseGitLabApiError(error.message);
  if (!parsed) return null;

  return handleGitLabError(
    { status: parsed.status, message: parsed.message },
    toolName,
    action,
    toolArgs,
  );
}

/** Guard: health monitor initialization runs once, not per session */
let healthMonitorInitialized = false;

/** Reset guard for testing */
export function resetHandlersState(): void {
  healthMonitorInitialized = false;
}

export async function setupHandlers(server: Server): Promise<void> {
  // Check if authentication is configured before trying to initialize connection
  const { isAuthenticationConfigured } = await import('./oauth/index');

  if (isAuthenticationConfigured()) {
    // Initialize health monitor ONCE (setupHandlers is called per session,
    // but the broadcast callback affects all sessions — avoid duplicate registrations)
    if (!healthMonitorInitialized) {
      healthMonitorInitialized = true;

      const healthMonitor = HealthMonitor.getInstance();

      // Register state change callback to broadcast tools/list_changed
      healthMonitor.onStateChange((_instanceUrl, from, to) => {
        // Only broadcast when transitioning between disconnected-like and connected-like states
        const isDisconnectedLike = (state: string): boolean =>
          state === 'disconnected' || state === 'connecting';

        if (isDisconnectedLike(from) !== isDisconnectedLike(to)) {
          // Fire-and-forget: async broadcast doesn't block state transition
          void (async () => {
            try {
              // Refresh registry cache to apply/remove connection health filter
              const { RegistryManager } = await import('./registry-manager');
              RegistryManager.getInstance().refreshCache();

              // Notify all connected MCP clients that tool list has changed
              const { getSessionManager } = await import('./session-manager');
              await getSessionManager().broadcastToolsListChanged();

              logInfo('Tool list updated after connection state change', { from, to });
            } catch (error) {
              logWarn('Failed to broadcast tools/list_changed after state change', {
                err: error as Error,
              });
            }
          })();
        }
      });

      await healthMonitor.initialize();
      const state = healthMonitor.getState();
      logInfo('Connection health monitor initialized', { state });

      // If we connected, rebuild registry cache with tier/version info
      if (state === 'healthy' || state === 'degraded') {
        const { RegistryManager } = await import('./registry-manager');
        RegistryManager.getInstance().refreshCache();
      }
    }
  } else {
    // No authentication configured - server will respond to tools/list but tool calls will fail
    logInfo('Skipping connection initialization - no authentication configured');
  }
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logInfo('ListToolsRequest received');

    // Get tools from registry manager (already filtered)
    const { RegistryManager } = await import('./registry-manager');
    const registryManager = RegistryManager.getInstance();
    const tools = registryManager.getAllToolDefinitions();

    logInfo('Returning tools list', { toolCount: tools.length });

    // Helper function to resolve $ref references in JSON schema
    function resolveRefs(
      schema: JsonSchemaProperty | JsonSchemaProperty[],
      rootSchema?: JsonSchema,
    ): JsonSchemaProperty | JsonSchemaProperty[] {
      if (!schema || typeof schema !== 'object') return schema;

      // Set root schema for reference resolution
      rootSchema ??= schema as JsonSchema;

      // Handle arrays
      if (Array.isArray(schema)) {
        return schema.map((item) => resolveRefs(item, rootSchema) as JsonSchemaProperty);
      }

      // Handle $ref resolution
      if (schema.$ref && typeof schema.$ref === 'string') {
        const refPath = schema.$ref.replace('#/properties/', '');
        const referencedProperty = rootSchema.properties?.[refPath];

        if (referencedProperty) {
          // Resolve the referenced property recursively
          const resolvedRef = resolveRefs(referencedProperty, rootSchema) as JsonSchemaProperty;
          // Merge with current properties (excluding $ref)
          const schemaWithoutRef = { ...schema };
          delete schemaWithoutRef.$ref;
          return { ...resolvedRef, ...schemaWithoutRef };
        }
        // If reference can't be resolved, remove $ref and keep other properties
        const schemaWithoutRef = { ...schema };
        delete schemaWithoutRef.$ref;
        return schemaWithoutRef;
      }

      // Recursively process all object properties
      const result: JsonSchemaProperty = {};
      for (const [key, value] of Object.entries(schema)) {
        if (key === 'properties' && typeof value === 'object' && value !== null) {
          // Special handling for properties object
          const resolvedProperties: Record<string, JsonSchemaProperty> = {};
          for (const [propKey, propValue] of Object.entries(
            value as Record<string, JsonSchemaProperty>,
          )) {
            resolvedProperties[propKey] = resolveRefs(propValue, rootSchema) as JsonSchemaProperty;
          }
          result[key] = resolvedProperties;
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result[key] = resolveRefs(value as JsonSchemaProperty, rootSchema);
        } else {
          result[key] = value;
        }
      }

      return result;
    }

    // Remove $schema for Gemini compatibility and ensure proper JSON schema format
    const modifiedTools = tools.map((tool) => {
      let inputSchema = tool.inputSchema;

      // Force all input schemas to be type: "object" for MCP compatibility
      if (inputSchema && typeof inputSchema === 'object') {
        inputSchema = { ...inputSchema, type: 'object' };
      }

      // Resolve $ref references for MCP agent compatibility
      if (inputSchema && typeof inputSchema === 'object') {
        const resolved = resolveRefs(inputSchema);
        // Only assign if resolved is an object (not array)
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          inputSchema = resolved;
        }
      }

      // Remove $schema for Gemini compatibility
      if (inputSchema && typeof inputSchema === 'object' && '$schema' in inputSchema) {
        const cleanedSchema = { ...inputSchema } as Record<string, unknown>;
        delete cleanedSchema.$schema;
        inputSchema = cleanedSchema;
      }

      return { ...tool, inputSchema };
    });

    return {
      tools: modifiedTools,
    };
  });

  // Call tool handler — wrapped with handler-level timeout to prevent infinite hangs.
  // Uses Promise.race() so that hung operations are actually cut off, not just flagged.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Create a timeout promise that rejects after HANDLER_TIMEOUT_MS
    const HANDLER_TIMEOUT_SYMBOL = Symbol('handler_timeout');
    let handlerTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<typeof HANDLER_TIMEOUT_SYMBOL>((resolve) => {
      handlerTimeoutId = setTimeout(() => resolve(HANDLER_TIMEOUT_SYMBOL), HANDLER_TIMEOUT_MS);
    });

    // The actual handler logic as a separate async function
    const handlerWork = async (): Promise<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }> => {
      if (!request.params.arguments) {
        throw new Error('Arguments are required');
      }

      // In condensed mode, tool/action is captured via request tracker for single-line log
      // In verbose mode, emit per-request INFO logs
      if (LOG_FORMAT === 'verbose') {
        logInfo(`Tool called: ${request.params.name}`);
      }

      // Check if authentication is configured
      const { isOAuthEnabled, isAuthenticationConfigured } = await import('./oauth/index');

      if (!isAuthenticationConfigured()) {
        // No token configured - return clear error with setup instructions
        throw new Error(
          'GITLAB_TOKEN environment variable is required to execute tools. ' +
            "Run 'npx @structured-world/gitlab-mcp setup' for interactive configuration, " +
            'or set GITLAB_TOKEN manually. ' +
            'Documentation: https://gitlab-mcp.sw.foundation/guide/configuration',
        );
      }

      // Resolve effective instance URL (OAuth multi-instance uses per-request context)
      const { getGitLabApiUrlFromContext } = await import('./oauth/index');
      const effectiveInstanceUrl = getGitLabApiUrlFromContext() ?? GITLAB_BASE_URL;

      // Check connection health — if disconnected, return structured error for non-context tools.
      // Context tools (manage_context) are allowed through for diagnostics (whoami, switch_instance).
      const healthMonitor = HealthMonitor.getInstance();
      const toolName = request.params.name;
      if (
        !healthMonitor.isInstanceReachable(effectiveInstanceUrl) &&
        toolName !== 'manage_context'
      ) {
        const action =
          request.params.arguments && typeof request.params.arguments.action === 'string'
            ? request.params.arguments.action
            : 'unknown';
        const instanceState = healthMonitor.getState(effectiveInstanceUrl);
        const connError = createConnectionFailedError(
          toolName,
          action,
          effectiveInstanceUrl,
          instanceState,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(connError, null, 2) }],
          isError: true,
        };
      }

      // Context tools (manage_context) can run without a GitLab connection —
      // skip connection bootstrap when disconnected/failed to avoid throwing
      // on getClient()/initialize() during cold disconnected start.
      // No reportSuccess/reportError here: context tools don't hit GitLab API,
      // so their outcome doesn't indicate GitLab health.
      if (
        toolName === 'manage_context' &&
        !healthMonitor.isInstanceReachable(effectiveInstanceUrl)
      ) {
        const { RegistryManager } = await import('./registry-manager');
        const registryManager = RegistryManager.getInstance();
        if (registryManager.hasToolHandler(toolName)) {
          const result = await registryManager.executeTool(toolName, request.params.arguments);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
      }

      // Check if connection is initialized - try to initialize if needed
      const connectionManager = ConnectionManager.getInstance();
      const oauthMode = isOAuthEnabled();

      try {
        // Try to get client first (basic initialization check)
        connectionManager.getClient();

        // In OAuth mode, ensure introspection is done (uses token from context)
        if (oauthMode) {
          await connectionManager.ensureIntrospected();
        }

        const instanceInfo = connectionManager.getInstanceInfo();
        if (LOG_FORMAT === 'verbose') {
          logInfo(`Connection verified: ${instanceInfo.version} ${instanceInfo.tier}`);
        }
      } catch {
        if (LOG_FORMAT === 'verbose') {
          logInfo('Connection not initialized, attempting to initialize...');
        }
        try {
          await connectionManager.initialize();
          connectionManager.getClient();

          // In OAuth mode, ensure introspection is done after init
          if (oauthMode) {
            await connectionManager.ensureIntrospected();
          }

          const instanceInfo = connectionManager.getInstanceInfo();
          if (LOG_FORMAT === 'verbose') {
            logInfo(`Connection initialized: ${instanceInfo.version} ${instanceInfo.tier}`);
          }

          // Rebuild registry cache now that tier/version info is available
          const { RegistryManager } = await import('./registry-manager');
          RegistryManager.getInstance().refreshCache();
        } catch (initError) {
          // Report bootstrap failure to health monitor
          if (initError instanceof Error) {
            healthMonitor.reportError(effectiveInstanceUrl, initError);
          }
          logError(
            `Connection initialization failed: ${initError instanceof Error ? initError.message : String(initError)}`,
          );
          throw new Error('Bad Request: Server not initialized', { cause: initError });
        }
      }

      // Dynamic tool dispatch using the new registry manager
      const toolArgs = request.params.arguments;
      const action = toolArgs && typeof toolArgs.action === 'string' ? toolArgs.action : undefined;

      // Access log tracking only runs in condensed mode (verbose mode uses per-line logs)
      if (LOG_FORMAT === 'condensed') {
        const requestTracker = getRequestTracker();
        requestTracker.setToolForCurrentRequest(toolName, action);

        // Capture current context and read-only state for access logging
        const { getContextManager } = await import('./entities/context/context-manager');
        const contextManager = getContextManager();
        const sessionContext = contextManager.getContext();
        if (sessionContext.scope?.path) {
          requestTracker.setContextForCurrentRequest(sessionContext.scope.path);
        }
        requestTracker.setReadOnlyForCurrentRequest(sessionContext.readOnly);

        // Increment tool count for connection tracking
        const currentRequestId = getCurrentRequestId();
        if (currentRequestId) {
          // Get session ID from the request stack to update connection stats
          const stack = requestTracker.getStack(currentRequestId);
          if (stack?.sessionId) {
            const connectionTracker = getConnectionTracker();
            connectionTracker.incrementTools(stack.sessionId);
          }
        }
      }

      try {
        // Import the registry manager
        const { RegistryManager } = await import('./registry-manager');
        const registryManager = RegistryManager.getInstance();

        // Check if tool exists and passes all filtering (applied at registry level)
        if (!registryManager.hasToolHandler(toolName)) {
          throw new Error(`Tool '${toolName}' is not available or has been filtered out`);
        }

        if (LOG_FORMAT === 'verbose') {
          logInfo(`Executing tool: ${toolName}`);
        }

        // Check OAuth context
        const { isOAuthEnabled, getTokenContext } = await import('./oauth/index');
        if (isOAuthEnabled()) {
          const context = getTokenContext();
          logDebug('OAuth context check before tool execution', {
            hasContext: !!context,
            hasToken: !!context?.gitlabToken,
            tool: toolName,
          });
        }

        // Execute the tool using the registry manager
        const result = await registryManager.executeTool(toolName, request.params.arguments);

        // Report success to health monitor
        healthMonitor.reportSuccess(effectiveInstanceUrl);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        // Report error to health monitor for connection health tracking
        if (error instanceof Error) {
          healthMonitor.reportError(effectiveInstanceUrl, error);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        // Preserve original error as cause to allow action extraction and structured error detection
        throw new Error(`Failed to execute tool '${toolName}': ${errorMessage}`, { cause: error });
      }
    };

    try {
      // Race the handler against the timeout — if handler hangs, timeout wins
      const result = await Promise.race([handlerWork(), timeoutPromise]);

      if (result === HANDLER_TIMEOUT_SYMBOL) {
        // Timeout won the race — handler is still running but we respond immediately
        const toolName = request.params.name;
        const action =
          request.params.arguments && typeof request.params.arguments.action === 'string'
            ? request.params.arguments.action
            : 'unknown';
        const retryable = isIdempotentOperation(toolName);
        const timeoutError = createTimeoutError(toolName, action, HANDLER_TIMEOUT_MS, retryable);

        logError(`Handler timeout: tool '${toolName}' timed out after ${HANDLER_TIMEOUT_MS}ms`);

        // Report timeout to health monitor as transient failure
        // Note: the timed-out handlerWork() may still call reportSuccess() later,
        // but that's acceptable — it just resets counters, and the timeout was already reported.
        const { getGitLabApiUrlFromContext } = await import('./oauth/index');
        const timedOutInstanceUrl = getGitLabApiUrlFromContext() ?? GITLAB_BASE_URL;
        HealthMonitor.getInstance().reportError(
          timedOutInstanceUrl,
          new Error(`Handler timeout after ${HANDLER_TIMEOUT_MS}ms`),
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(timeoutError, null, 2),
            },
          ],
          isError: true,
        };
      }

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logError(`Error in tool handler: ${errMsg}`);

      // Record error for access logging
      const reqTracker = getRequestTracker();
      reqTracker.setErrorForCurrentRequest(errMsg);

      // Record error on connection stats
      const curRequestId = getCurrentRequestId();
      if (curRequestId) {
        const stack = reqTracker.getStack(curRequestId);
        if (stack?.sessionId) {
          const connTracker = getConnectionTracker();
          connTracker.recordError(stack.sessionId, errMsg);
        }
      }

      // Try to convert to structured error for better LLM feedback
      const toolName = request.params.name;
      const toolArgs = request.params.arguments;
      const structuredError = toStructuredError(error, toolName, toolArgs);

      if (structuredError) {
        logDebug('Returning structured error response', { structuredError });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredError, null, 2),
            },
          ],
          isError: true,
        };
      }

      // Fallback to original error format
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    } finally {
      clearTimeout(handlerTimeoutId);
    }
  });
}
