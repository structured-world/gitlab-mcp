import { milestoneTools, milestoneReadOnlyTools } from "../../../../src/entities/milestones";

/**
 * Milestone Index Exports Tests
 *
 * Tests for backward-compatible exports from the milestones module.
 */
describe("Milestone Index Exports", () => {
  describe("milestoneTools", () => {
    it("should export an array of tool definitions", () => {
      expect(Array.isArray(milestoneTools)).toBe(true);
      expect(milestoneTools.length).toBeGreaterThan(0);
    });

    it("should include browse_milestones tool", () => {
      const browseTool = milestoneTools.find(t => t.name === "browse_milestones");
      expect(browseTool).toBeDefined();
      expect(browseTool?.description).toContain("BROWSE");
    });

    it("should include manage_milestone tool", () => {
      const manageTool = milestoneTools.find(t => t.name === "manage_milestone");
      expect(manageTool).toBeDefined();
      expect(manageTool?.description).toContain("MANAGE");
    });

    it("should have valid tool definition structure", () => {
      for (const tool of milestoneTools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
      }
    });
  });

  describe("milestoneReadOnlyTools", () => {
    it("should export an array of read-only tool names", () => {
      expect(Array.isArray(milestoneReadOnlyTools)).toBe(true);
      expect(milestoneReadOnlyTools.length).toBeGreaterThan(0);
    });

    it("should include browse_milestones as read-only", () => {
      expect(milestoneReadOnlyTools).toContain("browse_milestones");
    });

    it("should not include manage_milestone as read-only", () => {
      expect(milestoneReadOnlyTools).not.toContain("manage_milestone");
    });
  });
});
