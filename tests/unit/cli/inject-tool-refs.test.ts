/**
 * Unit tests for src/cli/inject-tool-refs.ts
 * Tests action extraction from JSON schemas, markdown table generation,
 * marker detection, and file processing logic.
 */

// Mock fs module before imports
jest.mock("fs");

// Mock RegistryManager with configurable return value
const mockGetAllToolDefinitionsUnfiltered = jest.fn().mockReturnValue([]);
jest.mock("../../../src/registry-manager", () => ({
  RegistryManager: {
    getInstance: () => ({
      getAllToolDefinitionsUnfiltered: mockGetAllToolDefinitionsUnfiltered,
    }),
  },
}));

import {
  extractActions,
  generateActionsTable,
  findMarkers,
  processFile,
  main,
} from "../../../src/cli/inject-tool-refs";
import type { JsonSchemaProperty, ActionInfo } from "../../../src/cli/inject-tool-refs";
import * as fs from "fs";
import * as path from "path";

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("inject-tool-refs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("extractActions", () => {
    it("should extract actions from oneOf discriminated union schema", () => {
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "list", description: "List all items" },
            },
          },
          {
            properties: {
              action: { const: "get", description: "Get single item" },
            },
          },
          {
            properties: {
              action: { const: "create", description: "Create new item" },
            },
          },
        ],
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(3);
      expect(actions[0]).toEqual({ name: "list", description: "List all items" });
      expect(actions[1]).toEqual({ name: "get", description: "Get single item" });
      expect(actions[2]).toEqual({ name: "create", description: "Create new item" });
    });

    it("should extract actions from flat enum schema", () => {
      const schema: JsonSchemaProperty = {
        properties: {
          action: {
            enum: ["list", "get", "create"],
          },
        },
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(3);
      // Uses ACTION_DESCRIPTIONS fallback for known actions
      expect(actions[0]).toEqual({
        name: "list",
        description: "List items with filtering and pagination",
      });
      expect(actions[1]).toEqual({ name: "get", description: "Get a single item by ID" });
      expect(actions[2]).toEqual({ name: "create", description: "Create a new item" });
    });

    it("should return empty array for empty schema", () => {
      const schema: JsonSchemaProperty = {};

      const actions = extractActions(schema);

      expect(actions).toHaveLength(0);
    });

    it("should return empty array for schema with no action property", () => {
      const schema: JsonSchemaProperty = {
        properties: {
          project_id: { type: "string" },
          name: { type: "string" },
        },
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(0);
    });

    it("should fall back to ACTION_DESCRIPTIONS when oneOf branch has no description", () => {
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "delete" }, // Known action, no description
            },
          },
          {
            properties: {
              action: { const: "search" }, // Known action, no description
            },
          },
        ],
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual({ name: "delete", description: "Delete an item" });
      expect(actions[1]).toEqual({ name: "search", description: "Search for items" });
    });

    it("should use 'Perform X operation' when action is not in ACTION_DESCRIPTIONS", () => {
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "custom_action" }, // Unknown action, no description
            },
          },
        ],
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        name: "custom_action",
        description: "Perform custom_action operation",
      });
    });

    it("should use 'Perform X operation' for flat enum with unknown actions", () => {
      const schema: JsonSchemaProperty = {
        properties: {
          action: {
            enum: ["custom_action", "another_unknown"],
          },
        },
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual({
        name: "custom_action",
        description: "Perform custom_action operation",
      });
      expect(actions[1]).toEqual({
        name: "another_unknown",
        description: "Perform another_unknown operation",
      });
    });

    it("should skip non-string values in flat enum", () => {
      const schema: JsonSchemaProperty = {
        properties: {
          action: {
            enum: ["list", 123, null, "get", undefined],
          },
        },
      };

      const actions = extractActions(schema);

      // Only string values should be extracted
      expect(actions).toHaveLength(2);
      expect(actions[0].name).toBe("list");
      expect(actions[1].name).toBe("get");
    });

    it("should skip oneOf branches without action.const", () => {
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "list", description: "List items" },
            },
          },
          {
            // Branch with no properties
          },
          {
            properties: {
              // No action property
              name: { type: "string" },
            },
          },
          {
            properties: {
              action: {
                // Action with no const value
                type: "string",
              },
            },
          },
        ],
      };

      const actions = extractActions(schema);

      // Only the first branch has a valid action.const
      expect(actions).toHaveLength(1);
      expect(actions[0].name).toBe("list");
    });

    it("should prefer oneOf over flat enum when both exist", () => {
      // oneOf is checked first, and returns early if found
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "merge", description: "Merge from oneOf" },
            },
          },
        ],
        properties: {
          action: {
            enum: ["list", "get"],
          },
        },
      };

      const actions = extractActions(schema);

      // Should use oneOf results, not enum
      expect(actions).toHaveLength(1);
      expect(actions[0].name).toBe("merge");
    });

    it("should handle all known ACTION_DESCRIPTIONS fallbacks for flat enum", () => {
      const schema: JsonSchemaProperty = {
        properties: {
          action: {
            enum: [
              "list",
              "get",
              "create",
              "update",
              "delete",
              "search",
              "diffs",
              "compare",
              "merge",
              "approve",
              "unapprove",
              "cancel",
              "retry",
              "play",
              "publish",
              "resolve",
              "disable",
              "test",
            ],
          },
        },
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(18);
      expect(actions[0].description).toBe("List items with filtering and pagination");
      expect(actions[1].description).toBe("Get a single item by ID");
      expect(actions[2].description).toBe("Create a new item");
      expect(actions[3].description).toBe("Update an existing item");
      expect(actions[4].description).toBe("Delete an item");
      expect(actions[5].description).toBe("Search for items");
      expect(actions[6].description).toBe("Get file changes/diffs");
      expect(actions[7].description).toBe("Compare two branches or commits");
      expect(actions[8].description).toBe("Merge a merge request");
      expect(actions[9].description).toBe("Approve a merge request");
      expect(actions[10].description).toBe("Remove approval from a merge request");
      expect(actions[11].description).toBe("Cancel a running operation");
      expect(actions[12].description).toBe("Retry a failed operation");
      expect(actions[13].description).toBe("Run a manual job");
      expect(actions[14].description).toBe("Publish draft notes");
      expect(actions[15].description).toBe("Resolve a discussion thread");
      expect(actions[16].description).toBe("Disable the integration");
      expect(actions[17].description).toBe("Test a webhook");
    });

    it("should handle oneOf with description taking priority over ACTION_DESCRIPTIONS", () => {
      const schema: JsonSchemaProperty = {
        oneOf: [
          {
            properties: {
              action: { const: "list", description: "Custom list description" },
            },
          },
        ],
      };

      const actions = extractActions(schema);

      expect(actions).toHaveLength(1);
      // Schema description should take priority over ACTION_DESCRIPTIONS fallback
      expect(actions[0].description).toBe("Custom list description");
    });
  });

  describe("generateActionsTable", () => {
    it("should generate correct markdown table format", () => {
      const actions: ActionInfo[] = [
        { name: "list", description: "List items with filtering and pagination" },
        { name: "get", description: "Get a single item by ID" },
      ];

      const table = generateActionsTable(actions);

      const lines = table.split("\n");
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe("| Action | Description |");
      expect(lines[1]).toBe("|--------|-------------|");
      expect(lines[2]).toBe("| `list` | List items with filtering and pagination |");
      expect(lines[3]).toBe("| `get` | Get a single item by ID |");
    });

    it("should generate table with single action", () => {
      const actions: ActionInfo[] = [{ name: "create", description: "Create a new item" }];

      const table = generateActionsTable(actions);

      const lines = table.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe("| `create` | Create a new item |");
    });

    it("should generate table with many actions", () => {
      const actions: ActionInfo[] = [
        { name: "list", description: "List items" },
        { name: "get", description: "Get item" },
        { name: "create", description: "Create item" },
        { name: "update", description: "Update item" },
        { name: "delete", description: "Delete item" },
      ];

      const table = generateActionsTable(actions);

      const lines = table.split("\n");
      // Header (2 lines) + 5 action rows
      expect(lines).toHaveLength(7);
    });

    it("should handle empty actions array", () => {
      const actions: ActionInfo[] = [];

      const table = generateActionsTable(actions);

      const lines = table.split("\n");
      // Just the header lines, no data rows
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("| Action | Description |");
      expect(lines[1]).toBe("|--------|-------------|");
    });

    it("should properly escape action names with backticks", () => {
      const actions: ActionInfo[] = [{ name: "my_action", description: "My action description" }];

      const table = generateActionsTable(actions);

      expect(table).toContain("| `my_action` | My action description |");
    });

    it("should escape pipe characters in descriptions", () => {
      const actions: ActionInfo[] = [
        { name: "filter", description: "Filter by type | status | priority" },
      ];

      const table = generateActionsTable(actions);

      expect(table).toContain("| `filter` | Filter by type \\| status \\| priority |");
      expect(table).not.toContain("| `filter` | Filter by type | status");
    });
  });

  describe("findMarkers", () => {
    it("should find a single marker in content", () => {
      const content =
        "Some text\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "old content\n" +
        "<!-- @autogen:end -->\n" +
        "more text";

      const markers = findMarkers(content);

      expect(markers).toHaveLength(1);
      expect(markers[0].toolName).toBe("browse_projects");
      expect(markers[0].startIdx).toBe(content.indexOf("<!-- @autogen:tool"));
      expect(markers[0].endIdx).toBe(
        content.indexOf("<!-- @autogen:end -->") + "<!-- @autogen:end -->".length
      );
    });

    it("should find multiple markers in content", () => {
      const content =
        "# Tools\n" +
        "## Projects\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "projects table\n" +
        "<!-- @autogen:end -->\n" +
        "\n" +
        "## Labels\n" +
        "<!-- @autogen:tool manage_label -->\n" +
        "labels table\n" +
        "<!-- @autogen:end -->\n" +
        "footer";

      const markers = findMarkers(content);

      expect(markers).toHaveLength(2);
      expect(markers[0].toolName).toBe("browse_projects");
      expect(markers[1].toolName).toBe("manage_label");
    });

    it("should return empty array when no markers present", () => {
      const content = "# Regular markdown\n\nSome content without markers.\n";

      const markers = findMarkers(content);

      expect(markers).toHaveLength(0);
    });

    it("should throw Error when end tag is missing", () => {
      const content =
        "Some text\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "content without closing tag\n";

      expect(() => findMarkers(content)).toThrow(
        'Missing <!-- @autogen:end --> for tool "browse_projects"'
      );
    });

    it("should correctly identify start and end indices", () => {
      const startTag = "<!-- @autogen:tool test_tool -->";
      const endTag = "<!-- @autogen:end -->";
      const content = `prefix\n${startTag}\ninner content\n${endTag}\nsuffix`;

      const markers = findMarkers(content);

      expect(markers).toHaveLength(1);
      // startIdx should be where the start tag begins
      expect(content.substring(markers[0].startIdx, markers[0].startIdx + startTag.length)).toBe(
        startTag
      );
      // endIdx should be right after the end tag
      expect(content.substring(markers[0].endIdx - endTag.length, markers[0].endIdx)).toBe(endTag);
    });

    it("should handle markers with no content between them", () => {
      const content = "<!-- @autogen:tool my_tool --><!-- @autogen:end -->";

      const markers = findMarkers(content);

      expect(markers).toHaveLength(1);
      expect(markers[0].toolName).toBe("my_tool");
    });

    it("should handle tool names with underscores and hyphens", () => {
      const content =
        "<!-- @autogen:tool browse_merge_requests -->\n" + "content\n" + "<!-- @autogen:end -->";

      const markers = findMarkers(content);

      expect(markers).toHaveLength(1);
      expect(markers[0].toolName).toBe("browse_merge_requests");
    });

    it("should throw for first marker without end when multiple markers exist", () => {
      const contentNoEnd = "<!-- @autogen:tool orphaned_tool -->\n" + "no end tag anywhere";

      expect(() => findMarkers(contentNoEnd)).toThrow(
        'Missing <!-- @autogen:end --> for tool "orphaned_tool"'
      );
    });
  });

  describe("processFile", () => {
    it("should replace marker content with generated action table", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_projects", {
        oneOf: [
          {
            properties: {
              action: { const: "list", description: "List projects" },
            },
          },
          {
            properties: {
              action: { const: "get", description: "Get a project" },
            },
          },
        ],
      });

      const fileContent =
        "# Projects\n\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "old table content\n" +
        "<!-- @autogen:end -->\n\n" +
        "More docs.";

      mockedFs.readFileSync.mockReturnValue(fileContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const result = processFile("/path/to/file.md", toolSchemas);

      expect(result).toBe(true);
      expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);

      // Verify the written content contains the new table
      const writtenContent = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain("| Action | Description |");
      expect(writtenContent).toContain("| `list` | List projects |");
      expect(writtenContent).toContain("| `get` | Get a project |");
      expect(writtenContent).toContain("<!-- @autogen:tool browse_projects -->");
      expect(writtenContent).toContain("<!-- @autogen:end -->");
      // Original content should be replaced
      expect(writtenContent).not.toContain("old table content");
    });

    it("should be idempotent - running twice produces same result", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_labels", {
        properties: {
          action: { enum: ["list", "get"] },
        },
      });

      const originalContent =
        "# Labels\n\n" +
        "<!-- @autogen:tool browse_labels -->\n" +
        "| Action | Description |\n" +
        "|--------|-------------|\n" +
        "| `list` | List items with filtering and pagination |\n" +
        "| `get` | Get a single item by ID |\n" +
        "<!-- @autogen:end -->\n";

      // First call - generate the table
      mockedFs.readFileSync.mockReturnValue(originalContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const result = processFile("/path/to/labels.md", toolSchemas);

      // The content already matches what would be generated, so no write needed
      expect(result).toBe(false);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should return false when no markers are present", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_projects", {
        oneOf: [{ properties: { action: { const: "list" } } }],
      });

      const fileContent = "# Regular file\n\nNo markers here.\n";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      const result = processFile("/path/to/regular.md", toolSchemas);

      expect(result).toBe(false);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should throw when tool name is not in schema map", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_projects", {
        oneOf: [{ properties: { action: { const: "list" } } }],
      });

      const fileContent =
        "<!-- @autogen:tool unknown_tool -->\n" + "content\n" + "<!-- @autogen:end -->\n";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      expect(() => processFile("/path/to/file.md", toolSchemas)).toThrow(
        'Unknown tool "unknown_tool"'
      );
      expect(() => processFile("/path/to/file.md", toolSchemas)).toThrow(
        "Available tools: browse_projects"
      );
    });

    it("should throw when tool has no extractable actions", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      // Schema with no action property at all
      toolSchemas.set("empty_tool", {
        properties: {
          name: { type: "string" },
        },
      });

      const fileContent =
        "<!-- @autogen:tool empty_tool -->\n" + "content\n" + "<!-- @autogen:end -->\n";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      expect(() => processFile("/path/to/file.md", toolSchemas)).toThrow(
        'Tool "empty_tool" has no extractable actions'
      );
    });

    it("should handle multiple markers in a single file", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_projects", {
        oneOf: [{ properties: { action: { const: "list", description: "List projects" } } }],
      });
      toolSchemas.set("manage_label", {
        properties: {
          action: { enum: ["create", "delete"] },
        },
      });

      const fileContent =
        "# Tools\n\n" +
        "## Projects\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "old projects\n" +
        "<!-- @autogen:end -->\n\n" +
        "## Labels\n" +
        "<!-- @autogen:tool manage_label -->\n" +
        "old labels\n" +
        "<!-- @autogen:end -->\n";

      mockedFs.readFileSync.mockReturnValue(fileContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const result = processFile("/path/to/tools.md", toolSchemas);

      expect(result).toBe(true);
      const writtenContent = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;

      // Both tables should be present
      expect(writtenContent).toContain("| `list` | List projects |");
      expect(writtenContent).toContain("| `create` | Create a new item |");
      expect(writtenContent).toContain("| `delete` | Delete an item |");
      // Old content should be replaced
      expect(writtenContent).not.toContain("old projects");
      expect(writtenContent).not.toContain("old labels");
    });

    it("should preserve content outside markers", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_wiki", {
        oneOf: [{ properties: { action: { const: "list", description: "List wiki pages" } } }],
      });

      const prefix = "# Wiki Documentation\n\nIntro paragraph.\n\n";
      const suffix = "\n\nFooter content.\n";
      const fileContent =
        prefix +
        "<!-- @autogen:tool browse_wiki -->\n" +
        "to be replaced\n" +
        "<!-- @autogen:end -->" +
        suffix;

      mockedFs.readFileSync.mockReturnValue(fileContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      processFile("/path/to/wiki.md", toolSchemas);

      const writtenContent = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain("# Wiki Documentation");
      expect(writtenContent).toContain("Intro paragraph.");
      expect(writtenContent).toContain("Footer content.");
    });

    it("should read file with utf8 encoding", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();

      mockedFs.readFileSync.mockReturnValue("no markers here");

      processFile("/path/to/file.md", toolSchemas);

      expect(mockedFs.readFileSync).toHaveBeenCalledWith("/path/to/file.md", "utf8");
    });

    it("should write file with utf8 encoding when modified", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_refs", {
        properties: {
          action: { enum: ["list"] },
        },
      });

      const fileContent = "<!-- @autogen:tool browse_refs -->\nold\n<!-- @autogen:end -->";

      mockedFs.readFileSync.mockReturnValue(fileContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      processFile("/docs/refs.md", toolSchemas);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        "/docs/refs.md",
        expect.any(String),
        "utf8"
      );
    });

    it("should include the file path in error messages for unknown tools", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();

      const fileContent =
        "<!-- @autogen:tool missing_tool -->\n" + "content\n" + "<!-- @autogen:end -->";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      expect(() => processFile("/docs/tools/missing.md", toolSchemas)).toThrow(
        "/docs/tools/missing.md"
      );
    });

    it("should include the file path in error messages for tools with no actions", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("no_actions_tool", { type: "object" });

      const fileContent =
        "<!-- @autogen:tool no_actions_tool -->\n" + "content\n" + "<!-- @autogen:end -->";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      expect(() => processFile("/docs/tools/noactions.md", toolSchemas)).toThrow(
        "/docs/tools/noactions.md"
      );
    });

    it("should use provided content instead of reading file when passed", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_refs", {
        properties: {
          action: { enum: ["list_branches", "get_branch"] },
        },
      });

      const content = "<!-- @autogen:tool browse_refs -->\nold\n<!-- @autogen:end -->";

      mockedFs.writeFileSync.mockImplementation(() => undefined);

      processFile("/docs/refs.md", toolSchemas, content);

      // Should NOT read the file since content was provided
      expect(mockedFs.readFileSync).not.toHaveBeenCalled();
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });

    it("should list available tools in error message when tool is unknown", () => {
      const toolSchemas = new Map<string, JsonSchemaProperty>();
      toolSchemas.set("browse_projects", { oneOf: [] });
      toolSchemas.set("manage_label", { properties: {} });
      toolSchemas.set("browse_wiki", { oneOf: [] });

      const fileContent =
        "<!-- @autogen:tool nonexistent -->\n" + "content\n" + "<!-- @autogen:end -->";

      mockedFs.readFileSync.mockReturnValue(fileContent);

      expect(() => processFile("/file.md", toolSchemas)).toThrow(
        "Available tools: browse_projects, browse_wiki, manage_label"
      );
    });
  });

  describe("main", () => {
    let mockConsoleLog: jest.SpyInstance;
    let mockConsoleError: jest.SpyInstance;
    let mockProcessExit: jest.SpyInstance;
    let mockProcessCwd: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      // Restore default return value after clearAllMocks wipes it
      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([]);
      mockConsoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
      mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      mockProcessExit = jest.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit");
      }) as never);
      mockProcessCwd = jest.spyOn(process, "cwd").mockReturnValue("/project");
    });

    afterEach(() => {
      mockConsoleLog.mockRestore();
      mockConsoleError.mockRestore();
      mockProcessExit.mockRestore();
      mockProcessCwd.mockRestore();
    });

    it("should exit with error when docs/tools/ directory does not exist", () => {
      // package.json exists in cwd, but docs/tools/ does not
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return false;
        return false;
      });

      expect(() => main()).toThrow("process.exit");

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("docs/tools/ directory not found")
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should traverse up directories to find package.json", () => {
      // package.json is not in cwd but in parent
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return false;
        if (pathStr === path.join("/", "package.json")) return true;
        if (pathStr.endsWith(path.join("docs", "tools"))) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([]);
      mockedFs.readdirSync.mockReturnValue([] as never);

      main();

      // Should not exit with error
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it("should process markdown files in docs/tools/ directory", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "browse_projects",
          inputSchema: {
            oneOf: [{ properties: { action: { const: "list", description: "List projects" } } }],
          },
        },
      ]);

      // docs/tools/ has one .md file with a marker
      mockedFs.readdirSync.mockReturnValue(["projects.md", "readme.txt"] as never);

      const mdContent =
        "# Projects\n" +
        "<!-- @autogen:tool browse_projects -->\n" +
        "old\n" +
        "<!-- @autogen:end -->\n";

      mockedFs.readFileSync.mockReturnValue(mdContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      main();

      // Should have processed the file and logged update
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("Updated:"));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("1 marker(s) in 1 file(s), 1 updated")
      );
    });

    it("should log summary with zero updates when no markers found", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([]);
      mockedFs.readdirSync.mockReturnValue(["page.md"] as never);
      mockedFs.readFileSync.mockReturnValue("# No markers\n\nJust text.");

      main();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("0 marker(s) in 1 file(s), 0 updated")
      );
    });

    it("should skip non-markdown files in docs/tools/ directory", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([]);
      // Only .txt file, no .md files
      mockedFs.readdirSync.mockReturnValue(["notes.txt", "data.json"] as never);

      main();

      // No files to process, readFileSync should not be called for processing
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("0 marker(s) in 0 file(s), 0 updated")
      );
    });

    it("should not log update when file content is already up to date", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "browse_labels",
          inputSchema: {
            properties: { action: { enum: ["list"] } },
          },
        },
      ]);

      mockedFs.readdirSync.mockReturnValue(["labels.md"] as never);

      // File already has the correct generated content
      const upToDateContent =
        "# Labels\n" +
        "<!-- @autogen:tool browse_labels -->\n" +
        "| Action | Description |\n" +
        "|--------|-------------|\n" +
        "| `list` | List items with filtering and pagination |\n" +
        "<!-- @autogen:end -->\n";

      mockedFs.readFileSync.mockReturnValue(upToDateContent);

      main();

      // Should count marker but not update
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("1 marker(s) in 1 file(s), 0 updated")
      );
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should handle multiple markdown files with mixed markers", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([
        {
          name: "browse_projects",
          inputSchema: {
            oneOf: [{ properties: { action: { const: "list", description: "List projects" } } }],
          },
        },
      ]);

      mockedFs.readdirSync.mockReturnValue(["projects.md", "overview.md"] as never);

      // First file has marker, second doesn't
      mockedFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = filePath.toString();
        if (pathStr.includes("projects.md")) {
          return "<!-- @autogen:tool browse_projects -->\nold\n<!-- @autogen:end -->";
        }
        return "# Overview\n\nNo markers here.";
      });
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      main();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("1 marker(s) in 2 file(s), 1 updated")
      );
    });

    it("should build toolSchemas map from registry tool definitions", () => {
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === path.join("/project", "package.json")) return true;
        if (pathStr === path.join("/project", "docs", "tools")) return true;
        return false;
      });

      const toolDef = {
        name: "manage_wiki",
        inputSchema: {
          oneOf: [
            { properties: { action: { const: "create", description: "Create wiki page" } } },
            { properties: { action: { const: "update", description: "Update wiki page" } } },
          ],
        },
      };

      mockGetAllToolDefinitionsUnfiltered.mockReturnValue([toolDef]);

      mockedFs.readdirSync.mockReturnValue(["wiki.md"] as never);

      const fileContent = "<!-- @autogen:tool manage_wiki -->\nold\n<!-- @autogen:end -->";

      mockedFs.readFileSync.mockReturnValue(fileContent);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      main();

      // Verify the tool was properly resolved and table generated
      const writtenContent = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain("| `create` | Create wiki page |");
      expect(writtenContent).toContain("| `update` | Update wiki page |");
    });
  });
});
