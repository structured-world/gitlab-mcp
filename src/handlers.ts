import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConnectionManager } from './services/ConnectionManager';
import { HealthMonitor } from './services/HealthMonitor';
import { normalizeInstanceUrl } from './utils/url';
import { logInfo, logWarn, logError, logDebug } from './logger';
import {
  handleGitLabError,
  GitLabStructuredError,
  isStructuredToolError,
  createTimeoutError,
  createConnectionFailedError,
  parseTimeoutError,
  parseGitLabApiError,
  classifyError,
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

/** Record tool/error in condensed-mode access logs and connection stats.
 *  Used by early-return paths (disconnected, bootstrap failure, timeout). */
function recordEarlyReturnError(
  toolName: string,
  action: string | undefined,
  errorMessage: string,
): void {
  const requestTracker = getRequestTracker();
  if (LOG_FORMAT === 'condensed') {
    requestTracker.setToolForCurrentRequest(toolName, action);
    requestTracker.setErrorForCurrentRequest(errorMessage);
  }
  const currentRequestId = getCurrentRequestId();
  if (currentRequestId) {
    const stack = requestTracker.getStack(currentRequestId);
    if (stack?.sessionId) {
      getConnectionTracker().recordError(stack.sessionId, errorMessage);
    }
  }
}

/**
 * Check if a tool operation is idempotent (safe to retry).
 * browse_*, list_*, get_*, download_* are read-only.
 * manage_context is local despite the manage_ prefix.
 */
function isIdempotentOperation(toolName: string): boolean {
  // manage_context is read-only/local despite the manage_ prefix (whoami,
  // show_scope, set_scope, etc.) — it needs timeout protection and correct
  // retryable semantics, unlike manage_merge_request/manage_issue which mutate.
  return (
    toolName.startsWith('browse_') ||
    toolName.startsWith('list_') ||
    toolName.startsWith('get_') ||
    toolName.startsWith('download_') ||
    toolName === 'manage_context'
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

/** One-shot startup promise: health monitor init + registry refresh.
 *  Concurrent setupHandlers() calls await the same promise instead of racing. */
let healthMonitorStartup: Promise<void> | null = null;
/** One-shot guard: state change callback is registered exactly once */
let stateChangeRegistered = false;

/** Reset guard for testing */
export function resetHandlersState(): void {
  healthMonitorStartup = null;
  stateChangeRegistered = false;
}

export async function setupHandlers(server: Server): Promise<void> {
  // Check if authentication is configured before trying to initialize connection
  const { isAuthenticationConfigured } = await import('./oauth/index');

  if (isAuthenticationConfigured()) {
    // Initialize health monitor ONCE (setupHandlers is called per session,
    // but the broadcast callback affects all sessions — avoid duplicate registrations).
    // Use a shared promise so concurrent sessions await the same work.
    healthMonitorStartup ??= (async () => {
      try {
        const healthMonitor = HealthMonitor.getInstance();

        // Register state change callback exactly once — guard prevents duplicates
        // if healthMonitorStartup resets to null on failure and retries.
        if (!stateChangeRegistered) {
          stateChangeRegistered = true;
          const broadcastToolsListChangedForStateChange = async (
            instanceUrl: string,
            from: string,
            to: string,
          ): Promise<void> => {
            const { RegistryManager } = await import('./registry-manager');
            RegistryManager.getInstance().refreshCache(instanceUrl);

            const { getSessionManager } = await import('./session-manager');
            await getSessionManager().broadcastToolsListChanged();

            logInfo('Tool list updated after connection state change', {
              instanceUrl,
              from,
              to,
            });
          };

          healthMonitor.onStateChange((instanceUrl, from, to) => {
            // Broadcast on any state transition that could change the tool list:
            // disconnected↔connected changes available registries, and degraded↔healthy
            // can enable/disable version-gated tools (version goes from 'unknown' to real).
            if (from !== to) {
              broadcastToolsListChangedForStateChange(instanceUrl, from, to).catch(
                (error: unknown) => {
                  logWarn('Failed to broadcast tools/list_changed after state change', {
                    instanceUrl,
                    err: error as Error,
                  });
                },
              );
            }
          });
        }

        // Initializes with default GITLAB_BASE_URL only. OAuth multi-instance
        // URLs are NOT auto-tracked — reportSuccess/reportError are no-ops for
        // untracked URLs. Untracked URLs pass isInstanceReachable() as reachable.
        await healthMonitor.initialize();
        const state = healthMonitor.getState();
        logInfo('Connection health monitor initialized', { state });

        // Rebuild registry cache after initialization — applies tier/version info
        // when healthy/degraded, or applies disconnected-mode tool filtering otherwise.
        // Best-effort: a cache rebuild failure should not block handler installation.
        try {
          const { RegistryManager } = await import('./registry-manager');
          RegistryManager.getInstance().refreshCache();
        } catch (cacheError) {
          logWarn('Failed to refresh registry cache during handler setup', {
            err: cacheError as Error,
          });
        }
      } catch (error) {
        // Reset so the next session retries instead of re-awaiting a rejected promise
        healthMonitorStartup = null;
        throw error;
      }
    })();
    await healthMonitorStartup;
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

  // Call tool handler — all tool execution is wrapped with a handler-level timeout
  // using Promise.race() so the client gets a response early on hang. The underlying
  // work may continue running after the timeout fires, but late results are guarded
  // by the timedOut flag to prevent overwriting the timeout error response.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Capture instance URL early — used for both handlerWork and timeout reporting.
    // Must be resolved before Promise.race so timeout branch doesn't re-derive a
    // potentially different URL after a concurrent switch_instance.
    const { getGitLabApiUrlFromContext: getUrlFromCtx, isOAuthEnabled } =
      await import('./oauth/index');
    // In OAuth mode, use the per-request context URL to avoid bleeding the
    // last-set ConnectionManager instance across concurrent OAuth sessions.
    // When OAuth is enabled but no request context is available (e.g. startup
    // health check, non-OAuth transport), we fall back to GITLAB_BASE_URL as the
    // default instance. This is intentional: the alternative (returning an auth
    // error) would block health monitoring and tool-list initialization. The
    // fallback is safe because GITLAB_BASE_URL is always configured. See #379
    // for the planned migration to explicit URL threading.
    // In static-token mode, prefer the actively selected instance URL so
    // switch_instance requests continue routing to the current instance.
    const rawInstanceUrl = isOAuthEnabled()
      ? (getUrlFromCtx() ?? GITLAB_BASE_URL)
      : (ConnectionManager.getInstance().getCurrentInstanceUrl() ?? GITLAB_BASE_URL);
    // Normalize so CONNECTION_FAILED instance_url and HealthMonitor keys are consistent
    const requestInstanceUrl = normalizeInstanceUrl(rawInstanceUrl);

    // Flag to prevent late reportSuccess/reportError from a timed-out handlerWork()
    // overwriting the timeout signal already sent to HealthMonitor.
    let timedOut = false;
    // Tracks whether bootstrap was entered and whether it completed.
    // bootstrapStarted: true once we enter the init/introspection path (not set
    //   for disconnected manage_context bypass which does no GitLab I/O)
    // bootstrapComplete: true after init + introspection succeed (before cache rebuild)
    let bootstrapStarted = false;
    let bootstrapComplete = false;

    // Create a timeout promise that rejects after HANDLER_TIMEOUT_MS
    const HANDLER_TIMEOUT_SYMBOL = Symbol('handler_timeout');
    let handlerTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<typeof HANDLER_TIMEOUT_SYMBOL>((resolve) => {
      handlerTimeoutId = setTimeout(() => {
        timedOut = true;
        resolve(HANDLER_TIMEOUT_SYMBOL);
      }, HANDLER_TIMEOUT_MS);
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

      // Use the instance URL captured before Promise.race (requestInstanceUrl)
      // to ensure the entire dispatch path uses the same URL, even if a concurrent
      // switch_instance changes getCurrentInstanceUrl mid-request.
      const effectiveInstanceUrl = requestInstanceUrl;
      const connectionManager = ConnectionManager.getInstance();

      // Check connection health — if disconnected, return structured error for non-context tools.
      // Context tools (manage_context) are allowed through for diagnostic/context management
      // actions (e.g., whoami, show_scope, set_scope).
      const healthMonitor = HealthMonitor.getInstance();
      const toolName = request.params.name;
      // isInstanceReachable treats untracked URLs as reachable (first call before
      // HealthMonitor.initialize) and healthy/degraded as reachable.
      if (
        !healthMonitor.isInstanceReachable(effectiveInstanceUrl) &&
        toolName !== 'manage_context'
      ) {
        const action =
          request.params.arguments && typeof request.params.arguments.action === 'string'
            ? request.params.arguments.action
            : 'unknown';

        // Read state for CONNECTION_FAILED payload
        const rawState = healthMonitor.getState(effectiveInstanceUrl);
        let connectionState: 'connecting' | 'disconnected' | 'failed';
        if (rawState === 'failed') {
          connectionState = 'failed';
        } else if (rawState === 'connecting') {
          connectionState = 'connecting';
        } else {
          connectionState = 'disconnected';
        }
        const connError = createConnectionFailedError(
          toolName,
          action,
          effectiveInstanceUrl,
          connectionState,
        );

        recordEarlyReturnError(toolName, action, connError.message);

        return {
          content: [{ type: 'text', text: JSON.stringify(connError, null, 2) }],
          isError: true,
        };
      }

      // Disconnected/failed fast-path for manage_context: skip connection bootstrap
      // and health reporting. Most context actions operate on local state (cached
      // scopes, config, instance registry). Some actions (e.g. whoami) may attempt
      // GitLab API calls that fail gracefully. Health reporting is skipped because
      // the fast-path bypasses bootstrap — there's no connection lifecycle to report on.
      if (
        toolName === 'manage_context' &&
        !healthMonitor.isInstanceReachable(effectiveInstanceUrl)
      ) {
        // Track in condensed mode so disconnected context calls appear in access logs
        if (LOG_FORMAT === 'condensed') {
          const action =
            request.params.arguments && typeof request.params.arguments.action === 'string'
              ? request.params.arguments.action
              : undefined;
          const requestTracker = getRequestTracker();
          requestTracker.setToolForCurrentRequest(toolName, action);
        }

        const { RegistryManager } = await import('./registry-manager');
        const registryManager = RegistryManager.getInstance();
        // hasToolHandler + executeTool are not a single atomic operation — a concurrent
        // refreshCache() could swap the lookup cache between the two calls. In practice
        // this is benign: executeTool() falls through with undefined and we re-enter the
        // bootstrap path below. A full atomic getTool() refactor is tracked separately.
        if (registryManager.hasToolHandler(toolName)) {
          const result = await registryManager.executeTool(toolName, request.params.arguments);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
      }

      // Check if connection is initialized - try to initialize if needed
      bootstrapStarted = true;
      const oauthMode = isOAuthEnabled();

      try {
        // Ensure connection is initialized for this URL (no-op if already done)
        if (!connectionManager.isConnected(effectiveInstanceUrl)) {
          if (LOG_FORMAT === 'verbose') {
            logInfo('Connection not initialized, attempting to initialize...');
          }
          await connectionManager.initialize(effectiveInstanceUrl);
        }

        // Verify client is available for this URL
        connectionManager.getClient(effectiveInstanceUrl);

        // In OAuth mode, ensure introspection is done for the effective URL
        if (oauthMode) {
          await connectionManager.ensureIntrospected(effectiveInstanceUrl);
        }

        // Mark bootstrap complete BEFORE cache rebuild — refreshCache is local
        // bookkeeping, not a connectivity step. If it fails, the tool call should
        // still proceed (not return CONNECTION_FAILED for a successful connection).
        bootstrapComplete = true;

        // Rebuild registry cache AFTER full bootstrap (initialize + introspection)
        // so tier/version/widget availability are all populated.
        // TODO: refreshCache mutates a singleton cache — concurrent multi-instance
        // requests can race. Key cache by normalized URL instead (#386).
        {
          const { RegistryManager } = await import('./registry-manager');
          RegistryManager.getInstance().refreshCache(effectiveInstanceUrl);
        }
        // Best-effort log enrichment — getInstanceInfo may throw in OAuth-deferred
        // or degraded mode where version detection hasn't completed yet.
        if (LOG_FORMAT === 'verbose') {
          try {
            const instanceInfo = connectionManager.getInstanceInfo(effectiveInstanceUrl);
            logInfo(`Connection verified: ${instanceInfo.version} ${instanceInfo.tier}`);
          } catch {
            logDebug('Connection verified but instance info not yet available', {
              instanceUrl: effectiveInstanceUrl,
            });
          }
        }
      } catch (initError) {
        // Use bootstrapComplete (not isConnected) — isConnected flips after
        // initialize() but getClient/ensureIntrospected can still fail before
        // bootstrapComplete is set, and those failures should return CONNECTION_FAILED.
        if (!bootstrapComplete) {
          const errorCategory = initError instanceof Error ? classifyError(initError) : 'permanent';
          // Report bootstrap failure to HealthMonitor. When the handler has already
          // timed out, we still forward auth/permanent errors so the instance
          // converges to `failed` instead of staying in `reconnecting` indefinitely.
          if (initError instanceof Error) {
            if (!timedOut || errorCategory === 'auth' || errorCategory === 'permanent') {
              healthMonitor.reportError(effectiveInstanceUrl, initError);
            }
          }
          logError(
            `Connection initialization failed: ${initError instanceof Error ? initError.message : String(initError)}`,
            { instanceUrl: effectiveInstanceUrl },
          );
          // Return structured CONNECTION_FAILED so clients get instance_url,
          // reconnecting status, and suggested fix (not a generic "Bad Request")
          const action =
            request.params.arguments && typeof request.params.arguments.action === 'string'
              ? request.params.arguments.action
              : 'unknown';
          // Use error classification together with HealthMonitor state to determine
          // the derived connection state. For untracked URLs, getState() falls back
          // to 'disconnected', so we must not rely on that alone — otherwise
          // permanent/auth failures would incorrectly appear retriable.
          const monitorState = healthMonitor.getState(effectiveInstanceUrl);
          // Prefer explicit monitor states when available; otherwise derive from
          // the error category:
          // - auth/permanent → failed (no auto-retry)
          // - transient/other → disconnected (retriable)
          let derivedState: 'connecting' | 'disconnected' | 'failed';
          if (monitorState === 'connecting' || monitorState === 'failed') {
            derivedState = monitorState;
          } else if (errorCategory === 'auth' || errorCategory === 'permanent') {
            derivedState = 'failed';
          } else {
            derivedState = 'disconnected';
          }
          const connError = createConnectionFailedError(
            toolName,
            action,
            effectiveInstanceUrl,
            derivedState,
          );

          // Skip bookkeeping if timeout already recorded the error
          if (!timedOut) {
            recordEarlyReturnError(toolName, action, connError.message);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(connError, null, 2) }],
            isError: true,
          };
        }
        // Connected but getClient()/ensureIntrospected() failed — rethrow as
        // generic tool error. These are NOT connection failures (initialize
        // succeeded), so CONNECTION_FAILED would be misleading. The error will
        // be caught by the outer handler and returned as a standard tool error.
        throw initError;
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

        // Check if tool exists and passes all filtering (applied at registry level).
        // hasToolHandler + executeTool are not atomic — see comment above on the
        // bootstrap fast-path for context. Here a TOCTOU miss throws, which is
        // caught and converted to a McpError with the message below.
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

        // Report success — skip if handler already timed out (late completion
        // must not overwrite the timeout error already sent to HealthMonitor)
        if (!timedOut) {
          healthMonitor.reportSuccess(effectiveInstanceUrl);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        // Only report connectivity/auth errors to HealthMonitor — not request-level
        // 4xx (e.g. 404 "project not found") which don't indicate connection problems.
        // classifyError returns 'permanent' for 4xx like 400/403/404, 'transient' for network issues,
        // and 'auth' for authentication errors like 401; only 'transient' and 'auth' are reported here.
        if (!timedOut && error instanceof Error) {
          const category = classifyError(error);
          if (category === 'transient' || category === 'auth') {
            healthMonitor.reportError(effectiveInstanceUrl, error);
          }
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        // Preserve original error as cause to allow action extraction and structured error detection
        throw new Error(`Failed to execute tool '${toolName}': ${errorMessage}`, { cause: error });
      }
    };

    try {
      // Race all tools against the timeout. For non-idempotent mutations this
      // means the client gets a timeout response while the mutation may still
      // complete — but the alternative (no timeout) leaves bootstrap unbounded
      // if the instance is hung. The timedOut flag prevents late reportSuccess/
      // reportError from overwriting the timeout health signal.
      const result = await Promise.race([handlerWork(), timeoutPromise]);

      if (result === HANDLER_TIMEOUT_SYMBOL) {
        // timedOut already set in timer callback — handler is still running but we respond
        const toolName = request.params.name;
        const action =
          request.params.arguments && typeof request.params.arguments.action === 'string'
            ? request.params.arguments.action
            : 'unknown';
        const retryable = isIdempotentOperation(toolName);
        const timeoutError = createTimeoutError(toolName, action, HANDLER_TIMEOUT_MS, retryable);

        logError(`Handler timeout: tool '${toolName}' timed out after ${HANDLER_TIMEOUT_MS}ms`);

        // Only report to health monitor and clear inflight if bootstrap was
        // actually attempted (not for disconnected manage_context bypass which
        // does no GitLab I/O and shouldn't affect connection health).
        if (bootstrapStarted && !bootstrapComplete) {
          // Use "timed out" so classifyError() reliably treats this as transient
          // and triggers disconnected → auto-reconnect. Use a plain Error (not
          // InitializationTimeoutError) because this is a handler-level timeout,
          // not the startup init timeout from HealthMonitor.performConnect.
          HealthMonitor.getInstance().reportError(
            requestInstanceUrl,
            new Error(
              `Handler timed out after ${HANDLER_TIMEOUT_MS}ms — bootstrap did not complete`,
            ),
          );
          ConnectionManager.getInstance().clearInflight(requestInstanceUrl);
        }

        recordEarlyReturnError(toolName, action, timeoutError.message);

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
