/**
 * Unit tests for ConnectionManager service
 * Tests singleton pattern and error handling without external dependencies
 */

import { ConnectionManager } from "../../../src/services/ConnectionManager";

// Mock isOAuthEnabled to avoid OAuth config validation in tests
const mockIsOAuthEnabled = jest.fn();
jest.mock("../../../src/oauth/index.js", () => ({
  isOAuthEnabled: () => mockIsOAuthEnabled(),
}));

// Mock detectTokenScopes for testing scope refresh
const mockDetectTokenScopes = jest.fn();
jest.mock("../../../src/services/TokenScopeDetector", () => ({
  detectTokenScopes: () => mockDetectTokenScopes(),
  getTokenCreationUrl: jest.fn(
    () => "https://gitlab.example.com/-/user_settings/personal_access_tokens"
  ),
}));

describe("ConnectionManager Unit", () => {
  beforeEach(() => {
    // Reset singleton instance for each test
    (ConnectionManager as any).instance = null;
  });

  describe("singleton pattern", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = ConnectionManager.getInstance();
      const instance2 = ConnectionManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should maintain singleton across different call patterns", () => {
      const instances: ConnectionManager[] = [];
      for (let i = 0; i < 5; i++) {
        instances.push(ConnectionManager.getInstance());
      }

      // All instances should be the same object
      instances.forEach(instance => {
        expect(instance).toBe(instances[0]);
      });
    });
  });

  describe("error handling before initialization", () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
    });

    const errorMessage = "Connection not initialized. Call initialize() first.";

    it("should throw error when getting client before initialization", () => {
      expect(() => manager.getClient()).toThrow(errorMessage);
    });

    it("should throw error when getting version detector before initialization", () => {
      expect(() => manager.getVersionDetector()).toThrow(errorMessage);
    });

    it("should throw error when getting schema introspector before initialization", () => {
      expect(() => manager.getSchemaIntrospector()).toThrow(errorMessage);
    });

    it("should throw error when getting instance info before initialization", () => {
      expect(() => manager.getInstanceInfo()).toThrow(errorMessage);
    });

    it("should throw error when getting schema info before initialization", () => {
      expect(() => manager.getSchemaInfo()).toThrow(errorMessage);
    });
  });

  describe("refreshTokenScopes", () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      mockIsOAuthEnabled.mockReturnValue(false);
      mockDetectTokenScopes.mockReset();
    });

    it("should return false in OAuth mode", async () => {
      // Mock OAuth mode enabled
      mockIsOAuthEnabled.mockReturnValue(true);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
    });

    it("should return false when token detection fails (returns null)", async () => {
      // Detection returns null on failure
      mockDetectTokenScopes.mockResolvedValue(null);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
    });

    it("should return false when scopes have not changed", async () => {
      // First, set up initial token info with some scopes
      const initialScopes = {
        active: true,
        scopes: ["read_api", "read_user"],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: "personal_access_token",
        name: "test-token",
        expiresAt: null,
        daysUntilExpiry: null,
      };

      // Set initial state
      (manager as any).tokenScopeInfo = initialScopes;

      // Return same scopes on refresh
      mockDetectTokenScopes.mockResolvedValue(initialScopes);

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(false);
    });

    it("should return true when scopes change (new scopes added)", async () => {
      // Set up initial token info with limited scopes
      const initialScopes = {
        active: true,
        scopes: ["read_api"],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: "personal_access_token",
        name: "test-token",
        expiresAt: null,
        daysUntilExpiry: null,
      };

      // Set initial state
      (manager as any).tokenScopeInfo = initialScopes;

      // Return new scopes with api scope added
      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ["api", "read_api"],
        hasWriteAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it("should return true when GraphQL access changes", async () => {
      // Set up initial token info without GraphQL access
      const initialScopes = {
        active: true,
        scopes: ["read_user"],
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        tokenType: "personal_access_token",
        name: "test-token",
        expiresAt: null,
        daysUntilExpiry: null,
      };

      // Set initial state
      (manager as any).tokenScopeInfo = initialScopes;

      // Return scopes with GraphQL access now available
      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ["api"],
        hasGraphQLAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it("should return true when write access changes", async () => {
      // Set up initial token info without write access
      const initialScopes = {
        active: true,
        scopes: ["read_api"],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: "personal_access_token",
        name: "test-token",
        expiresAt: null,
        daysUntilExpiry: null,
      };

      // Set initial state
      (manager as any).tokenScopeInfo = initialScopes;

      // Return scopes with write access now available
      mockDetectTokenScopes.mockResolvedValue({
        ...initialScopes,
        scopes: ["api"],
        hasWriteAccess: true,
      });

      const result = await manager.refreshTokenScopes();
      expect(result).toBe(true);
    });

    it("should update tokenScopeInfo when scopes change", async () => {
      // Set up initial token info
      const initialScopes = {
        active: true,
        scopes: ["read_api"],
        hasGraphQLAccess: true,
        hasWriteAccess: false,
        tokenType: "personal_access_token",
        name: "test-token",
        expiresAt: null,
        daysUntilExpiry: null,
      };

      // Set initial state
      (manager as any).tokenScopeInfo = initialScopes;

      // Return new scopes
      const newScopes = {
        ...initialScopes,
        scopes: ["api"],
        hasWriteAccess: true,
      };
      mockDetectTokenScopes.mockResolvedValue(newScopes);

      await manager.refreshTokenScopes();

      // Verify the tokenScopeInfo was updated
      const updatedInfo = manager.getTokenScopeInfo();
      expect(updatedInfo?.scopes).toEqual(["api"]);
      expect(updatedInfo?.hasWriteAccess).toBe(true);
    });
  });

  describe("ensureIntrospected", () => {
    let manager: ConnectionManager;

    beforeEach(() => {
      manager = ConnectionManager.getInstance();
      mockIsOAuthEnabled.mockReturnValue(false);
    });

    it("should throw error when called before initialization", async () => {
      await expect(manager.ensureIntrospected()).rejects.toThrow(
        "Connection not initialized. Call initialize() first."
      );
    });

    it("should return early if already introspected", async () => {
      // Simulate introspected state
      (manager as any).instanceInfo = { version: "16.0.0", tier: "premium" };
      (manager as any).schemaInfo = { workItemWidgetTypes: [] };
      (manager as any).client = {};
      (manager as any).versionDetector = {};
      (manager as any).schemaIntrospector = {};

      // Should not throw and return quickly
      await expect(manager.ensureIntrospected()).resolves.toBeUndefined();
    });
  });
});
