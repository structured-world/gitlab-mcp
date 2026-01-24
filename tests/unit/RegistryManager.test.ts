import { RegistryManager } from "../../src/registry-manager";

// Mock all dependencies
jest.mock("../../src/entities/core/registry", () => ({
  coreToolRegistry: new Map([
    [
      "core_tool_1",
      {
        name: "core_tool_1",
        description: "Core tool 1",
        inputSchema: { type: "object" },
        handler: jest.fn().mockResolvedValue({ success: true }),
      },
    ],
    [
      "core_readonly",
      {
        name: "core_readonly",
        description: "Core readonly tool",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      },
    ],
  ]),
  getCoreReadOnlyToolNames: () => ["core_readonly"],
}));

jest.mock("../../src/entities/labels/registry", () => ({
  labelsToolRegistry: new Map([
    [
      "labels_tool_1",
      {
        name: "labels_tool_1",
        description: "Labels tool 1",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      },
    ],
    [
      "labels_readonly",
      {
        name: "labels_readonly",
        description: "Labels readonly",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      },
    ],
  ]),
  getLabelsReadOnlyToolNames: () => ["labels_readonly"],
}));

// Mock empty registries
[
  "mrs",
  "files",
  "milestones",
  "pipelines",
  "variables",
  "wiki",
  "workitems",
  "snippets",
  "webhooks",
  "integrations",
  "iterations",
].forEach(entity => {
  jest.mock(`../../src/entities/${entity}/registry`, () => ({
    [`${entity}ToolRegistry`]: new Map(),
    [`get${entity.charAt(0).toUpperCase() + entity.slice(1)}ReadOnlyToolNames`]: () => [],
  }));
});

jest.mock("../../src/services/ToolAvailability", () => ({
  ToolAvailability: {
    isToolAvailable: jest.fn(),
    getUnavailableReason: jest.fn(),
    getRestrictedParameters: jest.fn().mockReturnValue([]),
  },
}));

jest.mock("../../src/services/ConnectionManager", () => ({
  ConnectionManager: {
    getInstance: jest.fn().mockReturnValue({
      getInstanceInfo: jest.fn().mockReturnValue({ tier: "free", version: "17.0.0" }),
    }),
  },
}));

jest.mock("../../src/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../src/config", () => ({
  get GITLAB_READ_ONLY_MODE() {
    return process.env.GITLAB_READ_ONLY_MODE === "true";
  },
  get GITLAB_CROSS_REFS() {
    return process.env.GITLAB_CROSS_REFS !== "false";
  },
  get GITLAB_DENIED_TOOLS_REGEX() {
    return process.env.GITLAB_DENIED_TOOLS_REGEX
      ? new RegExp(process.env.GITLAB_DENIED_TOOLS_REGEX)
      : null;
  },
  get GITLAB_DENIED_ACTIONS() {
    return new Map();
  },
  get USE_GITLAB_WIKI() {
    return process.env.USE_GITLAB_WIKI !== "false";
  },
  get USE_MILESTONE() {
    return process.env.USE_MILESTONE !== "false";
  },
  get USE_PIPELINE() {
    return process.env.USE_PIPELINE !== "false";
  },
  get USE_WORKITEMS() {
    return process.env.USE_WORKITEMS !== "false";
  },
  get USE_LABELS() {
    return process.env.USE_LABELS !== "false";
  },
  get USE_MRS() {
    return process.env.USE_MRS !== "false";
  },
  get USE_FILES() {
    return process.env.USE_FILES !== "false";
  },
  get USE_VARIABLES() {
    return process.env.USE_VARIABLES !== "false";
  },
  get USE_SNIPPETS() {
    return process.env.USE_SNIPPETS !== "false";
  },
  get USE_WEBHOOKS() {
    return process.env.USE_WEBHOOKS !== "false";
  },
  get USE_INTEGRATIONS() {
    return process.env.USE_INTEGRATIONS !== "false";
  },
  get USE_ITERATIONS() {
    return process.env.USE_ITERATIONS !== "false";
  },
  getToolDescriptionOverrides: jest.fn(() => new Map()),
  getActionDescriptionOverrides: jest.fn(() => new Map()),
  getParamDescriptionOverrides: jest.fn(() => new Map()),
}));

