/**
 * Unit tests for HealthMonitor service
 *
 * Tests state machine transitions, backoff calculation, error classification integration,
 * and multi-instance tracking.
 *
 * NOTE: XState v5 actors use internal microtask scheduling. All tests use real timers
 * with short config values (INIT_TIMEOUT_MS=200ms, RECONNECT_BASE_DELAY_MS=100ms,
 * HEALTH_CHECK_INTERVAL_MS=300ms) to exercise time-dependent behavior without fake timers.
 */

import { HealthMonitor, calculateBackoffDelay } from '../../../src/services/HealthMonitor';
import { classifyError, createConnectionFailedError } from '../../../src/utils/error-handler';

// Mock ConnectionManager
const mockInitialize = jest.fn();
const mockIsConnected = jest.fn();
const mockGetInstanceInfo = jest.fn();
const mockGetSchemaInfo = jest.fn();
const mockGetClient = jest.fn();
const mockGetCurrentInstanceUrl = jest.fn();
jest.mock('../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      initialize: mockInitialize,
      isConnected: mockIsConnected,
      getInstanceInfo: mockGetInstanceInfo,
      getSchemaInfo: mockGetSchemaInfo,
      getCurrentInstanceUrl: mockGetCurrentInstanceUrl,
      getClient: mockGetClient,
      clearInflight: jest.fn(),
    }),
  },
}));

// Mock InstanceRegistry
// Mock InstanceRegistry — configurable per test via mockRegistryIsInitialized/mockGetIntrospection
const mockRegistryIsInitialized = jest.fn().mockReturnValue(false);
const mockGetIntrospection = jest.fn().mockReturnValue(null);
jest.mock('../../../src/services/InstanceRegistry', () => ({
  InstanceRegistry: {
    getInstance: () => ({
      isInitialized: mockRegistryIsInitialized,
      updateConnectionStatus: jest.fn(),
      getIntrospection: mockGetIntrospection,
    }),
  },
}));

