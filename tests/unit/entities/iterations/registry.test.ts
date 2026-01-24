import {
  iterationsToolRegistry,
  getIterationsReadOnlyToolNames,
  getIterationsToolDefinitions,
  getFilteredIterationsTools,
} from "../../../../src/entities/iterations/registry";
import { BrowseIterationsSchema } from "../../../../src/entities/iterations/schema-readonly";
import {
  BrowseIterationsSchema as IndexBrowseIterationsSchema,
  iterationsToolRegistry as indexIterationsToolRegistry,
} from "../../../../src/entities/iterations";
import { enhancedFetch } from "../../../../src/utils/fetch";
import { isActionDenied } from "../../../../src/config";

// Mock enhancedFetch
jest.mock("../../../../src/utils/fetch", () => ({
  enhancedFetch: jest.fn(),
}));

// Mock config module
jest.mock("../../../../src/config", () => ({
  isActionDenied: jest.fn(() => false),
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;
const mockIsActionDenied = isActionDenied as jest.MockedFunction<typeof isActionDenied>;

describe("Iterations Tool Registry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, GITLAB_API_URL: "https://gitlab.example.com" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("browse_iterations tool", () => {
    const browseIterationsTool = iterationsToolRegistry.get("browse_iterations");

    it("should be registered in the registry", () => {
      expect(browseIterationsTool).toBeDefined();
      expect(browseIterationsTool?.name).toBe("browse_iterations");
    });

    it("should have a description mentioning actions", () => {
      expect(browseIterationsTool?.description).toContain("list");
      expect(browseIterationsTool?.description).toContain("get");
    });

    describe("list action", () => {
      it("should list iterations with minimal params", async () => {
        const mockIterations = [
          { id: 1, title: "Sprint 1", state: "current" },
          { id: 2, title: "Sprint 2", state: "upcoming" },
        ];
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockIterations,
        } as Response);

        const result = await browseIterationsTool?.handler({
          action: "list",
          group_id: "my-group",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          expect.stringContaining("https://gitlab.example.com/api/v4/groups/my-group/iterations?")
        );
        expect(result).toEqual(mockIterations);
      });

      it("should encode group_id with special characters", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        await browseIterationsTool?.handler({
          action: "list",
          group_id: "my-org/my-group",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          expect.stringContaining("groups/my-org%2Fmy-group/iterations")
        );
      });

      it("should pass state filter", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        await browseIterationsTool?.handler({
          action: "list",
          group_id: "123",
          state: "current",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining("state=current"));
      });

      it("should pass search filter", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        await browseIterationsTool?.handler({
          action: "list",
          group_id: "123",
          search: "Sprint",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining("search=Sprint"));
      });

      it("should pass include_ancestors parameter", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        await browseIterationsTool?.handler({
          action: "list",
          group_id: "123",
          include_ancestors: true,
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          expect.stringContaining("include_ancestors=true")
        );
      });

      it("should pass pagination parameters", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        await browseIterationsTool?.handler({
          action: "list",
          group_id: "123",
          per_page: 50,
          page: 2,
        });

        const url = mockEnhancedFetch.mock.calls[0][0];
        expect(url).toContain("per_page=50");
        expect(url).toContain("page=2");
      });

      it("should throw on API error", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        } as Response);

        await expect(
          browseIterationsTool?.handler({
            action: "list",
            group_id: "123",
          })
        ).rejects.toThrow("GitLab API error: 403 Forbidden");
      });
    });

    describe("get action", () => {
      it("should get a specific iteration", async () => {
        const mockIteration = {
          id: 42,
          title: "Sprint 5",
          state: "current",
          start_date: "2024-01-01",
          due_date: "2024-01-14",
        };
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockIteration,
        } as Response);

        const result = await browseIterationsTool?.handler({
          action: "get",
          group_id: "my-group",
          iteration_id: "42",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          "https://gitlab.example.com/api/v4/groups/my-group/iterations/42"
        );
        expect(result).toEqual(mockIteration);
      });

      it("should encode group_id and iteration_id", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({}),
        } as Response);

        await browseIterationsTool?.handler({
          action: "get",
          group_id: "org/sub-group",
          iteration_id: "99",
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          "https://gitlab.example.com/api/v4/groups/org%2Fsub-group/iterations/99"
        );
      });

      it("should throw on API error", async () => {
        mockEnhancedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        } as Response);

        await expect(
          browseIterationsTool?.handler({
            action: "get",
            group_id: "123",
            iteration_id: "999",
          })
        ).rejects.toThrow("GitLab API error: 404 Not Found");
      });
    });
  });

  describe("Action denied handling", () => {
    const browseIterationsTool = iterationsToolRegistry.get("browse_iterations");

    it("should throw error when list action is denied", async () => {
      mockIsActionDenied.mockReturnValueOnce(true);

      await expect(
        browseIterationsTool?.handler({
          action: "list",
          group_id: "123",
        })
      ).rejects.toThrow("Action 'list' is not allowed for browse_iterations tool");
    });

    it("should throw error when get action is denied", async () => {
      mockIsActionDenied.mockReturnValueOnce(true);

      await expect(
        browseIterationsTool?.handler({
          action: "get",
          group_id: "123",
          iteration_id: "42",
        })
      ).rejects.toThrow("Action 'get' is not allowed for browse_iterations tool");
    });
  });

  describe("Schema validation", () => {
    it("should validate list action with valid params", () => {
      const result = BrowseIterationsSchema.safeParse({
        action: "list",
        group_id: "my-group",
        state: "current",
      });
      expect(result.success).toBe(true);
    });

    it("should validate get action with valid params", () => {
      const result = BrowseIterationsSchema.safeParse({
        action: "get",
        group_id: "my-group",
        iteration_id: "42",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid action", () => {
      const result = BrowseIterationsSchema.safeParse({
        action: "delete",
        group_id: "my-group",
      });
      expect(result.success).toBe(false);
    });

    it("should reject get action without iteration_id", () => {
      const result = BrowseIterationsSchema.safeParse({
        action: "get",
        group_id: "my-group",
      });
      expect(result.success).toBe(false);
    });

    it("should reject list action with invalid state", () => {
      const result = BrowseIterationsSchema.safeParse({
        action: "list",
        group_id: "my-group",
        state: "invalid_state",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Registry exports", () => {
    it("should have only browse_iterations tool", () => {
      expect(iterationsToolRegistry.has("browse_iterations")).toBe(true);
      expect(iterationsToolRegistry.size).toBe(1);
    });
  });

  describe("Helper functions", () => {
    it("getIterationsReadOnlyToolNames should return browse_iterations", () => {
      const names = getIterationsReadOnlyToolNames();
      expect(names).toEqual(["browse_iterations"]);
    });

    it("getIterationsToolDefinitions should return all tool definitions", () => {
      const definitions = getIterationsToolDefinitions();
      expect(definitions).toHaveLength(1);
      expect(definitions[0].name).toBe("browse_iterations");
    });

    it("getFilteredIterationsTools should return all tools when readOnlyMode is false", () => {
      const tools = getFilteredIterationsTools(false);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("browse_iterations");
    });

    it("getFilteredIterationsTools should return all tools when readOnlyMode is true (all are read-only)", () => {
      const tools = getFilteredIterationsTools(true);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("browse_iterations");
    });

    it("getFilteredIterationsTools should default to readOnlyMode false", () => {
      const tools = getFilteredIterationsTools();
      expect(tools).toHaveLength(1);
    });
  });

  describe("Index re-exports", () => {
    it("should export BrowseIterationsSchema from index", () => {
      expect(IndexBrowseIterationsSchema).toBeDefined();
      const result = IndexBrowseIterationsSchema.safeParse({
        action: "list",
        group_id: "test",
      });
      expect(result.success).toBe(true);
    });

    it("should export iterationsToolRegistry from index", () => {
      expect(indexIterationsToolRegistry).toBeDefined();
      expect(indexIterationsToolRegistry.has("browse_iterations")).toBe(true);
    });
  });
});
