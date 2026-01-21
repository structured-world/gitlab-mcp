/**
 * Unit tests for context entity index exports
 *
 * Tests the convenience exports from the context entity.
 */

describe("context entity exports", () => {
  // Use dynamic import to test the module
  let contextModule: typeof import("../../../../src/entities/context/index");

  beforeAll(async () => {
    contextModule = await import("../../../../src/entities/context/index");
  });

  describe("contextTools", () => {
    it("should export contextTools array", () => {
      expect(contextModule.contextTools).toBeDefined();
      expect(Array.isArray(contextModule.contextTools)).toBe(true);
    });

    it("should contain tool definitions with required properties", () => {
      contextModule.contextTools.forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
      });
    });

    it("should include manage_context tool", () => {
      const manageContext = contextModule.contextTools.find(t => t.name === "manage_context");
      expect(manageContext).toBeDefined();
    });
  });

  describe("contextReadOnlyTools", () => {
    it("should export contextReadOnlyTools array", () => {
      expect(contextModule.contextReadOnlyTools).toBeDefined();
      expect(Array.isArray(contextModule.contextReadOnlyTools)).toBe(true);
    });

    it("should contain manage_context", () => {
      expect(contextModule.contextReadOnlyTools).toContain("manage_context");
    });
  });

  describe("contextToolRegistry", () => {
    it("should export contextToolRegistry", () => {
      expect(contextModule.contextToolRegistry).toBeDefined();
      expect(contextModule.contextToolRegistry instanceof Map).toBe(true);
    });

    it("should contain manage_context tool", () => {
      expect(contextModule.contextToolRegistry.has("manage_context")).toBe(true);
    });
  });

  describe("type exports", () => {
    it("should export ContextManager", () => {
      expect(contextModule.ContextManager).toBeDefined();
    });

    it("should export getContextManager", () => {
      expect(contextModule.getContextManager).toBeDefined();
      expect(typeof contextModule.getContextManager).toBe("function");
    });

    it("should export handleManageContext", () => {
      expect(contextModule.handleManageContext).toBeDefined();
      expect(typeof contextModule.handleManageContext).toBe("function");
    });

    it("should export ManageContextSchema", () => {
      expect(contextModule.ManageContextSchema).toBeDefined();
    });
  });
});
