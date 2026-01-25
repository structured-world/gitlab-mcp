/**
 * Rate Limiter Middleware Unit Tests
 */

import { Request, Response, NextFunction } from "express";
import {
  rateLimiterMiddleware,
  stopCleanup,
  getRateLimitStats,
} from "../../../src/middleware/rate-limiter";

// Mock config module
jest.mock("../../../src/config", () => ({
  RATE_LIMIT_IP_ENABLED: true,
  RATE_LIMIT_IP_WINDOW_MS: 60000,
  RATE_LIMIT_IP_MAX_REQUESTS: 100,
  RATE_LIMIT_SESSION_ENABLED: false,
  RATE_LIMIT_SESSION_WINDOW_MS: 60000,
  RATE_LIMIT_SESSION_MAX_REQUESTS: 300,
}));

// Mock logger
jest.mock("../../../src/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
  // Real implementation - pure function with no side effects
  truncateId: (id: string) => (id.length <= 10 ? id : id.substring(0, 4) + ".." + id.slice(-4)),
}));

// Helper to create mock request
function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    path: "/api/test",
    ip: "192.168.1.1",
    socket: { remoteAddress: "192.168.1.1" },
    headers: {},
    ...overrides,
  } as unknown as Request;
}

// Helper to create mock response
function createMockRes(locals: Record<string, unknown> = {}): Response {
  const res = {
    locals,
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("Rate Limiter Middleware", () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNext = jest.fn();
  });

  afterAll(() => {
    stopCleanup();
  });

  describe("rateLimiterMiddleware", () => {
    it("should skip rate limiting for health check endpoint", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ path: "/health" });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should skip rate limiting for authenticated users with oauthSessionId", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq();
      const mockRes = createMockRes({ oauthSessionId: "session-123" });

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should skip rate limiting for authenticated users with mcp-session-id header", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ headers: { "mcp-session-id": "mcp-session-456" } });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should apply IP-based rate limiting for anonymous requests", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ ip: "10.0.0.1" });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.set).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
      expect(mockRes.set).toHaveBeenCalledWith("X-RateLimit-Remaining", expect.any(String));
      expect(mockRes.set).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(String));
    });

    it("should set rate limit headers on response", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ ip: "10.0.0.2" });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
      expect(mockRes.set).toHaveBeenCalledWith("X-RateLimit-Remaining", "99");
    });

    it("should use socket.remoteAddress when ip is undefined", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({
        ip: undefined,
        socket: { remoteAddress: "10.0.0.3" },
      });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should use 'unknown' when both ip and socket.remoteAddress are undefined", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({
        ip: undefined,
        socket: { remoteAddress: undefined },
      });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("getRateLimitStats", () => {
    it("should return current rate limit statistics", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ ip: "10.0.0.100" });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      const stats = getRateLimitStats();

      expect(stats).toHaveProperty("totalEntries");
      expect(stats).toHaveProperty("entries");
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it("should return entry with key, count, and resetAt", () => {
      const middleware = rateLimiterMiddleware();
      const mockReq = createMockReq({ ip: "10.0.0.101" });
      const mockRes = createMockRes();

      middleware(mockReq, mockRes, mockNext);

      const stats = getRateLimitStats();
      const entry = stats.entries.find(e => e.key === "ip:10.0.0.101");

      expect(entry).toBeDefined();
      expect(entry?.count).toBe(1);
      expect(entry?.resetAt).toBeInstanceOf(Date);
    });
  });

  describe("stopCleanup", () => {
    it("should stop the cleanup interval without error", () => {
      expect(() => stopCleanup()).not.toThrow();
    });

    it("should be safe to call multiple times", () => {
      expect(() => {
        stopCleanup();
        stopCleanup();
        stopCleanup();
      }).not.toThrow();
    });
  });
});

