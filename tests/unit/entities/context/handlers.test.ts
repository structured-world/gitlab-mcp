/**
 * Unit tests for context handlers
 *
 * Tests the handleManageContext dispatcher and individual handlers.
 */

import { handleManageContext } from "../../../../src/entities/context/handlers";
import { ContextManager } from "../../../../src/entities/context/context-manager";

// Mock dependencies
jest.mock("../../../../src/utils/namespace", () => ({
  detectNamespaceType: jest.fn().mockResolvedValue("group"),
}));

jest.mock("../../../../src/profiles/loader", () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    listProfiles: jest.fn().mockResolvedValue([
      {
        name: "readonly",
        description: "Read-only preset",
        readOnly: true,
        isBuiltIn: true,
        isPreset: true,
      },
    ]),
    loadPreset: jest.fn().mockResolvedValue({
      description: "Test preset",
      read_only: false,
    }),
    loadProfile: jest.fn().mockResolvedValue({
      host: "gitlab.example.com",
      auth: { type: "pat", token_env: "GITLAB_TOKEN" },
    }),
  })),
}));

describe("handleManageContext", () => {
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
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("action: show", () => {
    it("should return current session context", async () => {
      const result = await handleManageContext({ action: "show" });

      expect(result).toHaveProperty("host");
      expect(result).toHaveProperty("apiUrl");
      expect(result).toHaveProperty("readOnly");
      expect(result).toHaveProperty("oauthMode");
    });
  });

  describe("action: list_presets", () => {
    it("should return array of presets", async () => {
      const result = await handleManageContext({ action: "list_presets" });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("action: list_profiles", () => {
    it("should throw error in non-OAuth mode", async () => {
      await expect(handleManageContext({ action: "list_profiles" })).rejects.toThrow(
        "only available in OAuth mode"
      );
    });

    it("should return array in OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const result = await handleManageContext({ action: "list_profiles" });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("action: switch_preset", () => {
    it("should switch to specified preset", async () => {
      const result = await handleManageContext({
        action: "switch_preset",
        preset: "readonly",
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("current", "readonly");
    });
  });

  describe("action: switch_profile", () => {
    it("should throw error in non-OAuth mode", async () => {
      await expect(
        handleManageContext({ action: "switch_profile", profile: "production" })
      ).rejects.toThrow("only available in OAuth mode");
    });

    it("should switch profile in OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const result = await handleManageContext({
        action: "switch_profile",
        profile: "production",
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("current", "production");
    });
  });

  describe("action: set_scope", () => {
    it("should set scope with auto-detection", async () => {
      const result = await handleManageContext({
        action: "set_scope",
        namespace: "my-group",
        includeSubgroups: true,
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("scope");

      expect((result as any).scope.path).toBe("my-group");
    });

    it("should respect includeSubgroups parameter", async () => {
      const result = await handleManageContext({
        action: "set_scope",
        namespace: "my-group",
        includeSubgroups: false,
      });

      expect(result).toHaveProperty("success", true);

      expect((result as any).scope.includeSubgroups).toBe(false);
    });
  });

  describe("action: reset", () => {
    it("should reset context to initial state", async () => {
      // First make some changes
      await handleManageContext({
        action: "switch_preset",
        preset: "readonly",
      });

      await handleManageContext({
        action: "set_scope",
        namespace: "my-group",
        includeSubgroups: true,
      });

      // Then reset
      const result = await handleManageContext({ action: "reset" });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("context");
    });
  });
});