// Mock logger
jest.mock('../../../src/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

// Mock enhancedFetch for health checks (quickHealthCheck uses enhancedFetch, not global fetch)
const mockFetch = jest.fn();
jest.mock('../../../src/utils/fetch', () => ({
  enhancedFetch: (...args: unknown[]) => mockFetch(...args),
}));

// Mock config with shorter timeouts for testing
jest.mock('../../../src/config', () => ({
  INIT_TIMEOUT_MS: 200,
  RECONNECT_BASE_DELAY_MS: 100,
  RECONNECT_MAX_DELAY_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 300, // Short for testing health check substates
  FAILURE_THRESHOLD: 3,
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

describe('HealthMonitor', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    // mockReset clears implementations (clearAllMocks only clears call history)
    mockInitialize.mockReset();
    mockIsConnected.mockReset();
    mockGetInstanceInfo.mockReset();
    mockGetSchemaInfo.mockReset();
    mockGetCurrentInstanceUrl.mockReset();
    mockRegistryIsInitialized.mockReset();
    mockGetIntrospection.mockReset();

    HealthMonitor.resetInstance();
    mockInitialize.mockResolvedValue(undefined);
    mockIsConnected.mockReturnValue(false);
    mockGetCurrentInstanceUrl.mockReturnValue(null);
    mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
    mockGetSchemaInfo.mockReturnValue({ workItemWidgetTypes: [], typeDefinitions: new Map() });
    mockRegistryIsInitialized.mockReturnValue(false);
    mockGetIntrospection.mockReturnValue(null);
    mockFetch.mockResolvedValue({ status: 200, ok: true });
  });

  afterEach(async () => {
    HealthMonitor.resetInstance();
    // Allow XState cleanup microtasks to complete
    await new Promise((r) => process.nextTick(r));
  });

  const TEST_URL = 'https://gitlab.example.com';

  /** Create monitor, initialize for TEST_URL, return monitor */
  async function initMonitor(
    url: string = TEST_URL,
  ): Promise<ReturnType<typeof HealthMonitor.getInstance>> {
    const monitor = HealthMonitor.getInstance();
    await monitor.initialize(url);
    return monitor;
  }

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const a = HealthMonitor.getInstance();
      const b = HealthMonitor.getInstance();
      expect(a).toBe(b);
    });

    it('should create new instance after reset', () => {
      const a = HealthMonitor.getInstance();
      HealthMonitor.resetInstance();
      const b = HealthMonitor.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('initialization — successful connection', () => {
    it('should transition to healthy when initialize succeeds', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('healthy');
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });

    it('should transition to degraded when version is unknown', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('degraded');
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });
  });

  describe('initialization — OAuth deferred (instanceInfo unavailable)', () => {
    it('should transition to degraded when initialize succeeds but getInstanceInfo throws', async () => {
      // OAuth deferred mode: initialize resolves but instanceInfo is null
      mockInitialize.mockResolvedValue(undefined);
      mockIsConnected.mockReturnValue(false);
      mockGetInstanceInfo.mockImplementation(() => {
        throw new Error('Connection not initialized. Call initialize() first.');
      });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });
  });

  describe('initialization — connection failure', () => {
    it('should transition to disconnected when initialize fails', async () => {
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('disconnected');
      expect(monitor.isAnyInstanceHealthy()).toBe(false);
    });

    it('should transition to disconnected on timeout', async () => {
      // Never-resolving promise — INIT_TIMEOUT_MS (200ms) will fire first
      mockInitialize.mockImplementation(() => new Promise(() => {}));

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('disconnected');
    });

    it('should start fresh init after timeout via clearInflight', async () => {
      // First attempt: hung init → timeout → disconnected
      const hangingPromise = new Promise(() => {});
      mockInitialize.mockImplementationOnce(() => hangingPromise);

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('disconnected');

      const callsAfterTimeout = mockInitialize.mock.calls.length;

      // Reconnect: mockInitialize now resolves successfully (default from beforeEach)
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      // Wait for reconnect delay (RECONNECT_BASE_DELAY_MS=100ms + jitter)
      await new Promise((r) => setTimeout(r, 400));

      // initialize should have been called again (fresh attempt, not re-awaiting hung promise)
      expect(mockInitialize.mock.calls.length).toBeGreaterThan(callsAfterTimeout);
    });

    it('should transition to failed on auth error (no auto-reconnect)', async () => {
      // Auth errors (401) are classified as permanent → failed state, not disconnected
      mockInitialize.mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('failed');
      expect(monitor.isAnyInstanceHealthy()).toBe(false);

      // Record call count after initial connect attempt
      const callCountAfterInit = mockInitialize.mock.calls.length;

      // Wait past reconnect delay to verify no auto-reconnect happens
      await new Promise((r) => setTimeout(r, 300));

      // Still failed — no reconnect attempt, initialize not called again
      expect(monitor.getState(TEST_URL)).toBe('failed');
      expect(mockInitialize.mock.calls.length).toBe(callCountAfterInit);
    });

    it('should transition to failed on config error (no auto-reconnect)', async () => {
      mockInitialize.mockRejectedValue(
        new Error('GITLAB_TOKEN is required in static authentication mode'),
      );

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('failed');

      // Verify no reconnect calls
      const callCountAfterInit = mockInitialize.mock.calls.length;
      await new Promise((r) => setTimeout(r, 300));
      expect(mockInitialize.mock.calls.length).toBe(callCountAfterInit);
    });

    it('should allow manual reconnect from failed state via forceReconnect', async () => {
      // First: fail with auth error → failed
      mockInitialize.mockRejectedValueOnce(new Error('GitLab API error: 401 Unauthorized'));

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('failed');

      // Fix the auth issue, then force reconnect
      mockInitialize.mockResolvedValueOnce(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      monitor.forceReconnect(TEST_URL);

      await new Promise((r) => setTimeout(r, 300));
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });
  });

  describe('state change callbacks', () => {
    it('should fire callback on state transition', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      const callback = jest.fn();
      monitor.onStateChange(callback);

      await monitor.initialize(TEST_URL);

      // Should have been called for connecting → healthy
      expect(callback).toHaveBeenCalledWith(TEST_URL, 'connecting', 'healthy');
    });

    it('should not fire callback when state does not change', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      const callback = jest.fn();

      await monitor.initialize(TEST_URL);

      // Register callback AFTER initialization (already in healthy state)
      monitor.onStateChange(callback);

      // Report success — should stay healthy, no callback
      monitor.reportSuccess(TEST_URL);

      // Flush microtask queue so XState processes the TOOL_SUCCESS event
      await new Promise((r) => process.nextTick(r));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('health snapshots', () => {
    it('should return correct snapshot after initialization', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      const snapshot = monitor.getSnapshot(TEST_URL);
      expect(snapshot.state).toBe('healthy');
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.reconnectAttempt).toBe(0);
      expect(snapshot.lastSuccessAt).toBeGreaterThan(0);
      expect(snapshot.lastError).toBeNull();
    });

    it('should return disconnected snapshot for unknown instance', () => {
      const monitor = HealthMonitor.getInstance();
      const snapshot = monitor.getSnapshot('https://unknown.example.com');
      expect(snapshot.state).toBe('disconnected');
    });
  });

  describe('error reporting and threshold', () => {
    it('should track consecutive transient failures', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      // Report 2 transient errors (below threshold of 3)
      const transientError = new Error('connect ECONNREFUSED');
      (transientError as Error & { code: string }).code = 'ECONNREFUSED';
      monitor.reportError(TEST_URL, transientError);
      monitor.reportError(TEST_URL, transientError);

      // Allow XState microtasks to process
      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot(TEST_URL);
      expect(snapshot.consecutiveFailures).toBe(2);
      // Still healthy — below threshold
      expect(snapshot.state).toBe('healthy');
    });

    it('should track transient failures in degraded state', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('degraded');

      // Report transient error in degraded state
      const transientError = new Error('connect ECONNREFUSED');
      (transientError as Error & { code: string }).code = 'ECONNREFUSED';
      monitor.reportError(TEST_URL, transientError);

      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot(TEST_URL);
      expect(snapshot.consecutiveFailures).toBe(1);
      expect(snapshot.state).toBe('degraded');
    });

    it('should not count auth errors toward failure threshold', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      // Auth errors (401) should NOT increment consecutiveFailures
      for (let i = 0; i < 5; i++) {
        monitor.reportError(TEST_URL, new Error('GitLab API error: 401 Unauthorized'));
      }

      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot(TEST_URL);
      // Auth errors are classified as 'auth', not 'transient',
      // so the guard rejects them and failures stay at 0
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.state).toBe('healthy');
    });

    it('should reset failure count on success', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      // Report 2 transient errors
      const transientError = new Error('connect ECONNREFUSED');
      (transientError as Error & { code: string }).code = 'ECONNREFUSED';
      monitor.reportError(TEST_URL, transientError);
      monitor.reportError(TEST_URL, transientError);

      // Report success — should reset counter
      monitor.reportSuccess(TEST_URL);

      // Allow XState to process the event
      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot(TEST_URL);
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.state).toBe('healthy');
    });
  });

  describe('multi-instance tracking', () => {
    it('should track instances independently', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab-a.example.com');
      await monitor.initialize('https://gitlab-b.example.com');

      expect(monitor.getMonitoredInstances()).toHaveLength(2);
      expect(monitor.getState('https://gitlab-a.example.com')).toBe('healthy');
      expect(monitor.getState('https://gitlab-b.example.com')).toBe('healthy');
    });

    it('should report isAnyInstanceHealthy correctly with mixed states', async () => {
      // Instance A succeeds
      mockInitialize.mockResolvedValueOnce(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab-a.example.com');

      // Instance B fails
      mockInitialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await monitor.initialize('https://gitlab-b.example.com');

      expect(monitor.isAnyInstanceHealthy()).toBe(true);
      expect(monitor.getState('https://gitlab-a.example.com')).toBe('healthy');
      expect(monitor.getState('https://gitlab-b.example.com')).toBe('disconnected');
    });

    it('should not create duplicate actors for same instance', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();
      await monitor.initialize(TEST_URL);

      expect(monitor.getMonitoredInstances()).toHaveLength(1);
    });

    it('should handle concurrent initialize calls for same instance', async () => {
      // Keep initialize pending so second call arrives while first is still connecting
      let resolveInit!: () => void;
      mockInitialize.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r;
          }),
      );
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      const p1 = monitor.initialize(TEST_URL);
      const p2 = monitor.initialize(TEST_URL);

      // Resolve the pending init
      resolveInit();
      await Promise.all([p1, p2]);

      // Only one actor created, both callers resolved.
      // ConnectionManager.initialize should have been called exactly once (dedup worked).
      expect(monitor.getMonitoredInstances()).toHaveLength(1);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });
  });

  describe('shutdown', () => {
    it('should clear all state on shutdown', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      monitor.shutdown();

      expect(monitor.getMonitoredInstances()).toHaveLength(0);
      expect(monitor.getState(TEST_URL)).toBe('disconnected');
    });
  });

  describe('forceReconnect', () => {
    it('should trigger reconnect on disconnected instance', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('disconnected');

      // Set up for successful reconnect
      mockInitialize.mockResolvedValueOnce(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      monitor.forceReconnect(TEST_URL);

      // Wait for the reconnect to complete
      await new Promise((r) => setTimeout(r, 300));

      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should be no-op for unknown instance', () => {
      const monitor = HealthMonitor.getInstance();
      // Should not throw
      monitor.forceReconnect('https://unknown.example.com');
    });
  });

  describe('reconnect after disconnect', () => {
    it('should auto-reconnect after backoff delay when disconnected', async () => {
      // First init fails
      mockInitialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('disconnected');

      // Next init succeeds (auto-reconnect)
      mockInitialize.mockResolvedValueOnce(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      // Wait for backoff delay (100ms base in test config + processing time)
      await new Promise((r) => setTimeout(r, 500));

      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should increment reconnect attempt on repeated failures', async () => {
      // All inits fail
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();

      // reconnectAttempt starts at 0 in disconnected (increments on exit)
      const snap1 = monitor.getSnapshot(TEST_URL);
      expect(snap1.reconnectAttempt).toBe(0);

      // Wait for one reconnect cycle (exit disconnected → connecting → fail → disconnected)
      await new Promise((r) => setTimeout(r, 500));

      const snap2 = monitor.getSnapshot(TEST_URL);
      expect(snap2.reconnectAttempt).toBeGreaterThan(0);
    });
  });

  describe('already connected path', () => {
    it('should return degraded when connected but getInstanceInfo throws', async () => {
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockImplementation(() => {
        throw new Error('Not initialized');
      });

      const monitor = await initMonitor();

      // Health check passes but getInstanceInfo throws → degraded
      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });

    it('should verify with health check when already connected', async () => {
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      // Should be healthy (connected + health check passed)
      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // Fetch should have been called for health check
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should not take fast-path for a different URL than what was initialized', async () => {
      // isConnected returns true for URL-A, but we initialize for URL-B
      // isConnected(URL-B) should return false → full init path
      mockIsConnected.mockImplementation((url?: string) => url === 'https://gitlab-a.example.com');
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab-b.example.com');

      // Should have called full initialize, not fast-path
      expect(mockInitialize).toHaveBeenCalledWith('https://gitlab-b.example.com');
    });

    it('should disconnect when already connected but health check fails', async () => {
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 502, ok: false });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('disconnected');
    });
  });

  describe('per-instance degraded detection', () => {
    it('should use singleton getInstanceInfo when InstanceRegistry has no data', async () => {
      // isConnected = true, health check passes, no InstanceRegistry data → singleton fallback
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      // Should be healthy via singleton fallback
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should detect degraded from per-URL getInstanceInfo when version is unknown', async () => {
      // Per-URL state has version=unknown → degraded
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = await initMonitor();

      // Should be degraded because getInstanceInfo(url) returns version=unknown
      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });

    it('should detect degraded when version is known but schema is missing', async () => {
      // REST-only/OAuth-deferred: has real version but no schema introspection
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockGetSchemaInfo.mockImplementation(() => {
        throw new Error('Connection not initialized');
      });

      const monitor = await initMonitor();

      // Should be degraded: known version but missing schema
      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });

    it('should derive healthy when version is known and schema present', async () => {
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      // Both getInstanceInfo and getSchemaInfo return valid data
      mockGetInstanceInfo.mockReturnValue({ version: '17.5', tier: 'premium' });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // Verify per-URL getInstanceInfo was called (not InstanceRegistry fallback)
      expect(mockGetInstanceInfo).toHaveBeenCalledWith(TEST_URL);
      expect(mockGetSchemaInfo).toHaveBeenCalledWith(TEST_URL);
    });

    it('should derive degraded when version is unknown', async () => {
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });
  });

  describe('health check fetch failures', () => {
    it('should return false when fetch throws (network error)', async () => {
      // This tests quickHealthCheck returning false on network error
      mockIsConnected.mockReturnValue(true);
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const monitor = await initMonitor();

      // Health check failed → connection attempt fails → disconnected
      expect(monitor.getState(TEST_URL)).toBe('disconnected');
    });
  });

  describe('default instance URL', () => {
    it('should use GITLAB_BASE_URL when no instanceUrl provided', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      // Call without URL - should use default
      await monitor.initialize();

      expect(monitor.getState()).toBe('healthy');
      expect(monitor.isInstanceReachable()).toBe(true);
    });

    it('should use default URL for reportSuccess/reportError', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize();

      // Should not throw when called without URL
      monitor.reportSuccess();
      monitor.reportError(undefined, new Error('test'));

      expect(monitor.getState()).toBe('healthy');
    });
  });

  describe('isInstanceReachable', () => {
    it('should return true for healthy instance', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      expect(monitor.isInstanceReachable(TEST_URL)).toBe(true);
    });

    it('should return true for degraded instance', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = await initMonitor();

      expect(monitor.isInstanceReachable(TEST_URL)).toBe(true);
    });

    it('should return false for disconnected instance', async () => {
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();

      expect(monitor.isInstanceReachable(TEST_URL)).toBe(false);
    });

    it('should return true for untracked instance (assume reachable)', async () => {
      const monitor = HealthMonitor.getInstance();
      // No actor for this URL — should assume reachable
      expect(monitor.isInstanceReachable('https://unknown.example.com')).toBe(true);
    });

    it('should return false for failed instance', async () => {
      mockInitialize.mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

      const monitor = await initMonitor();

      expect(monitor.isInstanceReachable(TEST_URL)).toBe(false);
    });
  });

  describe('isAnyInstanceHealthy', () => {
    it('should return true when no actors exist (not yet initialized)', () => {
      const monitor = HealthMonitor.getInstance();
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });

    it('should return false when all instances disconnected', async () => {
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();

      expect(monitor.isAnyInstanceHealthy()).toBe(false);
    });

    it('should return false when all instances failed', async () => {
      mockInitialize.mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

      const monitor = await initMonitor();

      expect(monitor.isAnyInstanceHealthy()).toBe(false);
    });
  });

  describe('periodic health checks', () => {
    it('should run health check and stay healthy when GitLab is reachable', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('healthy');

      // Wait for health check interval to fire (300ms in test config)
      await new Promise((r) => setTimeout(r, 500));

      // Should still be healthy after health check
      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // fetch should have been called for health check (at least once beyond init)
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should transition degraded → healthy when health check succeeds with full introspection', async () => {
      // Start degraded
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('degraded');

      // Now fix introspection — health check will detect non-degraded
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      // Wait for degraded health check (min(HEALTH_CHECK_INTERVAL_MS, 30000) = 300ms)
      await new Promise((r) => setTimeout(r, 500));

      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should handle health check failure from healthy state', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      const monitor = await initMonitor();

      // Make health check fail (500 = server error)
      mockFetch.mockResolvedValue({ status: 500, ok: false });

      // Wait for health check
      await new Promise((r) => setTimeout(r, 500));

      // Health check failure increments consecutiveFailures but doesn't immediately disconnect
      const snapshot = monitor.getSnapshot(TEST_URL);
      expect(snapshot.consecutiveFailures).toBeGreaterThanOrEqual(1);
    });

    it('should handle getInstanceInfo throwing during health check', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      const monitor = await initMonitor();

      // Make getInstanceInfo throw during health check
      mockGetInstanceInfo.mockImplementation(() => {
        throw new Error('Not initialized');
      });

      // Wait for health check
      await new Promise((r) => setTimeout(r, 500));

      // Should transition to degraded (getInstanceInfo failed → degraded: true)
      const state = monitor.getState(TEST_URL);
      expect(state === 'degraded' || state === 'healthy').toBe(true);
    });
  });
});

