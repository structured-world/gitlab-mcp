/**
 * Tests for AccessLogFormatter
 *
 * Tests the condensed access log format implementation including:
 * - Session ID truncation
 * - Duration formatting
 * - GitLab status formatting
 * - Details formatting
 * - Access log entry creation and formatting
 * - Connection close log formatting
 */

import {
  truncateSessionId,
  formatDuration,
  formatGitLabStatus,
  formatDetails,
  formatAccessLog,
  formatConnectionClose,
  createAccessLogEntry,
  createConnectionCloseEntry,
  AccessLogFormatter,
} from "../../../src/logging/access-log";
import type { RequestStack, ConnectionStats } from "../../../src/logging/types";

describe("AccessLogFormatter", () => {
  describe("truncateSessionId", () => {
    it("returns '-' for undefined session", () => {
      expect(truncateSessionId(undefined)).toBe("-");
    });

    it("returns '-' for empty session", () => {
      expect(truncateSessionId("")).toBe("-");
    });

    it("returns full ID for short sessions (<=8 chars)", () => {
      expect(truncateSessionId("abc123")).toBe("abc123");
      expect(truncateSessionId("12345678")).toBe("12345678");
    });

    it("truncates long session IDs with '..'", () => {
      expect(truncateSessionId("abc12345-6789-0abc")).toBe("abc12345..");
      expect(truncateSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400..");
    });
  });

  describe("formatDuration", () => {
    it("formats seconds only", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(1000)).toBe("1s");
      expect(formatDuration(59000)).toBe("59s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(60000)).toBe("1m0s");
      expect(formatDuration(90000)).toBe("1m30s");
      expect(formatDuration(3540000)).toBe("59m0s");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(3600000)).toBe("1h0m");
      expect(formatDuration(5400000)).toBe("1h30m");
      expect(formatDuration(7260000)).toBe("2h1m");
    });
  });

  describe("formatGitLabStatus", () => {
    it("returns '-' for undefined status", () => {
      expect(formatGitLabStatus(undefined)).toBe("-");
    });

    it("formats numeric status codes", () => {
      expect(formatGitLabStatus(200)).toBe("GL:200");
      expect(formatGitLabStatus(404)).toBe("GL:404");
      expect(formatGitLabStatus(500)).toBe("GL:500");
    });

    it("formats timeout status", () => {
      expect(formatGitLabStatus("timeout")).toBe("GL:timeout");
    });

    it("formats error status", () => {
      expect(formatGitLabStatus("error")).toBe("GL:error");
    });
  });

  describe("formatDetails", () => {
    it("returns empty string for empty details", () => {
      expect(formatDetails({})).toBe("");
    });

    it("formats simple key-value pairs", () => {
      expect(formatDetails({ project: "test/repo" })).toBe("project=test/repo");
      expect(formatDetails({ count: 42 })).toBe("count=42");
      expect(formatDetails({ enabled: true })).toBe("enabled=true");
    });

    it("quotes values with spaces", () => {
      expect(formatDetails({ err: "Not Found" })).toBe('err="Not Found"');
      expect(formatDetails({ path: "some path/file" })).toBe('path="some path/file"');
    });

    it("formats multiple details", () => {
      const details = { namespace: "test", items: 15, ready: true };
      const result = formatDetails(details);
      expect(result).toContain("namespace=test");
      expect(result).toContain("items=15");
      expect(result).toContain("ready=true");
    });

    it("escapes quotes in values", () => {
      expect(formatDetails({ msg: 'He said "hello"' })).toBe('msg="He said \\"hello\\""');
    });

    it("escapes backslashes in values", () => {
      expect(formatDetails({ path: "C:\\Users\\test" })).toBe('path="C:\\\\Users\\\\test"');
    });

    it("escapes both quotes and backslashes", () => {
      expect(formatDetails({ err: 'Error: "file\\not found"' })).toBe(
        'err="Error: \\"file\\\\not found\\""'
      );
    });

    it("escapes newlines to maintain single-line format", () => {
      expect(formatDetails({ msg: "line1\nline2" })).toBe('msg="line1\\nline2"');
    });

    it("escapes carriage returns", () => {
      expect(formatDetails({ msg: "line1\rline2" })).toBe('msg="line1\\rline2"');
    });

    it("escapes tabs", () => {
      expect(formatDetails({ msg: "col1\tcol2" })).toBe('msg="col1\\tcol2"');
    });

    it("escapes mixed control characters", () => {
      expect(formatDetails({ msg: 'Error:\n\t"details"\r\nend' })).toBe(
        'msg="Error:\\n\\t\\"details\\"\\r\\nend"'
      );
    });
  });

  describe("createAccessLogEntry", () => {
    it("creates entry from request stack", () => {
      const stack: RequestStack = {
        startTime: Date.now() - 142,
        clientIp: "192.168.1.100",
        sessionId: "abc12345-6789-0abc",
        context: "mygroup/myproject",
        readOnly: false,
        method: "POST",
        path: "/mcp",
        tool: "browse_projects",
        action: "list",
        gitlabStatus: 200,
        gitlabDuration: 98,
        details: { namespace: "test/backend", items: 15 },
        status: 200,
      };

      const entry = createAccessLogEntry(stack);

      expect(entry.clientIp).toBe("192.168.1.100");
      expect(entry.session).toBe("abc12345..");
      expect(entry.ctx).toBe("mygroup/myproject");
      expect(entry.ro).toBe("-");
      expect(entry.method).toBe("POST");
      expect(entry.path).toBe("/mcp");
      expect(entry.status).toBe(200);
      expect(entry.durationMs).toBeGreaterThanOrEqual(142);
      expect(entry.tool).toBe("browse_projects");
      expect(entry.action).toBe("list");
      expect(entry.gitlabStatus).toBe("GL:200");
      expect(entry.gitlabDurationMs).toBe("98ms");
      expect(entry.details).toContain("namespace=test/backend");
      expect(entry.details).toContain("items=15");
    });

    it("shows RO for read-only mode", () => {
      const stack: RequestStack = {
        startTime: Date.now() - 50,
        clientIp: "127.0.0.1",
        context: "mygroup/proj",
        readOnly: true,
        method: "POST",
        path: "/mcp",
        details: {},
        status: 200,
      };

      const entry = createAccessLogEntry(stack);

      expect(entry.ctx).toBe("mygroup/proj");
      expect(entry.ro).toBe("RO");
    });

    it("uses defaults for missing optional fields", () => {
      const stack: RequestStack = {
        startTime: Date.now() - 50,
        clientIp: "127.0.0.1",
        method: "GET",
        path: "/health",
        details: {},
        status: 200,
      };

      const entry = createAccessLogEntry(stack);

      expect(entry.session).toBe("-");
      expect(entry.ctx).toBe("-");
      expect(entry.ro).toBe("-");
      expect(entry.tool).toBe("-");
      expect(entry.action).toBe("-");
      expect(entry.gitlabStatus).toBe("-");
      expect(entry.gitlabDurationMs).toBe("-");
      expect(entry.details).toBe("");
    });
  });

  describe("formatAccessLog", () => {
    it("formats successful tool call", () => {
      const entry = {
        timestamp: "2026-01-25T12:34:56Z",
        clientIp: "192.168.1.100",
        session: "abc12345..",
        ctx: "mygroup/proj",
        ro: "-",
        method: "POST",
        path: "/mcp",
        status: 200,
        durationMs: 142,
        tool: "browse_projects",
        action: "list",
        gitlabStatus: "GL:200",
        gitlabDurationMs: "98ms",
        details: "namespace=test/backend items=15",
      };

      const log = formatAccessLog(entry);

      expect(log).toBe(
        "[2026-01-25T12:34:56Z] 192.168.1.100 abc12345.. mygroup/proj - POST /mcp 200 142ms | browse_projects list | GL:200 98ms | namespace=test/backend items=15"
      );
    });

    it("formats request without tool", () => {
      const entry = {
        timestamp: "2026-01-25T12:34:56Z",
        clientIp: "192.168.1.100",
        session: "-",
        ctx: "-",
        ro: "-",
        method: "GET",
        path: "/health",
        status: 200,
        durationMs: 5,
        tool: "-",
        action: "-",
        gitlabStatus: "-",
        gitlabDurationMs: "-",
        details: "",
      };

      const log = formatAccessLog(entry);

      expect(log).toBe(
        "[2026-01-25T12:34:56Z] 192.168.1.100 - - - GET /health 200 5ms | - - | - - | -"
      );
    });

    it("formats error response", () => {
      const entry = {
        timestamp: "2026-01-25T12:34:56Z",
        clientIp: "192.168.1.100",
        session: "abc12345..",
        ctx: "test/api",
        ro: "-",
        method: "POST",
        path: "/mcp",
        status: 200,
        durationMs: 85,
        tool: "manage_merge_request",
        action: "approve",
        gitlabStatus: "GL:403",
        gitlabDurationMs: "45ms",
        details: 'project=test/api mr_iid=42 err="403 Forbidden"',
      };

      const log = formatAccessLog(entry);

      expect(log).toContain("GL:403");
      expect(log).toContain('err="403 Forbidden"');
    });
  });

  describe("createConnectionCloseEntry", () => {
    it("creates entry from connection stats", () => {
      const stats: ConnectionStats = {
        connectedAt: Date.now() - 332000, // 5m32s ago
        clientIp: "192.168.1.100",
        sessionId: "abc12345-6789-0abc",
        requestCount: 42,
        toolCount: 15,
        errorCount: 0,
      };

      const entry = createConnectionCloseEntry(stats, "client_disconnect");

      expect(entry.clientIp).toBe("192.168.1.100");
      expect(entry.session).toBe("abc12345..");
      expect(entry.duration).toBe("5m32s");
      expect(entry.reason).toBe("client_disconnect");
      expect(entry.requests).toBe(42);
      expect(entry.tools).toBe(15);
      expect(entry.errors).toBe(0);
      expect(entry.lastError).toBeUndefined();
    });

    it("includes last error when present", () => {
      const stats: ConnectionStats = {
        connectedAt: Date.now() - 45000,
        clientIp: "192.168.1.100",
        sessionId: "abc12345",
        requestCount: 5,
        toolCount: 3,
        errorCount: 1,
        lastError: "write EPIPE",
      };

      const entry = createConnectionCloseEntry(stats, "transport_error");

      expect(entry.errors).toBe(1);
      expect(entry.lastError).toBe("write EPIPE");
    });
  });

  describe("formatConnectionClose", () => {
    it("formats normal disconnect", () => {
      const entry = {
        timestamp: "2026-01-25T12:40:00Z",
        clientIp: "192.168.1.100",
        session: "abc12345..",
        duration: "5m32s",
        reason: "client_disconnect" as const,
        requests: 42,
        tools: 15,
        errors: 0,
      };

      const log = formatConnectionClose(entry);

      expect(log).toBe(
        "[2026-01-25T12:40:00Z] CONN_CLOSE 192.168.1.100 abc12345.. 5m32s client_disconnect | reqs=42 tools=15 errs=0"
      );
    });

    it("formats error disconnect with last_err", () => {
      const entry = {
        timestamp: "2026-01-25T12:40:00Z",
        clientIp: "192.168.1.100",
        session: "abc12345..",
        duration: "45s",
        reason: "transport_error" as const,
        requests: 5,
        tools: 3,
        errors: 1,
        lastError: "write EPIPE",
      };

      const log = formatConnectionClose(entry);

      expect(log).toBe(
        '[2026-01-25T12:40:00Z] CONN_CLOSE 192.168.1.100 abc12345.. 45s transport_error | reqs=5 tools=3 errs=1 last_err="write EPIPE"'
      );
    });

    it("escapes quotes in last_err", () => {
      const entry = {
        timestamp: "2026-01-25T12:40:00Z",
        clientIp: "192.168.1.100",
        session: "abc12345..",
        duration: "10s",
        reason: "transport_error" as const,
        requests: 1,
        tools: 0,
        errors: 1,
        lastError: 'Error: "connection refused"',
      };

      const log = formatConnectionClose(entry);

      expect(log).toContain('last_err="Error: \\"connection refused\\""');
    });
  });

  describe("AccessLogFormatter class", () => {
    let formatter: AccessLogFormatter;

    beforeEach(() => {
      formatter = new AccessLogFormatter();
    });

    it("formats request from stack", () => {
      const stack: RequestStack = {
        startTime: Date.now() - 100,
        clientIp: "127.0.0.1",
        method: "POST",
        path: "/mcp",
        details: {},
        status: 200,
      };

      const log = formatter.formatRequest(stack);

      expect(log).toContain("127.0.0.1");
      expect(log).toContain("POST");
      expect(log).toContain("/mcp");
      expect(log).toContain("200");
    });

    it("formats connection close", () => {
      const stats: ConnectionStats = {
        connectedAt: Date.now() - 60000,
        clientIp: "127.0.0.1",
        sessionId: "test-session",
        requestCount: 10,
        toolCount: 5,
        errorCount: 0,
      };

      const log = formatter.formatConnectionClose(stats, "server_shutdown");

      expect(log).toContain("CONN_CLOSE");
      expect(log).toContain("server_shutdown");
      expect(log).toContain("reqs=10");
    });

    it("returns structured entries for JSON logging", () => {
      const stack: RequestStack = {
        startTime: Date.now() - 100,
        clientIp: "127.0.0.1",
        method: "GET",
        path: "/health",
        details: {},
        status: 200,
      };

      const entry = formatter.getAccessLogEntry(stack);

      expect(entry.clientIp).toBe("127.0.0.1");
      expect(entry.method).toBe("GET");
      expect(entry.status).toBe(200);
    });
  });
});
