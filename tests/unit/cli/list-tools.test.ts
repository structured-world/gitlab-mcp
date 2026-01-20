// Mock registry and console methods at the top
const mockManager = {
  getAllToolDefinitionsTierless: jest.fn(),
  getAllToolDefinitionsUnfiltered: jest.fn(),
};

const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();
const mockProcessExit = jest.fn() as unknown as jest.MockedFunction<typeof process.exit>;

jest.mock("../../../src/registry-manager", () => ({
  RegistryManager: {
    getInstance: () => mockManager,
  },
}));

// Mock console methods
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(mockConsoleLog);
  jest.spyOn(console, "error").mockImplementation(mockConsoleError);
  jest.spyOn(process, "exit").mockImplementation(mockProcessExit);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// Simple test to achieve coverage of the script
describe("list-tools script", () => {
  let originalArgv: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    originalArgv = process.argv;

    // Set up default mock return value
    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "test_tool",
        description: "Test tool description",
        inputSchema: { type: "object" },
      },
    ]);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("should handle simple format output", async () => {
    process.argv = ["node", "list-tools.ts", "--simple"];

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith("test_tool");
  });

  it("should handle json format output", async () => {
    process.argv = ["node", "list-tools.ts", "--json"];

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"name": "test_tool"'));
  });

  it("should handle markdown format output with environment info", async () => {
    process.argv = ["node", "list-tools.ts", "--env"];

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("test_tool"));
  });

  it("should filter tools by entity", async () => {
    process.argv = ["node", "list-tools.ts", "--entity", "core"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "list_projects",
        description: "Core tool description",
        inputSchema: { type: "object" },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockManager.getAllToolDefinitionsTierless).toHaveBeenCalled();
  });

  it("should filter tools by specific tool name", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "specific_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "specific_tool",
        description: "Specific tool description",
        inputSchema: { type: "object" },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockManager.getAllToolDefinitionsTierless).toHaveBeenCalled();
  });

  it("should handle environment variables for filtering", async () => {
    process.env.GITLAB_READ_ONLY_MODE = "true";

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockManager.getAllToolDefinitionsTierless).toHaveBeenCalled();

    delete process.env.GITLAB_READ_ONLY_MODE;
  });

  it("should handle errors gracefully", async () => {
    process.argv = ["node", "list-tools.ts"];

    mockManager.getAllToolDefinitionsTierless.mockImplementation(() => {
      throw new Error("Test error");
    });

    const { main } = await import("../../../src/cli/list-tools");

    // The main function should throw the error, not catch it
    await expect(main()).rejects.toThrow("Test error");

    // The error logging and exit happen in the script execution wrapper,
    // not in the main function itself
    expect(mockManager.getAllToolDefinitionsTierless).toHaveBeenCalled();
  });

  it("should handle complex schema types", async () => {
    process.argv = ["node", "list-tools.ts"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "complex_tool",
        description: "Complex tool with various schema types",
        inputSchema: {
          type: "object",
          properties: {
            stringParam: { type: "string", description: "String parameter" },
            numberParam: { type: "number", description: "Number parameter" },
            arrayParam: {
              type: "array",
              items: { type: "string" },
              description: "Array parameter",
            },
            enumParam: {
              type: "string",
              enum: ["option1", "option2"],
              description: "Enum parameter",
            },
            refParam: {
              $ref: "#/definitions/SomeType",
              description: "Reference parameter",
            },
            objectParam: {
              type: "object",
              properties: {
                nested: { type: "string" },
              },
              description: "Object parameter",
            },
          },
          required: ["stringParam"],
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("complex_tool"));
  });

  it("should handle help flag", async () => {
    process.argv = ["node", "list-tools.ts", "--help"];

    const { main } = await import("../../../src/cli/list-tools");

    // Help should exit the process
    await expect(main()).resolves.toBeUndefined();
    expect(mockProcessExit).toHaveBeenCalledWith(0);
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("GitLab MCP Tool Lister"));
  });

  it("should handle -h flag", async () => {
    process.argv = ["node", "list-tools.ts", "-h"];

    const { main } = await import("../../../src/cli/list-tools");

    await expect(main()).resolves.toBeUndefined();
    expect(mockProcessExit).toHaveBeenCalledWith(0);
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("Usage: yarn list-tools"));
  });

  it("should handle verbose flag", async () => {
    process.argv = ["node", "list-tools.ts", "--verbose"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "verbose_tool",
        description: "Tool for verbose testing",
        inputSchema: {
          type: "object",
          properties: {
            param1: { type: "string", description: "First parameter" },
          },
          required: ["param1"],
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("verbose_tool"));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("**Parameters**:"));
  });

  it("should handle detail flag", async () => {
    process.argv = ["node", "list-tools.ts", "--detail"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "detail_tool",
        description: "Tool for detail testing",
        inputSchema: {
          type: "object",
          properties: {
            detailParam: { type: "string", description: "Detail parameter" },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("detail_tool"));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("**Parameters**:"));
  });

  it("should handle unknown entity error", async () => {
    process.argv = ["node", "list-tools.ts", "--entity", "nonexistent"];

    const { main } = await import("../../../src/cli/list-tools");

    await expect(main()).resolves.toBeUndefined();
    expect(mockConsoleError).toHaveBeenCalledWith("No tools found for entity: nonexistent");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should handle unknown tool error", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "nonexistent_tool"];

    const { main } = await import("../../../src/cli/list-tools");

    await expect(main()).resolves.toBeUndefined();
    expect(mockConsoleError).toHaveBeenCalledWith("Tool not found: nonexistent_tool");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should error when --entity flag has no value", async () => {
    // --entity is the last argument with no value following it
    process.argv = ["node", "list-tools.ts", "--entity"];

    const { main } = await import("../../../src/cli/list-tools");

    await expect(main()).resolves.toBeUndefined();
    expect(mockConsoleError).toHaveBeenCalledWith("Error: --entity flag requires a value.");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should error when --tool flag has no value", async () => {
    // --tool is the last argument with no value following it
    process.argv = ["node", "list-tools.ts", "--tool"];

    const { main } = await import("../../../src/cli/list-tools");

    await expect(main()).resolves.toBeUndefined();
    expect(mockConsoleError).toHaveBeenCalledWith("Error: --tool flag requires a value.");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should handle tools with no parameters", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "no_params_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "no_params_tool",
        description: "Tool with no parameters",
        inputSchema: {
          type: "object",
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith("(no parameters)");
  });

  it("should handle schema with oneOf type", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "oneof_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "oneof_tool",
        description: "Tool with oneOf schema",
        inputSchema: {
          type: "object",
          properties: {
            unionParam: {
              oneOf: [{ type: "string" }, { type: "number" }],
              description: "Union parameter",
            },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("string | number"));
  });

  it("should handle schema with anyOf type", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "anyof_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "anyof_tool",
        description: "Tool with anyOf schema",
        inputSchema: {
          type: "object",
          properties: {
            anyParam: {
              anyOf: [{ type: "string" }, { type: "boolean" }],
              description: "Any parameter",
            },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("string | boolean"));
  });

  it("should handle schema with $ref type", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "ref_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "ref_tool",
        description: "Tool with $ref schema",
        inputSchema: {
          type: "object",
          properties: {
            refParam: {
              $ref: "#/properties/SomeType",
              description: "Reference parameter",
            },
            SomeType: {
              type: "string",
              description: "The referenced type",
            },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("ref_tool"));
  });

  it("should handle schema with enum-only type (no explicit type)", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "enum_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "enum_tool",
        description: "Tool with enum-only schema",
        inputSchema: {
          type: "object",
          properties: {
            enumParam: {
              enum: ["value1", "value2", "value3"],
              description: "Enum without type",
            },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("enum_tool"));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("enum"));
  });

  it("should handle schema with array type items", async () => {
    process.argv = ["node", "list-tools.ts", "--tool", "array_tool"];

    mockManager.getAllToolDefinitionsTierless.mockReturnValue([
      {
        name: "array_tool",
        description: "Tool with array schema",
        inputSchema: {
          type: "object",
          properties: {
            arrayParam: {
              type: "array",
              items: { type: "string" },
              description: "Array of strings",
            },
          },
        },
      },
    ]);

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("array_tool"));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("string[]"));
  });

  it("should show environment info with env flag", async () => {
    process.argv = ["node", "list-tools.ts", "--env"];

    const originalEnv = process.env.GITLAB_READONLY;
    process.env.GITLAB_READONLY = "true";

    const { main } = await import("../../../src/cli/list-tools");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith("=== Environment Configuration ===\n");
    expect(mockConsoleLog).toHaveBeenCalledWith("GITLAB_READONLY: true");

    // Restore environment
    if (originalEnv !== undefined) {
      process.env.GITLAB_READONLY = originalEnv;
    } else {
      delete process.env.GITLAB_READONLY;
    }
  });

  describe("--export mode", () => {
    beforeEach(() => {
      // Set up mock for export mode (uses getAllToolDefinitionsUnfiltered)
      mockManager.getAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "browse_test",
          description: "Test CQRS browse tool",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            oneOf: [
              {
                type: "object",
                properties: {
                  action: { type: "string", const: "list", description: "List items" },
                  page: { type: "integer", description: "Page number" },
                },
                required: ["action"],
              },
              {
                type: "object",
                properties: {
                  action: { type: "string", const: "get", description: "Get single item" },
                  id: { type: "string", description: "Item ID" },
                },
                required: ["action", "id"],
              },
            ],
          },
        },
      ]);
    });

    it("should generate markdown documentation with --export", async () => {
      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Check header
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("# GitLab MCP Tools Reference")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Auto-generated from source code")
      );
    });

    it("should extract actions from oneOf schema", async () => {
      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Check actions table
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("#### Actions"));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("| `list` | List items |")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("| `get` | Get single item |")
      );
    });

    it("should extract parameters grouped by action", async () => {
      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Check parameters section with grouped format
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("#### Parameters"));
      // Action-specific parameters are grouped under their action
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("**Action `get`**:"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("| `id` |"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("**Action `list`**:"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("| `page` |"));
    });

    it("should include table of contents with --toc", async () => {
      process.argv = ["node", "list-tools.ts", "--export", "--toc"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("## Table of Contents"));
    });

    it("should skip examples with --no-examples", async () => {
      process.argv = ["node", "list-tools.ts", "--export", "--no-examples"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Should not contain example JSON block
      const allCalls = mockConsoleLog.mock.calls.flat().join("\n");
      expect(allCalls).not.toContain("#### Example");
    });

    it("should handle flat schema fallback", async () => {
      mockManager.getAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "flat_tool",
          description: "Tool with flat schema",
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["create", "delete"],
                description: "Action to perform",
              },
              name: { type: "string", description: "Item name" },
            },
            required: ["action", "name"],
          },
        },
      ]);

      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Should use ACTION_DESCRIPTIONS fallback for flat schema
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("| `create` |"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("| `delete` |"));
    });

    it("should generate examples with various parameter naming patterns", async () => {
      mockManager.getAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "example_tool",
          description: "Tool with various parameter names",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", const: "test", description: "Test action" },
              project_id: { type: "string", description: "Project ID" },
              group_id: { type: "string", description: "Group ID" },
              namespace: { type: "string", description: "Namespace" },
              merge_request_iid: { type: "string", description: "MR IID" },
              user_id: { type: "string", description: "User ID" },
              title: { type: "string", description: "Title" },
              description: { type: "string", description: "Description" },
              url: { type: "string", description: "URL" },
              content: { type: "string", description: "Content" },
              file_path: { type: "string", description: "File path" },
              ref: { type: "string", description: "Git ref" },
              from: { type: "string", description: "From ref" },
              to: { type: "string", description: "To ref" },
              enabled: { type: "boolean", description: "Enabled flag" },
              count: { type: "integer", description: "Count" },
              items: { type: "array", description: "Items list" },
            },
            required: ["action"],
          },
        },
      ]);

      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      // Verify example was generated (includes various parameter patterns)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("example_tool"));
    });

    it("should handle tool with unknown schema type", async () => {
      mockManager.getAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "unknown_type_tool",
          description: "Tool with unknown schema type",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", const: "test", description: "Test" },
              unknownParam: {
                // No type, no enum, no oneOf/anyOf - should return "unknown"
                description: "Unknown type parameter",
              },
            },
            required: ["action"],
          },
        },
      ]);

      process.argv = ["node", "list-tools.ts", "--export"];

      const { main } = await import("../../../src/cli/list-tools");
      await main();

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("unknown_type_tool"));
    });
  });
});
