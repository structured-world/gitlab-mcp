import {
  searchToolRegistry,
  getSearchReadOnlyToolNames,
  getSearchToolDefinitions,
  getFilteredSearchTools,
} from "../../../../src/entities/search/registry";
// Import from index.ts to cover re-exports
import {
  BrowseSearchSchema,
  searchToolRegistry as indexSearchToolRegistry,
} from "../../../../src/entities/search";
import { gitlab } from "../../../../src/utils/gitlab-api";
import { isActionDenied } from "../../../../src/config";

// Mock the GitLab API module
jest.mock("../../../../src/utils/gitlab-api", () => ({
  gitlab: {
    get: jest.fn(),
  },
  paths: {
    project: (id: string | number) =>
      `projects/${typeof id === "number" ? id : encodeURIComponent(String(id))}`,
    group: (id: string | number) =>
      `groups/${typeof id === "number" ? id : encodeURIComponent(String(id))}`,
  },
  toQuery: jest.fn((params, exclude = []) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && !exclude.includes(key)) {
        result[key] = value;
      }
    }
    return result;
  }),
}));

// Mock config module
jest.mock("../../../../src/config", () => ({
  isActionDenied: jest.fn(() => false),
}));

const mockGitlab = gitlab as jest.Mocked<typeof gitlab>;
const mockIsActionDenied = isActionDenied as jest.MockedFunction<typeof isActionDenied>;

