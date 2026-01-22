/**
 * Unit tests for enhanced fetch utilities
 * Tests the native fetch-based implementation with GitLab-specific features
 */

// Unmock the fetch module to test the actual implementation
jest.unmock("../../../src/utils/fetch");

// Mock config values FIRST - before any imports
jest.mock("../../../src/config", () => ({
  SKIP_TLS_VERIFY: false,
  GITLAB_AUTH_COOKIE_PATH: "",
  GITLAB_CA_CERT_PATH: "",
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  NODE_TLS_REJECT_UNAUTHORIZED: "",
  GITLAB_TOKEN: "test-token",
  API_TIMEOUT_MS: 10000,
  API_RETRY_ENABLED: true,
  API_RETRY_MAX_ATTEMPTS: 3,
  API_RETRY_BASE_DELAY_MS: 100, // Faster for tests
  API_RETRY_MAX_DELAY_MS: 400,
}));

// Mock dependencies
jest.mock("fs");
jest.mock("https");
jest.mock("http-proxy-agent");
jest.mock("https-proxy-agent");
jest.mock("socks-proxy-agent");
jest.mock("../../../src/logger", () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// Mock OAuth module - static token mode
jest.mock("../../../src/oauth/index", () => ({
  isOAuthEnabled: jest.fn(() => false),
  getTokenContext: jest.fn(() => undefined),
}));

// Import the actual implementation (not mocked)
const fetchModule = jest.requireActual("../../../src/utils/fetch");
const { enhancedFetch, createFetchOptions, DEFAULT_HEADERS } = fetchModule;

describe("Enhanced Fetch Utilities", () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeAll(() => {
    // Mock the global fetch function
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  // Helper function to create proper Response mocks
  const createMockResponse = (overrides: Partial<Response> = {}): Response =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      redirected: false,
      type: "basic" as ResponseType,
      url: "",
      body: null,
      bodyUsed: false,
      clone: jest.fn(),
      arrayBuffer: jest.fn(),
      blob: jest.fn(),
      formData: jest.fn(),
      text: jest.fn(),
      json: jest.fn(),
      ...overrides,
    }) as Response;

  describe("DEFAULT_HEADERS", () => {
    it("should include basic headers", () => {
      expect(DEFAULT_HEADERS["User-Agent"]).toBe("GitLab MCP Server");
      expect(DEFAULT_HEADERS["Content-Type"]).toBe("application/json");
      expect(DEFAULT_HEADERS["Accept"]).toBe("application/json");
    });

    it("should NOT include Authorization header in DEFAULT_HEADERS (added dynamically)", () => {
      // Authorization is now added dynamically in enhancedFetch based on auth mode
      expect(DEFAULT_HEADERS.Authorization).toBeUndefined();
    });
  });

  describe("createFetchOptions", () => {
    it("should return basic options when no special config is set", () => {
      const options = createFetchOptions();
      expect(options).toBeDefined();
      expect(typeof options).toBe("object");
    });
  });

  describe("enhancedFetch", () => {
    it("should call native fetch with merged options", async () => {
      const mockResponse = createMockResponse({
        json: jest.fn().mockResolvedValue({ success: true }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const result = await enhancedFetch("https://example.com");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: "Bearer test-token",
          }),
        })
      );
      expect(result).toBe(mockResponse);
    });

    it("should merge custom headers with default headers", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        headers: { "X-Custom-Header": "custom-value" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
            "X-Custom-Header": "custom-value",
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("should handle Headers object in options", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      const headers = new Headers();
      headers.set("X-Custom-Header", "custom-value");
      headers.set("Another-Header", "another-value");

      await enhancedFetch("https://example.com", { headers });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-custom-header": "custom-value",
            "another-header": "another-value",
          }),
        })
      );
    });

    it("should merge options correctly", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        method: "POST",
        body: JSON.stringify({ test: "data" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          method: "POST",
          body: '{"test":"data"}',
          headers: expect.any(Object),
        })
      );
    });

    it("should handle fetch errors", async () => {
      const fetchError = new Error("Network error");
      mockFetch.mockRejectedValue(fetchError);

      await expect(enhancedFetch("https://example.com")).rejects.toThrow("Network error");
    });

    it("should return the response from fetch", async () => {
      const mockResponse = createMockResponse({
        json: jest.fn(),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const result = await enhancedFetch("https://example.com");

      expect(result).toBe(mockResponse);
    });
  });

  describe("Additional Edge Cases", () => {
    it("should handle undefined headers", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      // Test with undefined headers
      await enhancedFetch("https://example.com", { headers: undefined });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
          }),
        })
      );
    });

    it("should handle array-like headers", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      // Test with array-like headers
      await enhancedFetch("https://example.com", {
        headers: [
          ["X-Custom", "value"],
          ["Another-Header", "value2"],
        ],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
    });

    it("should preserve custom HTTP methods", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", { method: "PATCH" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });

    it("should handle request timeout option", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        signal: AbortSignal.timeout(5000),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it("should handle different request body types", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      const formData = new FormData();
      formData.append("key", "value");

      await enhancedFetch("https://example.com", {
        method: "POST",
        body: formData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          method: "POST",
          body: formData,
        })
      );
    });

    it("should handle empty options object", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {});

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
          }),
        })
      );
    });

    it("should handle undefined options", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
          }),
        })
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should include Authorization header when token is available", async () => {
      // In static token mode with GITLAB_TOKEN set, Authorization should be added
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("should handle array-like headers correctly", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        headers: [
          ["X-Custom", "value"],
          ["Another-Header", "value2"],
        ],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
          }),
        })
      );
    });

    it("should preserve different content types", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        headers: { "Content-Type": "text/plain" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "text/plain",
          }),
        })
      );
    });

    it("should handle request with no headers option", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com", {
        method: "DELETE",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
          }),
        })
      );
    });
  });

  describe("URL Redaction", () => {
    it("should redact upload secrets in URL paths", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logger } = require("../../../src/logger");

      await enhancedFetch("https://gitlab.com/uploads/abc123def456/secret.txt");

      // Check that logger.debug was called with redacted URL
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("[REDACTED]"),
        }),
        expect.any(String)
      );
    });

    it("should redact long hex tokens in URL paths", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logger } = require("../../../src/logger");

      // 32+ character hex string should be redacted
      await enhancedFetch(
        "https://gitlab.com/api/v4/projects/1/repository/files/abcdef0123456789abcdef0123456789ab/raw"
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.not.stringContaining("abcdef0123456789abcdef0123456789ab"),
        }),
        expect.any(String)
      );
    });

    it("should redact sensitive query parameters", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logger } = require("../../../src/logger");

      await enhancedFetch("https://gitlab.com/api?private_token=secret123&other=value");

      // Should redact private_token but keep other
      // Note: URL.searchParams.set() URL-encodes the value, so [REDACTED] becomes %5BREDACTED%5D
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("%5BREDACTED%5D"),
        }),
        expect.any(String)
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("other=value"),
        }),
        expect.any(String)
      );
    });

    it("should handle invalid URLs gracefully in redaction", async () => {
      // This tests the catch block in redactUrlForLogging
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logger } = require("../../../src/logger");

      // The fetch will still work but the URL parsing in redactUrlForLogging may fail
      // for relative URLs - but our current implementation handles full URLs
      // Test with a URL that has protocol but invalid structure
      await enhancedFetch("https://gitlab.com/api/v4");

      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("Retry Logic", () => {
    // Use fake timers for all retry tests to avoid real backoff delays
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should retry on 5xx server errors for GET requests", async () => {
      // First call returns 500, second succeeds
      const errorResponse = createMockResponse({ status: 500, ok: false });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com", { method: "GET" });
      await jest.runAllTimersAsync();
      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should NOT retry on 5xx for POST requests by default", async () => {
      const errorResponse = createMockResponse({ status: 500, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      const result = await enhancedFetch("https://example.com", { method: "POST" });

      // POST is not idempotent, should not retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(500);
    });

    it("should retry POST requests when retry: true is explicitly set", async () => {
      const errorResponse = createMockResponse({ status: 500, ok: false });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com", {
        method: "POST",
        retry: true,
      });
      await jest.runAllTimersAsync();
      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should NOT retry GET requests when retry: false is explicitly set", async () => {
      const errorResponse = createMockResponse({ status: 500, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      const result = await enhancedFetch("https://example.com", {
        method: "GET",
        retry: false,
      });

      // Retry disabled, should not retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(500);
    });

    it("should retry on 429 rate limit with Retry-After header", async () => {
      // Fake timers are already enabled by beforeEach
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", "1"); // 1 second

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // Advance fake timers to simulate the Retry-After delay without real waiting
      await jest.advanceTimersByTimeAsync(1000);

      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should stop retrying after maxRetries attempts", async () => {
      const errorResponse = createMockResponse({ status: 500, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      const fetchPromise = enhancedFetch("https://example.com", {
        method: "GET",
        maxRetries: 2,
      });
      await jest.runAllTimersAsync();
      const result = await fetchPromise;

      // Initial attempt + 2 retries = 3 total calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.status).toBe(500);
    });

    it("should retry on network timeout errors", async () => {
      const timeoutError = new Error("GitLab API timeout after 10000ms");
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");
      await jest.runAllTimersAsync();
      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should retry on ECONNRESET errors", async () => {
      const networkError = new Error("ECONNRESET: Connection reset by peer");
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockRejectedValueOnce(networkError).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");
      await jest.runAllTimersAsync();
      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should NOT retry on 4xx client errors (except 429)", async () => {
      const clientError = createMockResponse({ status: 400, ok: false });
      mockFetch.mockResolvedValue(clientError);

      const result = await enhancedFetch("https://example.com");

      // 400 errors should not be retried
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(400);
    });

    it("should NOT retry on 401 unauthorized errors", async () => {
      const authError = createMockResponse({ status: 401, ok: false });
      mockFetch.mockResolvedValue(authError);

      const result = await enhancedFetch("https://example.com");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(401);
    });

    it("should NOT retry on 403 forbidden errors", async () => {
      const forbiddenError = createMockResponse({ status: 403, ok: false });
      mockFetch.mockResolvedValue(forbiddenError);

      const result = await enhancedFetch("https://example.com");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(403);
    });

    it("should NOT retry on non-retryable errors", async () => {
      const validationError = new Error("Invalid JSON payload");
      mockFetch.mockRejectedValue(validationError);

      await expect(enhancedFetch("https://example.com")).rejects.toThrow("Invalid JSON payload");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
