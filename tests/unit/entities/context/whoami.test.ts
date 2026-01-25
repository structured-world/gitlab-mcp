/**
 * Unit tests for whoami handler
 *
 * Tests token introspection and capability discovery functionality.
 */

import { handleManageContext } from "../../../../src/entities/context/handlers";
import { ContextManager } from "../../../../src/entities/context/context-manager";
import { WhoamiResult } from "../../../../src/entities/context/types";

// Create mock objects that will be populated in tests
const mockConnectionManager = {
  getTokenScopeInfo: jest.fn(),
  getInstanceInfo: jest.fn(),
  refreshTokenScopes: jest.fn(),
};

const mockRegistryManager = {
  getFilterStats: jest.fn(),
  refreshCache: jest.fn(),
};

const mockEnhancedFetch = jest.fn();
const mockSendToolsListChangedNotification = jest.fn();

// Mock dependencies
jest.mock("../../../../src/utils/namespace", () => ({
  detectNamespaceType: jest.fn().mockResolvedValue("group"),
}));

jest.mock("../../../../src/profiles/loader", () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    listProfiles: jest.fn().mockResolvedValue([]),
    loadPreset: jest.fn().mockResolvedValue({
      description: "Test preset",
      read_only: false,
    }),
    loadProfile: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock("../../../../src/services/ConnectionManager", () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => mockConnectionManager),
  },
}));

jest.mock("../../../../src/registry-manager", () => ({
  RegistryManager: {
    getInstance: jest.fn(() => mockRegistryManager),
  },
}));

jest.mock("../../../../src/utils/fetch", () => ({
  enhancedFetch: (...args: unknown[]) => mockEnhancedFetch(...args),
}));

jest.mock("../../../../src/server", () => ({
  sendToolsListChangedNotification: () => mockSendToolsListChangedNotification(),
}));

