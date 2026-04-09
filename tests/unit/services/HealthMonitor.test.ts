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

/** Flush XState v5 internal microtask queue with a double-tick for CI stability. */
async function flushXStateMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => process.nextTick(resolve));
  await new Promise<void>((resolve) => process.nextTick(resolve));
}

// Mock ConnectionManager
const mockInitialize = jest.fn();
const mockIsConnected = jest.fn();
const mockGetInstanceInfo = jest.fn();
const mockGetSchemaInfo = jest.fn();
const mockGetClient = jest.fn();
const mockGetCurrentInstanceUrl = jest.fn();
const mockClearInflight = jest.fn();
jest.mock('../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      initialize: mockInitialize,
      isConnected: mockIsConnected,
      getInstanceInfo: mockGetInstanceInfo,
      getSchemaInfo: mockGetSchemaInfo,
      getCurrentInstanceUrl: mockGetCurrentInstanceUrl,
      getClient: mockGetClient,
      clearInflight: mockClearInflight,
    }),
  },
}));

// Mock InstanceRegistry — configurable per test via mockRegistryIsInitialized/mockGetIntrospection
const mockRegistryIsInitialized = jest.fn().mockReturnValue(false);
const mockGetIntrospection = jest.fn().mockReturnValue(null);
const mockUpdateConnectionStatus = jest.fn();
jest.mock('../../../src/services/InstanceRegistry', () => ({
  InstanceRegistry: {
    getInstance: () => ({
      isInitialized: mockRegistryIsInitialized,
      updateConnectionStatus: mockUpdateConnectionStatus,
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

// GITLAB_TOKEN mock value — controlled per-test to cover the !GITLAB_TOKEN early-return branch
let mockGitLabToken: string | undefined = 'test-token';

// Mock config with shorter timeouts for testing.
// GITLAB_TOKEN uses a getter so individual tests can clear it (mockGitLabToken = undefined).
jest.mock('../../../src/config', () => ({
  INIT_TIMEOUT_MS: 200,
  RECONNECT_BASE_DELAY_MS: 100,
  RECONNECT_MAX_DELAY_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 300, // Short for testing health check substates
  FAILURE_THRESHOLD: 3,
  GITLAB_BASE_URL: 'https://gitlab.example.com',
  get GITLAB_TOKEN() {
    return mockGitLabToken;
  },
}));

// Mock isOAuthEnabled — controls authenticated health check in static vs OAuth mode
const mockIsOAuthEnabled = jest.fn();
jest.mock('../../../src/oauth/index', () => ({
  isOAuthEnabled: () => mockIsOAuthEnabled(),
}));

/** Return the given status for /api/v4/user; 200 for all other URLs. */
function stubUserEndpointStatus(status: number): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/v4/user'))
      return Promise.resolve({ status, ok: status >= 200 && status < 300 });
    return Promise.resolve({ status: 200, ok: true });
  });
}

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
    // Default: static token mode (authenticated health check enabled)
    mockIsOAuthEnabled.mockReturnValue(false);
    mockGitLabToken = 'test-token';

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
    await flushXStateMicrotasks();
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

  /** Set up mocks for "already connected" scenario */
  function setupConnectedState(
    version: string,
    tier: string,
    fetchStatus: { status: number; ok: boolean } = { status: 200, ok: true },
  ): void {
    mockIsConnected.mockReturnValue(true);
    mockFetch.mockResolvedValue(fetchStatus);
    mockGetInstanceInfo.mockReturnValue({ version, tier });
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

      // clearInflight should have been called with the instance URL to release hung promise
      expect(mockClearInflight).toHaveBeenCalledWith(TEST_URL);

      const callsAfterTimeout = mockInitialize.mock.calls.length;

      // Reconnect: mockInitialize now resolves successfully (default from beforeEach)
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
      mockFetch.mockResolvedValue({ status: 200, ok: true });

      // Wait for reconnect delay (RECONNECT_BASE_DELAY_MS=100ms + jitter)
      await new Promise((r) => setTimeout(r, 400));

      // initialize should have been called again (fresh attempt, not re-awaiting hung promise)
      expect(mockInitialize.mock.calls.length).toBeGreaterThan(callsAfterTimeout);
      // End-to-end: recovery should reach healthy state
      expect(monitor.getState(TEST_URL)).toBe('healthy');
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
      await flushXStateMicrotasks();

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
      await flushXStateMicrotasks();

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

      await flushXStateMicrotasks();

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

      await flushXStateMicrotasks();

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
      await flushXStateMicrotasks();

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

      // Flush XState microtasks so the actor invoke reaches mockInitialize
      await Promise.resolve();
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
      setupConnectedState('17.0', 'premium');

      const monitor = await initMonitor();

      // Should be healthy (connected + health check passed)
      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // Fetch should have been called for health check with correct URL and method
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_URL}/api/v4/version`,
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('should not take fast-path for a different URL than what was initialized', async () => {
      // Model: URL-A is connected (singleton path), URL-B is not.
      // Pin currentInstanceUrl to URL-A so the test verifies the per-URL guard.
      mockIsConnected.mockImplementation((url?: string) => {
        if (url === 'https://gitlab-b.example.com') return false;
        return true; // singleton/current-instance path still pointing at URL-A
      });
      mockGetCurrentInstanceUrl.mockReturnValue('https://gitlab-a.example.com');
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab-b.example.com');

      // Should have called full initialize, not fast-path
      expect(mockInitialize).toHaveBeenCalledWith('https://gitlab-b.example.com');
    });

    it('should disconnect when already connected but health check fails', async () => {
      setupConnectedState('17.0', 'premium', { status: 502, ok: false });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('disconnected');
    });
  });

  describe('per-instance degraded detection', () => {
    it('should use singleton getInstanceInfo when InstanceRegistry has no data', async () => {
      // isConnected = true, health check passes, no InstanceRegistry data → singleton fallback
      setupConnectedState('17.0', 'premium');

      const monitor = await initMonitor();

      // Should be healthy via singleton fallback
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it.each([['unknown', 'free']])(
      'should detect degraded when version is %s (tier: %s)',
      async (version, tier) => {
        setupConnectedState(version, tier);

        const monitor = await initMonitor();

        expect(monitor.getState(TEST_URL)).toBe('degraded');
      },
    );

    it('should detect degraded when version is known but schema is missing', async () => {
      // REST-only/OAuth-deferred: has real version but no schema introspection
      setupConnectedState('17.0', 'premium');
      mockGetSchemaInfo.mockImplementation(() => {
        throw new Error('Connection not initialized');
      });

      const monitor = await initMonitor();

      // Should be degraded: known version but missing schema
      expect(monitor.getState(TEST_URL)).toBe('degraded');
    });

    it('should derive healthy when version is known and schema present', async () => {
      setupConnectedState('17.5', 'premium');

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // Verify per-URL getInstanceInfo was called (not InstanceRegistry fallback)
      expect(mockGetInstanceInfo).toHaveBeenCalledWith(TEST_URL);
      expect(mockGetSchemaInfo).toHaveBeenCalledWith(TEST_URL);
    });
  });

  describe('InstanceRegistry integration', () => {
    it('should update InstanceRegistry when registry is initialized', async () => {
      // Enable InstanceRegistry mock
      mockRegistryIsInitialized.mockReturnValue(true);

      mockIsConnected.mockReturnValue(true);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // InstanceRegistry.updateConnectionStatus should have been called with 'healthy'
      expect(mockUpdateConnectionStatus).toHaveBeenCalledWith(TEST_URL, 'healthy');
    });

    it('should map disconnected state to offline in InstanceRegistry', async () => {
      mockRegistryIsInitialized.mockReturnValue(true);
      // Init fails → disconnected
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = await initMonitor();

      expect(monitor.getState(TEST_URL)).toBe('disconnected');
      expect(mockUpdateConnectionStatus).toHaveBeenCalledWith(TEST_URL, 'offline');
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
    it.each<{
      scenario: string;
      setup: () => void;
      expected: boolean;
    }>([
      {
        scenario: 'healthy instance → true',
        setup: () => {
          mockInitialize.mockResolvedValue(undefined);
          mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
        },
        expected: true,
      },
      {
        scenario: 'degraded instance → true',
        setup: () => {
          mockInitialize.mockResolvedValue(undefined);
          mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });
        },
        expected: true,
      },
      {
        scenario: 'disconnected instance → false',
        setup: () => {
          mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));
        },
        expected: false,
      },
      {
        scenario: 'failed instance (auth error) → false',
        setup: () => {
          mockInitialize.mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));
        },
        expected: false,
      },
    ])('should return $expected for $scenario', async ({ setup, expected }) => {
      setup();
      const monitor = await initMonitor();
      expect(monitor.isInstanceReachable(TEST_URL)).toBe(expected);
    });

    it('should return true for untracked instance (assume reachable)', () => {
      const monitor = HealthMonitor.getInstance();
      // No actor for this URL — should assume reachable
      expect(monitor.isInstanceReachable('https://unknown.example.com')).toBe(true);
    });
  });

  describe('isAnyInstanceHealthy', () => {
    it('should return true when no actors exist (not yet initialized)', () => {
      const monitor = HealthMonitor.getInstance();
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });

    it.each<{
      scenario: string;
      errorMsg: string;
    }>([
      { scenario: 'all instances disconnected', errorMsg: 'ECONNREFUSED' },
      { scenario: 'all instances failed', errorMsg: 'GitLab API error: 401 Unauthorized' },
    ])('should return false when $scenario', async ({ errorMsg }) => {
      mockInitialize.mockRejectedValue(new Error(errorMsg));
      const monitor = await initMonitor();
      expect(monitor.isAnyInstanceHealthy()).toBe(false);
    });

    it('should treat connecting (pending initialize) as healthy', async () => {
      // Initialize hangs — actor stays in connecting state
      mockInitialize.mockImplementation(() => new Promise<never>(() => {}));
      const monitor = HealthMonitor.getInstance();
      // Start initialize but don't await — actor is in connecting state
      void monitor.initialize(TEST_URL);
      // Flush XState microtasks so the actor is created
      await Promise.resolve();
      // connecting is treated as healthy to avoid context-only tools during startup
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });
  });

  /**
   * Init monitor in healthy state (beforeEach already provides 200 fetch + v17 instance info).
   * Used by token revocation tests that need to start from a known-healthy baseline.
   */
  async function initHealthy(): Promise<ReturnType<typeof HealthMonitor.getInstance>> {
    const monitor = await initMonitor();
    expect(monitor.getState(TEST_URL)).toBe('healthy');
    return monitor;
  }

  describe('token revocation detection', () => {
    // Buffer accounts for HEALTH_CHECK_INTERVAL_MS (300ms test config) + processing
    const HEALTH_CYCLE_MS = 600;

    // Alias used by several tests below
    const stubUserEndpoint401 = (): void => stubUserEndpointStatus(401);

    it.each([401, 403])(
      'should transition to failed when authenticated health check returns %i',
      async (authStatus) => {
        // Regression test for #370: token auth failure mid-session must move to failed state.
        // Previously the health monitor stayed healthy because the unauthenticated
        // /api/v4/version check treats 401/403 as "server alive" (status < 500).
        const monitor = await initHealthy();
        stubUserEndpointStatus(authStatus);
        await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
        // Verify token-only probe contract: must use skipAuth + explicit PRIVATE-TOKEN header
        // so ambient session cookies cannot mask a revoked static token.
        expect(mockFetch).toHaveBeenCalledWith(
          `${TEST_URL}/api/v4/user`,
          expect.objectContaining({
            method: 'HEAD',
            skipAuth: true,
            headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'test-token' }),
          }),
        );
        expect(monitor.getState(TEST_URL)).toBe('failed');
        expect(monitor.isInstanceReachable(TEST_URL)).toBe(false);
      },
    );

    it('should transition from degraded to failed on token revocation', async () => {
      // Regression test for #370 in degraded path: same auth check runs from degraded state.
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' }); // degraded
      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('degraded');

      stubUserEndpoint401();
      // degradedCheckInterval = min(HEALTH_CHECK_INTERVAL_MS, 30000) = 300ms
      await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
      // Verify token-only probe contract is enforced in the degraded path too
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_URL}/api/v4/user`,
        expect.objectContaining({
          method: 'HEAD',
          skipAuth: true,
          headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'test-token' }),
        }),
      );
      expect(monitor.getState(TEST_URL)).toBe('failed');
    });

    it.each([
      [
        'no GITLAB_TOKEN',
        (): void => {
          mockGitLabToken = undefined;
        },
      ],
      [
        'OAuth mode',
        (): void => {
          mockIsOAuthEnabled.mockReturnValue(true);
        },
      ],
    ])('should skip authenticated check in %s', async (_label, setup) => {
      // Guard: /api/v4/user must never be called — if it is, the 401 would flip state to failed.
      stubUserEndpoint401();
      setup();
      const monitor = await initMonitor();
      expect(monitor.getState(TEST_URL)).toBe('healthy');
      await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
      expect(monitor.getState(TEST_URL)).toBe('healthy');
      // Negative assertion: probe URL must not have been fetched in skip-path scenarios
      expect(
        mockFetch.mock.calls.some(
          ([url]) => typeof url === 'string' && url.includes('/api/v4/user'),
        ),
      ).toBe(false);
    });

    it('should swallow network errors during authenticated check', async () => {
      // Connectivity errors on the second request are noise, not signal:
      // the unauthenticated check already verified reachability.
      const monitor = await initHealthy();
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/v4/user')) return Promise.reject(new Error('network error'));
        return Promise.resolve({ status: 200, ok: true });
      });
      await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should recover after forceReconnect when authenticated checks succeed again', async () => {
      // After detecting token revocation (→ failed), a manual forceReconnect should
      // recover to healthy once the authenticated check starts succeeding again.
      const monitor = await initHealthy();
      stubUserEndpoint401();
      await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
      expect(monitor.getState(TEST_URL)).toBe('failed');

      mockFetch.mockResolvedValue({ status: 200, ok: true });
      monitor.forceReconnect(TEST_URL);
      await new Promise((r) => setTimeout(r, 400));
      expect(monitor.getState(TEST_URL)).toBe('healthy');
    });

    it('should remain in failed state on forceReconnect when token is still revoked', async () => {
      // Regression: forceReconnect uses the performConnect fast-path which must
      // also call authenticatedTokenCheck. Without it, a still-revoked token could
      // bounce failed → healthy until the next health-check interval.
      const monitor = await initHealthy();
      stubUserEndpoint401();
      await new Promise((r) => setTimeout(r, HEALTH_CYCLE_MS));
      expect(monitor.getState(TEST_URL)).toBe('failed');

      // Exercise the fast-path: isConnected() = true skips full re-initialization
      // and goes directly to quickHealthCheck + authenticatedTokenCheck.
      // The 401 from the token probe must route to failed (not healthy) immediately.
      const initCallsBefore = mockInitialize.mock.calls.length;
      mockIsConnected.mockReturnValue(true);
      monitor.forceReconnect(TEST_URL);
      await new Promise((r) => setTimeout(r, 400));
      expect(monitor.getState(TEST_URL)).toBe('failed');
      // Confirm fast-path was taken: initialize() must not have been called again
      expect(mockInitialize.mock.calls.length).toBe(initCallsBefore);
      // Verify token-only probe was invoked in the fast-path
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_URL}/api/v4/user`,
        expect.objectContaining({
          method: 'HEAD',
          skipAuth: true,
          headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'test-token' }),
        }),
      );
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
    // Very high attempt should never exceed 1000ms (test config RECONNECT_MAX_DELAY_MS=1000)
    const delay = calculateBackoffDelay(20);
    expect(delay).toBeLessThanOrEqual(1000);
    expect(delay).toBeGreaterThanOrEqual(900); // jitter may still reduce the delay
  });
});

/** Helper to create an Error with an optional `.code` property */
function errorWithCode(message: string, code?: string): Error {
  const err = new Error(message);
  if (code) (err as Error & { code: string }).code = code;
  return err;
}

describe('classifyError', () => {
  // HTTP status codes
  it.each<{ label: string; message: string; expected: string }>([
    { label: '401 → auth', message: 'GitLab API error: 401 Unauthorized', expected: 'auth' },
    { label: '403 → permanent', message: 'GitLab API error: 403 Forbidden', expected: 'permanent' },
    { label: '404 → permanent', message: 'GitLab API error: 404 Not Found', expected: 'permanent' },
    {
      label: '400 → permanent',
      message: 'GitLab API error: 400 Bad Request',
      expected: 'permanent',
    },
    {
      label: '422 → permanent',
      message: 'GitLab API error: 422 Unprocessable Entity',
      expected: 'permanent',
    },
    {
      label: '429 → transient',
      message: 'GitLab API error: 429 Too Many Requests',
      expected: 'transient',
    },
    {
      label: '500 → transient',
      message: 'GitLab API error: 500 Internal Server Error',
      expected: 'transient',
    },
    {
      label: '502 → transient',
      message: 'GitLab API error: 502 Bad Gateway',
      expected: 'transient',
    },
    {
      label: '503 → transient',
      message: 'GitLab API error: 503 Service Unavailable',
      expected: 'transient',
    },
  ])('should classify HTTP $label', ({ message, expected }) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });

  // Error codes (`.code` property)
  it.each<{ code: string; message: string; expected: string }>([
    { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443', expected: 'transient' },
    { code: 'ETIMEDOUT', message: 'connection timed out', expected: 'transient' },
    { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'connect timeout', expected: 'transient' },
    {
      code: 'ENOTFOUND',
      message: 'getaddrinfo ENOTFOUND gitlab.example.com',
      expected: 'permanent',
    },
  ])('should classify error code $code as $expected', ({ code, message, expected }) => {
    expect(classifyError(errorWithCode(message, code))).toBe(expected);
  });

  // Message-based classification (no `.code`)
  it.each<{ label: string; message: string; expected: string }>([
    {
      label: 'timeout in message',
      message: 'Request timed out after 5000ms',
      expected: 'transient',
    },
    {
      label: 'fetch failed (no cause) → permanent',
      message: 'fetch failed',
      expected: 'permanent',
    },
    { label: 'socket hang up', message: 'socket hang up', expected: 'transient' },
    { label: 'econnreset in message', message: 'read econnreset', expected: 'transient' },
    { label: 'network error', message: 'network error occurred', expected: 'transient' },
    {
      label: 'health check failed',
      message: 'Health check failed for https://gitlab.example.com',
      expected: 'transient',
    },
    {
      label: 'initialization timeout',
      message: 'Initialization timeout after 5000ms',
      expected: 'transient',
    },
    {
      label: 'enotfound in message',
      message: 'getaddrinfo enotfound gitlab.example.com',
      expected: 'permanent',
    },
    {
      label: 'unknown error',
      message: 'something completely unexpected happened',
      expected: 'permanent',
    },
  ])('should classify "$label" as $expected', ({ message, expected }) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });

  it('should classify fetch failed with ECONNREFUSED cause as transient', () => {
    // Undici wraps network errors: TypeError('fetch failed', { cause: Error('...', { code }) })
    const cause = new Error('connect ECONNREFUSED');
    (cause as Error & { code: string }).code = 'ECONNREFUSED';
    const error = new TypeError('fetch failed', { cause });
    expect(classifyError(error)).toBe('transient');
  });

  it('should classify fetch failed with ENOTFOUND cause as permanent', () => {
    const cause = new Error('getaddrinfo ENOTFOUND unknown.host');
    (cause as Error & { code: string }).code = 'ENOTFOUND';
    const error = new TypeError('fetch failed', { cause });
    expect(classifyError(error)).toBe('permanent');
  });

  it('should classify non-Error values as permanent', () => {
    expect(classifyError('string error')).toBe('permanent');
    expect(classifyError(42)).toBe('permanent');
    expect(classifyError(null)).toBe('permanent');
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
    expect(error.message).toContain('A connection attempt is in progress');
  });

  it('should create error for disconnected state (will retry)', () => {
    const error = createConnectionFailedError('manage_project', 'update', url, 'disconnected');
    expect(error.error_code).toBe('CONNECTION_FAILED');
    // disconnected = not actively reconnecting, but auto-retry is enabled
    expect(error.reconnecting).toBe(false);
    expect(error.auto_retry_enabled).toBe(true);
    expect(error.message).toContain('Connection will be retried automatically');
    expect(error.suggested_fix).toContain('network connectivity');
  });

  it('should create error for failed state (no auto-reconnect)', () => {
    const error = createConnectionFailedError('browse_projects', 'list', url, 'failed');
    expect(error.error_code).toBe('CONNECTION_FAILED');
    expect(error.reconnecting).toBe(false);
    expect(error.message).toContain('permanent authentication, permission, or configuration error');
    expect(error.message).toContain('Automatic reconnection is disabled');
    expect(error.suggested_fix).toContain('authentication/authorization');
  });
});
