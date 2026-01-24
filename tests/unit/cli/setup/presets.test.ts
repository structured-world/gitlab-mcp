/**
 * Unit tests for setup wizard preset definitions and tool categories
 */

import {
  TOOL_CATEGORIES,
  PRESET_DEFINITIONS,
  getPresetById,
  getCategoryById,
  getToolCount,
  getTotalToolCount,
} from "../../../../src/cli/setup/presets";

describe("setup/presets", () => {
  describe("TOOL_CATEGORIES", () => {
    it("should have at least 10 categories", () => {
      expect(TOOL_CATEGORIES.length).toBeGreaterThanOrEqual(10);
    });

    it("should have unique category IDs", () => {
      const ids = TOOL_CATEGORIES.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should have required fields for each category", () => {
      for (const category of TOOL_CATEGORIES) {
        expect(category.id).toBeTruthy();
        expect(category.name).toBeTruthy();
        expect(category.description).toBeTruthy();
        expect(category.tools.length).toBeGreaterThan(0);
        expect(typeof category.defaultEnabled).toBe("boolean");
      }
    });

    it("should have core category always enabled by default", () => {
      const core = TOOL_CATEGORIES.find(c => c.id === "core");
      expect(core).toBeDefined();
      expect(core!.defaultEnabled).toBe(true);
    });

    it("should have merge-requests enabled by default", () => {
      const mrs = TOOL_CATEGORIES.find(c => c.id === "merge-requests");
      expect(mrs).toBeDefined();
      expect(mrs!.defaultEnabled).toBe(true);
    });

    it("should have webhooks disabled by default", () => {
      const webhooks = TOOL_CATEGORIES.find(c => c.id === "webhooks");
      expect(webhooks).toBeDefined();
      expect(webhooks!.defaultEnabled).toBe(false);
    });

    it("should have variables disabled by default", () => {
      const variables = TOOL_CATEGORIES.find(c => c.id === "variables");
      expect(variables).toBeDefined();
      expect(variables!.defaultEnabled).toBe(false);
    });

    it("should have unique tool names across categories", () => {
      const allTools = TOOL_CATEGORIES.flatMap(c => c.tools);
      expect(new Set(allTools).size).toBe(allTools.length);
    });
  });

  describe("PRESET_DEFINITIONS", () => {
    it("should have at least 5 presets", () => {
      expect(PRESET_DEFINITIONS.length).toBeGreaterThanOrEqual(5);
    });

    it("should have unique preset IDs", () => {
      const ids = PRESET_DEFINITIONS.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should have required fields for each preset", () => {
      for (const preset of PRESET_DEFINITIONS) {
        expect(preset.id).toBeTruthy();
        expect(preset.name).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.enabledCategories.length).toBeGreaterThan(0);
      }
    });

    it("should reference only valid category IDs", () => {
      const validIds = new Set(TOOL_CATEGORIES.map(c => c.id));
      for (const preset of PRESET_DEFINITIONS) {
        for (const catId of preset.enabledCategories) {
          expect(validIds.has(catId)).toBe(true);
        }
      }
    });

    it("should include core categories in developer preset", () => {
      const dev = PRESET_DEFINITIONS.find(p => p.id === "developer");
      expect(dev).toBeDefined();
      expect(dev!.enabledCategories).toContain("core");
      expect(dev!.enabledCategories).toContain("merge-requests");
      expect(dev!.enabledCategories).toContain("work-items");
      expect(dev!.enabledCategories).toContain("pipelines");
    });

    it("should have full-access preset with all categories", () => {
      const fullAccess = PRESET_DEFINITIONS.find(p => p.id === "full-access");
      expect(fullAccess).toBeDefined();
      expect(fullAccess!.enabledCategories.length).toBe(TOOL_CATEGORIES.length);
    });

    it("should have readonly preset without variables/webhooks", () => {
      const readonly = PRESET_DEFINITIONS.find(p => p.id === "readonly");
      expect(readonly).toBeDefined();
      expect(readonly!.enabledCategories).not.toContain("variables");
      expect(readonly!.enabledCategories).not.toContain("webhooks");
      expect(readonly!.enabledCategories).not.toContain("integrations");
    });

    it("should have devops preset with CI/CD tools", () => {
      const devops = PRESET_DEFINITIONS.find(p => p.id === "devops");
      expect(devops).toBeDefined();
      expect(devops!.enabledCategories).toContain("pipelines");
      expect(devops!.enabledCategories).toContain("variables");
      expect(devops!.enabledCategories).toContain("webhooks");
    });

    it("should have code-reviewer preset focused on MRs", () => {
      const reviewer = PRESET_DEFINITIONS.find(p => p.id === "code-reviewer");
      expect(reviewer).toBeDefined();
      expect(reviewer!.enabledCategories).toContain("merge-requests");
      expect(reviewer!.enabledCategories).toContain("files");
      expect(reviewer!.enabledCategories).not.toContain("variables");
      expect(reviewer!.enabledCategories).not.toContain("webhooks");
    });
  });

  describe("getPresetById", () => {
    it("should return preset by ID", () => {
      const result = getPresetById("developer");
      expect(result).toBeDefined();
      expect(result!.id).toBe("developer");
    });

    it("should return undefined for unknown ID", () => {
      const result = getPresetById("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getCategoryById", () => {
    it("should return category by ID", () => {
      const result = getCategoryById("core");
      expect(result).toBeDefined();
      expect(result!.id).toBe("core");
    });

    it("should return undefined for unknown ID", () => {
      const result = getCategoryById("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getToolCount", () => {
    it("should return total tools for given categories", () => {
      const count = getToolCount(["core"]);
      expect(count).toBe(6); // browse_projects, browse_namespaces, browse_events, browse_users, manage_project, manage_namespace
    });

    it("should sum tools across multiple categories", () => {
      const coreCount = getToolCount(["core"]);
      const mrCount = getToolCount(["merge-requests"]);
      const combinedCount = getToolCount(["core", "merge-requests"]);
      expect(combinedCount).toBe(coreCount + mrCount);
    });

    it("should return 0 for empty category list", () => {
      expect(getToolCount([])).toBe(0);
    });

    it("should ignore invalid category IDs", () => {
      expect(getToolCount(["nonexistent"])).toBe(0);
    });
  });

  describe("getTotalToolCount", () => {
    it("should return total tools across all categories", () => {
      const total = getTotalToolCount();
      expect(total).toBeGreaterThan(30); // We have 30+ tools defined
    });

    it("should equal sum of all individual categories", () => {
      const allIds = TOOL_CATEGORIES.map(c => c.id);
      expect(getTotalToolCount()).toBe(getToolCount(allIds));
    });
  });
});
