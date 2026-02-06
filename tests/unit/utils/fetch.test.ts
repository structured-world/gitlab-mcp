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
  CONNECT_TIMEOUT_MS: 2000,
  HEADERS_TIMEOUT_MS: 10000,
  BODY_TIMEOUT_MS: 30000,
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
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

// Mock OAuth module - static token mode
jest.mock("../../../src/oauth/index", () => ({
  isOAuthEnabled: jest.fn(() => false),
  getTokenContext: jest.fn(() => undefined),
}));

// Import the actual implementation (not mocked)
const fetchModule = jest.requireActual("../../../src/utils/fetch");
const { enhancedFetch, createFetchOptions, DEFAULT_HEADERS, getAuthHeaders, extractBaseUrl } =
  fetchModule;

// Import mocked OAuth module to control behavior per test
const { isOAuthEnabled, getTokenContext } = require("../../../src/oauth/index");

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
            "PRIVATE-TOKEN": "test-token",
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
            "PRIVATE-TOKEN": "test-token",
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

    it("should respect caller-provided AbortSignal", async () => {
      // Test that caller signal is merged with internal timeout signal
      const controller = new AbortController();
      mockFetch.mockImplementation(async (_, options) => {
        // Check that the signal passed to fetch is aborted when caller aborts
        const signal = (options as RequestInit).signal;
        if (signal) {
          await new Promise(resolve => setTimeout(resolve, 10));
          // Simulate that caller aborted before request completed
          if (signal.aborted) {
            throw new DOMException("The operation was aborted", "AbortError");
          }
        }
        return createMockResponse();
      });

      // Abort before fetch completes
      setTimeout(() => controller.abort(), 5);

      await expect(
        enhancedFetch("https://example.com", {
          signal: controller.signal,
          retry: false, // Disable retry for this test
        })
      ).rejects.toThrow();
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
    it("should include PRIVATE-TOKEN header when PAT token is available", async () => {
      // In static token mode with GITLAB_TOKEN set, PRIVATE-TOKEN header should be used
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch("https://example.com");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "test-token",
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
      const { logDebug } = require("../../../src/logger");

      await enhancedFetch("https://gitlab.com/uploads/abc123def456/secret.txt");

      // Check that logDebug was called with redacted URL
      expect(logDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringContaining("[REDACTED]"),
        })
      );
    });

    it("should redact long hex tokens in URL paths", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logDebug } = require("../../../src/logger");

      // 32+ character hex string should be redacted
      await enhancedFetch(
        "https://gitlab.com/api/v4/projects/1/repository/files/abcdef0123456789abcdef0123456789ab/raw"
      );

      expect(logDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.not.stringContaining("abcdef0123456789abcdef0123456789ab"),
        })
      );
    });

    it("should redact sensitive query parameters", async () => {
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logDebug } = require("../../../src/logger");

      await enhancedFetch("https://gitlab.com/api?private_token=secret123&other=value");

      // Should redact private_token but keep other
      // Note: URL.searchParams.set() URL-encodes the value, so [REDACTED] becomes %5BREDACTED%5D
      expect(logDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringContaining("%5BREDACTED%5D"),
        })
      );
      expect(logDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringContaining("other=value"),
        })
      );
    });

    it("should handle valid URLs in redaction logging", async () => {
      // Test that valid URLs are properly logged with debug
      const mockResponse = createMockResponse();
      mockFetch.mockResolvedValue(mockResponse);
      const { logDebug } = require("../../../src/logger");

      await enhancedFetch("https://gitlab.com/api/v4");

      expect(logDebug).toHaveBeenCalled();
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

    it("should cap Retry-After to max delay to prevent excessive waits", async () => {
      // Test that excessively large Retry-After values are capped
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", "3600"); // 1 hour - should be capped

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // Should be capped to API_RETRY_MAX_DELAY_MS (400ms in test mock)
      // Not wait 3600 seconds (1 hour)
      await jest.advanceTimersByTimeAsync(400);

      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should parse Retry-After in HTTP-date format", async () => {
      // Test HTTP-date format: "Wed, 21 Oct 2015 07:28:00 GMT"
      // Set Retry-After to 2 seconds in the future
      const futureDate = new Date(Date.now() + 2000);
      const httpDate = futureDate.toUTCString();

      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", httpDate);

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // Advance timers - delay should be computed from HTTP-date
      await jest.advanceTimersByTimeAsync(2000);

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

    it("should NOT retry on caller-initiated AbortError", async () => {
      // Caller aborts are NOT retryable - they should propagate immediately
      // This test verifies that AbortError from fetch is not retried
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValue(abortError);

      // Run with fake timers to prevent internal timeout from interfering
      const fetchPromise = enhancedFetch("https://example.com", { retry: true, maxRetries: 3 });

      // The promise should reject without needing to advance timers
      // because AbortError is not retryable
      await expect(fetchPromise).rejects.toThrow("The operation was aborted");

      // Should NOT retry - only 1 call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should propagate caller abort without converting to timeout error", async () => {
      // This tests that AbortError from fetch is preserved and NOT converted
      // to "GitLab API timeout" message
      const abortError = new DOMException("User cancelled", "AbortError");
      mockFetch.mockRejectedValue(abortError);

      // Verify it's the original AbortError, not converted to timeout
      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toMatchObject({
        name: "AbortError",
        message: "User cancelled",
      });
    });

    it("should preserve caller abort error instead of converting to timeout", async () => {
      // When caller aborts, the error should NOT be converted to "GitLab API timeout"
      // The AbortError should propagate directly
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValue(abortError);

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "The operation was aborted"
      );

      // Verify it's an AbortError, not a timeout error
      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.not.toThrow(
        "GitLab API timeout"
      );
    });

    it("should handle pre-aborted signal", async () => {
      // Test that already-aborted signal is handled correctly
      const controller = new AbortController();
      controller.abort("Already aborted");

      mockFetch.mockImplementation(async (_, options) => {
        const signal = (options as RequestInit).signal;
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        return createMockResponse();
      });

      await expect(
        enhancedFetch("https://example.com", {
          signal: controller.signal,
          retry: false,
        })
      ).rejects.toThrow();
    });

    it("should accept Retry-After: 0 for immediate retry", async () => {
      // Retry-After: 0 is valid per RFC 7231 and means "retry immediately"
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", "0");

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // With Retry-After: 0, should retry immediately (0ms delay)
      await jest.advanceTimersByTimeAsync(0);

      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should accept Retry-After with leading zeros (RFC 7231 delta-seconds)", async () => {
      // RFC 7231: delta-seconds = 1*DIGIT, so "01", "001" are valid
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", "01"); // Leading zero

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // "01" = 1 second = 1000ms
      await jest.advanceTimersByTimeAsync(1000);

      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should abort during backoff sleep when caller aborts", async () => {
      // Test that caller abort during backoff sleep is respected
      const controller = new AbortController();
      const errorResponse = createMockResponse({ status: 500, ok: false });

      mockFetch.mockResolvedValue(errorResponse);

      const fetchPromise = enhancedFetch("https://example.com", {
        signal: controller.signal,
        retry: true,
        maxRetries: 3,
      });

      // First request fails with 500, enters backoff sleep
      await jest.advanceTimersByTimeAsync(0);

      // Abort during backoff
      controller.abort("User cancelled");

      // The promise should reject with AbortError
      await expect(fetchPromise).rejects.toThrow();
    });

    it("should use default backoff when Retry-After header is invalid", async () => {
      // Test that invalid Retry-After values fall back to calculated backoff
      // This covers the parseRetryAfter return null path (line 360)
      const rateLimitHeaders = new Headers();
      rateLimitHeaders.set("Retry-After", "invalid-not-a-number-or-date");

      const rateLimitResponse = createMockResponse({
        status: 429,
        ok: false,
        headers: rateLimitHeaders,
      });
      const successResponse = createMockResponse({ status: 200, ok: true });

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const fetchPromise = enhancedFetch("https://example.com");

      // Should use default backoff delay since Retry-After is invalid
      await jest.runAllTimersAsync();

      const result = await fetchPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it("should handle pre-aborted signal in retry backoff", async () => {
      // Test that already-aborted signal is handled in backoff sleep
      // This covers the sleep pre-abort check (lines 218-219)
      const controller = new AbortController();
      controller.abort("Already aborted");

      const errorResponse = createMockResponse({ status: 500, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      // With pre-aborted signal, should reject immediately
      await expect(
        enhancedFetch("https://example.com", {
          signal: controller.signal,
          retry: true,
        })
      ).rejects.toThrow();
    });

    it("should log caller abort with debug level and re-throw", async () => {
      // Test the caller abort logging path (lines 473-479)
      // When fetch throws AbortError due to caller signal, it should:
      // 1. Log at debug level (not warn like timeout)
      // 2. Re-throw the original error
      const controller = new AbortController();

      mockFetch.mockImplementation(async () => {
        // Simulate caller aborting during fetch
        controller.abort("User cancelled request");
        throw new DOMException("The operation was aborted", "AbortError");
      });

      await expect(
        enhancedFetch("https://example.com", {
          signal: controller.signal,
          retry: false,
        })
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "The operation was aborted",
      });

      // Should NOT be converted to timeout error
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should distinguish caller abort from internal timeout in doFetch", async () => {
      // This test ensures the caller abort path is exercised
      // The key distinction: internal timeout sets controller.signal.reason = TIMEOUT_REASON
      // Caller abort does NOT trigger internal controller, so isInternalTimeout = false
      const callerController = new AbortController();

      // Mock fetch to check the signal and throw AbortError when aborted
      mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
        const signal = opts.signal as AbortSignal;
        // Abort the caller's controller to trigger AbortError
        callerController.abort("Caller requested abort");
        // Check that signal is aborted (merged signal from AbortSignal.any)
        if (signal.aborted) {
          throw new DOMException("Signal aborted", "AbortError");
        }
        return createMockResponse();
      });

      const promise = enhancedFetch("https://example.com", {
        signal: callerController.signal,
        retry: false,
      });

      // Should throw AbortError (not timeout error)
      await expect(promise).rejects.toThrow("Signal aborted");
    });

    it("should return false from isRetryableError for AbortError with retry enabled", async () => {
      // Test that AbortError is NOT retried even when retry is enabled
      // This ensures isRetryableError returns false for AbortError (line 300)
      const abortError = new DOMException("Aborted by test", "AbortError");

      mockFetch.mockRejectedValue(abortError);

      const promise = enhancedFetch("https://example.com", {
        retry: true,
        maxRetries: 3,
      });

      // Should reject immediately without retrying
      await expect(promise).rejects.toThrow("Aborted by test");

      // Only 1 call - no retries for AbortError
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAuthHeaders", () => {
    afterEach(() => {
      // Reset OAuth mock to default (static/PAT mode)
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (getTokenContext as jest.Mock).mockReturnValue(undefined);
    });

    it("should return PRIVATE-TOKEN header in static/PAT mode", () => {
      // Default mock: isOAuthEnabled returns false, GITLAB_TOKEN is "test-token"
      const headers = getAuthHeaders();
      expect(headers).toEqual({ "PRIVATE-TOKEN": "test-token" });
    });

    it("should return Authorization Bearer header in OAuth mode", () => {
      // Switch to OAuth mode with a token in context
      (isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (getTokenContext as jest.Mock).mockReturnValue({ gitlabToken: "oauth-token-abc" });

      const headers = getAuthHeaders();
      expect(headers).toEqual({ Authorization: "Bearer oauth-token-abc" });
    });

    it("should return empty object when no token is available", () => {
      // OAuth mode but no token context
      (isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (getTokenContext as jest.Mock).mockReturnValue(undefined);

      const headers = getAuthHeaders();
      expect(headers).toEqual({});
    });

    it("should return empty object when OAuth context has no gitlabToken", () => {
      // OAuth mode with context but no gitlabToken
      (isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (getTokenContext as jest.Mock).mockReturnValue({ gitlabUserId: "user-1" });

      const headers = getAuthHeaders();
      expect(headers).toEqual({});
    });
  });

  describe("extractBaseUrl", () => {
    /**
     * Tests extractBaseUrl function for rate limit slot acquisition
     * This function extracts the base URL while preserving subpaths
     * and stripping known API suffixes (/api/v4, /api/graphql)
     */
    it("should extract base URL from simple GitLab URL", () => {
      const result = extractBaseUrl("https://gitlab.com/api/v4/projects");
      expect(result).toBe("https://gitlab.com");
    });

    it("should preserve subpath when stripping /api/v4", () => {
      // GitLab deployed at subpath: https://example.com/gitlab/api/v4/projects
      const result = extractBaseUrl("https://example.com/gitlab/api/v4/projects");
      expect(result).toBe("https://example.com/gitlab");
    });

    it("should preserve subpath when stripping /api/graphql", () => {
      const result = extractBaseUrl("https://example.com/gitlab/api/graphql");
      expect(result).toBe("https://example.com/gitlab");
    });

    it("should handle URL with only /api/v4 in path", () => {
      // API suffix at root: https://gitlab.com/api/v4
      const result = extractBaseUrl("https://gitlab.com/api/v4");
      expect(result).toBe("https://gitlab.com");
    });

    it("should handle URL with only /api/graphql in path", () => {
      const result = extractBaseUrl("https://gitlab.com/api/graphql");
      expect(result).toBe("https://gitlab.com");
    });

    it("should handle URL without API suffix", () => {
      // URL without /api/v4 or /api/graphql
      const result = extractBaseUrl("https://example.com/custom-path/something");
      expect(result).toBe("https://example.com/custom-path/something");
    });

    it("should normalize path with trailing slash", () => {
      const result = extractBaseUrl("https://gitlab.com/api/v4/");
      expect(result).toBe("https://gitlab.com");
    });

    it("should handle root path URL", () => {
      const result = extractBaseUrl("https://gitlab.com/");
      expect(result).toBe("https://gitlab.com");
    });

    it("should handle URL without path", () => {
      const result = extractBaseUrl("https://gitlab.com");
      expect(result).toBe("https://gitlab.com");
    });

    it("should preserve port in base URL", () => {
      const result = extractBaseUrl("https://gitlab.example.com:8443/api/v4/projects");
      expect(result).toBe("https://gitlab.example.com:8443");
    });

    it("should handle deep subpath with API suffix", () => {
      // Deep subpath: /company/gitlab/api/v4/projects
      const result = extractBaseUrl("https://internal.example.com/company/gitlab/api/v4/projects");
      expect(result).toBe("https://internal.example.com/company/gitlab");
    });

    it("should return undefined for invalid URL", () => {
      const result = extractBaseUrl("not-a-valid-url");
      expect(result).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      const result = extractBaseUrl("");
      expect(result).toBeUndefined();
    });

    it("should handle API suffix in middle of longer path", () => {
      // URL like /api/v4/projects/123/issues - should extract up to before /api/v4
      const result = extractBaseUrl("https://gitlab.com/api/v4/projects/123/issues");
      expect(result).toBe("https://gitlab.com");
    });
  });
});
