import {
  getFilteredMilestonesTools,
  getMilestonesReadOnlyToolNames,
  getMilestonesToolDefinitions,
} from "../../../../src/entities/milestones/registry";

/**
 * Milestone Index Exports Tests
 *
 * Tests the registry functions directly to verify both read-only and full mode.
 */
describe("Milestone Index Exports", () => {
  describe("getMilestonesToolDefinitions (all tools)", () => {
    const allTools = getMilestonesToolDefinitions();

    it("should export an array of tool definitions", () => {
      expect(Array.isArray(allTools)).toBe(true);
      expect(allTools.length).toBe(2); // browse_milestones + manage_milestone
    });

    it("should include browse_milestones tool", () => {
      const browseTool = allTools.find(t => t.name === "browse_milestones");
      expect(browseTool).toBeDefined();
      expect(browseTool?.description).toContain("BROWSE");
    });

    it("should include manage_milestone tool", () => {
      const manageTool = allTools.find(t => t.name === "manage_milestone");
      expect(manageTool).toBeDefined();
      expect(manageTool?.description).toContain("MANAGE");
    });

    it("should have valid tool definition structure", () => {
      for (const tool of allTools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
      }
    });
  });

  describe("getFilteredMilestonesTools (read-only mode)", () => {
    const readOnlyTools = getFilteredMilestonesTools(true);

    it("should return only read-only tools", () => {
      expect(readOnlyTools.length).toBe(1);
    });

    it("should include browse_milestones", () => {
      const browseTool = readOnlyTools.find(t => t.name === "browse_milestones");
      expect(browseTool).toBeDefined();
    });

    it("should NOT include manage_milestone", () => {
      const manageTool = readOnlyTools.find(t => t.name === "manage_milestone");
      expect(manageTool).toBeUndefined();
    });
  });

  describe("getFilteredMilestonesTools (full mode)", () => {
    const fullTools = getFilteredMilestonesTools(false);

    it("should return all tools", () => {
      expect(fullTools.length).toBe(2);
    });

    it("should include both browse and manage tools", () => {
      const names = fullTools.map(t => t.name);
      expect(names).toContain("browse_milestones");
      expect(names).toContain("manage_milestone");
    });
  });

  describe("getMilestonesReadOnlyToolNames", () => {
    const readOnlyNames = getMilestonesReadOnlyToolNames();

    it("should export an array of read-only tool names", () => {
      expect(Array.isArray(readOnlyNames)).toBe(true);
      expect(readOnlyNames.length).toBe(1);
    });

    it("should include browse_milestones as read-only", () => {
      expect(readOnlyNames).toContain("browse_milestones");
    });

    it("should not include manage_milestone as read-only", () => {
      expect(readOnlyNames).not.toContain("manage_milestone");
    });
  });
});
