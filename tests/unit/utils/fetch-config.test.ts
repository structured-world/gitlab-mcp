/**
 * Unit tests for fetch configuration edge cases
 * Tests TLS, proxy, CA certificates, and OAuth scenarios
 *
 * These tests use jest.isolateModules to properly mock config values
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

  describe("SOCKS Proxy Detection", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      // Re-register logger mock with persistent instance
      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("SOCKS proxy"));
      expect(mockLogger.warn).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("socks4://"));
    });
  });

  describe("HTTP/HTTPS Proxy", () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      mockFetch.mockResolvedValue(createMockResponse());

      jest.doMock("../../../src/logger", () => ({
        logger: mockLogger,
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.info).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("SKIP_TLS_VERIFY"));
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.warn).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Failed to load CA certificate")
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.info).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.warn).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.warn).toHaveBeenCalledWith(
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
        API_TIMEOUT_MS: 10000,
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

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 123 }),
        expect.stringContaining("using token from context")
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
      }));

      jest.doMock("../../../src/config", () => ({
        SKIP_TLS_VERIFY: false,
        GITLAB_AUTH_COOKIE_PATH: "",
        GITLAB_CA_CERT_PATH: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "",
        GITLAB_TOKEN: "test-token",
        API_TIMEOUT_MS: 10000,
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
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ url: "[INVALID_URL]" }),
        expect.any(String)
      );
    });

    it("should extract hostname from partially valid URL on parse error", async () => {
      const { enhancedFetch, resetDispatcherCache } = require("../../../src/utils/fetch");
      resetDispatcherCache();

      // URL that looks like it has a hostname but will fail new URL() parsing
      // Using URL with special characters that break parsing
      await enhancedFetch("https://example.com:invalid-port/path");

      // Should extract hostname and show parse error
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringMatching(/example\.com.*URL_PARSE_ERROR|INVALID_URL/),
        }),
        expect.any(String)
      );
    });
  });
});
