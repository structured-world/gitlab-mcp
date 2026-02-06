/**
 * Unit tests for fetch configuration edge cases
 * Tests TLS, proxy, CA certificates, and OAuth scenarios
 *
 * These tests use jest.resetModules to properly mock config values
 * since the fetch module caches config imports at load time.
 */

// Mock undici to avoid actual network calls
jest.mock("undici", () => ({
  Agent: jest.fn().mockImplementation(() => ({})),
  ProxyAgent: jest.fn().mockImplementation(() => ({})),
}));

describe("Fetch Configuration Edge Cases", () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeAll(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

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

  // Create a shared mock logger that persists across module reloads
  const mockLogger = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  };

  // Mock helper functions
  const mockLogInfo = jest.fn();
  const mockLogWarn = jest.fn();
  const mockLogError = jest.fn();
  const mockLogDebug = jest.fn();

  describe("SOCKS Proxy Detection", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      // Re-register logger mock with persistent instance
      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should warn about SOCKS5 proxy not being supported", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "socks5://proxy.example.com:1080",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining("SOCKS proxy"));
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("SOCKS proxy not supported")
      );
    });

    it("should detect socks4:// proxy URLs", async () => {
      // Use undefined instead of "" for HTTPS_PROXY because ?? (nullish coalescing)
      // only checks for null/undefined, not falsy values like empty string
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "socks4://proxy.example.com:1080",
        HTTPS_PROXY: undefined,
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining("socks4://"));
    });
  });

  describe("HTTP/HTTPS Proxy", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should log when using HTTP proxy", async () => {
      // Use undefined for HTTPS_PROXY so HTTP_PROXY is used (nullish coalescing)
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "http://proxy.example.com:8080",
        HTTPS_PROXY: undefined,
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining("http://proxy.example.com:8080")
      );
    });

    it("should create ProxyAgent for HTTPS proxy", async () => {
      const undici = require("undici");

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "https://secure-proxy.example.com:8443",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(undici.ProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ uri: "https://secure-proxy.example.com:8443" })
      );
    });
  });

  describe("TLS Verification Skip", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should warn when SKIP_TLS_VERIFY is true", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: true,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("SKIP_TLS_VERIFY"));
    });

    it("should warn when NODE_TLS_REJECT_UNAUTHORIZED is 0", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("NODE_TLS_REJECT_UNAUTHORIZED")
      );
    });
  });

  describe("CA Certificate Loading", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should log error when CA certificate file cannot be read", async () => {
      // Register the fs mock with throwing behavior AFTER resetModules
      // so it's used by the freshly loaded fetch module
      jest.doMock("fs", () => ({
        readFileSync: jest.fn((path: string) => {
          if (path.includes("ca-cert")) {
            throw new Error("ENOENT: no such file or directory");
          }
          return Buffer.from("");
        }),
      }));

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "/path/to/ca-cert.pem",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load CA certificate"),
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it("should log success when CA certificate is loaded", async () => {
      // Register fs mock that returns cert content
      jest.doMock("fs", () => ({
        readFileSync: jest.fn(() => Buffer.from("-----BEGIN CERTIFICATE-----")),
      }));

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "/path/to/ca-cert.pem",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining("Custom CA certificate loaded")
      );
    });
  });

  describe("OAuth Mode Token Handling", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should warn when OAuth is enabled but no token context", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => true),
        getTokenContext: jest.fn(() => null),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("no token context available")
      );
    });

    it("should warn when OAuth context exists but no gitlabToken", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => true),
        getTokenContext: jest.fn(() => ({ gitlabUserId: 123, gitlabToken: null })),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("token context exists but no gitlabToken")
      );
    });

    it("should debug log when OAuth token is available", async () => {
      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => true),
        getTokenContext: jest.fn(() => ({
          gitlabUserId: 123,
          gitlabToken: "oauth-token-abc",
        })),
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com");

      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining("using token from context"),
        expect.objectContaining({ userId: 123 })
      );
    });
  });

  describe("URL Redaction Edge Cases", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));

      jest.doMock("../../../src/config", () => ({
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
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));
    });

    it("should handle invalid URL gracefully in logging", async () => {
      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      // Test with a URL that will fail to parse - not a valid URL
      // Note: The fetch will be called with whatever URL string is passed
      // but the redaction function should handle the parse failure
      await enhancedFetch("not-a-valid-url-at-all");

      // The debug log should contain the fallback for invalid URLs
      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ url: "[INVALID_URL]" })
      );
    });

    it("should redact hostname on URL parse error for security", async () => {
      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      // URL that looks like it has a hostname but will fail new URL() parsing
      // Using URL with special characters that break parsing
      await enhancedFetch("https://example.com:invalid-port/path");

      // Should redact hostname (could contain userinfo) and show parse error
      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringMatching(/REDACTED_HOST.*URL_PARSE_ERROR|INVALID_URL/),
        })
      );
    });
  });

  describe("Caller Abort Handling", () => {
    // Tests that AbortError from caller signal is re-thrown as-is (not mapped to timeout).

    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));

      jest.doMock("../../../src/config", () => ({
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
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));
    });

    it("should re-throw AbortError as-is when caller aborts request", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "The operation was aborted"
      );

      expect(mockLogDebug).toHaveBeenCalledWith(
        "GitLab API request aborted by caller",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should not convert AbortError to timeout error", async () => {
      // AbortError with custom reason — must not be treated as Undici timeout
      const error = new Error("User cancelled");
      error.name = "AbortError";
      mockFetch.mockRejectedValue(error);

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "User cancelled"
      );

      // Should log as caller abort, not as timeout
      expect(mockLogWarn).not.toHaveBeenCalledWith(
        expect.stringContaining("timeout"),
        expect.anything()
      );
    });
  });

  describe("Undici Timeout Error Mapping", () => {
    // Tests that Undici-native timeout errors are mapped to structured "GitLab API timeout" messages
    // with the correct phase and timeout value, so isRetryableError() can match them.

    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));

      jest.doMock("../../../src/config", () => ({
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
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));
    });

    it("should map HeadersTimeoutError to structured timeout message", async () => {
      // Simulate Undici HeadersTimeoutError by constructor name
      class HeadersTimeoutError extends Error {
        constructor() {
          super("Headers Timeout Error");
          this.name = "HeadersTimeoutError";
        }
      }
      mockFetch.mockRejectedValue(new HeadersTimeoutError());

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 10000ms (headers phase)"
      );

      expect(mockLogWarn).toHaveBeenCalledWith(
        "GitLab API headers timeout",
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it("should map BodyTimeoutError to structured timeout message", async () => {
      class BodyTimeoutError extends Error {
        constructor() {
          super("Body Timeout Error");
          this.name = "BodyTimeoutError";
        }
      }
      mockFetch.mockRejectedValue(new BodyTimeoutError());

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 30000ms (body phase)"
      );

      expect(mockLogWarn).toHaveBeenCalledWith(
        "GitLab API body timeout",
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it("should map ConnectTimeoutError to structured timeout message", async () => {
      class ConnectTimeoutError extends Error {
        constructor() {
          super("Connect Timeout Error");
          this.name = "ConnectTimeoutError";
        }
      }
      mockFetch.mockRejectedValue(new ConnectTimeoutError());

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 2000ms (connect phase)"
      );

      expect(mockLogWarn).toHaveBeenCalledWith(
        "GitLab API connect timeout",
        expect.objectContaining({ timeout: 2000 })
      );
    });

    it("should detect timeout errors by message when constructor name is unavailable", async () => {
      // Simulate error where constructor name is generic but message contains "headers timeout"
      const error = new Error("headers timeout");
      mockFetch.mockRejectedValue(error);

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 10000ms (headers phase)"
      );
    });

    it("should detect body timeout by message fallback", async () => {
      const error = new Error("body timeout");
      mockFetch.mockRejectedValue(error);

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 30000ms (body phase)"
      );
    });

    it("should detect connect timeout by message fallback", async () => {
      const error = new Error("connect timeout");
      mockFetch.mockRejectedValue(error);

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "GitLab API timeout after 2000ms (connect phase)"
      );
    });
  });

  describe("Pool Pressure Logging", () => {
    // Verifies that logWarn is called when Undici pool has queued requests (stats.queued > 0)

    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        GITLAB_BASE_URL: "https://example.com",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
        getGitLabApiUrlFromContext: jest.fn(() => undefined),
      }));
    });

    it("should log warning when pool has queued requests", async () => {
      // Mock InstanceRegistry to return a dispatcher with queued stats
      const mockDispatcher = {
        stats: { queued: 5, running: 25, size: 25 },
      };

      jest.doMock("../../../src/services/InstanceRegistry", () => ({
        InstanceRegistry: {
          getInstance: () => ({
            isInitialized: () => true,
            getDispatcher: () => mockDispatcher,
            acquireSlot: jest.fn(async () => () => {}),
          }),
        },
      }));

      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      await enhancedFetch("https://example.com/api/v4/projects");

      expect(mockLogWarn).toHaveBeenCalledWith(
        "Connection pool pressure: requests queuing",
        expect.objectContaining({
          queued: 5,
          running: 25,
          size: 25,
        })
      );
    });
  });

  describe("ProxyAgent Timeout Configuration", () => {
    // Verifies that ProxyAgent receives the same timeout options as direct Agent

    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logError: mockLogError,
        logDebug: mockLogDebug,
      }));
    });

    it("should pass timeout options to ProxyAgent", async () => {
      // Track ProxyAgent constructor calls via a custom spy mock
      const proxyAgentSpy = jest.fn().mockImplementation(() => ({}));

      jest.doMock("undici", () => ({
        Agent: jest.fn().mockImplementation(() => ({})),
        ProxyAgent: proxyAgentSpy,
      }));

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "https://proxy.example.com:8443",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        CONNECT_TIMEOUT_MS: 2000,
        HEADERS_TIMEOUT_MS: 10000,
        BODY_TIMEOUT_MS: 30000,
        API_RETRY_ENABLED: false,
        API_RETRY_MAX_ATTEMPTS: 0,
        API_RETRY_BASE_DELAY_MS: 100,
        API_RETRY_MAX_DELAY_MS: 400,
      }));

      jest.doMock("../../../src/oauth/index", () => ({
        isOAuthEnabled: jest.fn(() => false),
        getTokenContext: jest.fn(() => undefined),
      }));

      // Calling createFetchOptions triggers createDispatcher via getDispatcher
      // which creates the ProxyAgent with our config
      const { createFetchOptions, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      createFetchOptions();

      expect(proxyAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: "https://proxy.example.com:8443",
          headersTimeout: 10000,
          bodyTimeout: 30000,
          connect: { timeout: 2000 },
        })
      );
    });
  });
});
