/**
 * Connection Health Monitor
 *
 * Manages per-instance GitLab connection lifecycle using XState v5 state machines.
 * Handles startup timeouts, automatic reconnection with exponential backoff,
 * health checks, and dynamic tool availability based on connection state.
 *
 * State machine per instance:
 *   CONNECTING → HEALTHY | DEGRADED | DISCONNECTED
 *   HEALTHY ↔ DEGRADED (introspection succeeds/fails)
 *   HEALTHY → DISCONNECTED (consecutive transient failures)
 *   DEGRADED → DISCONNECTED (consecutive transient failures)
 *   DISCONNECTED → CONNECTING (reconnect timer fires)
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
import { InstanceRegistry } from './InstanceRegistry';
import { classifyError, type ErrorCategory } from '../utils/error-handler';
import { logInfo, logWarn, logError, logDebug } from '../logger';
import {
  INIT_TIMEOUT_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  HEALTH_CHECK_INTERVAL_MS,
  FAILURE_THRESHOLD,
  GITLAB_BASE_URL,
} from '../config';

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
  | { type: 'CONNECT' }
  | { type: 'CONNECT_SUCCESS'; degraded: boolean }
  | { type: 'CONNECT_FAILURE'; error: string }
  | { type: 'HEALTH_CHECK_SUCCESS'; degraded: boolean }
  | { type: 'HEALTH_CHECK_FAILURE'; error: string }
  | { type: 'TOOL_SUCCESS' }
  | { type: 'TOOL_FAILURE'; error: string; category: ErrorCategory }
  | { type: 'RECONNECT' }
  | { type: 'SHUTDOWN' };

// ============================================================================
// Backoff calculation
// ============================================================================

/**
 * Calculate reconnect delay with exponential backoff and ±10% jitter.
 */
export function calculateBackoffDelay(attempt: number): number {
  const exponential = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
    RECONNECT_MAX_DELAY_MS,
  );
  const jitter = exponential * 0.1 * (Math.random() * 2 - 1); // ±10%
  return Math.max(100, Math.round(exponential + jitter));
}

// ============================================================================
// Async actors for XState
// ============================================================================

