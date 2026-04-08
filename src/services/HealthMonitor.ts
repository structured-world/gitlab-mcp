/**
 * Connection Health Monitor
 *
 * Manages per-instance GitLab connection lifecycle using XState v5 state machines.
 * Handles startup timeouts, automatic reconnection with exponential backoff,
 * health checks, and dynamic tool availability based on connection state.
 *
 * State machine per instance:
 *   CONNECTING → HEALTHY | DEGRADED | DISCONNECTED | FAILED
 *   HEALTHY ↔ DEGRADED (introspection succeeds/fails)
 *   HEALTHY → DISCONNECTED (consecutive transient failures)
 *   DEGRADED → DISCONNECTED (consecutive transient failures)
 *   DISCONNECTED → CONNECTING (reconnect timer fires)
 *   FAILED (auth/config error — no auto-reconnect, only manual RECONNECT event)
 */

import {
  setup,
  assign,
  createActor,
  fromPromise,
  type ActorRefFrom,
  type SnapshotFrom,
} from 'xstate';
import { ConnectionManager } from './ConnectionManager';
import { normalizeInstanceUrl } from '../utils/url';
import { InstanceRegistry } from './InstanceRegistry';
import { classifyError, type ErrorCategory } from '../utils/error-handler';
import { enhancedFetch } from '../utils/fetch';
import { logInfo, logWarn, logError, logDebug } from '../logger';
import {
  INIT_TIMEOUT_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  HEALTH_CHECK_INTERVAL_MS,
  FAILURE_THRESHOLD,
  GITLAB_BASE_URL,
  GITLAB_TOKEN,
} from '../config';
import { isOAuthEnabled } from '../oauth/index';

// ============================================================================
// Types
// ============================================================================

export type ConnectionState = 'connecting' | 'healthy' | 'degraded' | 'disconnected' | 'failed';

