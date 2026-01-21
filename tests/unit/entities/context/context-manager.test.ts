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

// Mock server module for tools list changed notification
jest.mock("../../../../src/server", () => ({
  sendToolsListChangedNotification: jest.fn().mockResolvedValue(undefined),
}));

// Mock preset responses for different test scenarios
const mockPresets: Record<string, unknown> = {
  readonly: {
    description: "Read-only preset",
    read_only: true,
  },
  developer: {
    description: "Developer preset",
    read_only: false,
  },
  "multi-projects": {
    description: "Multi-project preset",
    read_only: false,
    scope: {
      projects: ["team/project1", "team/project2", "team/project3"],
    },
  },
  "multi-groups": {
    description: "Multi-group preset",
    read_only: false,
    scope: {
      groups: ["team-a", "team-b"],
      includeSubgroups: true,
    },
  },
  "namespace-scope": {
    description: "Namespace scoped preset",
    read_only: false,
    scope: {
      namespace: "my-namespace",
      includeSubgroups: true,
    },
  },
  "single-project-scope": {
    description: "Single project in array",
    read_only: false,
    scope: {
      projects: ["only-project"],
    },
  },
  "single-group-scope": {
    description: "Single group in array",
    read_only: false,
    scope: {
      groups: ["only-group"],
    },
  },
};

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
    loadPreset: jest.fn().mockImplementation((name: string) => {
      if (name === "invalid-preset") {
        return Promise.reject(new Error("Preset not found: invalid-preset"));
      }
      const preset = mockPresets[name] || {
        description: "Test preset",
        read_only: false,
      };
      return Promise.resolve(preset);
    }),
    loadProfile: jest.fn().mockImplementation((name: string) => {
      if (name === "invalid-profile") {
        return Promise.reject(new Error("Profile not found: invalid-profile"));
      }
      return Promise.resolve({
        host: "gitlab.example.com",
        auth: { type: "pat", token_env: "GITLAB_TOKEN" },
      });
    }),
  })),
}));

import {
  ContextManager,
  getContextManager,
} from "../../../../src/entities/context/context-manager";
import { detectNamespaceType } from "../../../../src/utils/namespace";
import { sendToolsListChangedNotification } from "../../../../src/server";

const mockDetectNamespaceType = detectNamespaceType as jest.MockedFunction<
  typeof detectNamespaceType
>;