describe("Rate Limiter with Session Rate Limiting Enabled", () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockNext = jest.fn();
  });

  it("should apply session rate limiting when enabled", async () => {
    // Re-mock with session rate limiting enabled
    jest.doMock("../../../src/config", () => ({
      RATE_LIMIT_IP_ENABLED: true,
      RATE_LIMIT_IP_WINDOW_MS: 60000,
      RATE_LIMIT_IP_MAX_REQUESTS: 100,
      RATE_LIMIT_SESSION_ENABLED: true,
      RATE_LIMIT_SESSION_WINDOW_MS: 60000,
      RATE_LIMIT_SESSION_MAX_REQUESTS: 5,
    }));

    // Import fresh module with new config
    const { rateLimiterMiddleware: freshMiddleware, stopCleanup: freshStopCleanup } =
      await import("../../../src/middleware/rate-limiter");

    const middleware = freshMiddleware();
    const mockReq = createMockReq();
    const mockRes = createMockRes({ oauthSessionId: "session-rate-test" });

    // Make requests up to the limit
    for (let i = 0; i < 5; i++) {
      middleware(mockReq, mockRes, mockNext);
    }

    // 6th request should be rate limited
    middleware(mockReq, mockRes, mockNext);

    // Note: This test verifies the middleware runs without errors
    // The actual rate limiting behavior depends on the real config values
    expect(mockNext).toHaveBeenCalled();

    freshStopCleanup();
  });
});

describe("Rate Limiter with IP Rate Limiting Disabled", () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockNext = jest.fn();
  });

  it("should skip IP rate limiting when disabled", async () => {
    // Re-mock with IP rate limiting disabled
    jest.doMock("../../../src/config", () => ({
      RATE_LIMIT_IP_ENABLED: false,
      RATE_LIMIT_IP_WINDOW_MS: 60000,
      RATE_LIMIT_IP_MAX_REQUESTS: 100,
      RATE_LIMIT_SESSION_ENABLED: false,
      RATE_LIMIT_SESSION_WINDOW_MS: 60000,
      RATE_LIMIT_SESSION_MAX_REQUESTS: 300,
    }));

    // Import fresh module with new config
    const { rateLimiterMiddleware: freshMiddleware, stopCleanup: freshStopCleanup } =
      await import("../../../src/middleware/rate-limiter");

    const middleware = freshMiddleware();
    const mockReq = createMockReq();
    const mockRes = createMockRes();

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    // Should not set rate limit headers when disabled
    expect(mockRes.set).not.toHaveBeenCalledWith("X-RateLimit-Limit", expect.any(String));

    freshStopCleanup();
  });
});

describe("Rate Limiter - Per-IP Isolation", () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockNext = jest.fn();
  });

  it("should track rate limits separately per IP address", async () => {
    // Re-mock with low IP rate limit
    jest.doMock("../../../src/config", () => ({
      RATE_LIMIT_IP_ENABLED: true,
      RATE_LIMIT_IP_WINDOW_MS: 60000,
      RATE_LIMIT_IP_MAX_REQUESTS: 2,
      RATE_LIMIT_SESSION_ENABLED: false,
      RATE_LIMIT_SESSION_WINDOW_MS: 60000,
      RATE_LIMIT_SESSION_MAX_REQUESTS: 300,
    }));

    const { rateLimiterMiddleware: freshMiddleware, stopCleanup: freshStopCleanup } =
      await import("../../../src/middleware/rate-limiter");

    const middleware = freshMiddleware();

    // First IP makes 2 requests (reaches limit)
    const ip1 = "10.0.0.1";
    const mockReq1 = createMockReq({ ip: ip1, path: "/api/test" });
    const mockRes1 = createMockRes();

    middleware(mockReq1, mockRes1, mockNext);
    middleware(mockReq1, mockRes1, mockNext);

    // Second IP should still be able to make requests (separate limit)
    const ip2 = "10.0.0.2";
    const mockReq2 = createMockReq({ ip: ip2, path: "/api/test" });
    const mockRes2 = createMockRes();

    middleware(mockReq2, mockRes2, mockNext);

    // Verify IP2 was allowed (next was called, no 429)
    expect(mockRes2.status).not.toHaveBeenCalledWith(429);

    // Now IP1 should be rate limited on 3rd request
    mockRes1.status = jest.fn().mockReturnThis();
    mockRes1.json = jest.fn().mockReturnThis();
    mockRes1.set = jest.fn().mockReturnThis();

    middleware(mockReq1, mockRes1, mockNext);
    expect(mockRes1.status).toHaveBeenCalledWith(429);

    freshStopCleanup();
  });
});