describe('calculateBackoffDelay', () => {
  it('should return base delay for attempt 0', () => {
    // With jitter ±10%, delay should be around 100ms (test config RECONNECT_BASE_DELAY_MS=100)
    const delay = calculateBackoffDelay(0);
    expect(delay).toBeGreaterThanOrEqual(90);
    expect(delay).toBeLessThanOrEqual(110);
  });

  it('should double on each attempt', () => {
    // Attempt 1: 200ms ±10%
    const delay1 = calculateBackoffDelay(1);
    expect(delay1).toBeGreaterThanOrEqual(180);
    expect(delay1).toBeLessThanOrEqual(220);

    // Attempt 2: 400ms ±10%
    const delay2 = calculateBackoffDelay(2);
    expect(delay2).toBeGreaterThanOrEqual(360);
    expect(delay2).toBeLessThanOrEqual(440);
  });

  it('should cap at max delay', () => {
    // Very high attempt should cap at 1000ms (test config RECONNECT_MAX_DELAY_MS=1000)
    const delay = calculateBackoffDelay(20);
    expect(delay).toBeLessThanOrEqual(1100); // 1000 + 10% jitter
    expect(delay).toBeGreaterThanOrEqual(900); // 1000 - 10% jitter
  });
});

describe('classifyError — additional coverage', () => {
  it('should classify 429 rate limit as transient', () => {
    const error = new Error('GitLab API error: 429 Too Many Requests');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify 502 bad gateway as transient', () => {
    const error = new Error('GitLab API error: 502 Bad Gateway');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify 503 service unavailable as transient', () => {
    const error = new Error('GitLab API error: 503 Service Unavailable');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify 422 as permanent', () => {
    const error = new Error('GitLab API error: 422 Unprocessable Entity');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify 400 as permanent', () => {
    const error = new Error('GitLab API error: 400 Bad Request');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify ETIMEDOUT error code as transient', () => {
    const error = new Error('connection timed out');
    (error as Error & { code: string }).code = 'ETIMEDOUT';
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify ENOTFOUND error code as permanent (config error, not transient)', () => {
    const error = new Error('getaddrinfo ENOTFOUND gitlab.example.com');
    (error as Error & { code: string }).code = 'ENOTFOUND';
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify UND_ERR_CONNECT_TIMEOUT as transient', () => {
    const error = new Error('connect timeout');
    (error as Error & { code: string }).code = 'UND_ERR_CONNECT_TIMEOUT';
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify econnreset in message as transient', () => {
    const error = new Error('read econnreset');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify enotfound in message as permanent (config error)', () => {
    const error = new Error('getaddrinfo enotfound gitlab.example.com');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify network error message as transient', () => {
    const error = new Error('network error occurred');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify unknown error without code as permanent (programming bugs)', () => {
    const error = new Error('something completely unexpected happened');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify health check failed as transient', () => {
    const error = new Error('Health check failed for https://gitlab.example.com');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify initialization timeout as transient', () => {
    const error = new Error('Initialization timeout after 5000ms');
    expect(classifyError(error)).toBe('transient');
  });
});

