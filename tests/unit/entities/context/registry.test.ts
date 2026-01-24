/**
 * Unit tests for context registry
 *
 * Tests the context tool registry exports and functions.
 */

import {
  contextToolRegistry,
  getContextReadOnlyToolNames,
  getContextToolDefinitions,
  getFilteredContextTools,
} from "../../../../src/entities/context/registry";

describe("contextToolRegistry", () => {
  it("should export manage_context tool", () => {
    expect(contextToolRegistry.has("manage_context")).toBe(true);
  });

  it("should have correct tool definition structure", () => {
    const tool = contextToolRegistry.get("manage_context");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("manage_context");
    expect(tool?.description).toContain("session configuration");
    expect(tool?.description).toContain("show");
    expect(tool?.description).toContain("switch_preset");
    expect(tool?.inputSchema).toBeDefined();
    expect(tool?.handler).toBeDefined();
    expect(typeof tool?.handler).toBe("function");
  });
});

describe("getContextReadOnlyToolNames", () => {
  it("should return manage_context as read-only tool", () => {
    const readOnlyTools = getContextReadOnlyToolNames();
    expect(readOnlyTools).toContain("manage_context");
  });

  it("should return array of strings", () => {
    const readOnlyTools = getContextReadOnlyToolNames();
    expect(Array.isArray(readOnlyTools)).toBe(true);
    readOnlyTools.forEach(name => {
      expect(typeof name).toBe("string");
    });
  });
});

describe("getContextToolDefinitions", () => {
  it("should return all context tools", () => {
    const tools = getContextToolDefinitions();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should return tools with required properties", () => {
    const tools = getContextToolDefinitions();
    tools.forEach(tool => {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
    });
  });
});

describe("getFilteredContextTools", () => {
  it("should return all tools when readOnly is false", () => {
    const tools = getFilteredContextTools(false);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should return all tools when readOnly is true (context tools are always available)", () => {
    const tools = getFilteredContextTools(true);
    expect(Array.isArray(tools)).toBe(true);
    // Context tools should be available in read-only mode
    // because they only affect session state, not GitLab data
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should return same tools regardless of readOnly mode", () => {
    const toolsReadOnly = getFilteredContextTools(true);
    const toolsReadWrite = getFilteredContextTools(false);
    expect(toolsReadOnly.length).toBe(toolsReadWrite.length);
  });
});

describe("tool handler", () => {
  it("should execute handler without errors for show action", async () => {
    const tool = contextToolRegistry.get("manage_context");
    expect(tool?.handler).toBeDefined();

    const result = await tool?.handler({ action: "show" });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("host");
  });

  it("should throw error for invalid action", async () => {
    const tool = contextToolRegistry.get("manage_context");
    expect(tool?.handler).toBeDefined();

    await expect(tool?.handler({ action: "invalid" })).rejects.toThrow();
  });
});