describe("Search Tool Registry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("browse_search tool", () => {
    const browseSearchTool = searchToolRegistry.get("browse_search");

    it("should be registered in the registry", () => {
      expect(browseSearchTool).toBeDefined();
      expect(browseSearchTool?.name).toBe("browse_search");
    });

    it("should have proper description", () => {
      expect(browseSearchTool?.description).toContain("Search across GitLab");
      expect(browseSearchTool?.description).toContain("global");
      expect(browseSearchTool?.description).toContain("project");
      expect(browseSearchTool?.description).toContain("group");
    });

    describe("global action", () => {
      it("should perform global search with minimal params", async () => {
        const mockResults = [
          { id: 1, name: "project-one" },
          { id: 2, name: "project-two" },
        ];
        mockGitlab.get.mockResolvedValue(mockResults);

        const result = await browseSearchTool?.handler({
          action: "global",
          scope: "projects",
          search: "test",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("search", expect.any(Object));
        expect(result).toEqual({
          scope: "projects",
          count: 2,
          results: mockResults,
        });
      });

      it("should pass state filter to API", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "global",
          scope: "issues",
          search: "bug",
          state: "opened",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "search",
          expect.objectContaining({
            query: expect.objectContaining({
              scope: "issues",
              search: "bug",
              state: "opened",
            }),
          })
        );
      });

      it("should pass order_by and sort to API", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "global",
          scope: "merge_requests",
          search: "feature",
          order_by: "updated_at",
          sort: "desc",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "search",
          expect.objectContaining({
            query: expect.objectContaining({
              order_by: "updated_at",
              sort: "desc",
            }),
          })
        );
      });

      it("should pass pagination options to API", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "global",
          scope: "users",
          search: "john",
          per_page: 50,
          page: 2,
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "search",
          expect.objectContaining({
            query: expect.objectContaining({
              per_page: 50,
              page: 2,
            }),
          })
        );
      });
    });

    describe("project action", () => {
      it("should perform project-scoped search", async () => {
        const mockResults = [{ id: 1, path: "src/main.ts", data: "function test()" }];
        mockGitlab.get.mockResolvedValue(mockResults);

        const result = await browseSearchTool?.handler({
          action: "project",
          project_id: "my-group/my-project",
          scope: "blobs",
          search: "function",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-group%2Fmy-project/search",
          expect.any(Object)
        );
        expect(result).toEqual({
          project_id: "my-group/my-project",
          scope: "blobs",
          count: 1,
          results: mockResults,
        });
      });

      it("should handle numeric project_id", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "project",
          project_id: "123",
          scope: "commits",
          search: "fix",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/123/search", expect.any(Object));
      });

      it("should pass ref parameter for code search", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "project",
          project_id: "test-project",
          scope: "blobs",
          search: "TODO",
          ref: "develop",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/test-project/search",
          expect.objectContaining({
            query: expect.objectContaining({
              ref: "develop",
            }),
          })
        );
      });

      it("should handle all search scopes", async () => {
        const scopes = ["blobs", "commits", "issues", "merge_requests", "notes", "wiki_blobs"];

        for (const scope of scopes) {
          mockGitlab.get.mockResolvedValue([]);

          await browseSearchTool?.handler({
            action: "project",
            project_id: "test",
            scope,
            search: "query",
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test/search",
            expect.objectContaining({
              query: expect.objectContaining({ scope }),
            })
          );
        }
      });
    });

    describe("group action", () => {
      it("should perform group-scoped search", async () => {
        const mockResults = [{ id: 1, title: "Important Issue", iid: 42 }];
        mockGitlab.get.mockResolvedValue(mockResults);

        const result = await browseSearchTool?.handler({
          action: "group",
          group_id: "my-group",
          scope: "issues",
          search: "important",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("groups/my-group/search", expect.any(Object));
        expect(result).toEqual({
          group_id: "my-group",
          scope: "issues",
          count: 1,
          results: mockResults,
        });
      });

      it("should handle numeric group_id", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "group",
          group_id: "456",
          scope: "merge_requests",
          search: "refactor",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("groups/456/search", expect.any(Object));
      });

      it("should pass state filter for MR search", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "group",
          group_id: "test-group",
          scope: "merge_requests",
          search: "fix",
          state: "merged",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "groups/test-group/search",
          expect.objectContaining({
            query: expect.objectContaining({
              state: "merged",
            }),
          })
        );
      });

      it("should pass pagination and sorting options", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "group",
          group_id: "test-group",
          scope: "issues",
          search: "feature",
          order_by: "created_at",
          sort: "asc",
          per_page: 25,
          page: 3,
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "groups/test-group/search",
          expect.objectContaining({
            query: expect.objectContaining({
              order_by: "created_at",
              sort: "asc",
              per_page: 25,
              page: 3,
            }),
          })
        );
      });
    });

    describe("action denial", () => {
      it("should throw error when action is denied", async () => {
        mockIsActionDenied.mockReturnValue(true);

        await expect(
          browseSearchTool?.handler({
            action: "global",
            scope: "projects",
            search: "test",
          })
        ).rejects.toThrow("Action 'global' is not allowed for browse_search tool");

        expect(mockIsActionDenied).toHaveBeenCalledWith("browse_search", "global");
      });

      it("should check action denial for each action type", async () => {
        mockIsActionDenied.mockReturnValue(false);
        mockGitlab.get.mockResolvedValue([]);

        await browseSearchTool?.handler({
          action: "project",
          project_id: "test",
          scope: "blobs",
          search: "query",
        });
        expect(mockIsActionDenied).toHaveBeenCalledWith("browse_search", "project");

        await browseSearchTool?.handler({
          action: "group",
          group_id: "test",
          scope: "issues",
          search: "query",
        });
        expect(mockIsActionDenied).toHaveBeenCalledWith("browse_search", "group");
      });
    });
  });

  describe("Helper functions", () => {
    describe("getSearchReadOnlyToolNames", () => {
      it("should return browse_search as read-only", () => {
        const readOnlyTools = getSearchReadOnlyToolNames();
        expect(readOnlyTools).toContain("browse_search");
        expect(readOnlyTools).toHaveLength(1);
      });
    });

    describe("getSearchToolDefinitions", () => {
      it("should return all tool definitions", () => {
        const definitions = getSearchToolDefinitions();
        expect(definitions).toHaveLength(1);
        expect(definitions[0].name).toBe("browse_search");
      });
    });

    describe("getFilteredSearchTools", () => {
      it("should return all tools regardless of readOnlyMode", () => {
        const withReadOnly = getFilteredSearchTools(true);
        const withoutReadOnly = getFilteredSearchTools(false);

        expect(withReadOnly).toHaveLength(1);
        expect(withoutReadOnly).toHaveLength(1);
        expect(withReadOnly[0].name).toBe("browse_search");
        expect(withoutReadOnly[0].name).toBe("browse_search");
      });

      it("should default to non-read-only mode", () => {
        const defaultMode = getFilteredSearchTools();
        expect(defaultMode).toHaveLength(1);
      });
    });
  });

  describe("Index re-exports", () => {
    it("should re-export searchToolRegistry from index", () => {
      expect(indexSearchToolRegistry).toBe(searchToolRegistry);
    });

    it("should re-export BrowseSearchSchema from index", () => {
      expect(BrowseSearchSchema).toBeDefined();
    });
  });
});
