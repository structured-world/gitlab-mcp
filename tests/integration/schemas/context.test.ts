/**
 * Context Management Integration Tests
 *
 * Tests the manage_context tool with real GitLab API for auto-detection
 * and scope enforcement functionality.
 */

import { IntegrationTestHelper } from "../helpers/registry-helper";
import { ContextManager } from "../../../src/entities/context/context-manager";
import { ManageContextSchema } from "../../../src/entities/context/schema";

describe("manage_context Integration Tests", () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("Integration test helper initialized for context testing");
  });

  beforeEach(() => {
    // Reset context manager before each test
    ContextManager.resetInstance();
  });

  describe("action: show", () => {
    it("should return current session context", async () => {
      const input = { action: "show" };

      // Validate schema
      const validation = ManageContextSchema.safeParse(input);
      expect(validation.success).toBe(true);

      // Execute tool
      const result = (await helper.executeTool("manage_context", input)) as Record<string, unknown>;

      // Verify response structure
      expect(result).toHaveProperty("host");
      expect(result).toHaveProperty("apiUrl");
      expect(result).toHaveProperty("readOnly");
      expect(result).toHaveProperty("oauthMode");

      // Verify types
      expect(typeof result.host).toBe("string");
      expect(typeof result.apiUrl).toBe("string");
      expect(typeof result.readOnly).toBe("boolean");
      expect(typeof result.oauthMode).toBe("boolean");

      console.log(`  Context retrieved: host=${result.host}, readOnly=${result.readOnly}`);
    });

    it("should include initial context for reset capability", async () => {
      const result = (await helper.executeTool("manage_context", {
        action: "show",
      })) as Record<string, unknown>;

      expect(result).toHaveProperty("initialContext");
      expect(result.initialContext).toHaveProperty("host");
      expect(result.initialContext).toHaveProperty("apiUrl");
    });
  });

  describe("action: list_presets", () => {
    it("should return array of available presets", async () => {
      const result = (await helper.executeTool("manage_context", {
        action: "list_presets",
      })) as Array<Record<string, unknown>>;

      expect(Array.isArray(result)).toBe(true);

      // Should have at least the built-in presets
      if (result.length > 0) {
        const preset = result[0];
        expect(preset).toHaveProperty("name");
        expect(preset).toHaveProperty("isBuiltIn");

        console.log(`  Found ${result.length} presets`);
        result.forEach(p => {
          console.log(`    - ${p.name}: ${p.description || "no description"}`);
        });
      }
    });
  });

  describe("action: switch_preset", () => {
    it("should switch to a valid preset", async () => {
      // First get available presets
      const presets = (await helper.executeTool("manage_context", {
        action: "list_presets",
      })) as Array<Record<string, unknown>>;

      if (presets.length === 0) {
        console.log("  Skipping: no presets available");
        return;
      }

      const presetName = presets[0].name as string;

      // Switch to preset
      const result = (await helper.executeTool("manage_context", {
        action: "switch_preset",
        preset: presetName,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result.current).toBe(presetName);
      expect(result.message).toContain("Switched to preset");

      console.log(`  Switched to preset: ${presetName}`);
    });

    it("should track previous preset on switch", async () => {
      const presets = (await helper.executeTool("manage_context", {
        action: "list_presets",
      })) as Array<Record<string, unknown>>;

      if (presets.length < 2) {
        console.log("  Skipping: need at least 2 presets");
        return;
      }

      // Switch to first preset
      await helper.executeTool("manage_context", {
        action: "switch_preset",
        preset: presets[0].name,
      });

      // Switch to second preset
      const result = (await helper.executeTool("manage_context", {
        action: "switch_preset",
        preset: presets[1].name,
      })) as Record<string, unknown>;

      expect(result.previous).toBe(presets[0].name);
      expect(result.current).toBe(presets[1].name);
    });
  });

  describe("action: set_scope", () => {
    it("should auto-detect group namespace", async () => {
      // Use the test group that exists in the test environment
      const testGroup = "test";

      const result = (await helper.executeTool("manage_context", {
        action: "set_scope",
        namespace: testGroup,
        includeSubgroups: true,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result).toHaveProperty("scope");

      const scope = result.scope as Record<string, unknown>;
      expect(scope.type).toBe("group");
      expect(scope.path).toBe(testGroup);
      expect(scope.includeSubgroups).toBe(true);
      expect(scope.detected).toBe(true);

      console.log(
        `  Scope set to group: ${testGroup} (includeSubgroups: ${scope.includeSubgroups})`
      );
    });

    it("should auto-detect project namespace", async () => {
      // Use a test project that exists in the test environment
      const testProject = "test/backend/project1";

      const result = (await helper.executeTool("manage_context", {
        action: "set_scope",
        namespace: testProject,
        includeSubgroups: true,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result).toHaveProperty("scope");

      const scope = result.scope as Record<string, unknown>;
      expect(scope.type).toBe("project");
      expect(scope.path).toBe(testProject);
      expect(scope.includeSubgroups).toBe(false); // Projects don't have subgroups

      console.log(`  Scope set to project: ${testProject}`);
    });

    it("should respect includeSubgroups=false for groups", async () => {
      const testGroup = "test";

      const result = (await helper.executeTool("manage_context", {
        action: "set_scope",
        namespace: testGroup,
        includeSubgroups: false,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);

      const scope = result.scope as Record<string, unknown>;
      expect(scope.includeSubgroups).toBe(false);

      console.log(`  Scope set to group without subgroups: ${testGroup}`);
    });

    it("should update context with scope information", async () => {
      const testGroup = "test";

      // Set scope
      await helper.executeTool("manage_context", {
        action: "set_scope",
        namespace: testGroup,
        includeSubgroups: true,
      });

      // Get context and verify scope is present
      const context = (await helper.executeTool("manage_context", {
        action: "show",
      })) as Record<string, unknown>;

      expect(context).toHaveProperty("scope");

      const scope = context.scope as Record<string, unknown>;
      expect(scope.type).toBe("group");
      expect(scope.path).toBe(testGroup);
    });
  });

  describe("action: reset", () => {
    it("should reset context to initial state", async () => {
      // Make some changes
      const presets = (await helper.executeTool("manage_context", {
        action: "list_presets",
      })) as Array<Record<string, unknown>>;

      if (presets.length > 0) {
        await helper.executeTool("manage_context", {
          action: "switch_preset",
          preset: presets[0].name,
        });
      }

      await helper.executeTool("manage_context", {
        action: "set_scope",
        namespace: "test",
        includeSubgroups: true,
      });

      // Reset
      const result = (await helper.executeTool("manage_context", {
        action: "reset",
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result.message).toContain("reset to initial state");
      expect(result).toHaveProperty("context");

      // Verify reset state
      const context = result.context as Record<string, unknown>;
      expect(context.presetName).toBeUndefined();
      expect(context.scope).toBeUndefined();

      console.log("  Context reset to initial state");
    });
  });

  describe("schema validation", () => {
    it("should reject unknown actions", async () => {
      const input = { action: "unknown_action" };
      const validation = ManageContextSchema.safeParse(input);
      expect(validation.success).toBe(false);
    });

    it("should reject set_scope without namespace", async () => {
      const input = { action: "set_scope" };
      const validation = ManageContextSchema.safeParse(input);
      expect(validation.success).toBe(false);
    });

    it("should reject switch_preset without preset name", async () => {
      const input = { action: "switch_preset" };
      const validation = ManageContextSchema.safeParse(input);
      expect(validation.success).toBe(false);
    });
  });
});
