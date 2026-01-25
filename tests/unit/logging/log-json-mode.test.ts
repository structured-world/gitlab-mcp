/**
 * Tests for LOG_JSON mode in logging modules
 *
 * These tests verify that when LOG_JSON=true, the structured accessLog/connectionClose
 * objects are included in log output for log aggregators (Loki, ELK, Datadog).
 *
 * Uses module mocking to test the LOG_JSON=true branch that isn't covered
 * by default tests (where LOG_JSON=false).
 */

// Mock logger module with LOG_JSON=true BEFORE imports
const mockLoggerInfo = jest.fn();

jest.mock("../../../src/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  LOG_JSON: true, // This is the key - simulate JSON mode
  createLogger: jest.fn(() => ({
    info: mockLoggerInfo,
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Import AFTER mocking
import { RequestTracker } from "../../../src/logging/request-tracker";
import { ConnectionTracker } from "../../../src/logging/connection-tracker";

describe("LOG_JSON mode", () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
  });

  describe("RequestTracker with LOG_JSON=true", () => {
    let tracker: RequestTracker;

    beforeEach(() => {
      tracker = new RequestTracker(true);
    });

    afterEach(() => {
      tracker.clear();
    });

    it("includes accessLog object in log call when LOG_JSON=true", () => {
      // Setup request stack
      tracker.openStack("req-json-1", "192.168.1.100", "POST", "/mcp", "session-123");
      tracker.setTool("req-json-1", "browse_projects", "list");

      // Close stack - triggers log output
      const logLine = tracker.closeStack("req-json-1", 200);

      // Verify log was called with structured object (JSON mode)
      expect(mockLoggerInfo).toHaveBeenCalled();
      const [logArg, msgArg] = mockLoggerInfo.mock.calls[0];

      // In JSON mode, first argument should be object with accessLog
      expect(logArg).toHaveProperty("accessLog");
      expect(logArg.accessLog).toMatchObject({
        clientIp: "192.168.1.100",
        method: "POST",
        path: "/mcp",
        status: 200,
        tool: "browse_projects",
        action: "list",
      });

      // Second argument is the formatted log line
      expect(typeof msgArg).toBe("string");
      expect(msgArg).toContain("192.168.1.100");
      expect(logLine).toBe(msgArg);
    });

    it("accessLog object contains all expected fields", () => {
      tracker.openStack("req-json-2", "10.0.0.1", "POST", "/mcp", "sess-abc");
      tracker.setTool("req-json-2", "manage_merge_request", "approve");
      tracker.setContext("req-json-2", "mygroup/myproject");
      tracker.setReadOnly("req-json-2", true);
      tracker.setGitLabResponse("req-json-2", 200, 150);
      tracker.addDetails("req-json-2", { mr_iid: 42, project: "test/repo" });

      tracker.closeStack("req-json-2", 200);

      const [logArg] = mockLoggerInfo.mock.calls[0];
      expect(logArg.accessLog).toMatchObject({
        clientIp: "10.0.0.1",
        session: "sess-abc",
        ctx: "mygroup/myproject",
        ro: "RO",
        method: "POST",
        path: "/mcp",
        status: 200,
        tool: "manage_merge_request",
        action: "approve",
        gitlabStatus: "GL:200",
        gitlabDurationMs: "150ms",
      });
      expect(logArg.accessLog.details).toContain("mr_iid=42");
      expect(logArg.accessLog.details).toContain("project=test/repo");
    });
  });

  describe("ConnectionTracker with LOG_JSON=true", () => {
    let tracker: ConnectionTracker;

    beforeEach(() => {
      tracker = new ConnectionTracker(true);
    });

    afterEach(() => {
      tracker.clear();
    });

    it("includes connectionClose object in log call when LOG_JSON=true", () => {
      // Setup connection
      tracker.openConnection("conn-json-1", "192.168.1.100");
      tracker.incrementRequests("conn-json-1");
      tracker.incrementTools("conn-json-1");

      // Close connection - triggers log output
      const logLine = tracker.closeConnection("conn-json-1", "client_disconnect");

      // Verify log was called with structured object (JSON mode)
      expect(mockLoggerInfo).toHaveBeenCalled();
      const [logArg, msgArg] = mockLoggerInfo.mock.calls[0];

      // In JSON mode, first argument should be object with connectionClose
      expect(logArg).toHaveProperty("connectionClose");
      expect(logArg.connectionClose).toMatchObject({
        clientIp: "192.168.1.100",
        session: "conn-jso..", // Session ID is truncated to 8 chars + ".."
        reason: "client_disconnect",
        requests: 1,
        tools: 1,
        errors: 0,
      });

      // Second argument is the formatted log line
      expect(typeof msgArg).toBe("string");
      expect(msgArg).toContain("CONN_CLOSE");
      expect(logLine).toBe(msgArg);
    });

    it("connectionClose object includes error info when present", () => {
      tracker.openConnection("conn-json-2", "10.0.0.1");
      tracker.recordError("conn-json-2", "write EPIPE");
      tracker.recordError("conn-json-2", "connection reset");

      tracker.closeConnection("conn-json-2", "transport_error");

      const [logArg] = mockLoggerInfo.mock.calls[0];
      expect(logArg.connectionClose).toMatchObject({
        reason: "transport_error",
        errors: 2,
        lastError: "connection reset",
      });
    });

    it("handles all close reasons in JSON mode", () => {
      const reasons = [
        "client_disconnect",
        "idle_timeout",
        "server_shutdown",
        "transport_error",
        "auth_expired",
      ] as const;

      for (const reason of reasons) {
        mockLoggerInfo.mockClear();
        tracker.openConnection(`conn-${reason}`, "127.0.0.1");
        tracker.closeConnection(`conn-${reason}`, reason);

        expect(mockLoggerInfo).toHaveBeenCalled();
        const [logArg] = mockLoggerInfo.mock.calls[0];
        expect(logArg.connectionClose.reason).toBe(reason);
      }
    });
  });
});