describe("whoami handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ContextManager.resetInstance();
    jest.clearAllMocks();

    process.env = {
      ...originalEnv,
      GITLAB_API_URL: "https://gitlab.example.com",
      GITLAB_READ_ONLY_MODE: "false",
      OAUTH_ENABLED: "false",
    };

    // Default mock responses
    mockRegistryManager.getFilterStats.mockReturnValue({
      available: 45,
      total: 45,
      filteredByScopes: 0,
      filteredByReadOnly: 0,
      filteredByTier: 0,
      filteredByDeniedRegex: 0,
      filteredByActionDenial: 0,
    });

    mockConnectionManager.getTokenScopeInfo.mockReturnValue({
      name: "gitlab-mcp",
      scopes: ["api", "read_user"],
      expiresAt: "2025-12-31",
      active: true,
      tokenType: "unknown",
      hasGraphQLAccess: true,
      hasWriteAccess: true,
      daysUntilExpiry: 340,
    });

    mockConnectionManager.getInstanceInfo.mockReturnValue({
      version: "17.5.2",
      tier: "ultimate",
      features: {},
      detectedAt: new Date(),
    });

    mockEnhancedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        username: "developer",
        name: "John Developer",
        email: "dev@example.com",
        avatar_url: "https://gitlab.example.com/avatar.png",
        is_admin: false,
        state: "active",
      }),
    });

    // Default: no scope changes
    mockConnectionManager.refreshTokenScopes.mockResolvedValue(false);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("action: whoami", () => {
    it("should return complete WhoamiResult structure", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // Check top-level structure
      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("capabilities");
      expect(result).toHaveProperty("context");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("recommendations");
      expect(result).toHaveProperty("scopesRefreshed");

      // Check arrays
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(typeof result.scopesRefreshed).toBe("boolean");
    });

    it("should return user info when API call succeeds", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.user).not.toBeNull();
      expect(result.user?.id).toBe(123);
      expect(result.user?.username).toBe("developer");
      expect(result.user?.name).toBe("John Developer");
      expect(result.user?.state).toBe("active");
    });

    it("should return null user when API call fails", async () => {
      mockEnhancedFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.user).toBeNull();
    });

    it("should return token info from ConnectionManager", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token).not.toBeNull();
      expect(result.token?.name).toBe("gitlab-mcp");
      expect(result.token?.scopes).toContain("api");
      expect(result.token?.hasWriteAccess).toBe(true);
      expect(result.token?.hasGraphQLAccess).toBe(true);
    });

    it("should return server info", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.server).toBeDefined();
      expect(result.server.version).toBe("17.5.2");
      expect(result.server.tier).toBe("ultimate");
      expect(result.server.readOnlyMode).toBe(false);
      expect(result.server.oauthEnabled).toBe(false);
    });

    it("should return capabilities with full access", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.capabilities.canBrowse).toBe(true);
      expect(result.capabilities.canManage).toBe(true);
      expect(result.capabilities.canAccessGraphQL).toBe(true);
      expect(result.capabilities.availableToolCount).toBe(45);
      expect(result.capabilities.totalToolCount).toBe(45);
    });

    it("should return context info", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.context).toBeDefined();
      expect(result.context.activePreset).toBeNull();
      expect(result.context.activeProfile).toBeNull();
      expect(result.context.scope).toBeNull();
    });

    it("should generate no warnings with full access", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings).toHaveLength(0);
    });

    it("should generate no recommendations with full access", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.recommendations).toHaveLength(0);
    });

    it("should return scopesRefreshed=false when no scope changes", async () => {
      mockConnectionManager.refreshTokenScopes.mockResolvedValue(false);

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.scopesRefreshed).toBe(false);
      expect(mockRegistryManager.refreshCache).not.toHaveBeenCalled();
      expect(mockSendToolsListChangedNotification).not.toHaveBeenCalled();
    });

    it("should return scopesRefreshed=true and refresh registry when scopes change", async () => {
      mockConnectionManager.refreshTokenScopes.mockResolvedValue(true);

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.scopesRefreshed).toBe(true);
      expect(mockRegistryManager.refreshCache).toHaveBeenCalled();
      expect(mockSendToolsListChangedNotification).toHaveBeenCalled();
    });

    it("should handle refreshTokenScopes errors gracefully", async () => {
      mockConnectionManager.refreshTokenScopes.mockRejectedValue(new Error("Refresh failed"));

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // Should still return valid result even if refresh fails
      expect(result.scopesRefreshed).toBe(false);
      expect(result.server).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });
  });

  describe("whoami with limited token", () => {
    beforeEach(() => {
      // Limited token with only read_user scope
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "limited-token",
        scopes: ["read_user"],
        expiresAt: "2025-06-15",
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 142,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 3,
        total: 45,
        filteredByScopes: 42,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });
    });

    it("should show limited capabilities", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.capabilities.canBrowse).toBe(true);
      expect(result.capabilities.canManage).toBe(false);
      expect(result.capabilities.canAccessGraphQL).toBe(false);
      expect(result.capabilities.availableToolCount).toBe(3);
      expect(result.capabilities.filteredByScopes).toBe(42);
    });

    it("should generate warnings for limited scopes", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("Limited token scopes"))).toBe(true);
      expect(result.warnings.some(w => w.includes("No GraphQL access"))).toBe(true);
      expect(result.warnings.some(w => w.includes("No write access"))).toBe(true);
    });

    it("should recommend creating new token", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      const tokenRec = result.recommendations.find(r => r.action === "create_new_token");
      expect(tokenRec).toBeDefined();
      expect(tokenRec?.priority).toBe("high");
      expect(tokenRec?.url).toContain("personal_access_tokens");
    });
  });

  describe("whoami with expired token", () => {
    beforeEach(() => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "expired-token",
        scopes: ["api"],
        expiresAt: "2024-01-01",
        active: false,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: -390,
      });

      // User fetch fails with expired token
      mockEnhancedFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });
    });

    it("should show token as invalid", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token?.isValid).toBe(false);
      expect(result.token?.daysUntilExpiry).toBe(-390);
    });

    it("should generate expired token warning", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.some(w => w.includes("expired"))).toBe(true);
    });

    it("should recommend token renewal", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      const renewRec = result.recommendations.find(r => r.action === "renew_token");
      expect(renewRec).toBeDefined();
      expect(renewRec?.priority).toBe("high");
    });
  });

  describe("whoami with expiring soon token", () => {
    beforeEach(() => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "expiring-token",
        scopes: ["api"],
        expiresAt: "2025-01-30",
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 5,
      });
    });

    it("should generate expiring soon warning", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.some(w => w.includes("expires in 5 day"))).toBe(true);
    });

    it("should recommend renewal with medium priority", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      const renewRec = result.recommendations.find(r => r.action === "renew_token");
      expect(renewRec).toBeDefined();
      expect(renewRec?.priority).toBe("medium");
    });
  });

  describe("whoami in OAuth mode", () => {
    beforeEach(() => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      // In OAuth mode, token scope detection returns null
      mockConnectionManager.getTokenScopeInfo.mockReturnValue(null);
    });

    it("should return oauth token type", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token?.type).toBe("oauth");
      expect(result.server.oauthEnabled).toBe(true);
    });
  });

  describe("whoami with read-only filtering", () => {
    // Note: We can't easily test server.readOnlyMode because GITLAB_READ_ONLY_MODE
    // is evaluated at import time. Instead, we test the warning generation
    // based on filter stats which works regardless of config timing.
    beforeEach(() => {
      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 20,
        total: 45,
        filteredByScopes: 0,
        filteredByReadOnly: 25,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });
    });

    it("should show filtered tools count in capabilities", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.capabilities.filteredByReadOnly).toBe(25);
      expect(result.capabilities.availableToolCount).toBe(20);
    });

    it("should generate read-only warning when tools are filtered", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.some(w => w.includes("Read-only mode"))).toBe(true);
    });
  });

  describe("whoami edge cases", () => {
    it("should handle network errors when fetching user info", async () => {
      // Mock enhancedFetch to throw network error
      mockEnhancedFetch.mockRejectedValue(new Error("Network error"));

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // User should be null when network error occurs
      expect(result.user).toBeNull();
      // Other fields should still be populated
      expect(result.server).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });

    it("should handle ConnectionManager not initialized", async () => {
      // Make ConnectionManager throw for both methods
      mockConnectionManager.getTokenScopeInfo.mockImplementation(() => {
        throw new Error("Connection not initialized");
      });
      mockConnectionManager.getInstanceInfo.mockImplementation(() => {
        throw new Error("Connection not initialized");
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // Should return defaults when connection not initialized
      expect(result.token).toBeNull();
      expect(result.server.version).toBe("unknown");
      expect(result.server.tier).toBe("unknown");
    });

    it("should handle token with no scopes (empty array)", async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "no-scope-token",
        scopes: [],
        expiresAt: null,
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: null,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token?.scopes).toHaveLength(0);
      expect(result.capabilities.canBrowse).toBe(true); // Default behavior
    });

    it("should handle token expiring today", async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "today-token",
        scopes: ["api"],
        expiresAt: new Date().toISOString().split("T")[0],
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 0,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.some(w => w.includes("expires today"))).toBe(true);
    });

    it("should handle token with null expiry (never expires)", async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "permanent-token",
        scopes: ["api"],
        expiresAt: null,
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: null,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token?.daysUntilExpiry).toBeNull();
      // Should not generate expiry warnings
      expect(result.warnings.filter(w => w.includes("expire")).length).toBe(0);
    });

    it("should handle invalid/revoked token", async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "revoked-token",
        scopes: ["api"],
        expiresAt: "2025-12-31",
        active: false,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 340,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.token?.isValid).toBe(false);
      expect(result.warnings.some(w => w.includes("invalid or revoked"))).toBe(true);
    });

    it("should recommend creating new token when no write access", async () => {
      // When token lacks write access AND scopes are filtered,
      // create_new_token is recommended (covers both write and GraphQL)
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "read-only-token",
        scopes: ["read_user"],
        expiresAt: "2025-12-31",
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 340,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 5,
        total: 45,
        filteredByScopes: 40,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // Should recommend create_new_token, NOT add_scope (avoid duplicate recommendations)
      const createTokenRec = result.recommendations.find(r => r.action === "create_new_token");
      expect(createTokenRec).toBeDefined();
      expect(createTokenRec?.message).toContain("api");

      // add_scope should NOT be present (create_new_token covers it)
      const addScopeRec = result.recommendations.find(r => r.action === "add_scope");
      expect(addScopeRec).toBeUndefined();
    });

    it("should recommend adding scope when has write but no GraphQL access", async () => {
      // Edge case: token has write access but somehow lacks GraphQL access
      // (rare, but possible with custom token scopes)
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: "write-only-token",
        scopes: ["write_repository"],
        expiresAt: "2025-12-31",
        active: true,
        tokenType: "unknown",
        hasGraphQLAccess: false,
        hasWriteAccess: true, // Has write but no GraphQL
        daysUntilExpiry: 340,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 10,
        total: 45,
        filteredByScopes: 0, // No scope filtering (canManage=true)
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });

      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      // Should recommend add_scope since we have write but need GraphQL
      const addScopeRec = result.recommendations.find(r => r.action === "add_scope");
      expect(addScopeRec).toBeDefined();
      expect(addScopeRec?.message).toContain("api");
    });
  });

  describe("whoami with tier restrictions", () => {
    beforeEach(() => {
      mockConnectionManager.getInstanceInfo.mockReturnValue({
        version: "17.5.2",
        tier: "free",
        features: {},
        detectedAt: new Date(),
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 30,
        total: 45,
        filteredByScopes: 0,
        filteredByReadOnly: 0,
        filteredByTier: 15,
        filteredByDeniedRegex: 0,
      });
    });

    it("should show tier restrictions", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.server.tier).toBe("free");
      expect(result.capabilities.filteredByTier).toBe(15);
    });

    it("should generate tier warning", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      expect(result.warnings.some(w => w.includes("GitLab tier restrictions"))).toBe(true);
    });

    it("should recommend contacting admin", async () => {
      const result = (await handleManageContext({ action: "whoami" })) as WhoamiResult;

      const adminRec = result.recommendations.find(r => r.action === "contact_admin");
      expect(adminRec).toBeDefined();
      expect(adminRec?.priority).toBe("low");
    });
  });
});