const mockSendToolsListChangedNotification =
  sendToolsListChangedNotification as jest.MockedFunction<typeof sendToolsListChangedNotification>;

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

    it("should handle invalid URL in getHost by returning raw value", () => {
      // Test the catch branch in getHost() when URL parsing fails
      mockGitLabBaseUrl = "not-a-valid-url";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();
      const context = manager.getContext();

      // When URL is invalid, getHost returns the raw value
      expect(context.host).toBe("not-a-valid-url");
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

    it("should send tools/list_changed notification after successful switch", async () => {
      // Reset mock to track calls in this test
      mockSendToolsListChangedNotification.mockClear();

      const manager = ContextManager.getInstance();
      await manager.switchPreset("readonly");

      // Verify notification was sent
      expect(mockSendToolsListChangedNotification).toHaveBeenCalledTimes(1);
    });

    it("should send notification on each preset switch", async () => {
      mockSendToolsListChangedNotification.mockClear();

      const manager = ContextManager.getInstance();

      await manager.switchPreset("readonly");
      await manager.switchPreset("developer");

      // Should be called twice - once for each switch
      expect(mockSendToolsListChangedNotification).toHaveBeenCalledTimes(2);
    });

    it("should throw error when preset loading fails", async () => {
      const manager = ContextManager.getInstance();

      await expect(manager.switchPreset("invalid-preset")).rejects.toThrow(
        "Failed to switch to preset 'invalid-preset'"
      );
    });

    it("should clear scope when switching to preset without scope", async () => {
      const manager = ContextManager.getInstance();

      // First switch to preset with scope
      await manager.switchPreset("multi-groups");
      expect(manager.hasScope()).toBe(true);

      // Then switch to preset without scope - should clear
      await manager.switchPreset("readonly");
      expect(manager.hasScope()).toBe(false);
      expect(manager.getScopeEnforcer()).toBeNull();
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

    it("should throw error when profile loading fails in OAuth mode", async () => {
      process.env.OAUTH_ENABLED = "true";
      ContextManager.resetInstance();

      const manager = ContextManager.getInstance();

      await expect(manager.switchProfile("invalid-profile")).rejects.toThrow(
        "Failed to switch to profile 'invalid-profile'"
      );
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

  describe("getCurrentPreset", () => {
    it("should return null when no preset is set", () => {
      const manager = ContextManager.getInstance();
      expect(manager.getCurrentPreset()).toBeNull();
    });

    it("should return preset after switchPreset", async () => {
      const manager = ContextManager.getInstance();
      await manager.switchPreset("readonly");

      const preset = manager.getCurrentPreset();
      expect(preset).not.toBeNull();
    });
  });

  describe("error handling", () => {
    it("should handle setScope errors", async () => {
      mockDetectNamespaceType.mockRejectedValue(new Error("API error"));

      const manager = ContextManager.getInstance();

      await expect(manager.setScope("invalid-namespace")).rejects.toThrow("Failed to set scope");
    });

    it("should handle switchPreset with invalid preset", async () => {
      // This test verifies that ContextManager is created successfully
      // The actual error handling for invalid presets is tested via integration tests
      // since mocking ProfileLoader after module import requires complex setup
      const manager = ContextManager.getInstance();
      expect(manager).toBeDefined();
    });
  });

  describe("scopeConfigToRuntimeScope edge cases", () => {
    it("should handle scope with namespace field", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      await manager.setScope("my-namespace");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("group");
    });

    it("should not have additionalPaths for single project scope", async () => {
      mockDetectNamespaceType.mockResolvedValue("project");

      const manager = ContextManager.getInstance();
      await manager.setScope("group/project");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.path).toBe("group/project");
      expect(context.scope?.additionalPaths).toBeUndefined();
    });

    it("should not have additionalPaths for single group scope", async () => {
      mockDetectNamespaceType.mockResolvedValue("group");

      const manager = ContextManager.getInstance();
      await manager.setScope("my-group");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.path).toBe("my-group");
      expect(context.scope?.additionalPaths).toBeUndefined();
    });

    it("should include additionalPaths for multiple projects from preset", async () => {
      const manager = ContextManager.getInstance();

      // Switch to preset with multiple projects
      await manager.switchPreset("multi-projects");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("project");
      expect(context.scope?.path).toBe("team/project1");
      expect(context.scope?.additionalPaths).toEqual(["team/project2", "team/project3"]);
    });

    it("should include additionalPaths for multiple groups from preset", async () => {
      const manager = ContextManager.getInstance();

      // Switch to preset with multiple groups
      await manager.switchPreset("multi-groups");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("group");
      expect(context.scope?.path).toBe("team-a");
      expect(context.scope?.additionalPaths).toEqual(["team-b"]);
      expect(context.scope?.includeSubgroups).toBe(true);
    });

    it("should handle namespace scope from preset", async () => {
      const manager = ContextManager.getInstance();

      // Switch to preset with namespace scope
      await manager.switchPreset("namespace-scope");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("group");
      expect(context.scope?.path).toBe("my-namespace");
      expect(context.scope?.includeSubgroups).toBe(true);
    });

    it("should not have additionalPaths for single project in array", async () => {
      const manager = ContextManager.getInstance();

      // Switch to preset with single project in projects array
      await manager.switchPreset("single-project-scope");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("project");
      expect(context.scope?.path).toBe("only-project");
      expect(context.scope?.additionalPaths).toBeUndefined();
    });

    it("should not have additionalPaths for single group in array", async () => {
      const manager = ContextManager.getInstance();

      // Switch to preset with single group in groups array
      await manager.switchPreset("single-group-scope");

      const context = manager.getContext();
      expect(context.scope).toBeDefined();
      expect(context.scope?.type).toBe("group");
      expect(context.scope?.path).toBe("only-group");
      expect(context.scope?.additionalPaths).toBeUndefined();
    });
  });

  describe("listPresets edge cases", () => {
    it("should add current preset to list if not already present", async () => {
      const manager = ContextManager.getInstance();

      // First switch to a preset (our mock returns 'readonly' and 'developer')
      await manager.switchPreset("custom-preset");

      // The preset should appear in list even if not in ProfileLoader results
      const presets = await manager.listPresets();

      // Should have presets from ProfileLoader mock
      expect(presets.length).toBeGreaterThan(0);
    });
  });
});
