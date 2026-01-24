/**
 * Unit tests for TokenScopeDetector service
 *
 * Tests token scope detection, tool availability based on scopes,
 * and edge case handling (expired tokens, missing endpoints, etc.)
 */

import {
  detectTokenScopes,
  isToolAvailableForScopes,
  getToolsForScopes,
  getToolScopeRequirements,
  getTokenCreationUrl,
  logTokenScopeInfo,
  TokenScopeInfo,
  GitLabScope,
} from "../../../src/services/TokenScopeDetector";

// Mock config module
jest.mock("../../../src/config", () => ({
  GITLAB_BASE_URL: "https://gitlab.example.com",
  GITLAB_TOKEN: "glpat-test-token-123",
}));

// Mock logger
jest.mock("../../../src/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock enhancedFetch used by detectTokenScopes
const mockEnhancedFetch = jest.fn();
jest.mock("../../../src/utils/fetch", () => ({
  enhancedFetch: (...args: unknown[]) => mockEnhancedFetch(...args),
}));

// Alias for readability in tests
const mockFetch = mockEnhancedFetch;

describe("TokenScopeDetector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("detectTokenScopes", () => {
    it("should detect scopes from a valid PAT response", async () => {
      // Tests successful scope detection via /personal_access_tokens/self endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42,
          name: "gitlab-mcp",
          scopes: ["api", "read_user"],
          expires_at: "2026-06-15",
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();

      expect(result).not.toBeNull();
      expect(result!.name).toBe("gitlab-mcp");
      expect(result!.scopes).toEqual(["api", "read_user"]);
      expect(result!.hasGraphQLAccess).toBe(true);
      expect(result!.hasWriteAccess).toBe(true);
      expect(result!.active).toBe(true);
      expect(result!.tokenType).toBe("personal_access_token");

      // Verify correct endpoint and headers
      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/personal_access_tokens/self",
        expect.objectContaining({
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test-token-123",
          }),
        })
      );
    });

    it("should detect read_api scope as having GraphQL access", async () => {
      // read_api provides read-only GraphQL access
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 43,
          name: "read-only-token",
          scopes: ["read_api", "read_user"],
          expires_at: null,
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();

      expect(result!.hasGraphQLAccess).toBe(true);
      expect(result!.hasWriteAccess).toBe(false);
      expect(result!.daysUntilExpiry).toBeNull();
    });

    it("should detect read_user-only scope as lacking GraphQL access", async () => {
      // read_user alone does NOT provide GraphQL access
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 44,
          name: "limited-token",
          scopes: ["read_user"],
          expires_at: "2026-02-01",
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();

      expect(result!.hasGraphQLAccess).toBe(false);
      expect(result!.hasWriteAccess).toBe(false);
      expect(result!.scopes).toEqual(["read_user"]);
    });

    it("should handle 401 response (invalid token)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should handle 404 response (older GitLab without endpoint)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should handle 403 response (deploy tokens, etc.)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should return null when response fails schema validation", async () => {
      // Response missing required fields (e.g. no 'scopes' array)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 50,
          name: "bad-response",
          // scopes missing entirely
          expires_at: null,
          active: true,
        }),
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should return null when response has wrong field types", async () => {
      // 'scopes' is a string instead of array
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "not-a-number",
          name: 123,
          scopes: "api",
          expires_at: null,
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should handle unexpected status codes (e.g. 500)", async () => {
      // Covers the generic non-401/403/404 error path
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await detectTokenScopes();
      expect(result).toBeNull();
    });

    it("should return null when GITLAB_BASE_URL is missing", async () => {
      // Temporarily override the config mock
      jest.resetModules();
      jest.doMock("../../../src/config", () => ({
        GITLAB_BASE_URL: "",
        GITLAB_TOKEN: "glpat-test-token-123",
      }));
      jest.doMock("../../../src/logger", () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
      jest.doMock("../../../src/utils/fetch", () => ({
        enhancedFetch: jest.fn(),
      }));

      const { detectTokenScopes: detect } = require("../../../src/services/TokenScopeDetector");
      const result = await detect();
      expect(result).toBeNull();

      jest.resetModules();
    });

    it("should detect project access token type from name prefix", async () => {
      // Token names starting with "project_" indicate project access tokens
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 48,
          name: "project_bot_token",
          scopes: ["api"],
          expires_at: null,
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();
      expect(result!.tokenType).toBe("project_access_token");
    });

    it("should detect group access token type from name prefix", async () => {
      // Token names starting with "group_" indicate group access tokens
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 49,
          name: "group_bot_token",
          scopes: ["api", "read_user"],
          expires_at: null,
          active: true,
          revoked: false,
        }),
      });

      const result = await detectTokenScopes();
      expect(result!.tokenType).toBe("group_access_token");
    });

    it("should detect revoked token as inactive", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 45,
          name: "revoked-token",
          scopes: ["api"],
          expires_at: null,
          active: true,
          revoked: true,
        }),
      });

      const result = await detectTokenScopes();
      expect(result!.active).toBe(false);
    });

    it("should calculate days until expiry correctly", async () => {
      // Freeze time to make expiry calculation deterministic
      const baseDate = new Date("2024-06-15T12:00:00.000Z");
      jest.useFakeTimers().setSystemTime(baseDate);

      try {
        // Token expiring in 3 days from the frozen base date
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 46,
            name: "expiring-token",
            scopes: ["api"],
            expires_at: "2024-06-18",
            active: true,
            revoked: false,
          }),
        });

        const result = await detectTokenScopes();
        expect(result!.daysUntilExpiry).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it("should report negative days for already-expired token", async () => {
      // Freeze time to make expiry calculation deterministic
      const baseDate = new Date("2024-06-15T12:00:00.000Z");
      jest.useFakeTimers().setSystemTime(baseDate);

      try {
        // Token that expired 2 days ago from the frozen base date
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 47,
            name: "expired-token",
            scopes: ["api"],
            expires_at: "2024-06-13",
            active: false,
            revoked: false,
          }),
        });

        const result = await detectTokenScopes();
        expect(result!.daysUntilExpiry).toBe(-2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("isToolAvailableForScopes", () => {
    it("should allow all tools with api scope", () => {
      const scopes: GitLabScope[] = ["api"];
      // api scope should enable all known tools
      expect(isToolAvailableForScopes("browse_projects", scopes)).toBe(true);
      expect(isToolAvailableForScopes("manage_project", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_merge_requests", scopes)).toBe(true);
      expect(isToolAvailableForScopes("manage_merge_request", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_files", scopes)).toBe(true);
      expect(isToolAvailableForScopes("manage_files", scopes)).toBe(true);
    });

    it("should allow browse tools with read_api scope", () => {
      const scopes: GitLabScope[] = ["read_api"];
      expect(isToolAvailableForScopes("browse_projects", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_merge_requests", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_files", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_wiki", scopes)).toBe(true);
    });

    it("should deny manage tools with read_api scope", () => {
      const scopes: GitLabScope[] = ["read_api"];
      expect(isToolAvailableForScopes("manage_project", scopes)).toBe(false);
      expect(isToolAvailableForScopes("manage_merge_request", scopes)).toBe(false);
      expect(isToolAvailableForScopes("manage_files", scopes)).toBe(false);
    });

    it("should allow only user-related tools with read_user scope", () => {
      const scopes: GitLabScope[] = ["read_user"];
      // These work with read_user
      expect(isToolAvailableForScopes("browse_users", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_events", scopes)).toBe(true);
      // manage_context is not in scope map — defaults to allowed (any token)
      expect(isToolAvailableForScopes("manage_context", scopes)).toBe(true);
      // These don't work with just read_user
      expect(isToolAvailableForScopes("browse_projects", scopes)).toBe(false);
      expect(isToolAvailableForScopes("browse_merge_requests", scopes)).toBe(false);
      expect(isToolAvailableForScopes("manage_project", scopes)).toBe(false);
    });

    it("should allow browse_files with read_repository scope", () => {
      const scopes: GitLabScope[] = ["read_repository"];
      expect(isToolAvailableForScopes("browse_files", scopes)).toBe(true);
      // But not other browse tools
      expect(isToolAvailableForScopes("browse_projects", scopes)).toBe(false);
    });

    it("should allow manage_files with write_repository scope", () => {
      const scopes: GitLabScope[] = ["write_repository"];
      expect(isToolAvailableForScopes("manage_files", scopes)).toBe(true);
      // But not other manage tools
      expect(isToolAvailableForScopes("manage_project", scopes)).toBe(false);
    });

    it("should allow unknown tools (not in scope map)", () => {
      // Tools not in the scope requirements map should be allowed
      const scopes: GitLabScope[] = ["read_user"];
      expect(isToolAvailableForScopes("unknown_future_tool", scopes)).toBe(true);
    });

    it("should combine scopes correctly", () => {
      // read_user + read_repository
      const scopes: GitLabScope[] = ["read_user", "read_repository"];
      expect(isToolAvailableForScopes("browse_users", scopes)).toBe(true);
      expect(isToolAvailableForScopes("browse_files", scopes)).toBe(true);
      // Still can't access projects without api/read_api
      expect(isToolAvailableForScopes("browse_projects", scopes)).toBe(false);
    });
  });

  describe("getToolsForScopes", () => {
    it("should return all tools for api scope", () => {
      const tools = getToolsForScopes(["api"]);
      // api scope gives access to all mapped tools
      expect(tools.length).toBeGreaterThan(40);
      expect(tools).toContain("browse_projects");
      expect(tools).toContain("manage_project");
      expect(tools).toContain("browse_merge_requests");
      expect(tools).toContain("manage_merge_request");
    });

    it("should return only browse tools for read_api scope", () => {
      const tools = getToolsForScopes(["read_api"]);
      // All browse_* tools should be available
      const browseTools = tools.filter(t => t.startsWith("browse_"));
      expect(browseTools.length).toBeGreaterThan(15);
      // No manage_* tools (manage_context is not in scope map at all)
      const manageTools = tools.filter(t => t.startsWith("manage_"));
      expect(manageTools).toHaveLength(0);
    });

    it("should return minimal tools for read_user scope", () => {
      const tools = getToolsForScopes(["read_user"]);
      // Only browse_users and browse_events (manage_context is not scope-gated)
      expect(tools).toContain("browse_users");
      expect(tools).toContain("browse_events");
      expect(tools.length).toBe(2);
    });
  });

  describe("getToolScopeRequirements", () => {
    it("should return a copy of the scope requirements map", () => {
      const requirements = getToolScopeRequirements();
      // Should contain known tools
      expect(requirements).toHaveProperty("browse_projects");
      expect(requirements).toHaveProperty("manage_project");
      expect(requirements.browse_projects).toContain("api");
      // Should be a copy (modifying it shouldn't affect the original)
      requirements.browse_projects = [];
      const fresh = getToolScopeRequirements();
      expect(fresh.browse_projects).toContain("api");
    });
  });

  describe("getTokenCreationUrl", () => {
    it("should generate correct URL with default scopes", () => {
      const url = getTokenCreationUrl("https://gitlab.com");
      // URL API properly encodes parameters
      expect(url).toContain("/-/user_settings/personal_access_tokens");
      expect(url).toContain("name=gitlab-mcp");
      expect(url).toContain("scopes=api");
      expect(url).toContain("read_user");
    });

    it("should generate correct URL with custom scopes", () => {
      const url = getTokenCreationUrl("https://gitlab.example.com", [
        "api",
        "read_user",
        "read_repository",
      ]);
      expect(url).toContain("https://gitlab.example.com");
      expect(url).toContain("name=gitlab-mcp");
      expect(url).toContain("api");
      expect(url).toContain("read_user");
      expect(url).toContain("read_repository");
    });

    it("should properly encode special characters in scopes", () => {
      const url = getTokenCreationUrl("https://gitlab.com", ["api", "scope with spaces"]);
      // URL API should encode the space
      expect(url).not.toContain(" ");
      expect(url).toContain("scope");
    });
  });

  describe("logTokenScopeInfo", () => {
    const { logger } = require("../../../src/logger");

    it("should log brief message for full-access token", () => {
      const info: TokenScopeInfo = {
        name: "full-token",
        scopes: ["api", "read_user"],
        expiresAt: "2027-01-01",
        active: true,
        tokenType: "personal_access_token",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 365,
      };

      logTokenScopeInfo(info, 45);

      // Should log token detection without "limited" message
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ tokenName: "full-token" }),
        expect.stringContaining('Token "full-token" detected')
      );
      // Should NOT log "limited scopes" message
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("limited scopes")
      );
    });

    it("should log detailed message for limited-access token", () => {
      const info: TokenScopeInfo = {
        name: "limited-token",
        scopes: ["read_user"],
        expiresAt: null,
        active: true,
        tokenType: "personal_access_token",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: null,
      };

      logTokenScopeInfo(info, 45);

      // Should log "limited scopes" message
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenName: "limited-token",
          availableTools: 2,
          totalTools: 45,
        }),
        expect.stringContaining("limited scopes")
      );
      // Should mention GraphQL being skipped
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("GraphQL introspection skipped")
      );
    });

    it("should warn about expiring token (< 7 days)", () => {
      const info: TokenScopeInfo = {
        name: "expiring-token",
        scopes: ["api"],
        expiresAt: "2026-01-27",
        active: true,
        tokenType: "personal_access_token",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 3,
      };

      logTokenScopeInfo(info, 45);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tokenName: "expiring-token", daysUntilExpiry: 3 }),
        expect.stringContaining("expires in 3 day(s)")
      );
    });

    it("should warn about already-expired token", () => {
      const info: TokenScopeInfo = {
        name: "dead-token",
        scopes: ["api"],
        expiresAt: "2025-12-01",
        active: false,
        tokenType: "personal_access_token",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: -30,
      };

      logTokenScopeInfo(info, 45);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tokenName: "dead-token" }),
        expect.stringContaining("has expired")
      );
    });
  });
});
