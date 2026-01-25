import { Request, Response } from "express";
import {
  getRequestContext,
  getMinimalRequestContext,
  getIpAddress,
  truncateId,
  buildRateLimitInfo,
} from "../../../src/utils/request-logger";

// Mock Request factory
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: "192.168.1.100",
    socket: { remoteAddress: "192.168.1.101" },
    method: "POST",
    path: "/mcp",
    headers: {
      "user-agent": "TestClient/1.0",
    },
    ...overrides,
  } as Request;
}

// Mock Response factory
function createMockResponse(locals: Record<string, unknown> = {}): Response {
  return {
    locals,
  } as Response;
}

describe("request-logger utils", () => {
  describe("getIpAddress", () => {
    it("should return req.ip when available", () => {
      const req = createMockRequest({ ip: "10.0.0.1" });
      expect(getIpAddress(req)).toBe("10.0.0.1");
    });

    it("should fall back to socket.remoteAddress when req.ip is undefined", () => {
      const req = createMockRequest({ ip: undefined });
      expect(getIpAddress(req)).toBe("192.168.1.101");
    });

    it("should return 'unknown' when both ip and socket.remoteAddress are unavailable", () => {
      const req = createMockRequest({ ip: undefined, socket: undefined as any });
      expect(getIpAddress(req)).toBe("unknown");
    });

    it("should handle missing socket property gracefully", () => {
      const req = { ip: undefined, socket: null } as unknown as Request;
      expect(getIpAddress(req)).toBe("unknown");
    });
  });

  describe("truncateId", () => {
    it("should truncate long IDs to first4..last4 format", () => {
      // "abcdefghijklmnop" -> "abcd..mnop"
      expect(truncateId("abcdefghijklmnop")).toBe("abcd..mnop");
      // "123456789012345" -> "1234..2345"
      expect(truncateId("123456789012345")).toBe("1234..2345");
    });

    it("should return short IDs unchanged (<=10 chars)", () => {
      expect(truncateId("abcd")).toBe("abcd");
      expect(truncateId("1234567890")).toBe("1234567890");
    });

    it("should return undefined for undefined input", () => {
      expect(truncateId(undefined)).toBeUndefined();
    });

    it("should return undefined for empty string (falsy)", () => {
      expect(truncateId("")).toBeUndefined();
    });

    it("should handle exactly 10 character string", () => {
      expect(truncateId("1234567890")).toBe("1234567890");
    });

    it("should handle 11 character string", () => {
      // "12345678901" -> "1234..8901"
      expect(truncateId("12345678901")).toBe("1234..8901");
    });
  });

  describe("getRequestContext", () => {
    it("should extract full request context", () => {
      const req = createMockRequest({
        headers: {
          "user-agent": "Claude/1.0",
          "mcp-session-id": "mcp-session-1234567890",
        },
      });
      const res = createMockResponse({
        oauthSessionId: "oauth-session-abcdefghij",
      });

      const context = getRequestContext(req, res);

      expect(context.requestId).toHaveLength(8); // Short UUID
      expect(context.ip).toBe("192.168.1.100");
      expect(context.method).toBe("POST");
      expect(context.path).toBe("/mcp");
      expect(context.userAgent).toBe("Claude/1.0");
      expect(context.hasOAuthSession).toBe(true);
      expect(context.hasMcpSessionHeader).toBe(true);
      // oauth-session-abcdefghij -> first4="oaut" + ".." + last4="ghij"
      expect(context.oauthSessionId).toBe("oaut..ghij");
      // mcp-session-1234567890 -> first4="mcp-" + ".." + last4="7890"
      expect(context.mcpSessionId).toBe("mcp-..7890");
    });

    it("should handle missing auth context", () => {
      const req = createMockRequest();
      const res = createMockResponse();

      const context = getRequestContext(req, res);

      expect(context.hasOAuthSession).toBe(false);
      expect(context.hasMcpSessionHeader).toBe(false);
      expect(context.oauthSessionId).toBeUndefined();
      expect(context.mcpSessionId).toBeUndefined();
    });

    it("should generate unique requestIds", () => {
      const req = createMockRequest();
      const res = createMockResponse();

      const context1 = getRequestContext(req, res);
      const context2 = getRequestContext(req, res);

      expect(context1.requestId).not.toBe(context2.requestId);
    });
  });

  describe("getMinimalRequestContext", () => {
    it("should extract minimal context without auth info", () => {
      const req = createMockRequest({
        headers: {
          "user-agent": "MinimalClient/1.0",
          "mcp-session-id": "should-be-ignored",
        },
      });

      const context = getMinimalRequestContext(req);

      expect(context.requestId).toHaveLength(8);
      expect(context.ip).toBe("192.168.1.100");
      expect(context.method).toBe("POST");
      expect(context.path).toBe("/mcp");
      expect(context.userAgent).toBe("MinimalClient/1.0");
      // Should not have auth fields
      expect(context).not.toHaveProperty("hasOAuthSession");
      expect(context).not.toHaveProperty("hasMcpSessionHeader");
      expect(context).not.toHaveProperty("oauthSessionId");
      expect(context).not.toHaveProperty("mcpSessionId");
    });
  });

  describe("buildRateLimitInfo", () => {
    it("should build IP rate limit info", () => {
      const now = Date.now();
      const resetAt = now + 45000; // 45 seconds from now

      const info = buildRateLimitInfo("ip", "192.168.1.100", 85, 100, resetAt);

      expect(info.type).toBe("ip");
      expect(info.key).toBe("192.168.1.100"); // IP not truncated
      expect(info.used).toBe(85);
      expect(info.limit).toBe(100);
      expect(info.resetInSec).toBeGreaterThanOrEqual(44);
      expect(info.resetInSec).toBeLessThanOrEqual(45);
    });

    it("should build session rate limit info with truncated key", () => {
      const now = Date.now();
      const resetAt = now + 60000;

      const info = buildRateLimitInfo("session", "session-id-1234567890abcdef", 100, 100, resetAt);

      expect(info.type).toBe("session");
      // session-id-1234567890abcdef -> first4="sess" + ".." + last4="cdef"
      expect(info.key).toBe("sess..cdef");
      expect(info.used).toBe(100);
      expect(info.limit).toBe(100);
      expect(info.resetInSec).toBeGreaterThanOrEqual(59);
      expect(info.resetInSec).toBeLessThanOrEqual(60);
    });

    it("should handle past reset time", () => {
      const now = Date.now();
      const resetAt = now - 5000; // 5 seconds ago

      const info = buildRateLimitInfo("ip", "10.0.0.1", 50, 100, resetAt);

      expect(info.resetInSec).toBe(0);
    });

    it("should not truncate short session keys", () => {
      const now = Date.now();
      const resetAt = now + 30000;

      const info = buildRateLimitInfo("session", "short", 10, 100, resetAt);

      expect(info.key).toBe("short");
    });
  });
});
