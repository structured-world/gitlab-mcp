import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  SETTINGS_PANEL_RESOURCE_META,
  SETTINGS_PANEL_URI,
  settingsPanelHtml,
} from './entities/context/settings-panel';
import { MCP_APP_MIME_TYPE } from './mcp-apps';
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
  parseGitLabApiError,
  classifyError,
  parseTimeoutError,
} from './utils/error-handler';
import { GitLabTimeoutError } from './utils/fetch';
import { getRequestTracker, getConnectionTracker, getCurrentRequestId } from './logging/index';
import {
  LOG_FORMAT,
  HANDLER_TIMEOUT_MS,
  GITLAB_BASE_URL,
  GITLAB_READ_ONLY_MODE,
  GITLAB_ALLOWED_PROJECT_IDS,
  getEffectiveProjectId,
} from './config';
import { getSchemaMode } from './utils/schema-utils';
import { formatToolResult, errorToolResult } from './utils/tool-result';
import {
  APP_PANEL_SECURITY_SCHEMES,
  OAUTH_SECURITY_SCHEMES,
  resourceScopeRejection,
  toolScopeRejection,
  withReauthChallenge,
} from './oauth/tool-auth';
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AccountUnavailableError, withChatAccount } from './accounts/chat-accounts';
import { currentMcpServer, runWithMcpServer } from './mcp-server-context';
import { currentTokenAccount } from './accounts/token-account';
import {
  getConfigurationService,
  resolveCaller,
  runWithCaller,
  type Caller,
} from './configuration';
import {
  CONFIGURATION_TOOLS,
  callRestriction,
  isExemptFromSettings,
  listedToolSchema,
  scopeLabel,
  withoutScope,
  type EffectivePolicy,
} from './configuration/policy';
import { executeScoped, parseScopedArguments } from './configuration/scoped-execution';
import { withScopePaths, withTargetPaths } from './configuration/scope-ids';
import { operatorProjectRejection, withOperatorProjects } from './configuration/operator-projects';
import { assertOperatorOwnership } from './configuration/operator-ownership';
import { extractProjectsFromArgs } from './profiles/scope-enforcer';
import { withDefaultProject } from './configuration/default-project';

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
    typeof value.action === 'string'
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
 * Mixed command tools, including session mutations, are conservative.
 */