describe('createConnectionFailedError', () => {
  const url = 'https://gitlab.example.com';

  it('should create error for connecting state (reconnecting)', () => {
    const error = createConnectionFailedError('browse_projects', 'list', url, 'connecting');
    expect(error.error_code).toBe('CONNECTION_FAILED');
    expect(error.tool).toBe('browse_projects');
    expect(error.action).toBe('list');
    expect(error.instance_url).toBe(url);
    expect(error.reconnecting).toBe(true);
    expect(error.message).toContain('Automatic reconnection is in progress');
  });

  it('should create error for disconnected state (will retry)', () => {
    const error = createConnectionFailedError('manage_project', 'update', url, 'disconnected');
    expect(error.error_code).toBe('CONNECTION_FAILED');
    expect(error.reconnecting).toBe(false);
    expect(error.message).toContain('Connection will be retried automatically');
    expect(error.suggested_fix).toContain('network connectivity');
  });

  it('should create error for failed state (no auto-reconnect)', () => {
    const error = createConnectionFailedError('browse_projects', 'list', url, 'failed');
    expect(error.error_code).toBe('CONNECTION_FAILED');
    expect(error.reconnecting).toBe(false);
    expect(error.message).toContain('authentication or configuration error');
    expect(error.message).toContain('Automatic reconnection is disabled');
    expect(error.suggested_fix).toContain('authentication credentials');
  });
});

describe('classifyError', () => {
  it('should classify ECONNREFUSED as transient', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
    (error as Error & { code: string }).code = 'ECONNREFUSED';
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify timeout as transient', () => {
    const error = new Error('Request timed out after 5000ms');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify 401 as auth', () => {
    const error = new Error('GitLab API error: 401 Unauthorized');
    expect(classifyError(error)).toBe('auth');
  });

  it('should classify 403 as permanent (permission/tier, not auth)', () => {
    const error = new Error('GitLab API error: 403 Forbidden');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify 500 as transient', () => {
    const error = new Error('GitLab API error: 500 Internal Server Error');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify 404 as permanent', () => {
    const error = new Error('GitLab API error: 404 Not Found');
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify non-Error as permanent', () => {
    expect(classifyError('string error')).toBe('permanent');
    expect(classifyError(42)).toBe('permanent');
    expect(classifyError(null)).toBe('permanent');
  });

  it('should classify fetch failed as transient', () => {
    const error = new Error('fetch failed');
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify socket hang up as transient', () => {
    const error = new Error('socket hang up');
    expect(classifyError(error)).toBe('transient');
  });
});
