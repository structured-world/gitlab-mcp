/**
 * Tests for ConnectionTracker
 *
 * Tests connection statistics tracking including:
 * - Connection lifecycle (open, update, close)
 * - Request and tool counting
 * - Error recording
 * - Close reasons
 * - Shutdown handling
 */

import {
  ConnectionTracker,
  getConnectionTracker,
  resetConnectionTracker,
} from "../../../src/logging/connection-tracker";

describe("ConnectionTracker", () => {
  let tracker: ConnectionTracker;

  beforeEach(() => {
    tracker = new ConnectionTracker(true);
  });

  afterEach(() => {
    tracker.clear();
  });

  describe("enable/disable", () => {
    it("is enabled by default", () => {
      expect(tracker.isEnabled()).toBe(true);
    });

    it("can be disabled", () => {
      tracker.setEnabled(false);
      expect(tracker.isEnabled()).toBe(false);
    });

    it("does not track when disabled", () => {
      tracker.setEnabled(false);
      tracker.openConnection("session-1", "127.0.0.1");
      expect(tracker.hasConnection("session-1")).toBe(false);
    });
  });

  describe("openConnection", () => {
    it("creates new connection stats", () => {
      tracker.openConnection("session-1", "192.168.1.100");

      expect(tracker.hasConnection("session-1")).toBe(true);
      expect(tracker.getActiveConnectionCount()).toBe(1);
    });

    it("initializes stats with zeros", () => {
      tracker.openConnection("session-1", "192.168.1.100");

      const stats = tracker.getStats("session-1");

      expect(stats).toBeDefined();
      expect(stats?.clientIp).toBe("192.168.1.100");
      expect(stats?.sessionId).toBe("session-1");
      expect(stats?.requestCount).toBe(0);
      expect(stats?.toolCount).toBe(0);
      expect(stats?.errorCount).toBe(0);
      expect(stats?.lastError).toBeUndefined();
      expect(stats?.connectedAt).toBeLessThanOrEqual(Date.now());
    });

    it("tracks multiple connections", () => {
      tracker.openConnection("session-1", "192.168.1.100");
      tracker.openConnection("session-2", "192.168.1.101");
      tracker.openConnection("session-3", "192.168.1.102");

      expect(tracker.getActiveConnectionCount()).toBe(3);
    });
  });

  describe("incrementRequests", () => {
    it("increments request count", () => {
      tracker.openConnection("session-1", "127.0.0.1");

      tracker.incrementRequests("session-1");
      tracker.incrementRequests("session-1");
      tracker.incrementRequests("session-1");

      const stats = tracker.getStats("session-1");
      expect(stats?.requestCount).toBe(3);
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      tracker.incrementRequests("non-existent");
    });
  });

  describe("incrementTools", () => {
    it("increments tool count", () => {
      tracker.openConnection("session-1", "127.0.0.1");

      tracker.incrementTools("session-1");
      tracker.incrementTools("session-1");

      const stats = tracker.getStats("session-1");
      expect(stats?.toolCount).toBe(2);
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      tracker.incrementTools("non-existent");
    });
  });

  describe("recordError", () => {
    it("increments error count and stores last error", () => {
      tracker.openConnection("session-1", "127.0.0.1");

      tracker.recordError("session-1", "First error");
      tracker.recordError("session-1", "Second error");

      const stats = tracker.getStats("session-1");
      expect(stats?.errorCount).toBe(2);
      expect(stats?.lastError).toBe("Second error");
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      tracker.recordError("non-existent", "error");
    });
  });

  describe("closeConnection", () => {
    it("removes connection and returns log line", () => {
      tracker.openConnection("session-1", "192.168.1.100");
      tracker.incrementRequests("session-1");
      tracker.incrementTools("session-1");

      const logLine = tracker.closeConnection("session-1", "client_disconnect");

      expect(tracker.hasConnection("session-1")).toBe(false);
      expect(logLine).toBeDefined();
      expect(logLine).toContain("CONN_CLOSE");
      expect(logLine).toContain("192.168.1.100");
      expect(logLine).toContain("client_disconnect");
      expect(logLine).toContain("reqs=1");
      expect(logLine).toContain("tools=1");
    });

    it("handles different close reasons", () => {
      const reasons = [
        "client_disconnect",
        "idle_timeout",
        "server_shutdown",
        "transport_error",
        "auth_expired",
      ] as const;

      for (const reason of reasons) {
        tracker.openConnection(`session-${reason}`, "127.0.0.1");
        const logLine = tracker.closeConnection(`session-${reason}`, reason);
        expect(logLine).toContain(reason);
      }
    });

    it("includes last error in log", () => {
      tracker.openConnection("session-1", "127.0.0.1");
      tracker.recordError("session-1", "write EPIPE");

      const logLine = tracker.closeConnection("session-1", "transport_error");

      expect(logLine).toContain('last_err="write EPIPE"');
    });

    it("returns undefined for non-existent connection", () => {
      const logLine = tracker.closeConnection("non-existent", "client_disconnect");
      expect(logLine).toBeUndefined();
    });

    it("returns undefined when disabled", () => {
      tracker.openConnection("session-1", "127.0.0.1");
      tracker.setEnabled(false);

      const logLine = tracker.closeConnection("session-1", "client_disconnect");
      expect(logLine).toBeUndefined();
    });
  });

  describe("getAllSessionIds", () => {
    it("returns all tracked session IDs", () => {
      tracker.openConnection("session-1", "127.0.0.1");
      tracker.openConnection("session-2", "127.0.0.1");
      tracker.openConnection("session-3", "127.0.0.1");

      const sessionIds = tracker.getAllSessionIds();

      expect(sessionIds).toHaveLength(3);
      expect(sessionIds).toContain("session-1");
      expect(sessionIds).toContain("session-2");
      expect(sessionIds).toContain("session-3");
    });

    it("returns empty array when no connections", () => {
      const sessionIds = tracker.getAllSessionIds();
      expect(sessionIds).toEqual([]);
    });
  });

  describe("closeAllConnections", () => {
    it("closes all connections with given reason", () => {
      tracker.openConnection("session-1", "127.0.0.1");
      tracker.openConnection("session-2", "127.0.0.1");
      tracker.openConnection("session-3", "127.0.0.1");

      tracker.closeAllConnections("server_shutdown");

      expect(tracker.getActiveConnectionCount()).toBe(0);
    });

    it("uses server_shutdown as default reason", () => {
      tracker.openConnection("session-1", "127.0.0.1");

      // Mock to capture the close call
      const closeSpy = jest.spyOn(tracker, "closeConnection");
      tracker.closeAllConnections();

      expect(closeSpy).toHaveBeenCalledWith("session-1", "server_shutdown");
    });
  });

  describe("clear", () => {
    it("removes all connections", () => {
      tracker.openConnection("session-1", "127.0.0.1");
      tracker.openConnection("session-2", "127.0.0.1");

      tracker.clear();

      expect(tracker.getActiveConnectionCount()).toBe(0);
    });
  });
});

describe("Global ConnectionTracker", () => {
  beforeEach(() => {
    resetConnectionTracker();
  });

  afterEach(() => {
    resetConnectionTracker();
  });

  it("returns singleton instance", () => {
    const tracker1 = getConnectionTracker();
    const tracker2 = getConnectionTracker();

    expect(tracker1).toBe(tracker2);
  });

  it("creates new instance after reset", () => {
    const tracker1 = getConnectionTracker();
    resetConnectionTracker();
    const tracker2 = getConnectionTracker();

    expect(tracker1).not.toBe(tracker2);
  });
});
