/**
 * Unit tests for HealthMonitor service
 *
 * Tests state machine transitions, backoff calculation, error classification integration,
 * and multi-instance tracking.
 *
 * NOTE: XState v5 actors use internal microtask scheduling. Most tests use real timers
 * and rely on short test config values. Only the timeout test uses fake timers.
 */

import { HealthMonitor, calculateBackoffDelay } from '../../../src/services/HealthMonitor';
import { classifyError } from '../../../src/utils/error-handler';

// Mock ConnectionManager
const mockInitialize = jest.fn();
const mockIsConnected = jest.fn();
const mockGetInstanceInfo = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      initialize: mockInitialize,
      isConnected: mockIsConnected,
      getInstanceInfo: mockGetInstanceInfo,
      getClient: mockGetClient,
    }),
  },
}));

// Mock InstanceRegistry
jest.mock('../../../src/services/InstanceRegistry', () => ({
  InstanceRegistry: {
    getInstance: () => ({
      isInitialized: () => false,
      updateConnectionStatus: jest.fn(),
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

// Mock fetch for health checks
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock config with shorter timeouts for testing
jest.mock('../../../src/config', () => ({
  INIT_TIMEOUT_MS: 200,
  RECONNECT_BASE_DELAY_MS: 100,
  RECONNECT_MAX_DELAY_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 600_000, // Very long to avoid triggering in tests
  FAILURE_THRESHOLD: 3,
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

describe('HealthMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    HealthMonitor.resetInstance();
    mockIsConnected.mockReturnValue(false);
    mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });
    mockFetch.mockResolvedValue({ status: 200, ok: true });
  });

  afterEach(async () => {
    HealthMonitor.resetInstance();
    // Allow XState cleanup microtasks to complete
    await new Promise((r) => process.nextTick(r));
  });

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

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.getState('https://gitlab.example.com')).toBe('healthy');
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });

    it('should transition to degraded when version is unknown', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.getState('https://gitlab.example.com')).toBe('degraded');
      expect(monitor.isAnyInstanceHealthy()).toBe(true);
    });
  });

  describe('initialization — connection failure', () => {
    it('should transition to disconnected when initialize fails', async () => {
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.getState('https://gitlab.example.com')).toBe('disconnected');
      expect(monitor.isAnyInstanceHealthy()).toBe(false);
    });

    it('should transition to disconnected on timeout', async () => {
      // Simulate a long-running initialize that never resolves within INIT_TIMEOUT_MS
      mockInitialize.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)));

      const monitor = HealthMonitor.getInstance();
      // initialize() internally uses Promise.race with INIT_TIMEOUT_MS=200ms
      // The timeout will reject before the 5000ms initialize resolves
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.getState('https://gitlab.example.com')).toBe('disconnected');
    });
  });

  describe('state change callbacks', () => {
    it('should fire callback on state transition', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      const callback = jest.fn();
      monitor.onStateChange(callback);

      await monitor.initialize('https://gitlab.example.com');

      // Should have been called for connecting → healthy
      expect(callback).toHaveBeenCalledWith('https://gitlab.example.com', 'connecting', 'healthy');
    });

    it('should not fire callback when state does not change', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      const callback = jest.fn();

      await monitor.initialize('https://gitlab.example.com');

      // Register callback AFTER initialization (already in healthy state)
      monitor.onStateChange(callback);

      // Report success — should stay healthy, no callback
      monitor.reportSuccess('https://gitlab.example.com');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('health snapshots', () => {
    it('should return correct snapshot after initialization', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      const snapshot = monitor.getSnapshot('https://gitlab.example.com');
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

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      // Report 2 transient errors (below threshold of 3)
      const transientError = new Error('connect ECONNREFUSED');
      (transientError as any).code = 'ECONNREFUSED';
      monitor.reportError('https://gitlab.example.com', transientError);
      monitor.reportError('https://gitlab.example.com', transientError);

      // Allow XState microtasks to process
      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot('https://gitlab.example.com');
      expect(snapshot.consecutiveFailures).toBe(2);
      // Still healthy — below threshold
      expect(snapshot.state).toBe('healthy');
    });

    it('should not count auth errors toward failure threshold', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      // Auth errors (401) should NOT increment consecutiveFailures
      for (let i = 0; i < 5; i++) {
        monitor.reportError(
          'https://gitlab.example.com',
          new Error('GitLab API error: 401 Unauthorized'),
        );
      }

      await new Promise((r) => process.nextTick(r));

      const snapshot = monitor.getSnapshot('https://gitlab.example.com');
      // Auth errors are classified as 'auth', not 'transient',
      // so the guard rejects them and failures stay at 0
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.state).toBe('healthy');
    });

    it('should reset failure count on success', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      // Report 2 transient errors
      const transientError = new Error('connect ECONNREFUSED');
      (transientError as any).code = 'ECONNREFUSED';
      monitor.reportError('https://gitlab.example.com', transientError);
      monitor.reportError('https://gitlab.example.com', transientError);

      // Report success — should reset counter
      monitor.reportSuccess('https://gitlab.example.com');

      const snapshot = monitor.getSnapshot('https://gitlab.example.com');
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

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.getMonitoredInstances()).toHaveLength(1);
    });
  });

  describe('shutdown', () => {
    it('should clear all state on shutdown', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      monitor.shutdown();

      expect(monitor.getMonitoredInstances()).toHaveLength(0);
      expect(monitor.getState('https://gitlab.example.com')).toBe('disconnected');
    });
  });

  describe('isInstanceReachable', () => {
    it('should return true for healthy instance', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: '17.0', tier: 'premium' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.isInstanceReachable('https://gitlab.example.com')).toBe(true);
    });

    it('should return true for degraded instance', async () => {
      mockInitialize.mockResolvedValue(undefined);
      mockGetInstanceInfo.mockReturnValue({ version: 'unknown', tier: 'free' });

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.isInstanceReachable('https://gitlab.example.com')).toBe(true);
    });

    it('should return false for disconnected instance', async () => {
      mockInitialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const monitor = HealthMonitor.getInstance();
      await monitor.initialize('https://gitlab.example.com');

      expect(monitor.isInstanceReachable('https://gitlab.example.com')).toBe(false);
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

describe('classifyError', () => {
  it('should classify ECONNREFUSED as transient', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
    (error as any).code = 'ECONNREFUSED';
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

  it('should classify 403 as auth', () => {
    const error = new Error('GitLab API error: 403 Forbidden');
    expect(classifyError(error)).toBe('auth');
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
