// Mock fs module - must be before imports that use fs
jest.mock("fs", () => {
  const actualFs = jest.requireActual("fs");
  return {
    ...actualFs,
    readFileSync: jest.fn().mockImplementation((path: string, encoding?: string) => {
      // Allow actual reads for internal node_modules (pino, sonic-boom, etc.)
      if (
        typeof path === "string" &&
        (path.includes("node_modules") || path.includes("pino") || path.includes("sonic-boom"))
      ) {
        return actualFs.readFileSync(path, encoding);
      }
      // Return empty string for mocked paths (test paths)
      return "";
    }),
  };
});

import {
  createFetchOptions,
  enhancedFetch,
  DEFAULT_HEADERS,
  resetDispatcherCache,
} from "../../../src/utils/fetch";
import { InstanceRegistry } from "../../../src/services/InstanceRegistry";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();

  // Setup default mocks
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({}),
  });
});

describe("Fetch Utils Coverage Tests", () => {
  describe("Basic Functions", () => {
    it("should return fetch options object", () => {
      const options = createFetchOptions();
      expect(typeof options).toBe("object");
    });

    it("should have required default headers", () => {
      expect(DEFAULT_HEADERS["User-Agent"]).toBe("GitLab MCP Server");
      expect(DEFAULT_HEADERS["Content-Type"]).toBe("application/json");
      expect(DEFAULT_HEADERS.Accept).toBe("application/json");
    });
  });

  describe("enhancedFetch", () => {
    it("should propagate AbortError from caller signal without converting to timeout", async () => {
      // Caller-initiated AbortErrors should propagate as-is, NOT be converted to timeout
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValue(abortError);

      // Disable retry - caller aborts are not retryable anyway
      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "The operation was aborted"
      );
    });

    it("should propagate non-timeout errors", async () => {
      const networkError = new Error("Network error");
      mockFetch.mockRejectedValue(networkError);

      // Disable retry to test error propagation immediately
      await expect(enhancedFetch("https://example.com", { retry: false })).rejects.toThrow(
        "Network error"
      );
    });

    it("should merge custom headers with defaults", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      await enhancedFetch("https://example.com", {
        headers: { "X-Custom": "custom-value" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "GitLab MCP Server",
            "X-Custom": "custom-value",
          }),
        })
      );
    });

    it("should handle Headers object", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      const headers = new Headers();
      headers.set("X-Custom", "custom-value");

      await enhancedFetch("https://example.com", { headers });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-custom": "custom-value", // Headers normalizes to lowercase
          }),
        })
      );
    });

    it("should handle loadGitLabCookies success case", async () => {
      // Set environment variable to trigger cookie loading
      const originalCookiePath = process.env.GITLAB_AUTH_COOKIE_PATH;
      process.env.GITLAB_AUTH_COOKIE_PATH = "/fake/cookie/path";

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate cookie file exists
      const fs = require("fs");
      fs.readFileSync.mockReturnValue(
        "# HTTP Cookie File\n" +
          "gitlab.example.com\tFALSE\t/\tTRUE\t1234567890\t_gitlab_session\tabc123\n" +
          "gitlab.example.com\tFALSE\t/\tTRUE\t1234567890\tremember_token\tdef456\n"
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      // This should trigger cookie loading logic
      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/cookie/path", "utf-8");

      // Restore original value
      process.env.GITLAB_AUTH_COOKIE_PATH = originalCookiePath;
    });

    it("should handle loadGitLabCookies error case", async () => {
      // Set environment variable to trigger cookie loading
      const originalCookiePath = process.env.GITLAB_AUTH_COOKIE_PATH;
      process.env.GITLAB_AUTH_COOKIE_PATH = "/fake/cookie/path";

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate error reading cookie file
      const fs = require("fs");
      fs.readFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      // This should handle the cookie loading error gracefully
      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/cookie/path", "utf-8");

      // Restore original value
      process.env.GITLAB_AUTH_COOKIE_PATH = originalCookiePath;
    });

    it("should handle malformed cookie lines", async () => {
      // Set environment variable to trigger cookie loading
      const originalCookiePath = process.env.GITLAB_AUTH_COOKIE_PATH;
      process.env.GITLAB_AUTH_COOKIE_PATH = "/fake/cookie/path";

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate malformed cookie file
      const fs = require("fs");
      fs.readFileSync.mockReturnValue(
        "# HTTP Cookie File\n" +
          "malformed line\n" +
          "gitlab.example.com\tFALSE\t/\tTRUE\t1234567890\t_gitlab_session\tabc123\n" +
          "incomplete\ttab\tseparated\n"
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/cookie/path", "utf-8");

      // Restore original value
      process.env.GITLAB_AUTH_COOKIE_PATH = originalCookiePath;
    });

    it("should handle empty cookie file", async () => {
      // Set environment variable to trigger cookie loading
      const originalCookiePath = process.env.GITLAB_AUTH_COOKIE_PATH;
      process.env.GITLAB_AUTH_COOKIE_PATH = "/fake/cookie/path";

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate empty cookie file
      const fs = require("fs");
      fs.readFileSync.mockReturnValue("# HTTP Cookie File\n\n");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/cookie/path", "utf-8");

      // Restore original value
      process.env.GITLAB_AUTH_COOKIE_PATH = originalCookiePath;
    });

    it("should handle cookie file with comments only", async () => {
      // Set environment variable to trigger cookie loading
      const originalCookiePath = process.env.GITLAB_AUTH_COOKIE_PATH;
      process.env.GITLAB_AUTH_COOKIE_PATH = "/fake/cookie/path";

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate cookie file with only comments
      const fs = require("fs");
      fs.readFileSync.mockReturnValue(
        "# HTTP Cookie File\n" + "# This is a comment\n" + "# Another comment\n"
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/cookie/path", "utf-8");

      // Restore original value
      process.env.GITLAB_AUTH_COOKIE_PATH = originalCookiePath;
    });

    it("should handle proxy configuration scenarios", async () => {
      // Test various proxy configurations
      const originalHttpProxy = process.env.HTTP_PROXY;
      const originalHttpsProxy = process.env.HTTPS_PROXY;

      try {
        process.env.HTTP_PROXY = "http://proxy.example.com:8080";
        process.env.HTTPS_PROXY = "https://proxy.example.com:8080";

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
        });

        await enhancedFetch("https://gitlab.example.com/api/test");

        expect(mockFetch).toHaveBeenCalled();
      } finally {
        process.env.HTTP_PROXY = originalHttpProxy;
        process.env.HTTPS_PROXY = originalHttpsProxy;
      }
    });

    it("should handle SOCKS proxy configuration", async () => {
      const originalHttpProxy = process.env.HTTP_PROXY;

      try {
        process.env.HTTP_PROXY = "socks5://proxy.example.com:1080";

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
        });

        await enhancedFetch("https://gitlab.example.com/api/test");

        expect(mockFetch).toHaveBeenCalled();
      } finally {
        process.env.HTTP_PROXY = originalHttpProxy;
      }
    });

    it("should handle TLS configuration scenarios", async () => {
      const originalRejectUnauth = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

      try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
        });

        await enhancedFetch("https://gitlab.example.com/api/test");

        expect(mockFetch).toHaveBeenCalled();
      } finally {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauth;
      }
    });

    it("should handle CA certificate path configuration", async () => {
      // Set environment variable to trigger CA cert loading
      const originalCACertPath = process.env.GITLAB_CA_CERT_PATH;
      const originalHttpProxy = process.env.HTTP_PROXY;
      const originalHttpsProxy = process.env.HTTPS_PROXY;

      process.env.GITLAB_CA_CERT_PATH = "/fake/ca/cert/path";
      // Clear proxy variables to avoid conflicts
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;

      // Reset modules to force re-import with new environment variable
      jest.resetModules();

      // Mock fs to simulate CA cert file exists
      const fs = require("fs");
      fs.readFileSync.mockReturnValue(
        "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----"
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });

      // Re-import enhancedFetch after setting environment variable
      const { enhancedFetch: newEnhancedFetch } = require("../../../src/utils/fetch");

      await newEnhancedFetch("https://gitlab.example.com/api/test");

      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/ca/cert/path");

      // Restore original values
      process.env.GITLAB_CA_CERT_PATH = originalCACertPath;
      process.env.HTTP_PROXY = originalHttpProxy;
      process.env.HTTPS_PROXY = originalHttpsProxy;
    });

    it("should handle SOCKS4 proxy", async () => {
      const originalHttpProxy = process.env.HTTP_PROXY;

      try {
        process.env.HTTP_PROXY = "socks4://proxy.example.com:1080";

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
        });

        await enhancedFetch("https://gitlab.example.com/api/test");

        expect(mockFetch).toHaveBeenCalled();
      } finally {
        process.env.HTTP_PROXY = originalHttpProxy;
      }
    });

    it("should handle default HTTP proxy fallback", async () => {
      const originalHttpProxy = process.env.HTTP_PROXY;
      const originalHttpsProxy = process.env.HTTPS_PROXY;

      try {
        delete process.env.HTTPS_PROXY; // Ensure HTTPS_PROXY is not set
        process.env.HTTP_PROXY = "http://proxy.example.com:8080";

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
        });

        await enhancedFetch("https://gitlab.example.com/api/test");

        expect(mockFetch).toHaveBeenCalled();
      } finally {
        process.env.HTTP_PROXY = originalHttpProxy;
        process.env.HTTPS_PROXY = originalHttpsProxy;
      }
    });

    // Manual AbortController timeout was removed — Undici handles timeouts natively now.
    // The old "should handle abort controller timeout" test is no longer applicable.

    it("should handle authorization header without token", async () => {
      const originalToken = process.env.GITLAB_TOKEN;

      try {
        delete process.env.GITLAB_TOKEN;

        // Reset modules to test DEFAULT_HEADERS without token
        jest.resetModules();
        const { DEFAULT_HEADERS } = require("../../../src/utils/fetch");

        expect(DEFAULT_HEADERS.Authorization).toBeUndefined();
        expect(DEFAULT_HEADERS["User-Agent"]).toBe("GitLab MCP Server");
      } finally {
        process.env.GITLAB_TOKEN = originalToken;
      }
    });
  });

  describe("resetDispatcherCache", () => {
    it("should reset the dispatcher cache", () => {
      // Call resetDispatcherCache to reset cached dispatcher
      resetDispatcherCache();

      // After reset, createFetchOptions should reinitialize
      const options = createFetchOptions();
      expect(typeof options).toBe("object");
    });

    it("should allow dispatcher to be reinitialized after reset", () => {
      // First call initializes dispatcher
      createFetchOptions();

      // Reset the cache
      resetDispatcherCache();

      // Second call should reinitialize (not use cached)
      const options = createFetchOptions();
      expect(typeof options).toBe("object");
    });
  });

  describe("per-instance dispatcher integration", () => {
    beforeEach(async () => {
      // Reset InstanceRegistry to ensure clean state for each test
      await InstanceRegistry.getInstance().resetWithPools();
    });

    it("should get dispatcher from registry when initialized", async () => {
      // Initialize registry (this sets isInitialized to true)
      const registry = InstanceRegistry.getInstance();
      await registry.initialize(); // This makes isInitialized() return true

      // Register additional test instance
      registry.register({
        url: "https://gitlab.example.com",
        insecureSkipVerify: false,
      });

      // Create pool by getting GraphQL client (initializes connection pool)
      registry.getGraphQLClient("https://gitlab.example.com");

      // Verify dispatcher is available
      const dispatcher = registry.getDispatcher("https://gitlab.example.com");
      expect(dispatcher).toBeDefined();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      // Make request to the registered instance
      // This should hit the registry.isInitialized() === true path (lines 718-724)
      await enhancedFetch("https://gitlab.example.com/api/v4/projects", {
        retry: false,
        rateLimit: false,
      });

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should proceed without dispatcher for unregistered instance", async () => {
      const registry = InstanceRegistry.getInstance();
      await registry.initialize(); // Make isInitialized() return true

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      // Make request to instance without pool - dispatcher will be undefined
      // but isInitialized() is true so the code path is covered
      await enhancedFetch("https://other.gitlab.com/api/v4/projects", {
        retry: false,
        rateLimit: false,
      });

      // Fetch should still be called (uses global dispatcher as fallback)
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should acquire rate limit slot when registry initialized and rate limiting enabled", async () => {
      const registry = InstanceRegistry.getInstance();
      await registry.initialize(); // Make isInitialized() return true

      // Register instance with rate limiting
      registry.register({
        url: "https://custom.gitlab.com",
        rateLimit: {
          maxConcurrent: 10,
          queueSize: 5,
          queueTimeout: 1000,
        },
        insecureSkipVerify: false,
      });

      // Initialize pool
      registry.getGraphQLClient("https://custom.gitlab.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      // Make request with rate limiting enabled - covers the acquireSlot path (lines 726-734)
      await enhancedFetch("https://custom.gitlab.com/api/v4/projects", {
        retry: false,
        rateLimit: true,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it("should use rateLimitBaseUrl option when provided", async () => {
      const { InstanceRegistry } = await import("../../../src/services/InstanceRegistry");
      const registry = InstanceRegistry.getInstance();
      await registry.initialize();

      registry.register({
        url: "https://custom.gitlab.com",
        insecureSkipVerify: false,
      });

      registry.getGraphQLClient("https://custom.gitlab.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      // Use rateLimitBaseUrl option to override URL extraction
      await enhancedFetch("https://someproxy.com/api/v4/projects", {
        retry: false,
        rateLimit: false,
        rateLimitBaseUrl: "https://custom.gitlab.com",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it("should check pool stats when dispatcher has stats property", async () => {
      // Verifies that the pool pressure code path runs when the dispatcher
      // has a stats property. The actual logging is verified in fetch-config.test.ts
      // where the logger is properly mocked.
      const registry = InstanceRegistry.getInstance();
      await registry.initialize();

      // Register instance and create pool
      registry.register({
        url: "https://busy.gitlab.com",
        insecureSkipVerify: false,
      });
      registry.getGraphQLClient("https://busy.gitlab.com");

      // Override getDispatcher to return a mock with queued stats
      const mockDispatcher = {
        stats: { queued: 3, running: 25, size: 25 },
      };
      jest.spyOn(registry, "getDispatcher").mockReturnValue(mockDispatcher);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        headers: new Headers(),
      });

      // Should complete without error — pool pressure path exercises the stats check
      await enhancedFetch("https://busy.gitlab.com/api/v4/projects", {
        retry: false,
        rateLimit: false,
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
