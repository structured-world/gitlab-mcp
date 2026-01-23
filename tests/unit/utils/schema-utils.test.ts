/**
 * Unit tests for schema-utils.ts
 * Tests schema transformation utilities for discriminated unions
 */

import {
  filterDiscriminatedUnionActions,
  flattenDiscriminatedUnion,
  applyDescriptionOverrides,
  transformToolSchema,
  stripTierRestrictedParameters,
  shouldRemoveTool,
  extractActionsFromSchema,
  setDetectedSchemaMode,
  clearDetectedSchemaMode,
} from "../../../src/utils/schema-utils";

// Mock config module
jest.mock("../../../src/config", () => ({
  GITLAB_DENIED_ACTIONS: new Map(),
  GITLAB_SCHEMA_MODE: "flat", // Default to flat for tests expecting flattened output
  getActionDescriptionOverrides: jest.fn(() => new Map()),
  getParamDescriptionOverrides: jest.fn(() => new Map()),
  detectSchemaMode: jest.fn((clientName?: string) => {
    const name = clientName?.toLowerCase() ?? "";
    // Match actual implementation: exact match or dash-prefix
    if (
      name === "inspector" ||
      name.startsWith("inspector-") ||
      name === "mcp-inspector" ||
      name.startsWith("mcp-inspector-")
    ) {
      return "discriminated";
    }
    return "flat";
  }),
}));

// Mock logger
jest.mock("../../../src/logger", () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  GITLAB_DENIED_ACTIONS,
  getActionDescriptionOverrides,
  getParamDescriptionOverrides,
} from "../../../src/config";

const mockGetActionDescriptionOverrides = getActionDescriptionOverrides as jest.Mock;
const mockGetParamDescriptionOverrides = getParamDescriptionOverrides as jest.Mock;

// Type for JSON Schema in tests
interface TestJSONSchema {
  $schema?: string;
  type?: string;
  oneOf?: TestJSONSchema[];
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
  [key: string]: unknown;
}

// Sample discriminated union schema (like manage_milestone would have)
const discriminatedUnionSchema: TestJSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  oneOf: [
    {
      type: "object",
      properties: {
        action: { const: "create" },
        namespace: { type: "string", description: "Namespace path" },
        title: { type: "string", description: "Milestone title" },
        description: { type: "string", description: "Milestone description" },
      },
      required: ["action", "namespace", "title"],
    },
    {
      type: "object",
      properties: {
        action: { const: "update" },
        namespace: { type: "string", description: "Namespace path" },
        milestone_id: { type: "string", description: "Milestone ID" },
        title: { type: "string", description: "New title" },
        state_event: { type: "string", enum: ["close", "activate"] },
      },
      required: ["action", "namespace", "milestone_id"],
    },
    {
      type: "object",
      properties: {
        action: { const: "delete" },
        namespace: { type: "string", description: "Namespace path" },
        milestone_id: { type: "string", description: "Milestone ID" },
      },
      required: ["action", "namespace", "milestone_id"],
    },
    {
      type: "object",
      properties: {
        action: { const: "promote" },
        namespace: { type: "string", description: "Namespace path" },
        milestone_id: { type: "string", description: "Milestone ID" },
      },
      required: ["action", "namespace", "milestone_id"],
    },
  ],
};

// Sample flat schema (current format)
const flatSchema: TestJSONSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["create", "update", "delete", "promote"],
      description: "Action to perform",
    },
    namespace: { type: "string", description: "Namespace path" },
    milestone_id: { type: "string", description: "Milestone ID" },
    title: { type: "string", description: "Title" },
  },
  required: ["action", "namespace"],
};