const performConnect = fromPromise<{ degraded: boolean }, { instanceUrl: string }>(
  async ({ input }) => {
    const connectionManager = ConnectionManager.getInstance();

    // Fast-path: if already initialized for the SAME instance, verify with health check.
    // Skip fast-path when the singleton is connected to a different instance URL
    // (multi-instance OAuth mode) — fall through to full initialization instead.
    const currentUrl = connectionManager.getCurrentInstanceUrl();
    if (connectionManager.isConnected() && (!currentUrl || currentUrl === input.instanceUrl)) {
      const healthy = await quickHealthCheck(input.instanceUrl);
      if (!healthy) {
        throw new Error(`Health check failed for ${input.instanceUrl}`);
      }
      try {
        const info = connectionManager.getInstanceInfo();
        return { degraded: info.version === 'unknown' };
      } catch {
        // Instance info unavailable despite isConnected — treat as degraded
        return { degraded: true };
      }
    }

    // Try full initialization with timeout.
    // Note: timed-out initialize() continues in background — ConnectionManager.initialize()
    // guards with isInitialized flag so concurrent calls are safe (idempotent).
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Initialization timeout after ${INIT_TIMEOUT_MS}ms`)),
        INIT_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([connectionManager.initialize(input.instanceUrl), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    // Derive degraded state. In single-instance mode, getInstanceInfo() is reliable.
    // In multi-instance OAuth mode, per-instance state comes from InstanceRegistry
    // (populated by ConnectionManager.doIntrospection).
    const info = connectionManager.getInstanceInfo();
    const degraded = info.version === 'unknown';

    return { degraded };
  },
);

const performHealthCheck = fromPromise<{ degraded: boolean }, { instanceUrl: string }>(
  async ({ input }) => {
    const healthy = await quickHealthCheck(input.instanceUrl);
    if (!healthy) {
      throw new Error(`Health check failed for ${input.instanceUrl}`);
    }

    // If connected, check if we have full introspection
    const connectionManager = ConnectionManager.getInstance();
    try {
      const info = connectionManager.getInstanceInfo();
      return { degraded: info.version === 'unknown' };
    } catch {
      return { degraded: true };
    }
  },
);

/**
 * Lightweight health check: HEAD request to /api/v4/version with short timeout.
 */
async function quickHealthCheck(instanceUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INIT_TIMEOUT_MS);

  try {
    const response = await fetch(`${instanceUrl}/api/v4/version`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    // Any response (even 401) means GitLab is reachable
    return response.status < 500;
  } catch {
    return false;
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
    belowThreshold: ({ context }) => context.consecutiveFailures < FAILURE_THRESHOLD,
    // Classify connect/health-check errors: only transient → reconnect
    connectErrorIsTransient: ({ event }) => {
      const error = (event as { error?: unknown }).error;
      return classifyError(error) === 'transient';
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
            actions: assign({
              consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
              lastFailureAt: () => Date.now(),
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : String(event.error),
            }),
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
      states: {
        idle: {
          // after on idle substate reschedules after each check cycle (idle → checking → idle)
          after: {
            healthCheckInterval: 'checking',
          },
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
                actions: assign({
                  consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
                  lastFailureAt: () => Date.now(),
                  lastError: ({ event }) => event.error,
                }),
              },
            ],
          },
          always: [
            {
              guard: 'thresholdReached',
              target: '#connection.disconnected',
            },
          ],
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
            onError: {
              target: 'idle',
              actions: assign({
                consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
                lastFailureAt: () => Date.now(),
                lastError: ({ event }) =>
                  event.error instanceof Error ? event.error.message : String(event.error),
              }),
            },
          },
        },
      },
    },

    degraded: {
      initial: 'idle',
      states: {
        idle: {
          after: {
            degradedCheckInterval: 'checking',
          },
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
                actions: assign({
                  consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
                  lastFailureAt: () => Date.now(),
                  lastError: ({ event }) => event.error,
                }),
              },
            ],
          },
          always: [
            {
              guard: 'thresholdReached',
              target: '#connection.disconnected',
            },
          ],
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
            onError: {
              target: 'idle',
              actions: assign({
                consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
                lastFailureAt: () => Date.now(),
                lastError: ({ event }) =>
                  event.error instanceof Error ? event.error.message : String(event.error),
              }),
            },
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
  private actors = new Map<string, ConnectionActor>();
  private previousStates = new Map<string, ConnectionState>();
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private subscriptions = new Map<string, { unsubscribe: () => void }>();

  private constructor() {}

  public static getInstance(): HealthMonitor {
    HealthMonitor.instance ??= new HealthMonitor();
    return HealthMonitor.instance;
  }

  /**
   * Register a callback for connection state changes.
   */
  // Registered once from handlers.ts at startup (guarded by healthMonitorInitialized flag).
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
    const url = instanceUrl ?? GITLAB_BASE_URL;

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
      // If already past connecting, resolve immediately
      const currentState = this.getActorState(actor);
      if (currentState !== 'connecting') {
        resolve();
        return;
      }

      const sub = actor.subscribe((snapshot) => {
        const state = this.extractState(snapshot);
        if (state !== 'connecting') {
          sub.unsubscribe();
          resolve();
        }
      });
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

    this.previousStates.set(instanceUrl, newState);

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
        const registryStatus =
          newState === 'healthy' ? 'healthy' : newState === 'degraded' ? 'degraded' : 'offline';
        registry.updateConnectionStatus(instanceUrl, registryStatus);
      }
    } catch {
      // InstanceRegistry may not be initialized yet
    }

    // Fire callbacks
    if (previousState) {
      for (const callback of this.stateChangeCallbacks) {
        try {
          callback(instanceUrl, previousState, newState);
        } catch (error) {
          logError('State change callback error', { err: error as Error });
        }
      }
    }
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

  // ============================================================================
  // Public API — called from handlers.ts
  // ============================================================================

  /**
   * Get connection state for an instance.
   */
  public getState(instanceUrl?: string): ConnectionState {
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);
    if (!actor) return 'disconnected';
    return this.getActorState(actor);
  }

  /**
   * Get health snapshot for an instance.
   */
  public getSnapshot(instanceUrl?: string): InstanceHealthSnapshot {
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);

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
   * Check if at least one monitored instance is healthy or degraded.
   * Used by registry-manager to decide tool filtering.
   */
  public isAnyInstanceHealthy(): boolean {
    // No actors = HealthMonitor not yet initialized, don't restrict tools
    if (this.actors.size === 0) return true;

    for (const actor of this.actors.values()) {
      const state = this.getActorState(actor);
      if (state === 'healthy' || state === 'degraded') {
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
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);
    if (!actor) return true; // Untracked = assume reachable
    const state = this.getActorState(actor);
    return state === 'healthy' || state === 'degraded';
  }

  /**
   * Report a successful tool execution.
   */
  public reportSuccess(instanceUrl?: string): void {
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);
    if (actor) {
      actor.send({ type: 'TOOL_SUCCESS' });
    }
  }

  /**
   * Report a failed tool execution.
   * Error is classified to determine if it affects connection health.
   */
  public reportError(instanceUrl?: string, error?: Error): void {
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);
    if (!actor || !error) return;

    const category = classifyError(error);
    actor.send({
      type: 'TOOL_FAILURE',
      error: error.message,
      category,
    });

    if (category === 'transient') {
      logWarn('Transient error reported to health monitor', {
        instanceUrl: url,
        error: error.message,
      });
    }
  }

  /**
   * Force an immediate reconnection attempt.
   */
  public forceReconnect(instanceUrl?: string): void {
    const url = instanceUrl ?? GITLAB_BASE_URL;
    const actor = this.actors.get(url);
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
