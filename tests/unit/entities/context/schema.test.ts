/**
 * Unit tests for manage_context schema
 *
 * Tests the ManageContextSchema discriminated union and all action schemas.
 */

import { ManageContextSchema } from "../../../../src/entities/context/schema";

describe("ManageContextSchema", () => {
  describe("action: show", () => {
    it("should parse valid show action", () => {
      const input = { action: "show" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("show");
      }
    });
  });

  describe("action: list_presets", () => {
    it("should parse valid list_presets action", () => {
      const input = { action: "list_presets" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("list_presets");
      }
    });
  });

  describe("action: list_profiles", () => {
    it("should parse valid list_profiles action", () => {
      const input = { action: "list_profiles" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("list_profiles");
      }
    });
  });

  describe("action: switch_preset", () => {
    it("should parse valid switch_preset action with preset name", () => {
      const input = { action: "switch_preset", preset: "readonly" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "switch_preset") {
        expect(result.data.action).toBe("switch_preset");
        expect(result.data.preset).toBe("readonly");
      }
    });

    it("should reject switch_preset without preset name", () => {
      const input = { action: "switch_preset" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject switch_preset with empty preset name", () => {
      const input = { action: "switch_preset", preset: "" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("action: switch_profile", () => {
    it("should parse valid switch_profile action with profile name", () => {
      const input = { action: "switch_profile", profile: "production" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "switch_profile") {
        expect(result.data.action).toBe("switch_profile");
        expect(result.data.profile).toBe("production");
      }
    });

    it("should reject switch_profile without profile name", () => {
      const input = { action: "switch_profile" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject switch_profile with empty profile name", () => {
      const input = { action: "switch_profile", profile: "" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("action: set_scope", () => {
    it("should parse valid set_scope action with namespace", () => {
      const input = { action: "set_scope", namespace: "my-group" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "set_scope") {
        expect(result.data.action).toBe("set_scope");
        expect(result.data.namespace).toBe("my-group");
        // includeSubgroups defaults to true
        expect(result.data.includeSubgroups).toBe(true);
      }
    });

    it("should parse set_scope with includeSubgroups=false", () => {
      const input = { action: "set_scope", namespace: "my-group", includeSubgroups: false };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "set_scope") {
        expect(result.data.action).toBe("set_scope");
        expect(result.data.namespace).toBe("my-group");
        expect(result.data.includeSubgroups).toBe(false);
      }
    });

    it("should parse set_scope with project path", () => {
      const input = { action: "set_scope", namespace: "group/project" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "set_scope") {
        expect(result.data.action).toBe("set_scope");
        expect(result.data.namespace).toBe("group/project");
      }
    });

    it("should reject set_scope without namespace", () => {
      const input = { action: "set_scope" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject set_scope with empty namespace", () => {
      const input = { action: "set_scope", namespace: "" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("action: reset", () => {
    it("should parse valid reset action", () => {
      const input = { action: "reset" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("reset");
      }
    });
  });

  describe("invalid actions", () => {
    it("should reject unknown action", () => {
      const input = { action: "unknown" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject empty action", () => {
      const input = { action: "" };
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const input = {};
      const result = ManageContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
