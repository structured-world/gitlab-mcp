/**
 * Unit tests for the Cloudflare Pages Function handlers in report-bug.ts.
 * Tests the exported onRequestOptions and onRequestPost with mocked
 * crypto.subtle and fetch to cover JWT auth, rate limiting, and error paths.
 */

// Mock fetch globally before importing the module
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock crypto.subtle for JWT signing
const mockSign = jest.fn();
const mockImportKey = jest.fn();
Object.defineProperty(global, "crypto", {
  value: {
    subtle: {
      sign: mockSign,
      importKey: mockImportKey,
    },
  },
});

import { onRequestOptions, onRequestPost } from "../../../docs/functions/api/report-bug";

// Helper to create a mock context matching Cloudflare's EventContext shape
function createMockContext(overrides: {
  method?: string;
  origin?: string;
  body?: unknown;
  ip?: string;
  env?: Partial<{
    GITHUB_APP_ID: string;
    GITHUB_APP_PEM: string;
    GITHUB_APP_INSTALLATION_ID: string;
    RATE_LIMIT_KV: { get: jest.Mock; put: jest.Mock } | undefined;
  }>;
}) {
  const method = overrides.method || "POST";
  const origin = overrides.origin || "https://structured-world.github.io";
  const ip = overrides.ip || "1.2.3.4";
  const env = {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PEM: "dGVzdA==", // base64 of "test"
    GITHUB_APP_INSTALLATION_ID: "67890",
    RATE_LIMIT_KV: undefined,
    ...overrides.env,
  };

  const headers = new Map<string, string>();
  headers.set("Origin", origin);
  headers.set("CF-Connecting-IP", ip);

  return {
    request: {
      method,
      headers: { get: (key: string) => headers.get(key) || null },
      json: jest.fn().mockResolvedValue(overrides.body ?? {}),
    },
    env,
  } as unknown as Parameters<typeof onRequestPost>[0];
}

describe("report-bug handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: crypto.subtle.importKey returns a mock CryptoKey
    mockImportKey.mockResolvedValue({ type: "private" });
    // Default: crypto.subtle.sign returns a mock signature
    mockSign.mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  describe("onRequestOptions (CORS preflight)", () => {
    // Tests that OPTIONS returns 204 with proper CORS headers
    it("returns 204 with CORS headers for allowed origin", async () => {
      const ctx = createMockContext({
        method: "OPTIONS",
        origin: "https://structured-world.github.io",
      });
      const response = await onRequestOptions(ctx);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://structured-world.github.io"
      );
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    });

    // Tests that unknown origins fall back to primary allowed origin
    it("falls back to primary origin for unknown origins", async () => {
      const ctx = createMockContext({ method: "OPTIONS", origin: "https://evil.com" });
      const response = await onRequestOptions(ctx);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://docs.gitlab-mcp.sw.foundation"
      );
    });
  });

  describe("onRequestPost", () => {
    // Tests that invalid input returns 400
    it("returns 400 for missing description", async () => {
      const ctx = createMockContext({ body: { page: "/test" } });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Description is required" });
    });

    // Tests that short description returns 400
    it("returns 400 for description too short", async () => {
      const ctx = createMockContext({ body: { description: "short" } });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect((data as { error: string }).error).toContain("at least 10");
    });

    // Tests that honeypot detection returns 400
    it("returns 400 for non-empty honeypot (anti-spam)", async () => {
      const ctx = createMockContext({
        body: { description: "Valid description text", honeypot: "bot filled this" },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid submission" });
    });

    // Tests rate limiting returns 429
    it("returns 429 when rate limit exceeded", async () => {
      const mockKV = {
        get: jest.fn().mockResolvedValue("5"), // at max
        put: jest.fn(),
      };
      const ctx = createMockContext({
        body: { description: "Valid description text" },
        env: { RATE_LIMIT_KV: mockKV },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(429);
      const data = await response.json();
      expect((data as { error: string }).error).toContain("Too many reports");
    });

    // Tests successful issue creation (happy path)
    it("returns 201 on successful issue creation", async () => {
      // Mock fetch: first call = installation token, second call = create issue
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "ghs_installation_token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              number: 42,
              html_url: "https://github.com/structured-world/gitlab-mcp/issues/42",
            }),
        });

      const ctx = createMockContext({
        body: {
          page: "/guide/quick-start",
          description: "The example code does not work",
          category: "Tool not working as described",
        },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toEqual({ success: true, issue: 42 });

      // Verify fetch was called for installation token
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const installationCall = mockFetch.mock.calls[0];
      expect(installationCall[0]).toContain("/app/installations/67890/access_tokens");

      // Verify fetch was called to create issue
      const issueCall = mockFetch.mock.calls[1];
      expect(issueCall[0]).toContain("/repos/structured-world/gitlab-mcp/issues");
    });

    // Tests that GitHub API failure returns 500
    it("returns 500 when installation token fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Bad credentials"),
      });

      const ctx = createMockContext({
        body: { description: "Valid description for testing" },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect((data as { error: string }).error).toContain("Failed to submit");
    });

    // Tests that issue creation failure returns 500
    it("returns 500 when issue creation fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "ghs_token" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: () => Promise.resolve("Validation Failed"),
        });

      const ctx = createMockContext({
        body: { description: "Valid description for testing" },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect((data as { error: string }).error).toContain("Failed to submit");
    });

    // Tests rate limit KV is called correctly on allowed request
    it("increments rate limit counter on successful request", async () => {
      const mockKV = {
        get: jest.fn().mockResolvedValue("2"), // under limit
        put: jest.fn().mockResolvedValue(undefined),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "ghs_token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ number: 1, html_url: "https://example.com" }),
        });

      const ctx = createMockContext({
        body: { description: "Valid description for testing" },
        env: { RATE_LIMIT_KV: mockKV },
        ip: "10.0.0.1",
      });
      await onRequestPost(ctx);

      expect(mockKV.get).toHaveBeenCalledWith("rate:10.0.0.1");
      expect(mockKV.put).toHaveBeenCalledWith("rate:10.0.0.1", "3", { expirationTtl: 3600 });
    });

    // Tests that no KV binding gracefully allows requests
    it("allows requests when RATE_LIMIT_KV is not configured", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "ghs_token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ number: 5, html_url: "https://example.com" }),
        });

      const ctx = createMockContext({
        body: { description: "Valid description for testing" },
        env: { RATE_LIMIT_KV: undefined },
      });
      const response = await onRequestPost(ctx);

      expect(response.status).toBe(201);
    });
  });
});
