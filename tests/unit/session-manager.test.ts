/**
 * Unit tests for SessionManager
 * Verifies per-session Server isolation, cleanup, and broadcast behavior
 */

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    // Fresh spy per instance so tests can assert which server was notified
    notification: jest.fn().mockResolvedValue(undefined),
    oninitialized: null,
    getClientVersion: jest.fn().mockReturnValue({ name: 'test-client' }),
  })),
}));

jest.mock('../../src/config', () => ({
  packageName: 'test-package',
  packageVersion: '1.0.0',
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

jest.mock('../../src/handlers', () => ({
  setupHandlers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/schema-utils', () => ({
  setDetectedSchemaMode: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

import {
  SessionManager,
  getSessionManager,
  resetSessionManager,
  STDIO_SESSION_ID,
} from '../../src/session-manager';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupHandlers } from '../../src/handlers';
import { setDetectedSchemaMode } from '../../src/utils/schema-utils';
import { logWarn } from '../../src/logger';

describe('SessionManager', () => {
  let manager: SessionManager;

  const mockTransport = {
    start: jest.fn(),
    close: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    manager = new SessionManager(5000); // 5 second timeout for tests
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('should start the cleanup interval', () => {
      manager.start();
      // Cleanup interval is started (tested via cleanupStaleSessions behavior)
      expect(manager.activeSessionCount).toBe(0);
    });
  });

  describe('createSession', () => {
    it('should create a new Server instance per session', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      expect(Server).toHaveBeenCalledWith(
        { name: 'test-package', version: '1.0.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      expect(manager.activeSessionCount).toBe(1);
    });

    it('should create separate Server instances for different sessions', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);
      await manager.createSession('session-2', mockTransport as any);

      // Two Server instances created
      expect(Server).toHaveBeenCalledTimes(2);
      expect(manager.activeSessionCount).toBe(2);
    });

    it('should register handlers on each new Server', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);
      await manager.createSession('session-2', mockTransport as any);

      // setupHandlers called for each session
      expect(setupHandlers).toHaveBeenCalledTimes(2);
    });

    it('should connect the Server to the transport', async () => {
      manager.start();
      const server = await manager.createSession('session-1', mockTransport as any);

      expect(server.connect).toHaveBeenCalledWith(mockTransport);
    });

    it('should only call setDetectedSchemaMode once across multiple sessions', async () => {
      manager.start();

      // Create first session and trigger oninitialized
      const server1 = await manager.createSession('session-1', mockTransport as any);
      // Simulate SDK calling oninitialized
      (server1 as any).oninitialized();

      // Create second session and trigger oninitialized
      const server2 = await manager.createSession('session-2', mockTransport as any);
      (server2 as any).oninitialized();

      // setDetectedSchemaMode should only be called once (from first session)
      expect(setDetectedSchemaMode).toHaveBeenCalledTimes(1);
    });

    it('should close existing session when duplicate sessionId is provided', async () => {
      manager.start();

      // Create a session
      const server1 = await manager.createSession('session-dup', mockTransport as any);
      expect(manager.activeSessionCount).toBe(1);

      // Create another session with the SAME ID — should close the first
      const server2 = await manager.createSession('session-dup', mockTransport as any);

      // Old server should have been closed
      expect(server1.close).toHaveBeenCalled();
      // Manager should still have exactly 1 session with that ID
      expect(manager.activeSessionCount).toBe(1);
      // Warning should have been logged
      expect(logWarn).toHaveBeenCalledWith(
        'Duplicate sessionId detected — closing existing session',
        { sessionId: 'session-dup' },
      );
      // New server is a distinct instance
      expect(server2).not.toBe(server1);
    });
  });

  describe('touchSession', () => {
    it('should update lastActivityAt for existing session', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      // Advance time
      jest.advanceTimersByTime(2000);

      // Touch session to reset timeout
      manager.touchSession('session-1');

      // Advance to just before new timeout (5s from touch)
      jest.advanceTimersByTime(4500);

      // Session should still be active (touched 4.5s ago, timeout is 5s)
      expect(manager.activeSessionCount).toBe(1);
    });

    it('should not throw for non-existent session', () => {
      manager.start();
      expect(() => manager.touchSession('non-existent')).not.toThrow();
    });
  });

  describe('removeSession', () => {
    it('should remove session and close its Server', async () => {
      manager.start();
      const server = await manager.createSession('session-1', mockTransport as any);

      await manager.removeSession('session-1');

      expect(server.close).toHaveBeenCalled();
      expect(manager.activeSessionCount).toBe(0);
    });

    it('should not throw for non-existent session', async () => {
      manager.start();
      await expect(manager.removeSession('non-existent')).resolves.toBeUndefined();
    });

    it('should handle Server.close() errors gracefully', async () => {
      manager.start();
      const server = await manager.createSession('session-1', mockTransport as any);
      (server.close as jest.Mock).mockRejectedValueOnce(new Error('Already closed'));

      // Should not throw
      await expect(manager.removeSession('session-1')).resolves.toBeUndefined();
      expect(manager.activeSessionCount).toBe(0);
    });
  });

  describe('broadcastToolsListChanged', () => {
    it('should send notification to all active sessions', async () => {
      manager.start();
      const server1 = await manager.createSession('session-1', mockTransport as any);
      const server2 = await manager.createSession('session-2', mockTransport as any);

      await manager.broadcastToolsListChanged();

      expect(server1.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
      expect(server2.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
    });

    it('should not throw if individual notifications fail', async () => {
      manager.start();
      const server1 = await manager.createSession('session-1', mockTransport as any);
      (server1.notification as jest.Mock).mockRejectedValueOnce(new Error('Disconnected'));

      await expect(manager.broadcastToolsListChanged()).resolves.toBeUndefined();
    });

    it('should work with zero sessions', async () => {
      manager.start();
      await expect(manager.broadcastToolsListChanged()).resolves.toBeUndefined();
    });
  });

  describe('per-session instance URL tracking (#398)', () => {
    it('should default instanceUrl to GITLAB_BASE_URL on session creation', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      expect(manager.getSessionInstanceUrl('session-1')).toBe('https://gitlab.example.com');
    });

    it('should use provided instanceUrl on session creation', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any, 'https://custom.gitlab.com');

      expect(manager.getSessionInstanceUrl('session-1')).toBe('https://custom.gitlab.com');
    });

    it('should return undefined for non-existent session', () => {
      expect(manager.getSessionInstanceUrl('does-not-exist')).toBeUndefined();
    });

    it('should update instanceUrl via setSessionInstanceUrl', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      manager.setSessionInstanceUrl('session-1', 'https://other.gitlab.com');

      expect(manager.getSessionInstanceUrl('session-1')).toBe('https://other.gitlab.com');
    });

    it('should send tools/list_changed notification when instanceUrl changes', async () => {
      manager.start();
      const server = await manager.createSession('session-1', mockTransport as any);

      // URL changes → notification must be sent to this specific session's server
      manager.setSessionInstanceUrl('session-1', 'https://other.gitlab.com');

      // Allow the fire-and-forget promise to settle
      await Promise.resolve();

      expect(server.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
    });

    it('should NOT send tools/list_changed notification when instanceUrl is unchanged', async () => {
      manager.start();
      const server = await manager.createSession(
        'session-1',
        mockTransport as any,
        'https://a.gitlab.com',
      );

      // Same URL again → no notification
      manager.setSessionInstanceUrl('session-1', 'https://a.gitlab.com');
      await Promise.resolve();

      // notification may have been called during connect — only check that the
      // URL-unchanged path does NOT add an extra notification call
      const callsBefore = (server.notification as jest.Mock).mock.calls.length;
      manager.setSessionInstanceUrl('session-1', 'https://a.gitlab.com');
      await Promise.resolve();
      expect((server.notification as jest.Mock).mock.calls.length).toBe(callsBefore);
    });

    it('should no-op setSessionInstanceUrl for non-existent session', () => {
      // Should not throw
      expect(() =>
        manager.setSessionInstanceUrl('does-not-exist', 'https://gitlab.example.com'),
      ).not.toThrow();
    });

    it('should swallow notification errors when instanceUrl changes (fire-and-forget catch)', async () => {
      manager.start();
      const server = await manager.createSession('session-1', mockTransport as any);

      // Make the notification call reject
      (server.notification as jest.Mock).mockRejectedValueOnce(new Error('Transport closed'));

      // Should not throw despite notification failure
      expect(() =>
        manager.setSessionInstanceUrl('session-1', 'https://other.gitlab.com'),
      ).not.toThrow();

      // Allow the fire-and-forget promise (and its catch) to settle
      await Promise.resolve();
      await Promise.resolve();

      // URL was still updated despite notification failure
      expect(manager.getSessionInstanceUrl('session-1')).toBe('https://other.gitlab.com');
    });

    it('should return per-instance session counts from getSessionsByInstance', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any, 'https://a.gitlab.com');
      await manager.createSession('session-2', mockTransport as any, 'https://a.gitlab.com');
      await manager.createSession('session-3', mockTransport as any, 'https://b.gitlab.com');

      const counts = manager.getSessionsByInstance();

      expect(counts.get('https://a.gitlab.com')).toBe(2);
      expect(counts.get('https://b.gitlab.com')).toBe(1);
      expect(counts.size).toBe(2);
    });

    it('should return empty map when no sessions exist', () => {
      const counts = manager.getSessionsByInstance();
      expect(counts.size).toBe(0);
    });
  });

  describe('broadcastToolsListChanged — per-instance filtering (#398)', () => {
    it('should notify only sessions matching the given instanceUrl', async () => {
      manager.start();
      const serverA1 = await manager.createSession(
        'session-a1',
        mockTransport as any,
        'https://a.gitlab.com',
      );
      const serverA2 = await manager.createSession(
        'session-a2',
        mockTransport as any,
        'https://a.gitlab.com',
      );
      const serverB = await manager.createSession(
        'session-b',
        mockTransport as any,
        'https://b.gitlab.com',
      );

      await manager.broadcastToolsListChanged('https://a.gitlab.com');

      // Only sessions targeting 'a.gitlab.com' should be notified — NOT session-b
      expect(serverA1.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
      expect(serverA2.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
      expect(serverB.notification).not.toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
    });

    it('should notify all sessions when no instanceUrl filter is provided', async () => {
      manager.start();
      const server1 = await manager.createSession(
        'session-1',
        mockTransport as any,
        'https://a.gitlab.com',
      );
      const server2 = await manager.createSession(
        'session-2',
        mockTransport as any,
        'https://b.gitlab.com',
      );

      await manager.broadcastToolsListChanged();

      // Both sessions notified when no filter
      expect(server1.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
      expect(server2.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
    });

    it('should no-op when no sessions match the instanceUrl filter', async () => {
      manager.start();
      const server = await manager.createSession(
        'session-1',
        mockTransport as any,
        'https://a.gitlab.com',
      );

      await expect(
        manager.broadcastToolsListChanged('https://unrelated.gitlab.com'),
      ).resolves.toBeUndefined();

      expect(server.notification).not.toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
      });
    });
  });

  describe('stale session cleanup', () => {
    it('should remove sessions that exceed timeout', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      expect(manager.activeSessionCount).toBe(1);

      // Advance past the 5s timeout + 60s cleanup interval
      jest.advanceTimersByTime(61_000);

      // Give the fire-and-forget cleanup promise time to settle
      await Promise.resolve();

      expect(manager.activeSessionCount).toBe(0);
    });

    it('should never remove stdio session regardless of inactivity (regression: #361)', async () => {
      // stdio is single-client, single-process — its lifetime is owned by the
      // client, not by the session manager's idle timeout.
      manager.start();
      await manager.createSession(STDIO_SESSION_ID, mockTransport as any);

      expect(manager.activeSessionCount).toBe(1);

      // Advance well past the 5s timeout + multiple cleanup cycles
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();

      // stdio session must still be alive
      expect(manager.activeSessionCount).toBe(1);
    });

    it('should remove non-stdio sessions but keep stdio session', async () => {
      // Verify that cleanup correctly targets only HTTP sessions
      manager.start();
      await manager.createSession(STDIO_SESSION_ID, mockTransport as any);
      await manager.createSession('http-session-1', mockTransport as any);

      expect(manager.activeSessionCount).toBe(2);

      // Advance past timeout + cleanup interval
      jest.advanceTimersByTime(61_000);
      await Promise.resolve();

      // Only stdio should survive
      expect(manager.activeSessionCount).toBe(1);

      // Verify it's actually the stdio session that survived
      await manager.removeSession(STDIO_SESSION_ID);
      expect(manager.activeSessionCount).toBe(0);
    });

    it('should not remove sessions that are within timeout', async () => {
      manager.start();
      await manager.createSession('session-1', mockTransport as any);

      // Advance 60s (one cleanup interval) but session was just created
      // Actually, timeout is 5s so 60s > 5s, the session will be stale
      // Use a longer timeout manager for this test
      const longManager = new SessionManager(120_000); // 2 minute timeout
      longManager.start();
      await longManager.createSession('session-long', mockTransport as any);

      jest.advanceTimersByTime(61_000); // Cleanup runs, but 61s < 120s timeout

      expect(longManager.activeSessionCount).toBe(1);
      await longManager.shutdown();
    });
  });

  describe('shutdown', () => {
    it('should close all sessions and stop cleanup timer', async () => {
      manager.start();
      const server1 = await manager.createSession('session-1', mockTransport as any);
      const server2 = await manager.createSession('session-2', mockTransport as any);

      await manager.shutdown();

      expect(server1.close).toHaveBeenCalled();
      expect(server2.close).toHaveBeenCalled();
      expect(manager.activeSessionCount).toBe(0);
    });

    it('should work with zero sessions', async () => {
      manager.start();
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe('getSessionManager', () => {
  beforeEach(() => {
    resetSessionManager();
  });

  it('should return the same instance on repeated calls', () => {
    const sm1 = getSessionManager();
    const sm2 = getSessionManager();
    expect(sm1).toBe(sm2);
  });

  it('should create a new instance after reset', () => {
    const sm1 = getSessionManager();
    resetSessionManager();
    const sm2 = getSessionManager();
    expect(sm1).not.toBe(sm2);
  });
});