function isIdempotentOperation(toolName: string, declared?: boolean): boolean {
  if (declared !== undefined) return declared;
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
  declaredIdempotent?: boolean,
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

  // Check for timeout error first (before parseGitLabApiError).
  // Primary: instanceof for type safety in production.
  // Fallback: duck-typing by name+property for cross-module-graph cases.
  // Last resort: parse message string (covers handler-timeout wrapper case where
  // the original GitLabTimeoutError message is embedded in a generic Error).
  if (
    error instanceof GitLabTimeoutError ||
    (error instanceof Error &&
      error.name === 'GitLabTimeoutError' &&
      'timeoutMs' in error &&
      typeof (error as GitLabTimeoutError).timeoutMs === 'number')
  ) {
    const retryable = isIdempotentOperation(toolName, declaredIdempotent);
    return createTimeoutError(toolName, action, (error as GitLabTimeoutError).timeoutMs, retryable);
  }
  if (error instanceof Error) {
    const timeoutMs = parseTimeoutError(error.message);
    if (timeoutMs !== null) {
      const retryable = isIdempotentOperation(toolName, declaredIdempotent);
      return createTimeoutError(toolName, action, timeoutMs, retryable);
    }
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

/** Tracks connection bootstrap progress; shared with the handler-level timeout path. */
interface BootstrapState {
  started: boolean;
  complete: boolean;
}

/** Dependencies and per-call values passed to ensureBootstrapped. */
interface BootstrapContext {
  toolName: string;
  toolArguments: Record<string, unknown> | undefined;
  effectiveInstanceUrl: string;
  oauthMode: boolean;
  requestScopes?: readonly string[];
  connectionManager: ConnectionManager;
  healthMonitor: HealthMonitor;
  isTimedOut: () => boolean;
  bootstrapState: BootstrapState;
}

/**
 * Return a CONNECTION_FAILED response if the target instance is unreachable for
 * non-context tools, or null to proceed normally.
 *
 * Configuration tools always pass through: they work on local state and are how the
 * caller finds out about, and recovers from, the disconnected state.
 */
function checkUnreachableInstance(
  toolName: string,
  toolArguments: Record<string, unknown> | undefined,
  effectiveInstanceUrl: string,
  healthMonitor: HealthMonitor,
): CallToolResult | null {
  if (
    healthMonitor.isInstanceReachable(effectiveInstanceUrl) ||
    CONFIGURATION_TOOLS.has(toolName)
  ) {
    return null;
  }
  const action =
    toolArguments && typeof toolArguments.action === 'string' ? toolArguments.action : 'unknown';
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
  return errorToolResult(connError);
}

/**
 * Fast-path for configuration tools when the instance is unreachable: bypass connection
 * bootstrap and health reporting. Returns a tool response if handled, or null to
 * fall through to the normal bootstrap path.
 *
 * Bypasses bootstrap intentionally — context tools mostly operate on local state
 * (cached scopes, config, instance registry). Some of them read GitLab too (check_connection,
 * find_scope_targets, scope checks), and a caller runs them to check or recover the
 * connection; their own success says nothing about GitLab, so instead of reporting it the
 * monitor is asked to probe GitLab again, which lets other tools recover at once.
 */
async function tryManageContextFastPath(
  toolName: string,
  toolArguments: Record<string, unknown> | undefined,
  effectiveInstanceUrl: string,
  healthMonitor: HealthMonitor,
  sessionId: string | undefined,
  requestScopes: readonly string[] | undefined,
): Promise<CallToolResult | null> {
  if (
    !CONFIGURATION_TOOLS.has(toolName) ||
    healthMonitor.isInstanceReachable(effectiveInstanceUrl)
  ) {
    return null;
  }
  const result = await executeWithoutBootstrap(
    toolName,
    toolArguments,
    effectiveInstanceUrl,
    requestScopes,
  );
  // Not rate-limited: only a user's settings call while GitLab is unreachable asks for this
  // probe, the monitor drops it while one is running, and a cooldown would keep the other
  // tools down after GitLab answers again, which is what the probe is for.
  if (result) healthMonitor.forceReconnect(effectiveInstanceUrl);
  return result;
}

/**
 * Calls that run without bootstrapping the instance: configuration tools while it is
 * unreachable, and the account actions always. Listing, switching, linking and unlinking
 * accounts read the session store and the instance configuration, never this instance, so a
 * chat whose instance fails to start can still move to an account that works. Returns null
 * to fall through to the bootstrap path.
 */
async function tryWithoutBootstrap(
  request: CallToolRequest,
  toolArguments: Record<string, unknown> | undefined,
  effectiveInstanceUrl: string,
  healthMonitor: HealthMonitor,
  sessionId: string | undefined,
  requestScopes: readonly string[] | undefined,
): Promise<CallToolResult | null> {
  const toolName = request.params.name;
  const fastPath = await tryManageContextFastPath(
    toolName,
    toolArguments,
    effectiveInstanceUrl,
    healthMonitor,
    sessionId,
    requestScopes,
  );
  if (fastPath || !managesAccounts(request)) return fastPath;
  return executeWithoutBootstrap(toolName, toolArguments, effectiveInstanceUrl, requestScopes);
}

/**
 * Run a tool without bootstrapping its instance. Returns null when the tool is not in the
 * instance's cache, so the caller falls through to the bootstrap path.
 */
async function executeWithoutBootstrap(
  toolName: string,
  toolArguments: Record<string, unknown> | undefined,
  effectiveInstanceUrl: string,
  requestScopes: readonly string[] | undefined,
): Promise<CallToolResult | null> {
  if (LOG_FORMAT === 'condensed') {
    const action =
      toolArguments && typeof toolArguments.action === 'string' ? toolArguments.action : undefined;
    const requestTracker = getRequestTracker();
    requestTracker.setToolForCurrentRequest(toolName, action);
  }
  const { RegistryManager } = await import('./registry-manager');
  const registryManager = RegistryManager.getInstance();
  // hasToolHandler + executeTool are not a single atomic operation — a concurrent
  // refreshCache() could swap the lookup cache between the two calls. In practice
  // this is benign: executeTool() falls through with undefined and we re-enter the
  // bootstrap path below. A full atomic getTool() refactor is tracked separately.
  if (!registryManager.hasToolHandler(toolName, effectiveInstanceUrl)) {
    return null; // tool not yet cached — fall through to bootstrap
  }
  // The request's grants apply here too: a token without the tool's scopes is refused
  // exactly as on the connected path, whatever GitLab's reachability.
  const result = await registryManager.executeTool(
    toolName,
    toolArguments,
    effectiveInstanceUrl,
    requestScopes,
  );
  // If executeTool returns undefined (TOCTOU: cache was refreshed between hasToolHandler and
  // executeTool), fall through to the bootstrap path instead of returning {text: "undefined"}.
  if (result === undefined) {
    return null;
  }
  return formatToolResult(
    result,
    registryManager.getTool(toolName, effectiveInstanceUrl, requestScopes),
  );
}

/**
 * Initialize the connection, verify the client, and rebuild the per-URL tool cache.
 *
 * Mutates bootstrapState to track progress for the handler-level timeout path.
 * Returns a CONNECTION_FAILED response when bootstrap fails (connection, client, or
 * introspection step), or undefined on success. All errors are handled internally
 * and surfaced as a CONNECTION_FAILED payload — none are rethrown to the caller.
 */
async function ensureBootstrapped(ctx: BootstrapContext): Promise<CallToolResult | undefined> {
  const { effectiveInstanceUrl, oauthMode, requestScopes, connectionManager, bootstrapState } = ctx;
  bootstrapState.started = true;
  try {
    const firstInitialization = !connectionManager.isConnected(effectiveInstanceUrl);
    if (firstInitialization) {
      if (LOG_FORMAT === 'verbose') {
        logInfo('Connection not initialized, attempting to initialize...');
      }
      await connectionManager.initialize(effectiveInstanceUrl);
    }
    connectionManager.getClient(effectiveInstanceUrl);
    if (oauthMode) {
      await connectionManager.ensureIntrospected(effectiveInstanceUrl, requestScopes);
    }
    // Mark bootstrap complete BEFORE cache rebuild — refreshCache is local
    // bookkeeping, not a connectivity step. If it fails, the tool call should
    // still proceed (not return CONNECTION_FAILED for a successful connection).
    bootstrapState.complete = true;
    // Rebuild per-URL registry cache AFTER full bootstrap (initialize + introspection)
    // so tier/version/widget availability are all populated.
    // Cache is keyed by normalized URL — concurrent multi-instance requests
    // each get their own cache entry and cannot interfere (#379).
    // Isolated try/catch: cache rebuild is best-effort; a failure must NOT abort
    // the tool call — the connection is already established at this point.
    try {
      const { RegistryManager } = await import('./registry-manager');
      RegistryManager.getInstance().refreshCache(effectiveInstanceUrl);
    } catch (cacheError) {
      logWarn('Failed to refresh registry cache after bootstrap', {
        instanceUrl: effectiveInstanceUrl,
        err: cacheError as Error,
      });
    }
    // A list sent before the instance was initialized (a chat that just switched to it,
    // say) could not be filtered by its version, tier and token scopes: clients list again.
    if (firstInitialization) announceToolListChange(effectiveInstanceUrl);
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
    return undefined;
  } catch (initError) {
    return formatBootstrapFailure(ctx, initError);
  }
}

/**
 * Tell the sessions on `instanceUrl` and the calling chat (a sessionless one, or one on the
 * same instance with another account) that their tool list changed; best effort.
 */
function announceToolListChange(instanceUrl: string): void {
  void import('./session-manager')
    .then(({ getSessionManager }) => getSessionManager().broadcastToolsListChanged(instanceUrl))
    .catch((error: unknown) => logDebug('Could not announce the tool list', { err: error }));
  void currentMcpServer()
    ?.sendToolListChanged()
    .catch((error: unknown) => logDebug('Could not announce the tool list', { err: error }));
}

function bootstrapFailureState(
  monitorState: string,
  category: ReturnType<typeof classifyError>,
): 'connecting' | 'disconnected' | 'failed' {
  if (monitorState === 'connecting' || monitorState === 'failed') return monitorState;
  return category === 'auth' || category === 'permanent' ? 'failed' : 'disconnected';
}

function formatBootstrapFailure(ctx: BootstrapContext, initError: unknown): CallToolResult {
  const { toolName, toolArguments, effectiveInstanceUrl, healthMonitor, isTimedOut } = ctx;
  // Bootstrap has not completed here: refreshCache is isolated above,
  // so the only way to reach this catch is initialize()/getClient()/ensureIntrospected()
  // failing before bootstrapState.complete was set.
  const errorCategory = initError instanceof Error ? classifyError(initError) : 'permanent';
  // Report bootstrap failure to HealthMonitor. When the handler has already
  // timed out, we still forward auth/permanent errors so the instance
  // converges to `failed` instead of staying in `reconnecting` indefinitely.
  if (initError instanceof Error) {
    if (!isTimedOut() || errorCategory === 'auth' || errorCategory === 'permanent') {
      healthMonitor.reportError(effectiveInstanceUrl, initError);
    }
  }
  logError(
    `Connection initialization failed: ${initError instanceof Error ? initError.message : String(initError)}`,
    {
      instanceUrl: effectiveInstanceUrl,
      err: initError instanceof Error ? initError : new Error(String(initError)),
    },
  );
  const action =
    toolArguments && typeof toolArguments.action === 'string' ? toolArguments.action : 'unknown';
  // Use error classification together with HealthMonitor state to determine
  // the derived connection state. For untracked URLs, getState() falls back
  // to 'disconnected', so we must not rely on that alone — otherwise
  // permanent/auth failures would incorrectly appear retriable.
  const monitorState = healthMonitor.getState(effectiveInstanceUrl);
  // Prefer explicit monitor states when available; otherwise derive from the
  // error category: auth/permanent → failed (no auto-retry),
  // transient/other → disconnected (retriable)
  const derivedState = bootstrapFailureState(monitorState, errorCategory);
  const connError = createConnectionFailedError(
    toolName,
    action,
    effectiveInstanceUrl,
    derivedState,
  );
  if (!isTimedOut()) {
    recordEarlyReturnError(toolName, action, connError.message);
  }
  return withReauthChallenge(errorToolResult(connError), initError);
}

/** manage_context actions that manage the connection's accounts. */
const ACCOUNT_ACTIONS: ReadonlySet<string> = new Set([
  'list_accounts',
  'switch_account',
  'link_account',
  'unlink_account',
]);

/** Whether a call lists, switches, links or unlinks the connection's accounts. */
function managesAccounts(request: CallToolRequest): boolean {
  const action = request.params.arguments?.action;
  return (
    request.params.name === 'manage_context' &&
    typeof action === 'string' &&
    ACCOUNT_ACTIONS.has(action)
  );
}

/**
 * The instance a request works with, normalized: the OAuth token's (the configured one
 * without a request context), else the instance the static token works with now.
 */
function activeInstanceUrl(oauthEnabled: boolean, oauthContextUrl: string | undefined): string {
  // A static-token chat works with the server's own instance, or the configured one it
  // switched to; another chat's switch never moves it.
  const raw = oauthEnabled
    ? (oauthContextUrl ?? GITLAB_BASE_URL)
    : (currentTokenAccount()?.instanceUrl ?? GITLAB_BASE_URL);
  // Normalized so CONNECTION_FAILED instance_url and HealthMonitor keys are consistent.
  return normalizeInstanceUrl(raw);
}

/**
 * Keep the session's instance URL in sync so ListTools requests reflect the instance its
 * calls go to, and no other: in OAuth mode that is the token's instance, so context changes
 * (switch_preset, reset) need no re-pin of their own. In OAuth mode only a real context URL
 * is pinned; the GITLAB_BASE_URL fallback of a contextless call (health checks, non-OAuth
 * transport) must not overwrite a session pinned to a specific instance. In static-token
 * mode the active instance is always tracked.
 *
 * Account actions do not pin: they run as the connection's own account whichever account
 * the chat switched to, and switch_account pins the instance it moves to itself.
 */
async function pinSessionInstance(
  sessionId: string,
  oauthEnabled: boolean,
  oauthContextUrl: string | undefined,
  instanceUrl: string,
): Promise<void> {
  if (oauthEnabled && oauthContextUrl === undefined) return;
  const { getSessionManager } = await import('./session-manager');
  getSessionManager().setSessionInstanceUrl(sessionId, instanceUrl);
}

const HANDLER_TIMEOUT = Symbol('handler_timeout');

/** The time a call has from its arrival; resolving its account and running it share it. */
interface CallDeadline {
  expired: Promise<typeof HANDLER_TIMEOUT>;
  isExpired: () => boolean;
  clear: () => void;
}

function startCallDeadline(): CallDeadline {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof HANDLER_TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(HANDLER_TIMEOUT);
    }, HANDLER_TIMEOUT_MS);
  });
  return { expired: promise, isExpired: () => expired, clear: () => clearTimeout(timer) };
}