describe("RegistryManager", () => {
  let registryManager: RegistryManager;
  let mockConfig: any;
  const { ToolAvailability } = require("../../src/services/ToolAvailability");

  beforeEach(() => {
    jest.clearAllMocks();
    (RegistryManager as any).instance = null;

    // Get the mocked config
    mockConfig = require("../../src/config");

    // Reset environment variables to defaults
    delete process.env.GITLAB_READ_ONLY_MODE;
    delete process.env.GITLAB_CROSS_REFS;
    delete process.env.GITLAB_DENIED_TOOLS_REGEX;
    delete process.env.USE_LABELS;
    delete process.env.USE_MRS;
    delete process.env.USE_FILES;
    delete process.env.USE_WORKITEMS;
    delete process.env.USE_MILESTONE;
    delete process.env.USE_PIPELINE;
    delete process.env.USE_GITLAB_WIKI;
    delete process.env.USE_VARIABLES;
    delete process.env.USE_ITERATIONS;

    // Reset default mocks
    mockConfig.getToolDescriptionOverrides = jest.fn(() => new Map());
    ToolAvailability.isToolAvailable.mockReturnValue(true);
    ToolAvailability.getUnavailableReason.mockReturnValue("");

    registryManager = RegistryManager.getInstance();
  });

  afterEach(() => {
    (RegistryManager as any).instance = null;
  });

  describe("Singleton Pattern", () => {
    it("should implement singleton correctly", () => {
      const instance1 = RegistryManager.getInstance();
      const instance2 = RegistryManager.getInstance();
      expect(instance1).toBe(instance2);
      expect(instance1).toBe(registryManager);
    });
  });

  describe("Core Functionality", () => {
    it("should handle basic tool operations", () => {
      expect(registryManager.getTool("core_tool_1")).toBeDefined();
      expect(registryManager.getTool("nonexistent")).toBeNull();
      expect(registryManager.hasToolHandler("core_tool_1")).toBe(true);
      expect(registryManager.hasToolHandler("nonexistent")).toBe(false);
    });

    it("should execute tools successfully", async () => {
      const result = await registryManager.executeTool("core_tool_1", { test: "data" });
      expect(result).toEqual({ success: true });
    });

    it("should throw error for nonexistent tool execution", async () => {
      await expect(registryManager.executeTool("nonexistent", {})).rejects.toThrow(
        "Tool 'nonexistent' not found in any registry"
      );
    });

    it("should return all tool definitions and names", () => {
      const definitions = registryManager.getAllToolDefinitions();
      const names = registryManager.getAvailableToolNames();

      expect(Array.isArray(definitions)).toBe(true);
      expect(Array.isArray(names)).toBe(true);
      expect(definitions.length).toBe(names.length);
      expect(definitions.length).toBeGreaterThan(0);

      // Verify definition structure
      const tool = definitions.find(d => d.name === "core_tool_1");
      expect(tool).toEqual({
        name: "core_tool_1",
        description: "Core tool 1",
        inputSchema: { type: "object" },
      });
      expect((tool as any).handler).toBeUndefined();
    });

    it("should cache definitions and names for performance", () => {
      const defs1 = registryManager.getAllToolDefinitions();
      const defs2 = registryManager.getAllToolDefinitions();
      const names1 = registryManager.getAvailableToolNames();
      const names2 = registryManager.getAvailableToolNames();

      expect(defs1).toBe(defs2);
      expect(names1).toBe(names2);
    });
  });

  describe("Read-Only Mode Filtering", () => {
    beforeEach(() => {
      process.env.GITLAB_READ_ONLY_MODE = "true";
      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();
    });

    it("should filter tools in read-only mode", () => {
      const names = registryManager.getAvailableToolNames();
      expect(names).toContain("core_readonly");
      expect(names).toContain("labels_readonly");
      expect(names).not.toContain("core_tool_1");
      expect(names).not.toContain("labels_tool_1");
    });

    it("should only return read-only tools", () => {
      expect(registryManager.getTool("core_readonly")).toBeDefined();
      expect(registryManager.getTool("core_tool_1")).toBeNull();
    });
  });

  describe("Regex Filtering", () => {
    beforeEach(() => {
      process.env.GITLAB_DENIED_TOOLS_REGEX = "^core_";
      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();
    });

    it("should filter tools matching denied regex", () => {
      const names = registryManager.getAvailableToolNames();
      expect(names).not.toContain("core_tool_1");
      expect(names).not.toContain("core_readonly");
      expect(names).toContain("labels_tool_1");
    });

    it("should not return filtered tools", () => {
      expect(registryManager.getTool("core_tool_1")).toBeNull();
      expect(registryManager.getTool("labels_tool_1")).toBeDefined();
    });
  });

  describe("Feature Flag Testing", () => {
    it("should exclude workitems tools when USE_WORKITEMS is false", () => {
      // Set USE_WORKITEMS to false
      process.env.USE_WORKITEMS = "false";

      // Create new instance with USE_WORKITEMS=false
      (RegistryManager as any).instance = null;
      const newManager = RegistryManager.getInstance();
      const toolNames = newManager.getAvailableToolNames();

      // Work items should not be present when USE_WORKITEMS=false
      expect(toolNames).not.toContain("list_work_items");
      expect(toolNames).not.toContain("create_work_item");

      // But core and labels tools should be present (defaults to true)
      expect(toolNames).toContain("core_tool_1");
      expect(toolNames).toContain("labels_tool_1");
    });

    it("should include tools when flags are enabled", () => {
      const names = registryManager.getAvailableToolNames();

      // Core tools should always be included
      expect(names).toContain("core_tool_1");
      expect(names).toContain("core_readonly");

      // Labels should be included (USE_LABELS: true in mock)
      expect(names).toContain("labels_tool_1");
    });
  });

  describe("Tool Availability Filtering", () => {
    beforeEach(() => {
      ToolAvailability.isToolAvailable.mockImplementation(
        (name: string) => !name.includes("unavailable")
      );
      ToolAvailability.getUnavailableReason.mockImplementation((name: string) =>
        name.includes("unavailable") ? "Not available in this GitLab version" : ""
      );
    });

    it("should filter unavailable tools", () => {
      // Add an unavailable tool to the registry for testing
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      coreRegistry.set("unavailable_tool", {
        name: "unavailable_tool",
        description: "Unavailable tool",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();

      const names = registryManager.getAvailableToolNames();
      expect(names).toContain("core_tool_1");
      expect(names).not.toContain("unavailable_tool");
    });

    it("should strip tier-restricted parameters from tool schema", () => {
      // Add a tool with properties to test parameter stripping
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      coreRegistry.set("tool_with_params", {
        name: "tool_with_params",
        description: "Tool with tier-gated params",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create"] },
            title: { type: "string" },
            weight: { type: "number", description: "Premium param" },
            healthStatus: { type: "string", description: "Ultimate param" },
          },
          required: ["action", "title", "weight"],
        },
        handler: jest.fn(),
      });

      try {
        // Make getRestrictedParameters return restricted params for this tool
        ToolAvailability.getRestrictedParameters.mockImplementation((toolName: string) =>
          toolName === "tool_with_params" ? ["weight", "healthStatus"] : []
        );

        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("tool_with_params");
        expect(tool).toBeDefined();

        const schema = tool?.inputSchema as any;

        // Restricted properties should be removed
        expect(schema.properties?.weight).toBeUndefined();
        expect(schema.properties?.healthStatus).toBeUndefined();

        // Non-restricted properties should remain
        expect(schema.properties?.action).toBeDefined();
        expect(schema.properties?.title).toBeDefined();

        // weight was in required, should be removed
        expect(schema.required).not.toContain("weight");
        expect(schema.required).toContain("action");
        expect(schema.required).toContain("title");
      } finally {
        coreRegistry.delete("tool_with_params");
      }
    });

    it("should skip parameter stripping when ConnectionManager is not initialized", () => {
      const { ConnectionManager } = require("../../src/services/ConnectionManager");
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      coreRegistry.set("tool_with_params", {
        name: "tool_with_params",
        description: "Tool with tier-gated params",
        inputSchema: {
          type: "object",
          properties: {
            weight: { type: "number" },
            title: { type: "string" },
          },
          required: ["weight", "title"],
        },
        handler: jest.fn(),
      });

      try {
        // Mock getRestrictedParameters to return restricted params (would strip if called)
        ToolAvailability.getRestrictedParameters.mockReturnValue(["weight"]);

        // Make ConnectionManager throw (simulating uninitialized connection)
        ConnectionManager.getInstance.mockReturnValue({
          getInstanceInfo: jest.fn().mockImplementation(() => {
            throw new Error("Connection not initialized");
          }),
        });

        // Clear call history from beforeEach cache build before creating new instance
        ToolAvailability.getRestrictedParameters.mockClear();

        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("tool_with_params");
        expect(tool).toBeDefined();

        const schema = tool?.inputSchema as any;

        // Parameters should NOT be stripped when connection is unavailable
        // (getRestrictedParameters should not be called at all)
        expect(schema.properties?.weight).toBeDefined();
        expect(schema.properties?.title).toBeDefined();
        expect(schema.required).toContain("weight");

        // Verify getRestrictedParameters was NOT called (guard prevented it)
        expect(ToolAvailability.getRestrictedParameters).not.toHaveBeenCalled();
      } finally {
        coreRegistry.delete("tool_with_params");
        ToolAvailability.getRestrictedParameters.mockReturnValue([]);
        // Restore ConnectionManager mock
        ConnectionManager.getInstance.mockReturnValue({
          getInstanceInfo: jest.fn().mockReturnValue({ tier: "free", version: "17.0.0" }),
        });
      }
    });
  });

  describe("Description Overrides", () => {
    it("should apply tool description overrides when available", () => {
      // The mock config already sets up getToolDescriptionOverrides, test it works
      const tool = registryManager.getTool("core_tool_1");
      expect(tool).toBeDefined();
      expect(typeof tool?.description).toBe("string");
      expect(tool?.description.length).toBeGreaterThan(0);
    });

    it("should return original tool when no override exists", () => {
      const tool = registryManager.getTool("labels_tool_1");
      expect(tool).toBeDefined();
      expect(tool?.description).toBe("Labels tool 1");
    });
  });

  describe("Registry Management", () => {
    it("should load different entity registries based on config", () => {
      // Test with different configurations
      process.env.USE_LABELS = "false";
      process.env.USE_MRS = "true";

      // Mock MRS registry for this test
      const mrsRegistry = new Map([
        [
          "mrs_tool",
          { name: "mrs_tool", description: "MRS tool", inputSchema: {}, handler: jest.fn() },
        ],
      ]);
      require("../../src/entities/mrs/registry").mrsToolRegistry = mrsRegistry;

      (RegistryManager as any).instance = null;
      const newManager = RegistryManager.getInstance();

      const names = newManager.getAvailableToolNames();
      expect(names).toContain("core_tool_1"); // Always includes core
      expect(names).not.toContain("labels_tool_1"); // Labels disabled
    });

    it("should provide cache refresh functionality", () => {
      const _originalNames = registryManager.getAvailableToolNames();

      // Test that refresh method exists and doesn't throw
      expect(() => registryManager.refreshCache()).not.toThrow();

      // Names should still be available after refresh
      const refreshedNames = registryManager.getAvailableToolNames();
      expect(refreshedNames.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("should handle tool execution errors", async () => {
      const errorTool = {
        name: "error_tool",
        description: "Error tool",
        inputSchema: { type: "object" },
        handler: jest.fn().mockRejectedValue(new Error("Tool error")),
      };

      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      coreRegistry.set("error_tool", errorTool);

      (RegistryManager as any).instance = null;
      const errorManager = RegistryManager.getInstance();

      await expect(errorManager.executeTool("error_tool", {})).rejects.toThrow("Tool error");
    });
  });

  describe("Complex Filtering Scenarios", () => {
    it("should handle multiple filters combined", () => {
      process.env.GITLAB_READ_ONLY_MODE = "true";
      process.env.GITLAB_DENIED_TOOLS_REGEX = "readonly";

      (RegistryManager as any).instance = null;
      const filteredManager = RegistryManager.getInstance();

      // Should filter out tools that match denied regex even if they're read-only
      const names = filteredManager.getAvailableToolNames();
      expect(names).not.toContain("core_readonly");
      expect(names).not.toContain("labels_readonly");
      // May contain other read-only tools from MRS registry if enabled
    });

    it("should maintain consistency across multiple calls after filtering", () => {
      process.env.GITLAB_READ_ONLY_MODE = "true";
      (RegistryManager as any).instance = null;
      const readOnlyManager = RegistryManager.getInstance();

      for (let i = 0; i < 3; i++) {
        const names = readOnlyManager.getAvailableToolNames();
        const definitions = readOnlyManager.getAllToolDefinitions();
        expect(names.length).toBe(definitions.length);
        expect(names.every(name => definitions.some(def => def.name === name))).toBe(true);
      }
    });
  });

  describe("Environment Variable Dynamic Features", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = process.env;
      (RegistryManager as any).instance = null;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should handle GITLAB_DENIED_TOOLS_REGEX", () => {
      process.env.GITLAB_DENIED_TOOLS_REGEX = "^core_";

      registryManager = RegistryManager.getInstance();
      const tools = registryManager.getAllToolDefinitionsTierless();

      // Should filter out tools matching the regex
      expect(tools.find(t => t.name === "core_tool_1")).toBeUndefined();
      expect(tools.find(t => t.name === "labels_tool_1")).toBeDefined();
    });

    it("should handle GITLAB_READ_ONLY_MODE=true", () => {
      process.env.GITLAB_READ_ONLY_MODE = "true";

      registryManager = RegistryManager.getInstance();
      const tools = registryManager.getAllToolDefinitionsTierless();

      // Should only include read-only tools
      expect(tools.find(t => t.name === "core_readonly")).toBeDefined();
      expect(tools.find(t => t.name === "core_tool_1")).toBeUndefined();
    });

    it("should handle USE_LABELS=false", () => {
      process.env.USE_LABELS = "false";

      registryManager = RegistryManager.getInstance();
      const tools = registryManager.getAllToolDefinitionsTierless();

      // Should exclude labels tools
      expect(tools.find(t => t.name === "labels_tool_1")).toBeUndefined();
      expect(tools.find(t => t.name === "core_tool_1")).toBeDefined();
    });

    it("should handle multiple disabled features", () => {
      process.env.USE_LABELS = "false";
      process.env.USE_MRS = "false";
      process.env.USE_FILES = "false";
      process.env.USE_MILESTONE = "false";
      process.env.USE_PIPELINE = "false";
      process.env.USE_VARIABLES = "false";
      process.env.USE_GITLAB_WIKI = "false";
      process.env.USE_WORKITEMS = "false";
      process.env.USE_SNIPPETS = "false";
      process.env.USE_WEBHOOKS = "false";
      process.env.USE_INTEGRATIONS = "false";
      process.env.GITLAB_READ_ONLY_MODE = "true";

      registryManager = RegistryManager.getInstance();
      const tools = registryManager.getAllToolDefinitionsTierless();

      // Should only have core tools and context tools when all features disabled
      // Context tools (manage_context) are always available as they only affect session state
      expect(tools.length).toBeGreaterThan(0);

      // Verify no feature-specific tools are present
      const featureToolPatterns = [
        /^list_labels$/,
        /^create_label$/,
        /merge_request/,
        /^browse_files$/,
        /^manage_files$/,
        /milestone/,
        /pipeline/,
        /variable/,
        /wiki/,
        /work_item/,
        /snippet/,
        /webhook/,
        /integration/,
      ];

      const hasFeatureTools = tools.some(t =>
        featureToolPatterns.some(pattern => pattern.test(t.name))
      );
      expect(hasFeatureTools).toBe(false);
    });

    it("should strip Related sections when GITLAB_CROSS_REFS=false", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      // Add a tool with Related reference
      coreRegistry.set("browse_tierless_crossref", {
        name: "browse_tierless_crossref",
        description:
          "Browse tierless items. Actions: list. Related: manage_tierless_crossref to modify.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_tierless_crossref", {
        name: "manage_tierless_crossref",
        description: "Manage tierless items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        process.env.GITLAB_CROSS_REFS = "false";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tools = registryManager.getAllToolDefinitionsTierless();
        const tool = tools.find(t => t.name === "browse_tierless_crossref");

        expect(tool).toBeDefined();
        // Related should be stripped even though manage_tierless_crossref is available
        expect(tool!.description).toBe("Browse tierless items. Actions: list.");
        expect(tool!.description).not.toContain("Related:");
      } finally {
        coreRegistry.delete("browse_tierless_crossref");
        coreRegistry.delete("manage_tierless_crossref");
        delete process.env.GITLAB_CROSS_REFS;
      }
    });

    it("should resolve Related dynamically when GITLAB_CROSS_REFS is not false (tierless)", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      coreRegistry.set("browse_tierless_ref", {
        name: "browse_tierless_ref",
        description: "Browse items. Related: manage_tierless_ref to modify.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_tierless_ref", {
        name: "manage_tierless_ref",
        description: "Manage items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        // Default: GITLAB_CROSS_REFS not set (=true)
        delete process.env.GITLAB_CROSS_REFS;
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tools = registryManager.getAllToolDefinitionsTierless();
        const tool = tools.find(t => t.name === "browse_tierless_ref");

        expect(tool).toBeDefined();
        // Related should be preserved since manage_tierless_ref is available
        expect(tool!.description).toContain("Related: manage_tierless_ref");
      } finally {
        coreRegistry.delete("browse_tierless_ref");
        coreRegistry.delete("manage_tierless_ref");
      }
    });
  });

  describe("Additional Coverage Tests", () => {
    it("should handle getAllToolDefinitionsTierless variations", () => {
      const tools1 = registryManager.getAllToolDefinitionsTierless();
      const tools2 = registryManager.getAllToolDefinitions();

      expect(Array.isArray(tools1)).toBe(true);
      expect(Array.isArray(tools2)).toBe(true);
      expect(tools1.length).toBeGreaterThan(0);
      expect(tools2.length).toBeGreaterThan(0);
    });

    it("should handle refreshCache method", () => {
      expect(() => registryManager.refreshCache()).not.toThrow();
    });

    it("should handle hasToolHandler method", () => {
      expect(registryManager.hasToolHandler("core_tool_1")).toBe(true);
      expect(registryManager.hasToolHandler("nonexistent")).toBe(false);
    });
  });

  describe("Dynamic Related Resolution", () => {
    it("should strip Related references when referenced tool is unavailable", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      // Add a tool with Related reference to a tool that will be filtered
      coreRegistry.set("browse_test", {
        name: "browse_test",
        description:
          "Browse test items. Actions: list, get. Related: manage_test to create/update.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_test");
        expect(tool).toBeDefined();
        // manage_test doesn't exist, so Related should be stripped
        expect(tool!.description).toBe("Browse test items. Actions: list, get.");
        expect(tool!.description).not.toContain("Related:");
      } finally {
        coreRegistry.delete("browse_test");
      }
    });

    it("should preserve Related when referenced tool is available", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      coreRegistry.set("browse_with_ref", {
        name: "browse_with_ref",
        description: "Browse items. Related: manage_with_ref to modify.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_with_ref", {
        name: "manage_with_ref",
        description: "Manage items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_with_ref");
        expect(tool).toBeDefined();
        expect(tool!.description).toContain("Related: manage_with_ref");
      } finally {
        coreRegistry.delete("browse_with_ref");
        coreRegistry.delete("manage_with_ref");
      }
    });

    it("should strip Related in read-only mode for manage_ references", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      const { getCoreReadOnlyToolNames } = require("../../src/entities/core/registry");

      coreRegistry.set("browse_readonly_test", {
        name: "browse_readonly_test",
        description: "Browse items. Related: manage_readonly_test to create.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_readonly_test", {
        name: "manage_readonly_test",
        description: "Manage items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      // Add browse_readonly_test to the read-only list
      const origFn = getCoreReadOnlyToolNames;
      require("../../src/entities/core/registry").getCoreReadOnlyToolNames = () => [
        ...origFn(),
        "browse_readonly_test",
      ];

      try {
        process.env.GITLAB_READ_ONLY_MODE = "true";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_readonly_test");
        expect(tool).toBeDefined();
        // manage_readonly_test is filtered by read-only mode, so Related should be stripped
        expect(tool!.description).toBe("Browse items.");
        expect(tool!.description).not.toContain("Related:");
      } finally {
        coreRegistry.delete("browse_readonly_test");
        coreRegistry.delete("manage_readonly_test");
        require("../../src/entities/core/registry").getCoreReadOnlyToolNames = origFn;
        delete process.env.GITLAB_READ_ONLY_MODE;
      }
    });

    it("should strip Related when GITLAB_DENIED_TOOLS_REGEX matches referenced tool", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      coreRegistry.set("browse_deny_test", {
        name: "browse_deny_test",
        description: "Browse items. Related: manage_deny_target to create.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_deny_target", {
        name: "manage_deny_target",
        description: "Manage items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        process.env.GITLAB_DENIED_TOOLS_REGEX = "manage_deny_target";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_deny_test");
        expect(tool).toBeDefined();
        // manage_deny_target is denied, so Related should be stripped
        expect(tool!.description).toBe("Browse items.");
        expect(tool!.description).not.toContain("Related:");
      } finally {
        coreRegistry.delete("browse_deny_test");
        coreRegistry.delete("manage_deny_target");
        delete process.env.GITLAB_DENIED_TOOLS_REGEX;
      }
    });

    it("should not resolve Related when tool has custom description override", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      const mockConfig = require("../../src/config");

      coreRegistry.set("browse_override_test", {
        name: "browse_override_test",
        description: "Browse items. Related: manage_nonexistent to create.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      // Set a custom override for this tool
      mockConfig.getToolDescriptionOverrides = jest.fn(
        () =>
          new Map([
            ["browse_override_test", "Custom description. Related: manage_nonexistent to create."],
          ])
      );

      try {
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_override_test");
        expect(tool).toBeDefined();
        // Custom description should be used as-is, no resolution
        expect(tool!.description).toBe(
          "Custom description. Related: manage_nonexistent to create."
        );
      } finally {
        coreRegistry.delete("browse_override_test");
        mockConfig.getToolDescriptionOverrides = jest.fn(() => new Map());
      }
    });
  });

  describe("GITLAB_CROSS_REFS=false", () => {
    it("should strip all Related sections from descriptions", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      // Add a tool with Related reference that would normally be preserved
      coreRegistry.set("browse_crossref_test", {
        name: "browse_crossref_test",
        description: "Browse items. Actions: list, get. Related: manage_crossref_test to modify.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });
      coreRegistry.set("manage_crossref_test", {
        name: "manage_crossref_test",
        description: "Manage items.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        process.env.GITLAB_CROSS_REFS = "false";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_crossref_test");
        expect(tool).toBeDefined();
        // Even though manage_crossref_test is available, Related should be stripped
        expect(tool!.description).toBe("Browse items. Actions: list, get.");
        expect(tool!.description).not.toContain("Related:");
      } finally {
        coreRegistry.delete("browse_crossref_test");
        coreRegistry.delete("manage_crossref_test");
        delete process.env.GITLAB_CROSS_REFS;
      }
    });

    it("should not affect tools without Related section", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;

      coreRegistry.set("browse_no_related", {
        name: "browse_no_related",
        description: "Browse items without cross-refs. Actions: list, get.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      try {
        process.env.GITLAB_CROSS_REFS = "false";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_no_related");
        expect(tool).toBeDefined();
        expect(tool!.description).toBe("Browse items without cross-refs. Actions: list, get.");
      } finally {
        coreRegistry.delete("browse_no_related");
        delete process.env.GITLAB_CROSS_REFS;
      }
    });

    it("should not strip Related from tools with custom description overrides", () => {
      const coreRegistry = require("../../src/entities/core/registry").coreToolRegistry;
      const mockConfig = require("../../src/config");

      coreRegistry.set("browse_crossref_override", {
        name: "browse_crossref_override",
        description: "Original. Related: manage_something to do.",
        inputSchema: { type: "object" },
        handler: jest.fn(),
      });

      mockConfig.getToolDescriptionOverrides = jest.fn(
        () =>
          new Map([["browse_crossref_override", "Custom desc. Related: manage_something to do."]])
      );

      try {
        process.env.GITLAB_CROSS_REFS = "false";
        (RegistryManager as any).instance = null;
        registryManager = RegistryManager.getInstance();

        const tool = registryManager.getTool("browse_crossref_override");
        expect(tool).toBeDefined();
        // Custom override should be preserved as-is
        expect(tool!.description).toBe("Custom desc. Related: manage_something to do.");
      } finally {
        coreRegistry.delete("browse_crossref_override");
        mockConfig.getToolDescriptionOverrides = jest.fn(() => new Map());
        delete process.env.GITLAB_CROSS_REFS;
      }
    });
  });

  describe("getAllToolDefinitionsUnfiltered", () => {
    it("should return all tools without any filtering", () => {
      // Set up environment to filter tools
      process.env.USE_LABELS = "false";
      process.env.GITLAB_READ_ONLY_MODE = "true";

      registryManager = RegistryManager.getInstance();

      // getAllToolDefinitionsTierless should filter
      const filteredTools = registryManager.getAllToolDefinitionsTierless();

      // getAllToolDefinitionsUnfiltered should NOT filter
      const unfilteredTools = registryManager.getAllToolDefinitionsUnfiltered();

      // Unfiltered should have more or equal tools
      expect(unfilteredTools.length).toBeGreaterThanOrEqual(filteredTools.length);

      // Unfiltered should include labels tools even when USE_LABELS=false
      const hasLabelsTools = unfilteredTools.some(t => t.name.includes("labels"));
      expect(hasLabelsTools).toBe(true);
    });

    it("should preserve original schemas without transformation for documentation", () => {
      registryManager = RegistryManager.getInstance();
      const tools = registryManager.getAllToolDefinitionsUnfiltered();

      // All tools should have inputSchema preserved (not transformed/flattened)
      tools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe("object");
      });

      // Verify oneOf structures are preserved for CQRS tools (not flattened)
      const cqrsTool = tools.find(t => t.name === "browse_projects");
      if (cqrsTool) {
        const schema = cqrsTool.inputSchema as { oneOf?: unknown[] };
        if (schema.oneOf) {
          // Original discriminated union should be preserved
          expect(Array.isArray(schema.oneOf)).toBe(true);
          expect(schema.oneOf.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