export interface InstanceHealthSnapshot {
  state: ConnectionState;
  consecutiveFailures: number;
  reconnectAttempt: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

/** Dedicated error for initialization timeouts — replaces fragile string matching. */
export class InitializationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Initialization timeout after ${timeoutMs}ms`);
    this.name = 'InitializationTimeoutError';
  }
}

// ============================================================================
// XState Machine Context & Events
// ============================================================================

interface MachineContext {
  instanceUrl: string;
  consecutiveFailures: number;
  reconnectAttempt: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

type MachineEvent =
  | { type: 'TOOL_SUCCESS' }
  | { type: 'TOOL_FAILURE'; error: string; category: ErrorCategory }
  | { type: 'RECONNECT' };

// ============================================================================
// Backoff calculation
// ============================================================================

/**
 * Calculate reconnect delay with exponential backoff and ±10% jitter,
 * clamped to [RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS].
 * Assumes BASE <= MAX (invalid config yields BASE as constant delay).
 */
export function calculateBackoffDelay(attempt: number): number {
  const exponential = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
    RECONNECT_MAX_DELAY_MS,
  );
  // Math.random is safe here — jitter is for load distribution, not security
  const jitter = exponential * 0.1 * (Math.random() * 2 - 1); // ±10%
  return Math.max(
    RECONNECT_BASE_DELAY_MS,
    Math.min(Math.round(exponential + jitter), RECONNECT_MAX_DELAY_MS),
  );
}

// ============================================================================
// Async actors for XState
// ============================================================================

/**
 * Check if schema introspection data is available for a URL.
 * Used to distinguish healthy (version + schema) from degraded (version only).
 */
function hasSchemaInfo(connectionManager: ConnectionManager, instanceUrl: string): boolean {
  try {
    connectionManager.getSchemaInfo(instanceUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an instance is running in degraded mode.
 * Degraded = version unknown (REST/OAuth fallback) OR schema introspection incomplete.
 */
function isDegradedInstance(connectionManager: ConnectionManager, instanceUrl: string): boolean {
  try {
    const info = connectionManager.getInstanceInfo(instanceUrl);
    return info.version === 'unknown' || !hasSchemaInfo(connectionManager, instanceUrl);
  } catch {
    return true;
  }
}

// performConnect handles three phases in one function: (1) fast-path for already-connected
// instances, (2) full initialization with timeout budget, (3) degraded-path reachability probe.
// SonarCloud flags cognitive complexity=17 (limit 15). Extracting phase helpers would split
// the shared `deadline` variable across callsites and obscure the single-budget invariant.
// The three phases are demarcated by inline comments; complexity is intentional here.
const performConnect = fromPromise<{ degraded: boolean }, { instanceUrl: string }>(
  async ({ input }) => {
    const connectionManager = ConnectionManager.getInstance();

    // Fast-path: if already initialized for this URL, verify with health check.
    // Use HEALTH_CHECK_PROBE_MS (not INIT_TIMEOUT_MS) — init timeout may be
    // configured very low to speed up startup, which would cause spurious disconnects.
    if (connectionManager.isConnected(input.instanceUrl)) {
      const healthy = await quickHealthCheck(input.instanceUrl, HEALTH_CHECK_PROBE_MS);
      if (!healthy) {
        // Intentionally a new Error (not the original fetch cause) — health check
        // failures are always transient regardless of the underlying cause.
        // classifyError maps this to 'transient' → disconnected → auto-reconnect.
        throw new Error(`Health check failed for ${input.instanceUrl}`);
      }
      return { degraded: isDegradedInstance(connectionManager, input.instanceUrl) };
    }

    // Full initialization with timeout.
    // On timeout, clearInflight removes the hung promise so the next reconnect
    // starts a fresh doInitialize() instead of re-awaiting the stale one.
    // Single timeout budget for the entire connect flow (init + degraded probe)
    const deadline = Date.now() + INIT_TIMEOUT_MS;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new InitializationTimeoutError(INIT_TIMEOUT_MS)),
        INIT_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([connectionManager.initialize(input.instanceUrl), timeoutPromise]);
    } catch (error) {
      // Only clear the inflight promise on timeout — for auth/network errors the
      // underlying doInitialize() has already settled and cleaned up normally.
      // Clearing on non-timeout errors could race with a concurrent doInitialize().
      const isTimeout = error instanceof InitializationTimeoutError;
      if (isTimeout) {
        connectionManager.clearInflight(input.instanceUrl);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    // Degraded = version unknown OR schema introspection incomplete.
    // When degraded, verify actual reachability — OAuth/REST-only init can
    // succeed with fallback data even when GitLab is unreachable. Without this
    // check, the state machine would report "degraded" (reachable) instead of
    // "disconnected", keeping all tools exposed.
    // OAuth deferred: init may succeed but instanceInfo not yet available → degraded
    const isDegraded = isDegradedInstance(connectionManager, input.instanceUrl);

    if (isDegraded) {
      // Verify reachability — OAuth/REST-only init can succeed with fallback
      // data even when GitLab is unreachable. Throwing here lands in disconnected.
      // Keep the degraded-path probe within the original startup budget.
      // If the budget is exhausted or nearly exhausted (< 500ms), skip the probe —
      // init already succeeded, and deadline jitter or a near-zero timeout would
      // almost certainly fail and cause a false disconnect.
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // Budget exhausted — init succeeded so treat as reachable (avoids false disconnect
        // from timer/event-loop jitter that can flip remainingMs negative by a few ms).
        return { degraded: isDegraded };
      }
      if (remainingMs < 500) {
        // Not enough time for a meaningful probe — assume reachable since init succeeded
        return { degraded: isDegraded };
      }
      const reachable = await quickHealthCheck(input.instanceUrl, remainingMs);
      if (!reachable) {
        throw new Error(
          `Health check failed for ${input.instanceUrl}: instance unreachable after degraded init`,
        );
      }
    }
    return { degraded: isDegraded };
  },
);

const performHealthCheck = fromPromise<{ degraded: boolean }, { instanceUrl: string }>(
  async ({ input }) => {
    const healthy = await quickHealthCheck(input.instanceUrl);
    if (!healthy) {
      throw new Error(`Health check failed for ${input.instanceUrl}`);
    }

    // Detect mid-session token revocation in static token mode.
    // Throws GitLab API 401 when the token is revoked → classifyError → 'auth'
    // → healthCheckErrorIsAuth guard → '#connection.failed' (no auto-reconnect).
    // No-op in OAuth mode (no global token) and when GITLAB_TOKEN is unset.
    await authenticatedTokenCheck(input.instanceUrl, HEALTH_CHECK_PROBE_MS);

    const connectionManager = ConnectionManager.getInstance();
    return { degraded: isDegradedInstance(connectionManager, input.instanceUrl) };
  },
);

/**
 * Lightweight health check: HEAD request to /api/v4/version with short timeout.
 * Uses enhancedFetch to respect proxy/TLS/custom CA settings.
 */
// Steady-state probes use a shorter timeout than startup init
const HEALTH_CHECK_PROBE_MS = 3000;

async function quickHealthCheck(
  instanceUrl: string,
  timeoutMs: number = HEALTH_CHECK_PROBE_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Health probes are intentionally unauthenticated — 401 still confirms
    // the server is alive. skipAuth prevents OAuth "no token context" warnings.
    const response = await enhancedFetch(`${instanceUrl}/api/v4/version`, {
      method: 'HEAD',
      signal: controller.signal,
      retry: false,
      skipAuth: true,
      rateLimit: false,
    });

    // Any non-5xx response means the server is reachable. The probe measures
    // connectivity, not API correctness: 401/403 = auth needed, 3xx = redirect,
    // 400/404 = unusual but still a responding HTTP endpoint. Actual API errors
    // are caught at tool-call level, not here.
    return response.status < 500;
  } catch {
    // Intentionally swallows the error — health checks are lightweight probes.
    // Error classification (transient vs permanent) happens in performConnect
    // during the full init/reconnect path, not during periodic probes.
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Authenticated token validity check: HEAD /api/v4/user with the static token.
 * Detects mid-session token revocation that the unauthenticated reachability check
 * cannot see (401 from /api/v4/version is treated as "server alive").
 *
 * Only runs in static token mode — OAuth tokens are per-request context and are
 * not available during background health checks.
 *
 * Throws a GitLab API 401 error when the token is revoked or expired.
 * classifyError maps this to 'auth' → state machine transitions to 'failed',
 * disabling auto-reconnect until the user intervenes.
 *
 * Network/timeout errors are swallowed: the unauthenticated check already verified
 * reachability, so connectivity failures on this request are noise, not signal.
 */
async function authenticatedTokenCheck(instanceUrl: string, timeoutMs: number): Promise<void> {
  // OAuth mode: token is per-request context, unavailable during background checks
  if (isOAuthEnabled()) return;
  // No static token configured — nothing to validate
  if (!GITLAB_TOKEN) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await enhancedFetch(`${instanceUrl}/api/v4/user`, {
      method: 'HEAD',
      signal: controller.signal,
      retry: false,
      rateLimit: false,
      // skipAuth defaults to false — PRIVATE-TOKEN header injected automatically
    });

    if (response.status === 401) {
      // Error message format matches parseGitLabApiError pattern so classifyError
      // correctly returns 'auth' → state machine transitions to 'failed'.
      // Use "token invalid" rather than "revoked or expired" — a 401 from /api/v4/user
      // can also indicate a wrong token value, missing scope, or other auth failure.
      throw new Error('GitLab API error: 401 Unauthorized - token invalid');
    }
  } catch (error) {
    // Re-throw the 401 auth error from token validation.
    // Swallow everything else (network/timeout) — reachability already confirmed by quickHealthCheck.
    if (error instanceof Error && error.message.startsWith('GitLab API error: 401')) {
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// XState Machine Definition
// ============================================================================

const connectionMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
    input: {} as { instanceUrl: string },
  },
  actors: {
    performConnect,
    performHealthCheck,
  },
  delays: {
    reconnectDelay: ({ context }) => calculateBackoffDelay(context.reconnectAttempt),
    healthCheckInterval: () => HEALTH_CHECK_INTERVAL_MS,
    degradedCheckInterval: () => Math.min(HEALTH_CHECK_INTERVAL_MS, 30_000),
  },
  guards: {
    isTransient: (_, params: { category: ErrorCategory }) => params.category === 'transient',
    thresholdReached: ({ context }) => context.consecutiveFailures >= FAILURE_THRESHOLD,
    // Classify connect/health-check errors: only transient → reconnect
    connectErrorIsTransient: ({ event }) => {
      const error = (event as { error?: unknown }).error;
      return classifyError(error) === 'transient';
    },
    // Auth error during periodic health check → failed (no auto-reconnect)
    healthCheckErrorIsAuth: ({ event }) => {
      const error = (event as { error?: unknown }).error;
      return classifyError(error) === 'auth';
    },
  },
  actions: {
    recordSuccess: assign({
      consecutiveFailures: 0,
      reconnectAttempt: 0,
      lastSuccessAt: () => Date.now(),
      lastError: null,
    }),
    incrementReconnectAttempt: assign({
      reconnectAttempt: ({ context }) => context.reconnectAttempt + 1,
    }),
    // Shared action for TOOL_FAILURE and health check onError — increments
    // failure counter and records the error for threshold-based disconnect.
    recordFailure: assign({
      consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
      lastFailureAt: () => Date.now(),
      lastError: ({ event }) => {
        const e = (event as { error?: unknown }).error;
        return e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      },
    }),
  },
}).createMachine({
  id: 'connection',
  initial: 'connecting',
  context: ({ input }: { input: { instanceUrl: string } }) => ({
    instanceUrl: input.instanceUrl,
    consecutiveFailures: 0,
    reconnectAttempt: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
  }),

  states: {
    connecting: {
      invoke: {
        src: 'performConnect',
        input: ({ context }) => ({ instanceUrl: context.instanceUrl }),
        onDone: [
          {
            guard: ({ event }) => event.output.degraded,
            target: 'degraded',
            actions: 'recordSuccess',
          },
          {
            target: 'healthy',
            actions: 'recordSuccess',
          },
        ],
        onError: [
          {
            // Transient errors (network, timeout, 5xx) → disconnected → auto-reconnect
            guard: 'connectErrorIsTransient',
            target: 'disconnected',
            actions: 'recordFailure',
          },
          {
            // Auth/permanent errors (401, config) → failed, no auto-reconnect
            target: 'failed',
            actions: assign({
              lastFailureAt: () => Date.now(),
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : String(event.error),
            }),
          },
        ],
      },
    },

    healthy: {
      initial: 'idle',
      // Tool success/failure handlers on parent state so they're active in both
      // idle AND checking substates (events during health check probe aren't dropped).
      on: {
        TOOL_SUCCESS: {
          actions: 'recordSuccess',
        },
        TOOL_FAILURE: [
          {
            // Only transient errors (network, 5xx) affect connection health.
            // Auth errors (401/403) during tool calls are intentionally ignored here —
            // mid-session token revocation requires authenticated health checks (#370).
            guard: {
              type: 'isTransient',
              params: ({ event }) => ({ category: event.category }),
            },
            actions: 'recordFailure',
          },
        ],
      },
      // XState v5: always transitions are re-evaluated after any context change
      // (including assign from TOOL_FAILURE), so thresholdReached fires correctly.
      always: [
        {
          guard: 'thresholdReached',
          target: '#connection.disconnected',
        },
      ],
      states: {
        idle: {
          after: {
            healthCheckInterval: 'checking',
          },
        },
        checking: {
          invoke: {
            src: 'performHealthCheck',
            input: ({ context }) => ({ instanceUrl: context.instanceUrl }),
            onDone: [
              {
                guard: ({ event }) => event.output.degraded,
                target: '#connection.degraded',
                actions: 'recordSuccess',
              },
              {
                target: 'idle',
                actions: 'recordSuccess',
              },
            ],
            onError: [
              {
                // Auth error (token revoked/expired) → failed immediately, no auto-reconnect
                guard: 'healthCheckErrorIsAuth',
                target: '#connection.failed',
                actions: assign({
                  lastFailureAt: () => Date.now(),
                  lastError: ({ event }) =>
                    event.error instanceof Error ? event.error.message : String(event.error),
                }),
              },
              {
                target: 'idle',
                actions: 'recordFailure',
              },
            ],
          },
        },
      },
    },

    degraded: {
      initial: 'idle',
      on: {
        TOOL_SUCCESS: {
          actions: 'recordSuccess',
        },
        TOOL_FAILURE: [
          {
            guard: {
              type: 'isTransient',
              params: ({ event }) => ({ category: event.category }),
            },
            actions: 'recordFailure',
          },
        ],
      },
      // XState v5: always re-evaluated after assign from TOOL_FAILURE
      always: [
        {
          guard: 'thresholdReached',
          target: '#connection.disconnected',
        },
      ],
      states: {
        idle: {
          after: {
            degradedCheckInterval: 'checking',
          },
        },
        checking: {
          invoke: {
            src: 'performHealthCheck',
            input: ({ context }) => ({ instanceUrl: context.instanceUrl }),
            onDone: [
              {
                guard: ({ event }) => !event.output.degraded,
                target: '#connection.healthy',
                actions: 'recordSuccess',
              },
              {
                target: 'idle',
                actions: 'recordSuccess',
              },
            ],
            onError: [
              {
                // Auth error (token revoked/expired) → failed immediately, no auto-reconnect
                guard: 'healthCheckErrorIsAuth',
                target: '#connection.failed',
                actions: assign({
                  lastFailureAt: () => Date.now(),
                  lastError: ({ event }) =>
                    event.error instanceof Error ? event.error.message : String(event.error),
                }),
              },
              {
                target: 'idle',
                actions: 'recordFailure',
              },
            ],
          },
        },
      },
    },

    disconnected: {
      after: {
        reconnectDelay: 'connecting',
      },
      exit: ['incrementReconnectAttempt'],
      on: {
        RECONNECT: {
          target: 'connecting',
        },
      },
    },

    // Terminal state: auth/config errors that won't fix themselves.
    // No auto-reconnect. Only RECONNECT event (manual forceReconnect) can retry.
    failed: {
      on: {
        RECONNECT: {
          target: 'connecting',
        },
      },
    },
  },
});

// ============================================================================
// HealthMonitor Service
// ============================================================================

type ConnectionActor = ActorRefFrom<typeof connectionMachine>;

/**
 * Callback invoked when any instance changes connection state.
 * Used by HealthMonitor to trigger tool list updates and logging.
 */
type StateChangeCallback = (
  instanceUrl: string,
  from: ConnectionState,
  to: ConnectionState,
) => void;

export class HealthMonitor {
  private static instance: HealthMonitor | null = null;
  private readonly actors = new Map<string, ConnectionActor>();
  private readonly previousStates = new Map<string, ConnectionState>();
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private readonly subscriptions = new Map<string, { unsubscribe: () => void }>();

  private constructor() {}

  public static getInstance(): HealthMonitor {
    HealthMonitor.instance ??= new HealthMonitor();
    return HealthMonitor.instance;
  }

  /**
   * Register a callback for connection state changes.
   */
  // Registered once from handlers.ts at startup (guarded by healthMonitorStartup promise).
  // No unregister needed — callbacks are cleared on shutdown().
  public onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Initialize health monitoring for an instance.
   * Returns a promise that resolves when the initial connection attempt completes
   * (success or timeout — never blocks indefinitely).
   */
  public async initialize(instanceUrl?: string): Promise<void> {
    const url = this.resolveUrl(instanceUrl);

    // Don't create duplicate actors for the same instance.
    // If the existing actor is still connecting, wait for the initial outcome.
    const existingActor = this.actors.get(url);
    if (existingActor) {
      logDebug('HealthMonitor: actor already exists for instance', { url });
      if (this.getActorState(existingActor) === 'connecting') {
        await this.waitForInitialState(existingActor);
      }
      return;
    }

    logInfo('HealthMonitor: initializing connection monitoring', { url });

    const actor = createActor(connectionMachine, {
      input: { instanceUrl: url },
    });

    this.actors.set(url, actor);
    this.previousStates.set(url, 'connecting');

    // Subscribe to state changes
    const subscription = actor.subscribe((snapshot) => {
      this.handleStateChange(url, snapshot);
    });
    this.subscriptions.set(url, subscription);

    // Start the actor (begins connecting)
    actor.start();

    // Wait for the initial connection attempt to resolve
    // This ensures setupHandlers() doesn't return until we know the state
    await this.waitForInitialState(actor);
  }

  /**
   * Wait for the actor to leave the 'connecting' state (success or failure).
   */
  private waitForInitialState(actor: ConnectionActor): Promise<void> {
    return new Promise<void>((resolve) => {
      // Subscribe first, then check — avoids race where state transitions
      // between getActorState() and subscribe() (the subscribe callback
      // wouldn't fire for the missed transition).
      const sub = actor.subscribe((snapshot) => {
        const state = this.extractState(snapshot);
        if (state !== 'connecting') {
          sub.unsubscribe();
          resolve();
        }
      });

      // Check current state AFTER subscribing — if already past connecting,
      // the subscribe callback may not fire (XState v5 doesn't replay current
      // snapshot to new subscribers), so resolve immediately.
      const currentState = this.getActorState(actor);
      if (currentState !== 'connecting') {
        sub.unsubscribe();
        resolve();
      }
    });
  }

  /**
   * Handle state transitions — log, update InstanceRegistry, fire callbacks.
   */
  private handleStateChange(
    instanceUrl: string,
    snapshot: SnapshotFrom<typeof connectionMachine>,
  ): void {
    const newState = this.extractState(snapshot);
    const previousState = this.previousStates.get(instanceUrl);

    if (previousState === newState) return;

    const context = snapshot.context;

    logInfo('Connection state changed', {
      instanceUrl,
      from: previousState,
      to: newState,
      consecutiveFailures: context.consecutiveFailures,
      reconnectAttempt: context.reconnectAttempt,
      lastError: context.lastError,
    });

    // Update InstanceRegistry connection status
    try {
      const registry = InstanceRegistry.getInstance();
      if (registry.isInitialized()) {
        let registryStatus: 'healthy' | 'degraded' | 'offline';
        if (newState === 'healthy') {
          registryStatus = 'healthy';
        } else if (newState === 'degraded') {
          registryStatus = 'degraded';
        } else {
          registryStatus = 'offline';
        }
        registry.updateConnectionStatus(instanceUrl, registryStatus);
      }
    } catch {
      // InstanceRegistry may not be initialized yet
    }

    // Fire callbacks — use 'connecting' as default previous for the first emission
    // so broadcastToolsListChanged fires on the initial connecting→healthy transition.
    const effectivePrevious = previousState ?? 'connecting';
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(instanceUrl, effectivePrevious, newState);
      } catch (error) {
        logError('State change callback error', { err: error as Error });
      }
    }

    // Update previousStates AFTER callbacks so they see the pre-transition value
    this.previousStates.set(instanceUrl, newState);
  }

  /**
   * Extract top-level state name from XState snapshot.
   * Handles compound states (e.g., "healthy.idle" → "healthy").
   */
  private extractState(snapshot: SnapshotFrom<typeof connectionMachine>): ConnectionState {
    const value = snapshot.value;
    if (typeof value === 'string') {
      return value as ConnectionState;
    }
    // Compound state: { healthy: 'idle' } or { healthy: 'checking' }
    const topLevel = Object.keys(value)[0];
    return topLevel as ConnectionState;
  }

  private getActorState(actor: ConnectionActor): ConnectionState {
    return this.extractState(actor.getSnapshot());
  }

  /** Resolve and normalize an optional instance URL to a consistent Map key */
  private resolveUrl(instanceUrl?: string): string {
    return normalizeInstanceUrl(instanceUrl ?? GITLAB_BASE_URL);
  }

  /** Look up actor for an instance URL (returns undefined if untracked) */
  private getActor(instanceUrl?: string): ConnectionActor | undefined {
    return this.actors.get(this.resolveUrl(instanceUrl));
  }

  // ============================================================================
  // Public API — called from handlers.ts
  // ============================================================================

  /**
   * Get connection state for an instance.
   */
  // Note: returns 'disconnected' for untracked URLs (no actor). This differs from
  // isInstanceReachable() which treats untracked URLs as reachable. Use
  // isInstanceReachable() for gate decisions; use getState() only for status display.
  public getState(instanceUrl?: string): ConnectionState {
    const actor = this.getActor(instanceUrl);
    if (!actor) return 'disconnected';
    return this.getActorState(actor);
  }

  /**
   * Get health snapshot for an instance.
   */
  public getSnapshot(instanceUrl?: string): InstanceHealthSnapshot {
    const actor = this.getActor(instanceUrl);

    if (!actor) {
      return {
        state: 'disconnected',
        consecutiveFailures: 0,
        reconnectAttempt: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
      };
    }

    const snapshot = actor.getSnapshot();
    const context = snapshot.context;

    return {
      state: this.extractState(snapshot),
      consecutiveFailures: context.consecutiveFailures,
      reconnectAttempt: context.reconnectAttempt,
      lastSuccessAt: context.lastSuccessAt,
      lastFailureAt: context.lastFailureAt,
      lastError: context.lastError,
    };
  }

  /**
   * Check if at least one monitored instance is healthy, degraded, or connecting.
   * Connecting is included to avoid context-only tools/list during startup.
   * Used by registry-manager to decide tool filtering.
   */
  public isAnyInstanceHealthy(): boolean {
    // No actors = HealthMonitor not yet initialized, don't restrict tools
    if (this.actors.size === 0) return true;

    for (const actor of this.actors.values()) {
      const state = this.getActorState(actor);
      // connecting = init in progress — include to avoid context-only tools/list
      // during startup (first session would see empty tool list for 5s otherwise)
      if (state === 'healthy' || state === 'degraded' || state === 'connecting') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a specific instance is reachable (healthy or degraded).
   * Untracked instances (no actor) are assumed reachable — we don't block
   * tool calls for instances the monitor hasn't seen yet (e.g., OAuth context switch).
   */
  public isInstanceReachable(instanceUrl?: string): boolean {
    const actor = this.getActor(instanceUrl);
    if (!actor) return true; // Untracked = assume reachable
    const state = this.getActorState(actor);
    return state === 'healthy' || state === 'degraded';
  }

  /**
   * Report a successful tool execution.
   */
  public reportSuccess(instanceUrl?: string): void {
    const actor = this.getActor(instanceUrl);
    if (actor) {
      actor.send({ type: 'TOOL_SUCCESS' });
    }
  }

  /**
   * Report a failed tool execution.
   * Error is classified to determine if it affects connection health.
   */
  public reportError(instanceUrl?: string, error?: Error): void {
    const actor = this.getActor(instanceUrl);
    if (!actor || !error) return;

    const category = classifyError(error);
    actor.send({
      type: 'TOOL_FAILURE',
      error: error.message,
      category,
    });

    if (category === 'transient') {
      logWarn('Transient error reported to health monitor', {
        instanceUrl: this.resolveUrl(instanceUrl),
        error: error.message,
      });
    }
  }

  /**
   * Force an immediate reconnection attempt.
   */
  public forceReconnect(instanceUrl?: string): void {
    const actor = this.getActor(instanceUrl);
    if (actor) {
      actor.send({ type: 'RECONNECT' });
    }
  }

  /**
   * Get all monitored instance URLs.
   */
  public getMonitoredInstances(): string[] {
    return [...this.actors.keys()];
  }

  /**
   * Stop all actors and clear state.
   */
  public shutdown(): void {
    for (const [url, actor] of this.actors) {
      try {
        actor.stop();
      } catch {
        // Actor may already be stopped
      }
      logDebug('HealthMonitor: stopped actor', { url });
    }

    for (const sub of this.subscriptions.values()) {
      try {
        sub.unsubscribe();
      } catch {
        // Subscription may already be cleaned up
      }
    }

    this.actors.clear();
    this.subscriptions.clear();
    this.previousStates.clear();
    this.stateChangeCallbacks = [];

    logInfo('HealthMonitor shut down');
  }

  /**
   * Reset singleton (for testing).
   */
  public static resetInstance(): void {
    if (HealthMonitor.instance) {
      HealthMonitor.instance.shutdown();
      HealthMonitor.instance = null;
    }
  }
}