/**
 * The response to a call whose handler ran out of time; the handler may still be running.
 * A bootstrap it left unfinished is reported to the health monitor.
 */
function handlerTimeoutResult(
  request: CallToolRequest,
  declaredIdempotent: boolean | undefined,
  bootstrapState: BootstrapState,
  requestInstanceUrl: string,
): CallToolResult {
  const toolName = request.params.name;
  const requested = request.params.arguments?.action;
  const action = typeof requested === 'string' ? requested : 'unknown';
  const retryable = isIdempotentOperation(toolName, declaredIdempotent);
  const timeoutError = createTimeoutError(toolName, action, HANDLER_TIMEOUT_MS, retryable);

  logError(`Handler timeout: tool '${toolName}' timed out after ${HANDLER_TIMEOUT_MS}ms`);

  // Only report to health monitor and clear inflight if bootstrap was
  // actually attempted (not for disconnected manage_context bypass which
  // does no GitLab I/O and shouldn't affect connection health).
  if (bootstrapState.started && !bootstrapState.complete) {
    // Use "timed out" so classifyError() reliably treats this as transient
    // and triggers disconnected → auto-reconnect. Use a plain Error (not
    // InitializationTimeoutError) because this is a handler-level timeout,
    // not the startup init timeout from HealthMonitor.performConnect.
    HealthMonitor.getInstance().reportError(
      requestInstanceUrl,
      new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms — bootstrap did not complete`),
    );
    ConnectionManager.getInstance().clearInflight(requestInstanceUrl);
  }

  recordEarlyReturnError(toolName, action, timeoutError.message);

  return errorToolResult(timeoutError);
}

/** Record a failed call for the access log and on its connection's stats. */
function recordToolError(errMsg: string): void {
  const reqTracker = getRequestTracker();
  reqTracker.setErrorForCurrentRequest(errMsg);

  const curRequestId = getCurrentRequestId();
  const sessionId = curRequestId ? reqTracker.getStack(curRequestId)?.sessionId : undefined;
  if (sessionId) {
    getConnectionTracker().recordError(sessionId, errMsg);
  }
}

/**
 * The tool list narrowed by the caller's settings: restricted tools and the actions the
 * preset denies are left out. When the settings cannot be read the list stays as the
 * registry built it: listing is only visibility, and every call is still checked (and
 * refused while the settings cannot be read).
 */
async function withoutRestrictedTools<
  T extends { name: string; inputSchema: Record<string, unknown> },
>(
  tools: T[],
  caller: Caller,
  registryManager: import('./registry-manager').RegistryManager,
): Promise<T[]> {
  let policy: EffectivePolicy;
  try {
    policy = (await getConfigurationService().resolve(caller)).policy;
  } catch (error: unknown) {
    logWarn('Could not read the caller settings for the tool list', { err: error as Error });
    return tools;
  }
  const listed: T[] = [];
  for (const tool of tools) {
    const inputSchema = listedToolSchema(
      policy,
      registryManager.getToolFacts(tool.name),
      tool.inputSchema,
    );
    if (inputSchema)
      listed.push(inputSchema === tool.inputSchema ? tool : { ...tool, inputSchema });
  }
  return listed;
}

/**
 * A refusal for a call the caller's settings do not allow, or null when it may run. Tool,
 * group, read-only and action limits come first: they need nothing from GitLab, so a call
 * they refuse reaches nothing. Then the scope, which compares paths: numeric ids, the call's
 * and the scope's own, are checked as the paths they stand for. The returned policy is the
 * one the call runs under.
 */
async function prepareScopedCall(
  toolName: string,
  args: Record<string, unknown>,
  configured: EffectivePolicy,
  registryManager: import('./registry-manager').RegistryManager,
  expired: () => boolean,
): Promise<{
  rejection: CallToolResult | null;
  args: Record<string, unknown>;
  policy: EffectivePolicy;
}> {
  const unscoped = settingsRejection(toolName, args, withoutScope(configured), registryManager);
  if (unscoped || isExemptFromSettings(toolName))
    return { rejection: unscoped, args, policy: configured };
  const action = typeof args.action === 'string' ? args.action : undefined;
  const defaultProject = getEffectiveProjectId(undefined);
  const defaults = defaultProject
    ? await withDefaultProject(
        toolName,
        args,
        registryManager.getDeclaredArguments(toolName, action),
        defaultProject,
        expired,
      )
    : { args, read: undefined };
  args = defaults.args;
  if (!configured.scopeEnforcer && GITLAB_ALLOWED_PROJECT_IDS.length === 0)
    return { rejection: null, args, policy: configured };
  const selected = parseScopedArguments(toolName, args);
  // The tool's parse keeps only the selected action's arguments, so only those are held to
  // the scope.
  const declared =
    selected === args ? registryManager.getDeclaredArguments(toolName, action) : undefined;
  const own = declared
    ? Object.fromEntries(Object.entries(selected).filter(([name]) => declared.has(name)))
    : selected;
  const operatorRejection = operatorProjectRejection(own);
  if (operatorRejection) {
    return {
      rejection: errorToolResult({ error: operatorRejection }),
      args: selected,
      policy: configured,
    };
  }
  const policy =
    GITLAB_ALLOWED_PROJECT_IDS.length > 0
      ? await withOperatorProjects(configured, defaults.read, expired, extractProjectsFromArgs(own))
      : await withScopePaths(configured, defaults.read);
  const rejection = settingsRejection(
    toolName,
    await withTargetPaths(own, defaults.read, policy.scopeEnforcer),
    policy,
    registryManager,
  );
  return {
    rejection,
    args: selected,
    policy,
  };
}

/** A refusal for a call the given policy does not allow, or null when it may run. */
function settingsRejection(
  toolName: string,
  args: Record<string, unknown>,
  policy: EffectivePolicy,
  registryManager: import('./registry-manager').RegistryManager,
): CallToolResult | null {
  const reason = callRestriction(policy, registryManager.getToolFacts(toolName), args);
  if (reason === null) return null;
  const action = typeof args.action === 'string' ? args.action : undefined;
  const call = action ? `${toolName} ${action}` : toolName;
  const message =
    `'${call}' is not allowed by the current settings: ` +
    `${reason}. The account settings are changed with update_settings, this session's ` +
    'with manage_context.';
  recordEarlyReturnError(toolName, action, message);
  return errorToolResult({ error: message });
}

/**
 * Runs the tool through the registry (per-URL cache). A listing that names no target
 * reads the working scope instead of everything the account sees.
 */
async function executeInScope(
  registryManager: import('./registry-manager').RegistryManager,
  toolName: string,
  requested: Record<string, unknown>,
  policy: EffectivePolicy,
  instanceUrl: string | undefined,
  requestScopes: readonly string[] | undefined,
): Promise<unknown> {
  // executeScoped wraps this runner so every call it makes in place of the requested one is
  // held to the preset's denied actions; the operator's are checked by each tool itself.
  const run = (tool: string, toolArgs: Record<string, unknown>): Promise<unknown> =>
    requestScopes === undefined
      ? registryManager.executeTool(tool, toolArgs, instanceUrl)
      : registryManager.executeTool(tool, toolArgs, instanceUrl, requestScopes);
  return executeScoped(run, toolName, requested, policy, true);
}

function recordCallContext(scopePath: string | undefined, readOnly: boolean): void {
  const requestTracker = getRequestTracker();
  // Capture current context and read-only state for access logging
  if (scopePath) {
    requestTracker.setContextForCurrentRequest(scopePath);
  }
  requestTracker.setReadOnlyForCurrentRequest(readOnly);

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

function throwDispatchError(
  error: unknown,
  toolName: string,
  instanceUrl: string,
  healthMonitor: HealthMonitor,
  timedOut: boolean,
): never {
  // Only report connectivity/auth errors to HealthMonitor — not request-level
  // 4xx (e.g. 404 "project not found") which don't indicate connection problems.
  // classifyError returns 'permanent' for 4xx like 400/403/404, 'transient' for network issues,
  // and 'auth' for authentication errors like 401; only 'transient' and 'auth' are reported here.
  if (!timedOut && error instanceof Error) {
    const category = classifyError(error);
    if (category === 'transient' || category === 'auth') {
      healthMonitor.reportError(instanceUrl, error);
    }
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  // Preserve original error as cause to allow action extraction and structured error detection
  throw new Error(`Failed to execute tool '${toolName}': ${errorMessage}`, { cause: error });
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

/**
 * Register all MCP request handlers on a Server instance.
 *
 * Called once per session by SessionManager. Handlers are idempotent across
 * sessions — the same logic is registered on each per-session Server instance.
 * One-shot initialisation guards (HealthMonitor startup, state-change callback)
 * are protected by module-level flags so they run exactly once across all sessions.
 */
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
            // Pass instanceUrl so only sessions targeting the changed instance are notified.
            // Sessions on other instances have no tool list changes from this state transition.
            await getSessionManager().broadcastToolsListChanged(instanceUrl);

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

  // The settings panel is the server's one resource: an MCP App document. It holds no
  // account data; everything it shows comes from tool calls made with the caller's own
  // authorization.
  server.setRequestHandler(ListResourcesRequestSchema, () => {
    const rejection = resourceScopeRejection();
    if (rejection) throw rejection;
    return {
      resources: [
        {
          uri: SETTINGS_PANEL_URI,
          name: 'GitLab connection panel',
          mimeType: MCP_APP_MIME_TYPE,
          _meta: SETTINGS_PANEL_RESOURCE_META,
        },
      ],
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const rejection = resourceScopeRejection();
    if (rejection) throw rejection;
    if (request.params.uri !== SETTINGS_PANEL_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          uri: SETTINGS_PANEL_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: settingsPanelHtml(),
          _meta: SETTINGS_PANEL_RESOURCE_META,
        },
      ],
    };
  });

  // List tools handler
  // Uses per-session instance URL tracking so each session receives the tool list
  // filtered for its target GitLab instance (#398). The sessionId from RequestHandlerExtra
  // resolves to the instance URL stored in SessionManager (set on session creation and
  // kept in sync by the CallToolRequestSchema handler on every tool call).
  const listTools = async (extra: { sessionId?: string } | undefined) => {
    logInfo('ListToolsRequest received');

    // Resolve the instance URL for this session so the tool list reflects the
    // correct tier/version/scope restrictions for the session's target instance.
    const { getSessionManager: getSessionMgr } = await import('./session-manager');
    const sessionMgr = getSessionMgr();
    const listToolsSessionId = extra?.sessionId;
    // SessionManager always initialises instanceUrl on createSession(), so undefined here
    // means the sessionId is unknown/expired (or absent). Pass it through so
    // getAllToolDefinitions can resolve via its built-in chain: OAuth request context →
    // current instance URL → GITLAB_BASE_URL. Substituting GITLAB_BASE_URL explicitly
    // would short-circuit that chain and return the wrong tool list for OAuth requests
    // with a real context URL or after an instance switch (#398).
    //
    // HTTP OAuth requests carry their own token context, including tools/list.
    // Static-token requests use the tracked session URL after an instance switch.
    const sessionInstanceUrl =
      listToolsSessionId !== undefined
        ? sessionMgr.getSessionInstanceUrl(listToolsSessionId)
        : undefined;

    // Get tools from registry manager (already filtered by tier/version/scopes)
    const { RegistryManager } = await import('./registry-manager');
    const registryManager = RegistryManager.getInstance();
    const mode = getSchemaMode(server.getClientVersion()?.name);
    const {
      getTokenContext: getCatalogContext,
      isOAuthEnabled: isCatalogOAuth,
      getGitLabApiUrlFromContext: getCatalogUrl,
    } = await import('./oauth/index');
    const scopes = getCatalogContext()?.gitlabScopes;
    // OAuth deployments declare the token every tool needs; static-token mode keeps
    // the descriptors as before.
    const securitySchemes = isCatalogOAuth() ? OAUTH_SECURITY_SCHEMES : undefined;
    const catalog =
      scopes === undefined
        ? registryManager.getAllToolDefinitions(sessionInstanceUrl, mode)
        : registryManager.getAllToolDefinitions(sessionInstanceUrl, mode, scopes);
    // A sessionless client (stdio) is listed with the settings of the instance its calls run
    // against, which follows the account the chat switched to.
    const callerInstanceUrl =
      sessionInstanceUrl ??
      activeInstanceUrl(isCatalogOAuth(), isCatalogOAuth() ? getCatalogUrl() : undefined);
    const tools = await withoutRestrictedTools(
      catalog,
      resolveCaller(listToolsSessionId, callerInstanceUrl),
      registryManager,
    );

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

      // A tool that declares its own schemes keeps them.
      if (!securitySchemes || tool._meta?.securitySchemes !== undefined) {
        return { ...tool, inputSchema };
      }
      // A tool that opens an app panel also needs the panel resource read. Mirrored in _meta
      // for clients whose descriptor schema drops unknown top-level fields.
      const schemes = tool._meta?.ui ? APP_PANEL_SECURITY_SCHEMES : securitySchemes;
      return {
        ...tool,
        inputSchema,
        securitySchemes: schemes,
        _meta: { ...tool._meta, securitySchemes: schemes },
      };
    });

    return {
      tools: modifiedTools,
    };
  };
  // The chat lists the tools of the account it works with. An account it switched to that
  // cannot be used now lists the connection's own; every call is refused until it switches.
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    try {
      return await withChatAccount(extra?.sessionId, () => listTools(extra));
    } catch (error) {
      if (!(error instanceof AccountUnavailableError)) throw error;
      return listTools(extra);
    }
  });

  // Call tool handler — all tool execution is wrapped with a handler-level timeout
  // using Promise.race() so the client gets a response early on hang. The underlying
  // work may continue running after the timeout fires, but late results are guarded
  // by the timedOut flag to prevent overwriting the timeout error response.
  const callTool = async (
    request: CallToolRequest,
    extra: { sessionId?: string } | undefined,
    deadline: CallDeadline,
  ): Promise<CallToolResult> => {
    // Capture instance URL early — used for both handlerWork and timeout reporting.
    // Must be resolved before Promise.race so timeout branch doesn't re-derive a
    // potentially different URL after a concurrent instance change.
    const {
      getGitLabApiUrlFromContext: getUrlFromCtx,
      isOAuthEnabled,
      getTokenContext: getCallContext,
    } = await import('./oauth/index');
    // In OAuth mode, use the per-request context URL to avoid bleeding the
    // last-set ConnectionManager instance across concurrent OAuth sessions.
    // When OAuth is enabled but no request context is available (e.g. startup
    // health check, non-OAuth transport), we fall back to GITLAB_BASE_URL as the
    // default instance. This is intentional: the alternative (returning an auth
    // error) would block health monitoring and tool-list initialization. The
    // fallback is safe because GITLAB_BASE_URL is always configured.
    // In static-token mode, prefer the actively selected instance URL so
    // requests continue routing to the current instance.
    const oauthEnabled = isOAuthEnabled();
    if (oauthEnabled) {
      const rejection = toolScopeRejection();
      if (rejection) return rejection;
    }
    const requestScopes = oauthEnabled ? getCallContext()?.gitlabScopes : undefined;
    let declaredIdempotent: boolean | undefined;
    // getGitLabApiUrlFromContext() returns string | undefined; use undefined (not null)
    // so that strict equality checks below correctly detect "no OAuth context".
    const oauthContextUrl = oauthEnabled ? getUrlFromCtx() : undefined;
    const requestInstanceUrl = activeInstanceUrl(oauthEnabled, oauthContextUrl);

    const callSessionId = extra?.sessionId;
    if (callSessionId && !managesAccounts(request)) {
      await pinSessionInstance(callSessionId, oauthEnabled, oauthContextUrl, requestInstanceUrl);
    }
    // Whose settings apply, from the authenticated request only.
    const caller = resolveCaller(callSessionId, requestInstanceUrl);

    // Tracks whether bootstrap was entered and whether it completed.
    // started: true once we enter the init/introspection path (not set for the
    //   disconnected manage_context bypass which does no GitLab I/O)
    // complete: true after init + introspection succeed (before cache rebuild)
    const bootstrapState: BootstrapState = { started: false, complete: false };
    // A late reportSuccess/reportError from a timed-out handlerWork() must not overwrite the
    // timeout signal already sent to HealthMonitor.
    const timedOut = deadline.isExpired;

    // The actual handler logic as a separate async function
    const handlerWork = async (): Promise<CallToolResult> => {
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
      // to ensure the entire dispatch path uses the same URL.
      const effectiveInstanceUrl = requestInstanceUrl;
      const connectionManager = ConnectionManager.getInstance();
      const healthMonitor = HealthMonitor.getInstance();
      const toolName = request.params.name;
      let toolArguments = request.params.arguments;

      // The caller's settings, checked before anything reaches GitLab. A call is refused
      // when they cannot be read: allowing it could bypass a restriction.
      const { RegistryManager: CallRegistry } = await import('./registry-manager');
      const configuration = await getConfigurationService().resolve(caller);
      const prepared = await prepareScopedCall(
        toolName,
        toolArguments ?? {},
        configuration.policy,
        CallRegistry.getInstance(),
        timedOut,
      );
      if (prepared.rejection) return prepared.rejection;
      toolArguments = prepared.args;

      // Early return: instance unreachable for non-context tools
      // (isInstanceReachable treats untracked URLs as reachable before HealthMonitor.initialize)
      const unreachableResult = checkUnreachableInstance(
        toolName,
        toolArguments,
        effectiveInstanceUrl,
        healthMonitor,
      );
      if (unreachableResult) return unreachableResult;

      // Configuration tools while disconnected, and the account actions: no bootstrap
      const withoutBootstrap = await tryWithoutBootstrap(
        request,
        toolArguments,
        effectiveInstanceUrl,
        healthMonitor,
        callSessionId,
        requestScopes,
      );
      if (withoutBootstrap) return withoutBootstrap;

      // Initialize connection, verify client, and rebuild the per-URL tool cache
      const oauthMode = isOAuthEnabled();
      const bootstrapFailure = await ensureBootstrapped({
        toolName,
        toolArguments,
        effectiveInstanceUrl,
        oauthMode,
        requestScopes,
        connectionManager,
        healthMonitor,
        isTimedOut: timedOut,
        bootstrapState,
      });
      if (bootstrapFailure) return bootstrapFailure;

      // Dynamic tool dispatch using the new registry manager
      const toolArgs = request.params.arguments;
      const action = toolArgs && typeof toolArgs.action === 'string' ? toolArgs.action : undefined;

      // Access log tracking only runs in condensed mode (verbose mode uses per-line logs)
      if (LOG_FORMAT === 'condensed') {
        const requestTracker = getRequestTracker();
        requestTracker.setToolForCurrentRequest(toolName, action);
        recordCallContext(
          scopeLabel(configuration.policy.scope),
          GITLAB_READ_ONLY_MODE || configuration.policy.readOnly,
        );
      }

      try {
        // Import the registry manager
        const { RegistryManager } = await import('./registry-manager');
        const registryManager = RegistryManager.getInstance();
        const definition = registryManager.getTool(toolName, effectiveInstanceUrl, requestScopes);
        declaredIdempotent = definition?.idempotent ?? definition?.annotations?.idempotentHint;

        // Check if tool exists and passes all filtering (applied at registry level).
        // Uses per-URL cache so the check is against the correct instance's
        // tier/version/scopes. hasToolHandler + executeTool are not atomic — see
        // comment above on the bootstrap fast-path for context. Here a TOCTOU
        // miss throws, which is caught and converted to a McpError with the
        // message below.
        if (!registryManager.hasToolHandler(toolName, effectiveInstanceUrl)) {
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

        await assertOperatorOwnership(toolName, toolArguments, prepared.policy, timedOut);
        if (timedOut()) throw new Error('Tool call expired before execution');
        const result = await executeInScope(
          registryManager,
          toolName,
          toolArguments,
          prepared.policy,
          effectiveInstanceUrl,
          requestScopes,
        );

        // Guard against TOCTOU cache miss: hasToolHandler returned true but a
        // concurrent refreshCache swapped the lookup table before executeTool ran.
        // Re-throw so the outer catch converts it to a McpError, consistent with
        // the explicit hasToolHandler check above. Never return JSON.stringify(undefined)
        // which would produce an invalid MCP payload ("text: undefined").
        if (result === undefined) {
          throw new Error(`Tool '${toolName}' is not available or has been filtered out`);
        }

        // Report success — skip if handler already timed out (late completion
        // must not overwrite the timeout error already sent to HealthMonitor)
        if (!timedOut()) {
          healthMonitor.reportSuccess(effectiveInstanceUrl);
        }

        return formatToolResult(result, definition);
      } catch (error) {
        throwDispatchError(error, toolName, effectiveInstanceUrl, healthMonitor, timedOut());
      }
    };

    try {
      // Race all tools against the timeout. For non-idempotent mutations this
      // means the client gets a timeout response while the mutation may still
      // complete — but the alternative (no timeout) leaves bootstrap unbounded
      // if the instance is hung. The timedOut flag prevents late reportSuccess/
      // reportError from overwriting the timeout health signal.
      const result = await Promise.race([runWithCaller(caller, handlerWork), deadline.expired]);

      // The deadline expired — handler is still running but we respond
      if (result === HANDLER_TIMEOUT) {
        return handlerTimeoutResult(
          request,
          declaredIdempotent,
          bootstrapState,
          requestInstanceUrl,
        );
      }

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logError(`Error in tool handler: ${errMsg}`);
      recordToolError(errMsg);

      // Try to convert to structured error for better LLM feedback
      const toolName = request.params.name;
      const toolArgs = request.params.arguments;
      const structuredError = toStructuredError(error, toolName, toolArgs, declaredIdempotent);

      if (structuredError) {
        logDebug('Returning structured error response', { structuredError });
        return withReauthChallenge(errorToolResult(structuredError), error);
      }

      // Fallback to original error format
      const errorMessage = error instanceof Error ? error.message : String(error);
      return withReauthChallenge(errorToolResult({ error: errorMessage }), error);
    }
  };
  // A call runs as the account its chat works with; one that cannot be used refuses it.
  // Managing the accounts needs no account's token, so it also runs when the chosen one
  // cannot be used: that is how the chat switches away from it.
  // The timeout starts when the call arrives: resolving the account (a token refresh, a
  // wait for another replica's refresh lease) counts against it like the handler does.
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    runWithMcpServer(server, async () => {
      const deadline = startCallDeadline();
      try {
        if (managesAccounts(request)) return await callTool(request, extra, deadline);
        let running = false;
        const call = withChatAccount(extra?.sessionId, async () => {
          // The client was already answered with a timeout: the tool must not run behind it.
          if (deadline.isExpired()) return undefined;
          running = true;
          return callTool(request, extra, deadline);
        });
        const first = await Promise.race([call, deadline.expired]);
        if (first !== HANDLER_TIMEOUT && first !== undefined) return first;
        // A running handler answers its own timeout, with what its bootstrap reached.
        const answered = running ? await call : undefined;
        if (answered) return answered;
        call.catch((error: unknown) =>
          logDebug('Account resolution failed after the call timed out', { err: error }),
        );
        return handlerTimeoutResult(
          request,
          undefined,
          { started: false, complete: false },
          GITLAB_BASE_URL,
        );
      } catch (error) {
        if (!(error instanceof AccountUnavailableError)) throw error;
        return errorToolResult({ error: error.message });
      } finally {
        deadline.clear();
      }
    }),
  );
}
