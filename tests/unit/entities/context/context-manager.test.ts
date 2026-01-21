/**
 * Unit tests for ContextManager
 *
 * Tests the ContextManager singleton and its methods.
 */

// Mock config module BEFORE importing ContextManager
let mockGitLabBaseUrl = "https://gitlab.example.com";
let mockGitLabReadOnlyMode = false;

jest.mock("../../../../src/config", () => ({
  get GITLAB_BASE_URL() {
    return mockGitLabBaseUrl;
  },
  get GITLAB_READ_ONLY_MODE() {
    return mockGitLabReadOnlyMode;
  },
}));

// Mock dependencies
jest.mock("../../../../src/utils/namespace", () => ({
  detectNamespaceType: jest.fn(),
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
      {
        name: "developer",
        description: "Developer preset",
        readOnly: false,
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

import {
  ContextManager,
  getContextManager,
} from "../../../../src/entities/context/context-manager";
import { detectNamespaceType } from "../../../../src/utils/namespace";

const mockDetectNamespaceType = detectNamespaceType as jest.MockedFunction<
  typeof detectNamespaceType
>;

describe("ContextManager", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset singleton and mocks before each test
    ContextManager.resetInstance();
    jest.clearAllMocks();

    // Reset mock values
    mockGitLabBaseUrl = "https://gitlab.example.com";
    mockGitLabReadOnlyMode = false;

    // Set up test environment
    process.env = {
      ...originalEnv,
      OAUTH_ENABLED: "false",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("singleton pattern", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = ContextManager.getInstance();
      const instance2 = ContextManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should create a new instance after reset", () => {
      const instance1 = ContextManager.getInstance();
      ContextManager.resetInstance();
      const instance2 = ContextManager.getInstance();
      expect(instance1).not.toBe(instance2);
    });

    it("should work with getContextManager helper", () => {
      const instance1 = getContextManager();
      const instance2 = ContextManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("getContext", () => {
    it("should return current context with basic info", () => {
      const manager = ContextManager.getInstance();
      const context = manager.getContext();

      expect(context.host).toBe("gitlab.example.com");
      expect(context.apiUrl).toBe("https://gitlab.example.com");
      expect(context.readOnly).toBe(false);
      expect(context.oauthMode).toBe(false);
    });

    it("should reflect read-only mode from config", () => {
      mockGitLabReadOnlyMode = true;
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();
      const context = manager.getContext();

      expect(context.readOnly).toBe(true);
    });

    it("should reflect OAuth mode from environment", () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();
      const context = manager.getContext();

      expect(context.oauthMode).toBe(true);
    });

    it("should include initial context for reset", () => {
      const manager = ContextManager.getInstance();
      const context = manager.getContext();

      expect(context.initialContext).toBeDefined();
      expect(context.initialContext?.host).toBe("gitlab.example.com");
    });
  });

  describe("listPresets", () => {
    it("should return available presets", async () => {
      const manager = ContextManager.getInstance();
      const presets = await manager.listPresets();

      expect(presets).toHaveLength(2);
      expect(presets[0].name).toBe("readonly");
      expect(presets[1].name).toBe("developer");
    });
  });

  describe("listProfiles", () => {
    it("should throw error in non-OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "false";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();

      await expect(manager.listProfiles()).rejects.toThrow("only available in OAuth mode");
    });

    it("should return profiles in OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();
      const profiles = await manager.listProfiles();

      // Our mock returns presets, which are filtered out for profiles
      // So this returns empty (profiles have isPreset: false)
      expect(Array.isArray(profiles)).toBe(true);
    });
  });

  describe("switchPreset", () => {
    it("should switch to a valid preset", async () => {
      const manager = ContextManager.getInstance();
      const result = await manager.switchPreset("readonly");

      expect(result.success).toBe(true);
      expect(result.current).toBe("readonly");
      expect(result.message).toContain("Switched to preset");
    });

    it("should return previous preset name on switch", async () => {
      const manager = ContextManager.getInstance();

      await manager.switchPreset("readonly");
      const result = await manager.switchPreset("developer");

      expect(result.previous).toBe("readonly");
      expect(result.current).toBe("developer");
    });

    it("should update getCurrentPresetName after switch", async () => {
      const manager = ContextManager.getInstance();

      expect(manager.getCurrentPresetName()).toBeNull();

      await manager.switchPreset("readonly");

      expect(manager.getCurrentPresetName()).toBe("readonly");
    });
  });

  describe("switchProfile", () => {
    it("should throw error in non-OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "false";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();

      await expect(manager.switchProfile("production")).rejects.toThrow(
        "only available in OAuth mode"
      );
    });

    it("should switch profile in OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();
      const result = await manager.switchProfile("production");

      expect(result.success).toBe(true);
      expect(result.current).toBe("production");
    });
  });

  describe("setScope", () => {
    it("should set scope for a group", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      const result = await manager.setScope("my-group");

      expect(result.success).toBe(true);
      expect(result.scope.type).toBe("group");
      expect(result.scope.path).toBe("my-group");
      expect(result.scope.includeSubgroups).toBe(true);
      expect(result.scope.detected).toBe(true);
    });

    it("should set scope for a project", async () => {
      mockDetectNamespaceType.mockResolvedValue("project");

      const manager = ContextManager.getInstance();
      const result = await manager.setScope("group/project");

      expect(result.success).toBe(true);
      expect(result.scope.type).toBe("project");
      expect(result.scope.path).toBe("group/project");
      expect(result.scope.includeSubgroups).toBe(false); // Projects don't have subgroups
    });

    it("should respect includeSubgroups parameter for groups", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      const result = await manager.setScope("my-group", false);

      expect(result.scope.includeSubgroups).toBe(false);
    });

    it("should update hasScope after setScope", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();

      expect(manager.hasScope()).toBe(false);

      await manager.setScope("my-group");

      expect(manager.hasScope()).toBe(true);
    });

    it("should update context with scope after setScope", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      await manager.setScope("my-group");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("group");
      expect(context.scope?.path).toBe("my-group");
    });
  });

  describe("reset", () => {
    it("should reset context to initial state", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();

      // Make some changes
      await manager.switchPreset("readonly");
      await manager.setScope("my-group");

      expect(manager.getCurrentPresetName()).toBe("readonly");
      expect(manager.hasScope()).toBe(true);

      // Reset
      const result = manager.reset();

      expect(result.success).toBe(true);
      expect(result.message).toContain("reset to initial state");
      expect(manager.getCurrentPresetName()).toBeNull();
      expect(manager.hasScope()).toBe(false);
    });

    it("should return restored context", async () => {
      const manager = ContextManager.getInstance();
      const result = manager.reset();

      expect(result.context).toBeDefined();
      expect(result.context.host).toBe("gitlab.example.com");
    });
  });

  describe("getScopeEnforcer", () => {
    it("should return null when no scope is set", () => {
      const manager = ContextManager.getInstance();

      expect(manager.getScopeEnforcer()).toBeNull();
    });

    it("should return ScopeEnforcer after scope is set", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      await manager.setScope("my-group");

      const enforcer = manager.getScopeEnforcer();
      expect(enforcer).not.toBeNull();
      expect(enforcer?.getScopeDescription()).toContain("my-group");
    });
  });
});