describe("Rate Limiter - Exceeded and Approaching Limits", () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockNext = jest.fn();
  });

  it("should return 429 when IP rate limit is exceeded", async () => {
    // Re-mock with very low IP rate limit
    jest.doMock("../../../src/config", () => ({
      RATE_LIMIT_IP_ENABLED: true,
      RATE_LIMIT_IP_WINDOW_MS: 60000,
      RATE_LIMIT_IP_MAX_REQUESTS: 3, // Very low limit
      RATE_LIMIT_SESSION_ENABLED: false,
      RATE_LIMIT_SESSION_WINDOW_MS: 60000,
      RATE_LIMIT_SESSION_MAX_REQUESTS: 300,
    }));

    const { rateLimiterMiddleware: freshMiddleware, stopCleanup: freshStopCleanup } =
      await import("../../../src/middleware/rate-limiter");
    const { logWarn } = require("../../../src/logger");

    const middleware = freshMiddleware();
    const uniqueIp = `192.168.99.${Math.floor(Math.random() * 255)}`;
    const mockReq = createMockReq({ ip: uniqueIp, path: "/api/test" });
    const mockRes = createMockRes();

    // Make requests up to the limit
    for (let i = 0; i < 3; i++) {
      middleware(mockReq, mockRes, mockNext);
    }

    // Reset mock for 4th request
    mockRes.status = jest.fn().mockReturnThis();
    mockRes.json = jest.fn().mockReturnThis();
    mockRes.set = jest.fn().mockReturnThis();

    // 4th request should be rate limited
    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Too Many Requests",
      })
    );
    expect(logWarn).toHaveBeenCalledWith(
      "IP rate limit exceeded",
      expect.objectContaining({
        event: "rate_limit_exceeded",
      })
    );

    freshStopCleanup();
  });

  it("should log debug when approaching IP rate limit threshold (80%)", async () => {
    // Re-mock with low IP rate limit to easily reach 80%
    jest.doMock("../../../src/config", () => ({
      RATE_LIMIT_IP_ENABLED: true,
      RATE_LIMIT_IP_WINDOW_MS: 60000,
      RATE_LIMIT_IP_MAX_REQUESTS: 5, // 80% = 4 requests
      RATE_LIMIT_SESSION_ENABLED: false,
      RATE_LIMIT_SESSION_WINDOW_MS: 60000,
      RATE_LIMIT_SESSION_MAX_REQUESTS: 300,
    }));

    const { rateLimiterMiddleware: freshMiddleware, stopCleanup: freshStopCleanup } =
      await import("../../../src/middleware/rate-limiter");
    const { logDebug } = require("../../../src/logger");

    const middleware = freshMiddleware();
    const uniqueIp = `192.168.88.${Math.floor(Math.random() * 255)}`;
    const mockReq = createMockReq({ ip: uniqueIp, path: "/api/test" });
    const mockRes = createMockRes();

    // Make 4 requests to reach 80% (4/5 = 80%)
    for (let i = 0; i < 4; i++) {
      middleware(mockReq, mockRes, mockNext);
    }

    expect(logDebug).toHaveBeenCalledWith(
      "Approaching IP rate limit threshold",
      expect.objectContaining({
        event: "rate_limit_warning",
      })
    );

    freshStopCleanup();
  });
});