describe("schema-utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset GITLAB_DENIED_ACTIONS
    GITLAB_DENIED_ACTIONS.clear();
    mockGetActionDescriptionOverrides.mockReturnValue(new Map());
    mockGetParamDescriptionOverrides.mockReturnValue(new Map());
  });

  describe("filterDiscriminatedUnionActions", () => {
    it("should return schema unchanged when no denied actions", () => {
      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "manage_milestone");
      expect(result.oneOf).toHaveLength(4);
    });

    it("should return schema unchanged when tool has no denied actions", () => {
      GITLAB_DENIED_ACTIONS.set("other_tool", new Set(["delete"]));

      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "manage_milestone");
      expect(result.oneOf).toHaveLength(4);
    });

    it("should filter out denied action branches", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete"]));

      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "manage_milestone");

      expect(result.oneOf).toHaveLength(3);
      const actions = result.oneOf!.map(b => b.properties?.action?.const);
      expect(actions).toContain("create");
      expect(actions).toContain("update");
      expect(actions).toContain("promote");
      expect(actions).not.toContain("delete");
    });

    it("should filter multiple denied actions", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete", "promote"]));

      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "manage_milestone");

      expect(result.oneOf).toHaveLength(2);
      const actions = result.oneOf!.map(b => b.properties?.action?.const);
      expect(actions).toContain("create");
      expect(actions).toContain("update");
    });

    it("should return empty schema when all actions denied", () => {
      GITLAB_DENIED_ACTIONS.set(
        "manage_milestone",
        new Set(["create", "update", "delete", "promote"])
      );

      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "manage_milestone");

      expect(result.type).toBe("object");
      expect(result.properties).toEqual({});
    });

    it("should be case-insensitive for tool name lookup", () => {
      // Real config parsing normalizes to lowercase, so Set contains lowercase values
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete"]));

      // Tool name lookup should be case-insensitive
      const result = filterDiscriminatedUnionActions(discriminatedUnionSchema, "MANAGE_MILESTONE");

      expect(result.oneOf).toHaveLength(3);
      const actions = result.oneOf!.map(b => b.properties?.action?.const);
      expect(actions).not.toContain("delete");
    });

    it("should return non-discriminated-union schema unchanged", () => {
      const result = filterDiscriminatedUnionActions(flatSchema, "manage_milestone");
      expect(result).toEqual(flatSchema);
    });

    it("should filter branches with enum action (not const)", () => {
      // Schema with action defined as enum instead of const
      const schemaWithEnumAction: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { enum: ["list"] },
              namespace: { type: "string" },
            },
            required: ["action", "namespace"],
          },
          {
            type: "object",
            properties: {
              action: { enum: ["get"] },
              namespace: { type: "string" },
              id: { type: "string" },
            },
            required: ["action", "namespace", "id"],
          },
        ],
      };

      GITLAB_DENIED_ACTIONS.set("test_tool", new Set(["list"]));

      const result = filterDiscriminatedUnionActions(schemaWithEnumAction, "test_tool");

      expect(result.oneOf).toHaveLength(1);
      expect(result.oneOf![0].properties?.action?.enum).toEqual(["get"]);
    });

    it("should keep branch when action property has no const or enum", () => {
      // Schema with branch that has no identifiable action
      const schemaWithNoActionValue: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { type: "string" }, // No const or enum
              namespace: { type: "string" },
            },
            required: ["action", "namespace"],
          },
          {
            type: "object",
            properties: {
              action: { const: "delete" },
              namespace: { type: "string" },
            },
            required: ["action", "namespace"],
          },
        ],
      };

      GITLAB_DENIED_ACTIONS.set("test_tool", new Set(["delete"]));

      const result = filterDiscriminatedUnionActions(schemaWithNoActionValue, "test_tool");

      // Should keep the branch without identifiable action
      expect(result.oneOf).toHaveLength(1);
      expect(result.oneOf![0].properties?.action?.type).toBe("string");
    });

    it("should keep branch without action property", () => {
      const schemaWithMissingAction: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              namespace: { type: "string" }, // No action property at all
            },
            required: ["namespace"],
          },
          {
            type: "object",
            properties: {
              action: { const: "delete" },
              namespace: { type: "string" },
            },
            required: ["action", "namespace"],
          },
        ],
      };

      GITLAB_DENIED_ACTIONS.set("test_tool", new Set(["delete"]));

      const result = filterDiscriminatedUnionActions(schemaWithMissingAction, "test_tool");

      // Should keep the branch without action property
      expect(result.oneOf).toHaveLength(1);
      expect(result.oneOf![0].properties?.action).toBeUndefined();
    });
  });

  describe("flattenDiscriminatedUnion", () => {
    it("should return non-union schema unchanged", () => {
      const result = flattenDiscriminatedUnion(flatSchema);
      expect(result).toEqual(flatSchema);
    });

    it("should merge all branches into flat schema", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);

      expect(result.type).toBe("object");
      expect(result.oneOf).toBeUndefined();
      expect(result.properties).toBeDefined();
    });

    it("should create action enum from all branches", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);

      expect(result.properties?.action?.enum).toEqual(
        expect.arrayContaining(["create", "update", "delete", "promote"])
      );
    });

    it("should include all properties from all branches", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);

      expect(result.properties).toHaveProperty("namespace");
      expect(result.properties).toHaveProperty("milestone_id");
      expect(result.properties).toHaveProperty("title");
      expect(result.properties).toHaveProperty("state_event");
      expect(result.properties).toHaveProperty("description");
    });

    it("should mark only shared required properties as required", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);

      // 'action' and 'namespace' are required in all branches
      expect(result.required).toContain("action");
      expect(result.required).toContain("namespace");

      // 'milestone_id' is not required in 'create' branch
      expect(result.required).not.toContain("milestone_id");

      // 'title' is not required in all branches
      expect(result.required).not.toContain("title");
    });

    it("should handle branches with enum action values", () => {
      // Schema where action is defined with enum instead of const
      const schemaWithEnumAction: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { enum: ["list", "search"] }, // Multiple values in enum
              namespace: { type: "string", description: "Namespace path" },
            },
            required: ["action", "namespace"],
          },
          {
            type: "object",
            properties: {
              action: { const: "get" },
              namespace: { type: "string", description: "Namespace path" },
              id: { type: "string", description: "Item ID" },
            },
            required: ["action", "namespace", "id"],
          },
        ],
      };

      const result = flattenDiscriminatedUnion(schemaWithEnumAction);

      // Should include all action values from both enum and const
      expect(result.properties?.action?.enum).toContain("list");
      expect(result.properties?.action?.enum).toContain("search");
      expect(result.properties?.action?.enum).toContain("get");
      expect(result.properties?.action?.enum).toHaveLength(3);
    });

    it("should take longer description when merging duplicate properties", () => {
      const schemaWithDiffDescriptions: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { const: "create" },
              name: { type: "string", description: "Short" },
            },
            required: ["action", "name"],
          },
          {
            type: "object",
            properties: {
              action: { const: "update" },
              name: { type: "string", description: "A much longer description for the name field" },
            },
            required: ["action", "name"],
          },
        ],
      };

      const result = flattenDiscriminatedUnion(schemaWithDiffDescriptions);

      // Should use the longer description
      expect(result.properties?.name?.description).toBe(
        "A much longer description for the name field"
      );
    });

    it("should annotate action-specific params with Required for using enum action", () => {
      // Schema where some branches use enum for action
      const schemaWithEnumBranch: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { enum: ["list"] },
              namespace: { type: "string", description: "Namespace path" },
              per_page: { type: "number", description: "Items per page" },
            },
            required: ["action", "namespace"],
          },
          {
            type: "object",
            properties: {
              action: { const: "get" },
              namespace: { type: "string", description: "Namespace path" },
              id: { type: "string", description: "Item ID" },
            },
            required: ["action", "namespace", "id"],
          },
        ],
      };

      const result = flattenDiscriminatedUnion(schemaWithEnumBranch);

      // per_page is only in 'list' branch (with enum action), should have annotation
      expect(result.properties?.per_page?.description).toContain("Required for 'list' action(s).");
      // id is only in 'get' branch (with const action), should have annotation
      expect(result.properties?.id?.description).toContain("Required for 'get' action(s).");
    });

    it("should preserve $schema if present", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);
      expect(result.$schema).toBe("http://json-schema.org/draft-07/schema#");
    });

    it("should add action descriptions to branch-specific params", () => {
      const result = flattenDiscriminatedUnion(discriminatedUnionSchema);

      // state_event is only in 'update' branch
      const stateEventDesc = result.properties?.state_event?.description ?? "";
      expect(stateEventDesc).toContain("update");
    });
  });

  describe("applyDescriptionOverrides", () => {
    it("should return schema unchanged when no overrides", () => {
      const result = applyDescriptionOverrides(flatSchema, "manage_milestone");
      expect(result.properties?.namespace?.description).toBe("Namespace path");
    });

    it("should apply parameter description overrides", () => {
      mockGetParamDescriptionOverrides.mockReturnValue(
        new Map([["manage_milestone:namespace", "Custom namespace description"]])
      );

      const result = applyDescriptionOverrides(flatSchema, "manage_milestone");

      expect(result.properties?.namespace?.description).toBe("Custom namespace description");
    });

    it("should apply action description override", () => {
      mockGetActionDescriptionOverrides.mockReturnValue(
        new Map([["manage_milestone:action", "Custom action description"]])
      );

      const result = applyDescriptionOverrides(flatSchema, "manage_milestone");

      expect(result.properties?.action?.description).toBe("Custom action description");
    });

    it("should apply multiple overrides", () => {
      mockGetParamDescriptionOverrides.mockReturnValue(
        new Map([
          ["manage_milestone:namespace", "NS"],
          ["manage_milestone:title", "T"],
        ])
      );

      const result = applyDescriptionOverrides(flatSchema, "manage_milestone");

      expect(result.properties?.namespace?.description).toBe("NS");
      expect(result.properties?.title?.description).toBe("T");
    });

    it("should be case-insensitive for tool name", () => {
      mockGetParamDescriptionOverrides.mockReturnValue(
        new Map([["manage_milestone:namespace", "Overridden"]])
      );

      const result = applyDescriptionOverrides(flatSchema, "MANAGE_MILESTONE");

      expect(result.properties?.namespace?.description).toBe("Overridden");
    });
  });

  describe("transformToolSchema", () => {
    it("should apply full pipeline for discriminated union", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete", "promote"]));
      mockGetParamDescriptionOverrides.mockReturnValue(
        new Map([["manage_milestone:namespace", "Path"]])
      );

      const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

      // Should be flattened
      expect(result.oneOf).toBeUndefined();
      expect(result.type).toBe("object");

      // Should have filtered actions
      expect(result.properties?.action?.enum).toEqual(expect.arrayContaining(["create", "update"]));
      expect(result.properties?.action?.enum).not.toContain("delete");
      expect(result.properties?.action?.enum).not.toContain("promote");

      // Should have applied description override
      expect(result.properties?.namespace?.description).toBe("Path");
    });

    it("should handle flat schema with action filtering", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete"]));

      const result = transformToolSchema("manage_milestone", flatSchema);

      expect(result.properties?.action?.enum).toEqual(
        expect.arrayContaining(["create", "update", "promote"])
      );
      expect(result.properties?.action?.enum).not.toContain("delete");
    });

    it("should return flat schema unchanged when no denied actions configured", () => {
      // No denied actions set - GITLAB_DENIED_ACTIONS is empty (cleared in beforeEach)

      const result = transformToolSchema("manage_milestone", flatSchema);

      // Should return schema unchanged
      expect(result.properties?.action?.enum).toEqual(
        expect.arrayContaining(["create", "update", "delete", "promote"])
      );
    });

    it("should warn but not modify flat schema when all actions are denied", () => {
      GITLAB_DENIED_ACTIONS.set(
        "manage_milestone",
        new Set(["create", "update", "delete", "promote"])
      );

      const result = transformToolSchema("manage_milestone", flatSchema);

      // When all actions denied from flat schema, code logs warning but returns schema unchanged
      // (unlike discriminated union which returns empty schema)
      expect(result.properties?.action?.enum).toEqual(["create", "update", "delete", "promote"]);
    });

    it("should preserve oneOf when GITLAB_SCHEMA_MODE is discriminated", () => {
      // Override schema mode to discriminated
      const configModule = jest.requireMock("../../../src/config");
      const originalMode = configModule.GITLAB_SCHEMA_MODE;
      configModule.GITLAB_SCHEMA_MODE = "discriminated";

      try {
        const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

        // Should NOT be flattened - oneOf should be preserved
        expect(result.oneOf).toBeDefined();
        expect(Array.isArray(result.oneOf)).toBe(true);
        expect(result.oneOf!.length).toBeGreaterThan(0);

        // Flat schema properties should NOT exist at root level
        expect(result.properties?.action?.enum).toBeUndefined();
      } finally {
        // Restore original mode
        configModule.GITLAB_SCHEMA_MODE = originalMode;
      }
    });

    it("should filter denied actions but preserve oneOf in discriminated mode", () => {
      // Override schema mode to discriminated
      const configModule = jest.requireMock("../../../src/config");
      const originalMode = configModule.GITLAB_SCHEMA_MODE;
      configModule.GITLAB_SCHEMA_MODE = "discriminated";

      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete", "promote"]));

      try {
        const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

        // Should preserve oneOf structure
        expect(result.oneOf).toBeDefined();

        // But with fewer branches (delete and promote filtered out)
        const actionValues = result.oneOf!.map(
          branch => branch.properties?.action?.const || branch.properties?.action?.enum?.[0]
        );
        expect(actionValues).toContain("create");
        expect(actionValues).toContain("update");
        expect(actionValues).not.toContain("delete");
        expect(actionValues).not.toContain("promote");
      } finally {
        configModule.GITLAB_SCHEMA_MODE = originalMode;
      }
    });
  });

  describe("shouldRemoveTool", () => {
    it("should return false when no denied actions", () => {
      const result = shouldRemoveTool("manage_milestone", ["create", "update", "delete"]);
      expect(result).toBe(false);
    });

    it("should return false when some actions allowed", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete"]));

      const result = shouldRemoveTool("manage_milestone", ["create", "update", "delete"]);
      expect(result).toBe(false);
    });

    it("should return true when all actions denied", () => {
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["create", "update", "delete"]));

      const result = shouldRemoveTool("manage_milestone", ["create", "update", "delete"]);
      expect(result).toBe(true);
    });

    it("should be case-insensitive for tool name", () => {
      // Real config parsing normalizes to lowercase, so Set contains lowercase values
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["create", "update", "delete"]));

      // Tool name lookup should be case-insensitive
      const result = shouldRemoveTool("MANAGE_MILESTONE", ["create", "update", "delete"]);
      expect(result).toBe(true);
    });
  });

  describe("extractActionsFromSchema", () => {
    it("should extract actions from flat schema enum", () => {
      const actions = extractActionsFromSchema(flatSchema);
      expect(actions).toEqual(["create", "update", "delete", "promote"]);
    });

    it("should extract actions from discriminated union", () => {
      const actions = extractActionsFromSchema(discriminatedUnionSchema);
      expect(actions).toEqual(["create", "update", "delete", "promote"]);
    });

    it("should return empty array for schema without actions", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const actions = extractActionsFromSchema(schema);
      expect(actions).toEqual([]);
    });

    it("should handle schema with enum action (not const)", () => {
      const schemaWithEnum = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { enum: ["list"] },
              namespace: { type: "string" },
            },
          },
        ],
      };

      const actions = extractActionsFromSchema(schemaWithEnum);
      expect(actions).toEqual(["list"]);
    });
  });

  describe("Integration: Parameter Removal with Discriminated Union", () => {
    it("should remove exclusive parameters when filtering actions", () => {
      // When we deny 'delete' and 'promote', and only 'create' remains,
      // milestone_id should be removed because it's only used by update/delete/promote
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["update", "delete", "promote"]));

      const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

      // Only 'create' action remains
      expect(result.properties?.action?.enum).toEqual(["create"]);

      // 'create' branch doesn't have milestone_id, so it should not be in flattened schema
      // But namespace, title, description should be present (from create branch)
      expect(result.properties).toHaveProperty("namespace");
      expect(result.properties).toHaveProperty("title");
      expect(result.properties).toHaveProperty("description");

      // milestone_id and state_event should NOT be present (only in filtered-out branches)
      expect(result.properties).not.toHaveProperty("milestone_id");
      expect(result.properties).not.toHaveProperty("state_event");
    });

    it("should keep shared parameters when some actions remain", () => {
      // When we deny only 'delete', update/create/promote remain
      // milestone_id should still be present (used by update and promote)
      GITLAB_DENIED_ACTIONS.set("manage_milestone", new Set(["delete"]));

      const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

      expect(result.properties?.action?.enum).toHaveLength(3);
      expect(result.properties).toHaveProperty("milestone_id"); // Still used by update, promote
      expect(result.properties).toHaveProperty("namespace"); // Shared by all
    });
  });

  describe("Auto-detection schema mode (GITLAB_SCHEMA_MODE=auto)", () => {
    beforeEach(() => {
      clearDetectedSchemaMode();
    });

    afterEach(() => {
      clearDetectedSchemaMode();
    });

    it("should use flat mode by default when auto mode not configured", () => {
      // With default mock (GITLAB_SCHEMA_MODE=flat), setDetectedSchemaMode should be no-op
      setDetectedSchemaMode("mcp-inspector");

      // Should still flatten because mode is not 'auto'
      const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);
      expect(result.oneOf).toBeUndefined();
      expect(result.properties?.action?.enum).toBeDefined();
    });

    it("should use detected mode when GITLAB_SCHEMA_MODE is auto", () => {
      // Override to auto mode
      const configModule = jest.requireMock("../../../src/config");
      const originalMode = configModule.GITLAB_SCHEMA_MODE;
      configModule.GITLAB_SCHEMA_MODE = "auto";

      try {
        // Simulate detection of inspector client
        setDetectedSchemaMode("mcp-inspector");

        const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

        // Should preserve oneOf because inspector supports discriminated unions
        expect(result.oneOf).toBeDefined();
      } finally {
        configModule.GITLAB_SCHEMA_MODE = originalMode;
        clearDetectedSchemaMode();
      }
    });

    it("should fall back to flat when auto mode but no client detected", () => {
      // Override to auto mode
      const configModule = jest.requireMock("../../../src/config");
      const originalMode = configModule.GITLAB_SCHEMA_MODE;
      configModule.GITLAB_SCHEMA_MODE = "auto";

      try {
        // Don't call setDetectedSchemaMode - simulates pre-initialization

        const result = transformToolSchema("manage_milestone", discriminatedUnionSchema);

        // Should flatten because no client detected yet (fallback to flat)
        expect(result.oneOf).toBeUndefined();
        expect(result.properties?.action?.enum).toBeDefined();
      } finally {
        configModule.GITLAB_SCHEMA_MODE = originalMode;
      }
    });
  });

  describe("stripTierRestrictedParameters", () => {
    // Flat schema with tier-gated parameters
    const flatSchemaWithParams: TestJSONSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update"] },
        namespace: { type: "string", description: "Namespace path" },
        title: { type: "string", description: "Title" },
        weight: { type: "number", description: "Work item weight" },
        iterationId: { type: "string", description: "Iteration ID" },
        healthStatus: { type: "string", description: "Health status" },
      },
      required: ["action", "namespace", "title", "weight"],
    };

    // Discriminated union schema with tier-gated parameters
    const discriminatedWithParams: TestJSONSchema = {
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "create" },
            namespace: { type: "string" },
            title: { type: "string" },
            weight: { type: "number", description: "Weight (premium)" },
            healthStatus: { type: "string", description: "Health (ultimate)" },
          },
          required: ["action", "namespace", "title", "weight"],
        },
        {
          type: "object",
          properties: {
            action: { const: "update" },
            id: { type: "string" },
            weight: { type: "number", description: "Weight (premium)" },
            iterationId: { type: "string", description: "Iteration (premium)" },
          },
          required: ["action", "id"],
        },
      ],
    };

    it("should return schema unchanged when no parameters are restricted", () => {
      const result = stripTierRestrictedParameters(flatSchemaWithParams as any, []);

      expect(result).toEqual(flatSchemaWithParams);
    });

    it("should remove restricted properties from flat schema", () => {
      const result = stripTierRestrictedParameters(flatSchemaWithParams as any, [
        "weight",
        "healthStatus",
      ]);

      // Removed properties should not be present
      expect(result.properties?.weight).toBeUndefined();
      expect(result.properties?.healthStatus).toBeUndefined();

      // Non-restricted properties remain
      expect(result.properties?.action).toBeDefined();
      expect(result.properties?.namespace).toBeDefined();
      expect(result.properties?.title).toBeDefined();
      expect(result.properties?.iterationId).toBeDefined();
    });

    it("should remove restricted parameters from required array", () => {
      const result = stripTierRestrictedParameters(flatSchemaWithParams as any, ["weight"]);

      // weight was in required, should be removed
      expect(result.required).not.toContain("weight");
      // Other required entries remain
      expect(result.required).toContain("action");
      expect(result.required).toContain("namespace");
      expect(result.required).toContain("title");
    });

    it("should remove restricted properties from all discriminated union branches", () => {
      const result = stripTierRestrictedParameters(discriminatedWithParams as any, [
        "weight",
        "healthStatus",
      ]);

      // Branch 0 (create): weight and healthStatus removed
      expect(result.oneOf?.[0]?.properties?.weight).toBeUndefined();
      expect(result.oneOf?.[0]?.properties?.healthStatus).toBeUndefined();
      expect(result.oneOf?.[0]?.properties?.namespace).toBeDefined();
      expect(result.oneOf?.[0]?.properties?.title).toBeDefined();

      // Branch 1 (update): weight removed, iterationId remains
      expect(result.oneOf?.[1]?.properties?.weight).toBeUndefined();
      expect(result.oneOf?.[1]?.properties?.iterationId).toBeDefined();
      expect(result.oneOf?.[1]?.properties?.id).toBeDefined();
    });

    it("should remove restricted params from required in discriminated union branches", () => {
      const result = stripTierRestrictedParameters(discriminatedWithParams as any, ["weight"]);

      // Branch 0 had weight in required - should be removed
      expect(result.oneOf?.[0]?.required).not.toContain("weight");
      expect(result.oneOf?.[0]?.required).toContain("action");
      expect(result.oneOf?.[0]?.required).toContain("namespace");
    });

    it("should not mutate the original schema", () => {
      const original = JSON.parse(JSON.stringify(flatSchemaWithParams));

      stripTierRestrictedParameters(flatSchemaWithParams as any, ["weight", "healthStatus"]);

      // Original should remain unchanged
      expect(flatSchemaWithParams).toEqual(original);
    });

    it("should handle parameters not present in the schema gracefully", () => {
      // Restrict a param that doesn't exist in the schema - should be a no-op
      const result = stripTierRestrictedParameters(flatSchemaWithParams as any, [
        "nonExistentParam",
      ]);

      expect(result.properties?.action).toBeDefined();
      expect(result.properties?.weight).toBeDefined();
    });

    it("should handle schema without properties object", () => {
      // Edge case: schema branch with no properties at all
      const noPropsSchema: TestJSONSchema = { type: "object" };

      const result = stripTierRestrictedParameters(noPropsSchema as any, ["weight"]);

      // Should return schema unchanged (no crash)
      expect(result.type).toBe("object");
      expect(result.properties).toBeUndefined();
    });

    it("should handle schema without required array", () => {
      // Schema with properties but no required array
      const noRequiredSchema: TestJSONSchema = {
        type: "object",
        properties: {
          title: { type: "string" },
          weight: { type: "number" },
        },
      };

      const result = stripTierRestrictedParameters(noRequiredSchema as any, ["weight"]);

      // Property should be removed, no crash on missing required
      expect(result.properties?.weight).toBeUndefined();
      expect(result.properties?.title).toBeDefined();
      expect(result.required).toBeUndefined();
    });

    it("should handle discriminated union with branch missing properties", () => {
      // oneOf branch without properties should not crash
      const partialBranches: TestJSONSchema = {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { const: "create" },
              weight: { type: "number" },
            },
            required: ["action"],
          },
          {
            type: "object",
            // No properties object in this branch
          },
        ],
      };

      const result = stripTierRestrictedParameters(partialBranches as any, ["weight"]);

      expect(result.oneOf?.[0]?.properties?.weight).toBeUndefined();
      expect(result.oneOf?.[0]?.properties?.action).toBeDefined();
      // Second branch should remain unchanged
      expect(result.oneOf?.[1]?.type).toBe("object");
    });
  });
});
