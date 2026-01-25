/**
 * Unit tests for SessionManager
 * Verifies per-session Server isolation, cleanup, and broadcast behavior
 */

const mockServer = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  notification: jest.fn().mockResolvedValue(undefined),
  oninitialized: null as (() => void) | null,
  getClientVersion: jest.fn().mockReturnValue({ name: "test-client" }),
};

jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn(() => ({ ...mockServer })),
}));

jest.mock("../../src/config", () => ({
  packageName: "test-package",
  packageVersion: "1.0.0",
}));

jest.mock("../../src/handlers", () => ({
  setupHandlers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/utils/schema-utils", () => ({
  setDetectedSchemaMode: jest.fn(),
}));

jest.mock("../../src/logger", () => ({
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

import { SessionManager, getSessionManager, resetSessionManager } from "../../src/session-manager";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { setupHandlers } from "../../src/handlers";
import { setDetectedSchemaMode } from "../../src/utils/schema-utils";
import { logWarn } from "../../src/logger";

describe("SessionManager", () => {
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

  describe("start", () => {
    it("should start the cleanup interval", () => {
      manager.start();
      // Cleanup interval is started (tested via cleanupStaleSessions behavior)
      expect(manager.activeSessionCount).toBe(0);
    });
  });

  describe("createSession", () => {
    it("should create a new Server instance per session", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);

      expect(Server).toHaveBeenCalledWith(
        { name: "test-package", version: "1.0.0" },
        { capabilities: { tools: { listChanged: true } } }
      );
      expect(manager.activeSessionCount).toBe(1);
    });

    it("should create separate Server instances for different sessions", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);
      await manager.createSession("session-2", mockTransport as any);

      // Two Server instances created
      expect(Server).toHaveBeenCalledTimes(2);
      expect(manager.activeSessionCount).toBe(2);
    });

    it("should register handlers on each new Server", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);
      await manager.createSession("session-2", mockTransport as any);

      // setupHandlers called for each session
      expect(setupHandlers).toHaveBeenCalledTimes(2);
    });

    it("should connect the Server to the transport", async () => {
      manager.start();
      const server = await manager.createSession("session-1", mockTransport as any);

      expect(server.connect).toHaveBeenCalledWith(mockTransport);
    });

    it("should only call setDetectedSchemaMode once across multiple sessions", async () => {
      manager.start();

      // Create first session and trigger oninitialized
      const server1 = await manager.createSession("session-1", mockTransport as any);
      // Simulate SDK calling oninitialized
      (server1 as any).oninitialized();

      // Create second session and trigger oninitialized
      const server2 = await manager.createSession("session-2", mockTransport as any);
      (server2 as any).oninitialized();

      // setDetectedSchemaMode should only be called once (from first session)
      expect(setDetectedSchemaMode).toHaveBeenCalledTimes(1);
    });

    it("should close existing session when duplicate sessionId is provided", async () => {
      manager.start();

      // Create a session
      const server1 = await manager.createSession("session-dup", mockTransport as any);
      expect(manager.activeSessionCount).toBe(1);

      // Create another session with the SAME ID — should close the first
      const server2 = await manager.createSession("session-dup", mockTransport as any);

      // Old server should have been closed
      expect(server1.close).toHaveBeenCalled();
      // Manager should still have exactly 1 session with that ID
      expect(manager.activeSessionCount).toBe(1);
      // Warning should have been logged
      expect(logWarn).toHaveBeenCalledWith(
        "Duplicate sessionId detected — closing existing session",
        { sessionId: "session-dup" }
      );
      // New server is a distinct instance
      expect(server2).not.toBe(server1);
    });
  });

  describe("touchSession", () => {
    it("should update lastActivityAt for existing session", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);

      // Advance time
      jest.advanceTimersByTime(2000);

      // Touch session to reset timeout
      manager.touchSession("session-1");

      // Advance to just before new timeout (5s from touch)
      jest.advanceTimersByTime(4500);

      // Session should still be active (touched 4.5s ago, timeout is 5s)
      expect(manager.activeSessionCount).toBe(1);
    });

    it("should not throw for non-existent session", () => {
      manager.start();
      expect(() => manager.touchSession("non-existent")).not.toThrow();
    });
  });

  describe("removeSession", () => {
    it("should remove session and close its Server", async () => {
      manager.start();
      const server = await manager.createSession("session-1", mockTransport as any);

      await manager.removeSession("session-1");

      expect(server.close).toHaveBeenCalled();
      expect(manager.activeSessionCount).toBe(0);
    });

    it("should not throw for non-existent session", async () => {
      manager.start();
      await expect(manager.removeSession("non-existent")).resolves.toBeUndefined();
    });

    it("should handle Server.close() errors gracefully", async () => {
      manager.start();
      const server = await manager.createSession("session-1", mockTransport as any);
      (server.close as jest.Mock).mockRejectedValueOnce(new Error("Already closed"));

      // Should not throw
      await expect(manager.removeSession("session-1")).resolves.toBeUndefined();
      expect(manager.activeSessionCount).toBe(0);
    });
  });

  describe("broadcastToolsListChanged", () => {
    it("should send notification to all active sessions", async () => {
      manager.start();
      const server1 = await manager.createSession("session-1", mockTransport as any);
      const server2 = await manager.createSession("session-2", mockTransport as any);

      await manager.broadcastToolsListChanged();

      expect(server1.notification).toHaveBeenCalledWith({
        method: "notifications/tools/list_changed",
      });
      expect(server2.notification).toHaveBeenCalledWith({
        method: "notifications/tools/list_changed",
      });
    });

    it("should not throw if individual notifications fail", async () => {
      manager.start();
      const server1 = await manager.createSession("session-1", mockTransport as any);
      (server1.notification as jest.Mock).mockRejectedValueOnce(new Error("Disconnected"));

      await expect(manager.broadcastToolsListChanged()).resolves.toBeUndefined();
    });

    it("should work with zero sessions", async () => {
      manager.start();
      await expect(manager.broadcastToolsListChanged()).resolves.toBeUndefined();
    });
  });

  describe("stale session cleanup", () => {
    it("should remove sessions that exceed timeout", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);

      expect(manager.activeSessionCount).toBe(1);

      // Advance past the 5s timeout + 60s cleanup interval
      jest.advanceTimersByTime(61_000);

      // Give the fire-and-forget cleanup promise time to settle
      await Promise.resolve();

      expect(manager.activeSessionCount).toBe(0);
    });

    it("should not remove sessions that are within timeout", async () => {
      manager.start();
      await manager.createSession("session-1", mockTransport as any);

      // Advance 60s (one cleanup interval) but session was just created
      // Actually, timeout is 5s so 60s > 5s, the session will be stale
      // Use a longer timeout manager for this test
      const longManager = new SessionManager(120_000); // 2 minute timeout
      longManager.start();
      await longManager.createSession("session-long", mockTransport as any);

      jest.advanceTimersByTime(61_000); // Cleanup runs, but 61s < 120s timeout

      expect(longManager.activeSessionCount).toBe(1);
      await longManager.shutdown();
    });
  });

  describe("shutdown", () => {
    it("should close all sessions and stop cleanup timer", async () => {
      manager.start();
      const server1 = await manager.createSession("session-1", mockTransport as any);
      const server2 = await manager.createSession("session-2", mockTransport as any);

      await manager.shutdown();

      expect(server1.close).toHaveBeenCalled();
      expect(server2.close).toHaveBeenCalled();
      expect(manager.activeSessionCount).toBe(0);
    });

    it("should work with zero sessions", async () => {
      manager.start();
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe("getSessionManager", () => {
  beforeEach(() => {
    resetSessionManager();
  });

  it("should return the same instance on repeated calls", () => {
    const sm1 = getSessionManager();
    const sm2 = getSessionManager();
    expect(sm1).toBe(sm2);
  });

  it("should create a new instance after reset", () => {
    const sm1 = getSessionManager();
    resetSessionManager();
    const sm2 = getSessionManager();
    expect(sm1).not.toBe(sm2);
  });
});
