import {
  mrsToolRegistry,
  getMrsReadOnlyToolNames,
  getMrsToolDefinitions,
  getFilteredMrsTools,
  flattenPositionToFormFields,
  getMergeStatusHint,
  getSuggestedAction,
  RETRYABLE_MERGE_STATUSES,
  AUTO_MERGE_ELIGIBLE_STATUSES,
} from "../../../../src/entities/mrs/registry";
import {
  mrsTools,
  mrsReadOnlyTools,
  LOCKFILE_PATTERNS,
  GENERATED_PATTERNS,
  DIFF_EXCLUSION_PRESETS,
} from "../../../../src/entities/mrs/index";
import { gitlab } from "../../../../src/utils/gitlab-api";

// Mock the gitlab API helper
// Note: toQuery mock mirrors the real implementation which filters out undefined values
jest.mock("../../../../src/utils/gitlab-api", () => ({
  gitlab: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  toQuery: jest.fn((options: Record<string, unknown>, exclude: string[] = []) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      // Filter out excluded keys and undefined values (matches real implementation)
      if (!exclude.includes(key) && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }),
}));

const mockGitlab = gitlab as jest.Mocked<typeof gitlab>;

// Mock environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: "https://gitlab.example.com",
    GITLAB_TOKEN: "test-token-12345",
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Note: Don't use resetAllMocks() here because it would remove the custom toQuery
  // mock implementation defined above, which is intended to mirror the real helper.
});

describe("MRS Index exports", () => {
  it("should export mrsTools array with tool definitions", () => {
    expect(Array.isArray(mrsTools)).toBe(true);
    expect(mrsTools.length).toBeGreaterThan(0);

    // Each tool should have name, description, inputSchema
    mrsTools.forEach(tool => {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    });
  });

  it("should export mrsReadOnlyTools array", () => {
    expect(Array.isArray(mrsReadOnlyTools)).toBe(true);
    expect(mrsReadOnlyTools).toContain("browse_merge_requests");
    expect(mrsReadOnlyTools).toContain("browse_mr_discussions");
  });
});

describe("Diff Exclusion Pattern Constants", () => {
  it("should export LOCKFILE_PATTERNS array with common lock files", () => {
    expect(Array.isArray(LOCKFILE_PATTERNS)).toBe(true);
    expect(LOCKFILE_PATTERNS).toContain("yarn.lock");
    expect(LOCKFILE_PATTERNS).toContain("package-lock.json");
    expect(LOCKFILE_PATTERNS).toContain("pnpm-lock.yaml");
    expect(LOCKFILE_PATTERNS).toContain("Cargo.lock");
    expect(LOCKFILE_PATTERNS).toContain("Gemfile.lock");
    expect(LOCKFILE_PATTERNS).toContain("go.sum");
  });

  it("should export GENERATED_PATTERNS array with build output patterns", () => {
    expect(Array.isArray(GENERATED_PATTERNS)).toBe(true);
    expect(GENERATED_PATTERNS).toContain("dist/**");
    expect(GENERATED_PATTERNS).toContain("build/**");
    expect(GENERATED_PATTERNS).toContain("**/*.min.js");
    expect(GENERATED_PATTERNS).toContain("**/*.map");
    expect(GENERATED_PATTERNS).toContain("coverage/**");
  });

  it("should export DIFF_EXCLUSION_PRESETS object with lockfiles and generated presets", () => {
    expect(DIFF_EXCLUSION_PRESETS).toBeDefined();
    expect(DIFF_EXCLUSION_PRESETS.lockfiles).toBe(LOCKFILE_PATTERNS);
    expect(DIFF_EXCLUSION_PRESETS.generated).toBe(GENERATED_PATTERNS);
  });
});

describe("flattenPositionToFormFields", () => {
  it("should flatten flat position object to bracket notation", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      head_sha: "def456",
      new_line: 10,
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[head_sha]": "def456",
      "position[new_line]": 10,
    });
  });

  it("should handle nested objects (2 levels)", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      line_range: {
        start: "line_code_1",
        end: "line_code_2",
      },
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[line_range][start]": "line_code_1",
      "position[line_range][end]": "line_code_2",
    });
  });

  it("should handle deeply nested objects (3 levels - line_range.start.line_code)", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      line_range: {
        start: {
          line_code: "abc_10_10",
          type: "new",
          new_line: 10,
        },
        end: {
          line_code: "abc_15_15",
          type: "new",
          new_line: 15,
        },
      },
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[line_range][start][line_code]": "abc_10_10",
      "position[line_range][start][type]": "new",
      "position[line_range][start][new_line]": 10,
      "position[line_range][end][line_code]": "abc_15_15",
      "position[line_range][end][type]": "new",
      "position[line_range][end][new_line]": 15,
    });
  });

  it("should skip null values", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      head_sha: null,
      old_line: null,
      new_line: 10,
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[new_line]": 10,
    });
  });

  it("should skip undefined values", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      head_sha: undefined,
      new_line: 10,
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[new_line]": 10,
    });
  });

  it("should skip null/undefined in nested objects", () => {
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      line_range: {
        start: {
          line_code: "abc_10_10",
          type: null,
          old_line: undefined,
        },
      },
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[line_range][start][line_code]": "abc_10_10",
    });
  });

  it("should pass arrays as-is at top level (not expand them)", () => {
    // Note: GitLab position schema doesn't have top-level arrays,
    // but if passed, they are added as-is (not expanded to bracket notation)
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      some_array: [1, 2, 3],
      new_line: 10,
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[some_array]": [1, 2, 3],
      "position[new_line]": 10,
    });
  });

  it("should not expand nested arrays", () => {
    // Arrays inside nested objects should be passed as-is
    const body: Record<string, unknown> = {};
    const position = {
      base_sha: "abc123",
      line_range: {
        values: [1, 2, 3],
        start: "code_1",
      },
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[base_sha]": "abc123",
      "position[line_range][values]": [1, 2, 3],
      "position[line_range][start]": "code_1",
    });
  });

  it("should preserve existing body fields", () => {
    const body: Record<string, unknown> = {
      body: "Test comment",
      commit_id: "xyz789",
    };
    const position = {
      base_sha: "abc123",
      new_line: 10,
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      body: "Test comment",
      commit_id: "xyz789",
      "position[base_sha]": "abc123",
      "position[new_line]": 10,
    });
  });

  it("should handle empty position object", () => {
    const body: Record<string, unknown> = { body: "Test" };
    const position = {};

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({ body: "Test" });
  });

  it("should handle boolean and number values correctly", () => {
    const body: Record<string, unknown> = {};
    const position = {
      new_line: 0,
      old_line: 42,
      position_type: "text",
    };

    flattenPositionToFormFields(body, position);

    expect(body).toEqual({
      "position[new_line]": 0,
      "position[old_line]": 42,
      "position[position_type]": "text",
    });
  });
});

describe("Merge Status Constants", () => {
  it("should define retryable merge statuses", () => {
    expect(RETRYABLE_MERGE_STATUSES).toContain("checking");
    expect(RETRYABLE_MERGE_STATUSES).toContain("unchecked");
    expect(RETRYABLE_MERGE_STATUSES).toContain("ci_still_running");
    expect(RETRYABLE_MERGE_STATUSES).toContain("ci_must_pass");
    expect(RETRYABLE_MERGE_STATUSES).toContain("approvals_syncing");
  });

  it("should define auto-merge eligible statuses", () => {
    expect(AUTO_MERGE_ELIGIBLE_STATUSES).toContain("ci_still_running");
    expect(AUTO_MERGE_ELIGIBLE_STATUSES).toContain("ci_must_pass");
  });

  it("should have auto-merge statuses as subset of retryable", () => {
    // All auto-merge eligible statuses should also be retryable
    for (const status of AUTO_MERGE_ELIGIBLE_STATUSES) {
      expect(RETRYABLE_MERGE_STATUSES).toContain(status);
    }
  });
});

describe("getMergeStatusHint", () => {
  it("should return hint for CI-related statuses suggesting auto-merge", () => {
    const ciRunningHint = getMergeStatusHint("ci_still_running");
    expect(ciRunningHint).toContain("auto-merge");
    expect(ciRunningHint).toContain("merge_when_pipeline_succeeds");

    const ciMustPassHint = getMergeStatusHint("ci_must_pass");
    expect(ciMustPassHint).toContain("auto-merge");
    expect(ciMustPassHint).toContain("merge_when_pipeline_succeeds");
  });

  it("should return hint for checking status suggesting retry", () => {
    const hint = getMergeStatusHint("checking");
    expect(hint).toContain("Wait");
    expect(hint).toContain("retry");
  });

  it("should return hint for approval status", () => {
    const hint = getMergeStatusHint("not_approved");
    expect(hint).toContain("approval");
  });

  it("should return hint for conflict status", () => {
    const hint = getMergeStatusHint("conflict");
    expect(hint).toContain("conflicts");
  });

  it("should return hint for draft status", () => {
    const hint = getMergeStatusHint("draft_status");
    expect(hint).toContain("draft");
  });

  it("should return generic hint for unknown status", () => {
    const hint = getMergeStatusHint("unknown_status_xyz");
    expect(hint).toContain("unknown_status_xyz");
  });

  it("should return hint for mergeable status", () => {
    const hint = getMergeStatusHint("mergeable");
    expect(hint).toContain("ready");
  });
});

describe("getSuggestedAction", () => {
  it("should suggest auto-merge when canAutoMerge is true", () => {
    const action = getSuggestedAction(true, true);
    expect(action).toContain("merge_when_pipeline_succeeds");
  });

  it("should suggest wait when retryable but not auto-merge", () => {
    const action = getSuggestedAction(true, false);
    expect(action).toContain("Wait");
    expect(action).toContain("retry");
  });

  it("should suggest resolving blocking condition when not retryable", () => {
    const action = getSuggestedAction(false, false);
    expect(action).toContain("Resolve");
    expect(action).toContain("blocking");
  });
});

describe("MRS Registry", () => {
  describe("Registry Structure", () => {
    it("should be a Map instance", () => {
      expect(mrsToolRegistry instanceof Map).toBe(true);
    });

    it("should contain exactly 5 CQRS tools", () => {
      const toolNames = Array.from(mrsToolRegistry.keys());

      // Check for all 5 CQRS tools
      expect(toolNames).toContain("browse_merge_requests");
      expect(toolNames).toContain("browse_mr_discussions");
      expect(toolNames).toContain("manage_merge_request");
      expect(toolNames).toContain("manage_mr_discussion");
      expect(toolNames).toContain("manage_draft_notes");

      expect(mrsToolRegistry.size).toBe(5);
    });

    it("should have tools with valid structure", () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("handler");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
        expect(typeof tool.handler).toBe("function");
      });
    });

    it("should have unique tool names", () => {
      const toolNames = Array.from(mrsToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe("Tool Definitions", () => {
    it("should have proper browse_merge_requests tool", () => {
      const tool = mrsToolRegistry.get("browse_merge_requests");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("browse_merge_requests");
      expect(tool!.description).toContain("merge requests");
      expect(tool!.description).toContain("list");
      expect(tool!.description).toContain("get");
      expect(tool!.description).toContain("diffs");
      expect(tool!.description).toContain("compare");
      expect(tool!.description).toContain("versions");
      expect(tool!.description).toContain("version");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have proper browse_mr_discussions tool", () => {
      const tool = mrsToolRegistry.get("browse_mr_discussions");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("browse_mr_discussions");
      expect(tool!.description).toContain("discussion threads");
      expect(tool!.description).toContain("list");
      expect(tool!.description).toContain("drafts");
      expect(tool!.description).toContain("draft");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have proper manage_merge_request tool", () => {
      const tool = mrsToolRegistry.get("manage_merge_request");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("manage_merge_request");
      expect(tool!.description).toContain("merge requests");
      expect(tool!.description).toContain("create");
      expect(tool!.description).toContain("update");
      expect(tool!.description).toContain("merge");
      expect(tool!.description).toContain("approve");
      expect(tool!.description).toContain("unapprove");
      expect(tool!.description).toContain("get_approval_state");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have proper manage_mr_discussion tool", () => {
      const tool = mrsToolRegistry.get("manage_mr_discussion");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("manage_mr_discussion");
      expect(tool!.description).toContain("threads");
      expect(tool!.description).toContain("comment");
      expect(tool!.description).toContain("thread");
      expect(tool!.description).toContain("reply");
      expect(tool!.description).toContain("update");
      expect(tool!.description).toContain("apply_suggestion");
      expect(tool!.description).toContain("apply_suggestions");
      expect(tool!.description).toContain("resolve");
      expect(tool!.description).toContain("suggest");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have proper manage_draft_notes tool", () => {
      const tool = mrsToolRegistry.get("manage_draft_notes");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("manage_draft_notes");
      expect(tool!.description).toContain("draft");
      expect(tool!.description).toContain("create");
      expect(tool!.description).toContain("update");
      expect(tool!.description).toContain("publish");
      expect(tool!.description).toContain("delete");
      expect(tool!.inputSchema).toBeDefined();
    });
  });

  describe("Read-Only Tools Function", () => {
    it("should return an array of read-only tool names", () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it("should include only browse_ tools", () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools).toContain("browse_merge_requests");
      expect(readOnlyTools).toContain("browse_mr_discussions");
    });

    it("should not include manage_ tools", () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools).not.toContain("manage_merge_request");
      expect(readOnlyTools).not.toContain("manage_mr_discussion");
      expect(readOnlyTools).not.toContain("manage_draft_notes");
    });

    it("should return exactly 2 read-only tools", () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(2);
    });

    it("should return tools that exist in the registry", () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(mrsToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe("MRS Tool Definitions Function", () => {
    it("should return an array of tool definitions", () => {
      const toolDefinitions = getMrsToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(5);
    });

    it("should return all tools from registry", () => {
      const toolDefinitions = getMrsToolDefinitions();
      const registrySize = mrsToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it("should return tool definitions with proper structure", () => {
      const toolDefinitions = getMrsToolDefinitions();

      toolDefinitions.forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("handler");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
      });
    });
  });

  describe("Filtered MRS Tools Function", () => {
    it("should return all tools in normal mode", () => {
      const filteredTools = getFilteredMrsTools(false);
      expect(filteredTools.length).toBe(5);
    });

    it("should return only read-only tools in read-only mode", () => {
      const filteredTools = getFilteredMrsTools(true);
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it("should filter tools correctly in read-only mode", () => {
      const filteredTools = getFilteredMrsTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain("browse_merge_requests");
      expect(toolNames).toContain("browse_mr_discussions");

      expect(toolNames).not.toContain("manage_merge_request");
      expect(toolNames).not.toContain("manage_mr_discussion");
      expect(toolNames).not.toContain("manage_draft_notes");
    });

    it("should return exactly 2 tools in read-only mode", () => {
      const filteredTools = getFilteredMrsTools(true);
      expect(filteredTools.length).toBe(2);
    });
  });

  describe("Tool Handlers", () => {
    it("should have handlers that are async functions", () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe("function");
        expect(tool.handler.constructor.name).toBe("AsyncFunction");
      });
    });

    it("should have handlers that accept arguments", () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("Registry Consistency", () => {
    it("should have all expected CQRS tools", () => {
      const expectedTools = [
        "browse_merge_requests",
        "browse_mr_discussions",
        "manage_merge_request",
        "manage_mr_discussion",
        "manage_draft_notes",
      ];

      expectedTools.forEach(toolName => {
        expect(mrsToolRegistry.has(toolName)).toBe(true);
      });
    });

    it("should have consistent tool count between functions", () => {
      const registrySize = mrsToolRegistry.size;
      const toolDefinitions = getMrsToolDefinitions();
      const filteredTools = getFilteredMrsTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it("should have more tools than just read-only ones", () => {
      const totalTools = mrsToolRegistry.size;
      const readOnlyTools = getMrsReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe("Tool Input Schemas", () => {
    it("should have valid JSON schema structure for all tools", () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe("object");
      });
    });

    it("should have discriminatedUnion schemas with action field", () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object with discriminator
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe("object");
      });
    });
  });

  describe("Handler Functions", () => {
    describe("browse_merge_requests handler", () => {
      describe("action: list", () => {
        it("should list MRs for specific project", async () => {
          const mockMRs = [{ id: 1, iid: 1, title: "Test MR" }];
          mockGitlab.get.mockResolvedValueOnce(mockMRs);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "list",
            project_id: "test/project",
            state: "opened",
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests",
            expect.objectContaining({ query: expect.any(Object) })
          );
          expect(result).toEqual(mockMRs);
        });

        it("should use global endpoint when no project_id", async () => {
          const mockMRs = [{ id: 1, iid: 1, title: "Test MR" }];
          mockGitlab.get.mockResolvedValueOnce(mockMRs);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          await tool.handler({ action: "list", state: "opened" });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "merge_requests",
            expect.objectContaining({ query: expect.any(Object) })
          );
        });
      });

      describe("action: get", () => {
        it("should get MR by IID", async () => {
          const mockMR = { id: 1, iid: 1, title: "Test MR" };
          mockGitlab.get.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "get",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          // No query params = undefined second argument
          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1",
            undefined
          );
          expect(result).toEqual(mockMR);
        });

        it("should get MR by IID with include flags", async () => {
          const mockMR = { id: 1, iid: 1, title: "Test MR", diverged_commits_count: 5 };
          mockGitlab.get.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "get",
            project_id: "test/project",
            merge_request_iid: 1,
            include_diverged_commits_count: true,
            include_rebase_in_progress: true,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith("projects/test%2Fproject/merge_requests/1", {
            query: {
              include_diverged_commits_count: true,
              include_rebase_in_progress: true,
            },
          });
          expect(result).toEqual(mockMR);
        });

        it("should get MR by branch name", async () => {
          const mockMRs = [{ id: 1, iid: 1, title: "Test MR", source_branch: "feature" }];
          mockGitlab.get.mockResolvedValueOnce(mockMRs);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "get",
            project_id: "test/project",
            branch_name: "feature",
          });

          expect(mockGitlab.get).toHaveBeenCalledWith("projects/test%2Fproject/merge_requests", {
            query: { source_branch: "feature" },
          });
          expect(result).toEqual(mockMRs[0]);
        });

        it("should throw error when no MR found by branch", async () => {
          mockGitlab.get.mockResolvedValueOnce([]);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;

          await expect(
            tool.handler({
              action: "get",
              project_id: "test/project",
              branch_name: "nonexistent",
            })
          ).rejects.toThrow("No merge request found for branch");
        });
      });

      describe("action: diffs", () => {
        it("should get MR diffs with pagination", async () => {
          const mockDiffs = { changes: [] };
          mockGitlab.get.mockResolvedValueOnce(mockDiffs);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "diffs",
            project_id: "test/project",
            merge_request_iid: 1,
            page: 1,
            per_page: 20,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/changes",
            { query: { page: 1, per_page: 20 } }
          );
          expect(result).toEqual(mockDiffs);
        });

        it("should get MR diffs with include flags", async () => {
          const mockDiffs = { changes: [], diverged_commits_count: 3 };
          mockGitlab.get.mockResolvedValueOnce(mockDiffs);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "diffs",
            project_id: "test/project",
            merge_request_iid: 1,
            include_diverged_commits_count: true,
            include_rebase_in_progress: true,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/changes",
            {
              query: {
                include_diverged_commits_count: true,
                include_rebase_in_progress: true,
                per_page: 20,
              },
            }
          );
          expect(result).toEqual(mockDiffs);
        });

        // --- File Exclusion Tests ---
        describe("file exclusion patterns", () => {
          // Mock diff data representing various file types
          const mockDiffsWithMixedFiles = {
            changes: [
              { new_path: "src/index.ts", old_path: "src/index.ts", diff: "..." },
              { new_path: "yarn.lock", old_path: "yarn.lock", diff: "..." },
              { new_path: "package-lock.json", old_path: "package-lock.json", diff: "..." },
              { new_path: "dist/bundle.js", old_path: "dist/bundle.js", diff: "..." },
              { new_path: "src/utils.min.js", old_path: "src/utils.min.js", diff: "..." },
              { new_path: "src/styles.css.map", old_path: "src/styles.css.map", diff: "..." },
              {
                new_path: "src/components/Button.tsx",
                old_path: "src/components/Button.tsx",
                diff: "...",
              },
            ],
          };

          it("should not filter when no exclusions specified", async () => {
            mockGitlab.get.mockResolvedValueOnce({ ...mockDiffsWithMixedFiles });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
            })) as { changes: unknown[]; _filtered?: unknown };

            // All 7 files returned, no _filtered metadata
            expect(result.changes.length).toBe(7);
            expect(result._filtered).toBeUndefined();
          });

          it("should exclude lockfiles when exclude_lockfiles=true", async () => {
            mockGitlab.get.mockResolvedValueOnce({ ...mockDiffsWithMixedFiles });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
            })) as { changes: Array<{ new_path: string }>; _filtered: { excluded_count: number } };

            // yarn.lock and package-lock.json should be excluded
            const paths = result.changes.map(d => d.new_path);
            expect(paths).not.toContain("yarn.lock");
            expect(paths).not.toContain("package-lock.json");
            expect(result.changes.length).toBe(5);
            expect(result._filtered.excluded_count).toBe(2);
          });

          it("should exclude generated files when exclude_generated=true", async () => {
            mockGitlab.get.mockResolvedValueOnce({ ...mockDiffsWithMixedFiles });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_generated: true,
            })) as { changes: Array<{ new_path: string }>; _filtered: { excluded_count: number } };

            // dist/bundle.js, *.min.js, *.css.map should be excluded
            const paths = result.changes.map(d => d.new_path);
            expect(paths).not.toContain("dist/bundle.js");
            expect(paths).not.toContain("src/utils.min.js");
            expect(paths).not.toContain("src/styles.css.map");
            expect(result.changes.length).toBe(4);
            expect(result._filtered.excluded_count).toBe(3);
          });

          it("should combine preset and custom patterns", async () => {
            mockGitlab.get.mockResolvedValueOnce({ ...mockDiffsWithMixedFiles });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
              exclude_patterns: ["src/components/**"],
            })) as { changes: Array<{ new_path: string }>; _filtered: { excluded_count: number } };

            // lockfiles + src/components/** should be excluded
            const paths = result.changes.map(d => d.new_path);
            expect(paths).not.toContain("yarn.lock");
            expect(paths).not.toContain("package-lock.json");
            expect(paths).not.toContain("src/components/Button.tsx");
            expect(result.changes.length).toBe(4);
            expect(result._filtered.excluded_count).toBe(3);
          });

          it("should add _filtered metadata with correct counts", async () => {
            mockGitlab.get.mockResolvedValueOnce({ ...mockDiffsWithMixedFiles });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
              exclude_generated: true,
            })) as {
              changes: Array<{ new_path: string }>;
              _filtered: {
                original_count: number;
                filtered_count: number;
                excluded_count: number;
                patterns_applied: string[];
              };
            };

            // Check metadata structure
            expect(result._filtered).toBeDefined();
            expect(result._filtered.original_count).toBe(7);
            expect(result._filtered.filtered_count).toBe(2); // only src/index.ts and Button.tsx
            expect(result._filtered.excluded_count).toBe(5);
            expect(Array.isArray(result._filtered.patterns_applied)).toBe(true);
            expect(result._filtered.patterns_applied.length).toBeGreaterThan(0);
          });

          it("should handle empty changes array", async () => {
            mockGitlab.get.mockResolvedValueOnce({ changes: [] });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
            })) as {
              changes: unknown[];
              _filtered: { original_count: number; excluded_count: number };
            };

            // Empty array should still have _filtered metadata
            expect(result.changes.length).toBe(0);
            expect(result._filtered.original_count).toBe(0);
            expect(result._filtered.excluded_count).toBe(0);
          });

          it("should not add _filtered when response has no changes array", async () => {
            // Some API responses may not have changes field
            mockGitlab.get.mockResolvedValueOnce({ some_other_field: "value" });

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
            })) as { changes?: unknown[]; _filtered?: unknown };

            // No changes array, no filtering attempted
            expect(result._filtered).toBeUndefined();
          });

          it("should filter by old_path as well as new_path", async () => {
            // Test case where file was renamed from a lockfile
            const mockDiffsWithRename = {
              changes: [
                { new_path: "src/index.ts", old_path: "src/index.ts", diff: "..." },
                { new_path: "renamed.txt", old_path: "yarn.lock", diff: "..." },
              ],
            };
            mockGitlab.get.mockResolvedValueOnce(mockDiffsWithRename);

            const tool = mrsToolRegistry.get("browse_merge_requests")!;
            const result = (await tool.handler({
              action: "diffs",
              project_id: "test/project",
              merge_request_iid: 1,
              exclude_lockfiles: true,
            })) as { changes: Array<{ new_path: string }>; _filtered: { excluded_count: number } };

            // File with old_path=yarn.lock should be excluded even if new_path is different
            expect(result.changes.length).toBe(1);
            expect(result.changes[0].new_path).toBe("src/index.ts");
            expect(result._filtered.excluded_count).toBe(1);
          });
        });
      });

      describe("action: compare", () => {
        it("should compare branches", async () => {
          const mockData = { commits: [], diffs: [] };
          mockGitlab.get.mockResolvedValueOnce(mockData);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "compare",
            project_id: "test/project",
            from: "main",
            to: "feature-branch",
            straight: true,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/repository/compare",
            { query: { from: "main", to: "feature-branch", straight: true } }
          );
          expect(result).toEqual(mockData);
        });

        it("should handle API errors", async () => {
          mockGitlab.get.mockRejectedValueOnce(new Error("GitLab API error: 404 Error"));

          const tool = mrsToolRegistry.get("browse_merge_requests")!;

          await expect(
            tool.handler({
              action: "compare",
              project_id: "test/project",
              from: "main",
              to: "nonexistent",
            })
          ).rejects.toThrow("GitLab API error: 404 Error");
        });
      });

      describe("action: versions", () => {
        it("should list MR diff versions", async () => {
          const mockVersions = [
            { id: 1, head_commit_sha: "abc123", base_commit_sha: "def456" },
            { id: 2, head_commit_sha: "ghi789", base_commit_sha: "def456" },
          ];
          mockGitlab.get.mockResolvedValueOnce(mockVersions);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "versions",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/versions",
            expect.objectContaining({ query: expect.any(Object) })
          );
          expect(result).toEqual(mockVersions);
        });

        it("should list MR diff versions with pagination", async () => {
          const mockVersions = [{ id: 1, head_commit_sha: "abc123" }];
          mockGitlab.get.mockResolvedValueOnce(mockVersions);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "versions",
            project_id: "test/project",
            merge_request_iid: 1,
            per_page: 10,
            page: 2,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/versions",
            expect.objectContaining({
              query: expect.objectContaining({ per_page: 10, page: 2 }),
            })
          );
          expect(result).toEqual(mockVersions);
        });
      });

      describe("action: version", () => {
        it("should get specific MR diff version", async () => {
          const mockVersion = {
            id: 123,
            head_commit_sha: "abc123",
            base_commit_sha: "def456",
            diffs: [{ old_path: "file.ts", new_path: "file.ts", diff: "@@ -1,5 +1,5 @@" }],
          };
          mockGitlab.get.mockResolvedValueOnce(mockVersion);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "version",
            project_id: "test/project",
            merge_request_iid: 1,
            version_id: "123",
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/versions/123"
          );
          expect(result).toEqual(mockVersion);
        });

        it("should handle numeric version_id", async () => {
          const mockVersion = { id: 456, head_commit_sha: "xyz789", diffs: [] };
          mockGitlab.get.mockResolvedValueOnce(mockVersion);

          const tool = mrsToolRegistry.get("browse_merge_requests")!;
          const result = await tool.handler({
            action: "version",
            project_id: "test/project",
            merge_request_iid: 42,
            version_id: 456,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/42/versions/456"
          );
          expect(result).toEqual(mockVersion);
        });
      });
    });

    describe("browse_mr_discussions handler", () => {
      describe("action: list", () => {
        it("should list MR discussions without per_page (uses default)", async () => {
          const mockDiscussions = [{ id: "abc123", notes: [] }];
          mockGitlab.get.mockResolvedValueOnce(mockDiscussions);

          const tool = mrsToolRegistry.get("browse_mr_discussions")!;
          const result = await tool.handler({
            action: "list",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              query: expect.objectContaining({ per_page: 20 }),
            })
          );
          expect(result).toEqual(mockDiscussions);
        });

        it("should list MR discussions with custom per_page", async () => {
          const mockDiscussions = [
            { id: "abc123", notes: [] },
            { id: "def456", notes: [] },
          ];
          mockGitlab.get.mockResolvedValueOnce(mockDiscussions);

          const tool = mrsToolRegistry.get("browse_mr_discussions")!;
          const result = await tool.handler({
            action: "list",
            project_id: "test/project",
            merge_request_iid: 1,
            per_page: 50,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              query: expect.objectContaining({ per_page: 50 }),
            })
          );
          expect(result).toEqual(mockDiscussions);
        });

        it("should list MR discussions with pagination (per_page and page)", async () => {
          const mockDiscussions = [{ id: "ghi789", notes: [] }];
          mockGitlab.get.mockResolvedValueOnce(mockDiscussions);

          const tool = mrsToolRegistry.get("browse_mr_discussions")!;
          const result = await tool.handler({
            action: "list",
            project_id: "test/project",
            merge_request_iid: 1,
            per_page: 10,
            page: 3,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              query: expect.objectContaining({ per_page: 10, page: 3 }),
            })
          );
          expect(result).toEqual(mockDiscussions);
        });
      });

      describe("action: drafts", () => {
        it("should list draft notes", async () => {
          const mockNotes = [{ id: 1, note: "Draft 1" }];
          mockGitlab.get.mockResolvedValueOnce(mockNotes);

          const tool = mrsToolRegistry.get("browse_mr_discussions")!;
          const result = await tool.handler({
            action: "drafts",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes"
          );
          expect(result).toEqual(mockNotes);
        });
      });

      describe("action: draft", () => {
        it("should get single draft note", async () => {
          const mockNote = { id: 1, note: "Draft comment" };
          mockGitlab.get.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("browse_mr_discussions")!;
          const result = await tool.handler({
            action: "draft",
            project_id: "test/project",
            merge_request_iid: 1,
            draft_note_id: 1,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes/1"
          );
          expect(result).toEqual(mockNote);
        });
      });
    });

    describe("manage_merge_request handler", () => {
      describe("action: create", () => {
        it("should create new MR", async () => {
          const mockMR = { id: 1, iid: 1, title: "New MR" };
          mockGitlab.post.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "create",
            project_id: "test/project",
            source_branch: "feature",
            target_branch: "main",
            title: "New MR",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests",
            expect.objectContaining({
              body: expect.objectContaining({
                source_branch: "feature",
                target_branch: "main",
                title: "New MR",
              }),
              contentType: "form",
            })
          );
          expect(result).toEqual(mockMR);
        });

        it("should handle array parameters", async () => {
          const mockMR = { id: 1, iid: 1, title: "New MR" };
          mockGitlab.post.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          await tool.handler({
            action: "create",
            project_id: "test/project",
            source_branch: "feature",
            target_branch: "main",
            title: "New MR",
            assignee_ids: ["1", "2"],
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests",
            expect.objectContaining({
              body: expect.objectContaining({
                assignee_ids: "1,2", // Arrays are joined
              }),
            })
          );
        });
      });

      describe("action: update", () => {
        it("should update existing MR", async () => {
          const mockMR = { id: 1, iid: 1, title: "Updated MR" };
          mockGitlab.put.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "update",
            project_id: "test/project",
            merge_request_iid: 1,
            title: "Updated MR",
            description: "Updated description",
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1",
            expect.objectContaining({
              body: expect.objectContaining({
                title: "Updated MR",
                description: "Updated description",
              }),
              contentType: "form",
            })
          );
          expect(result).toEqual(mockMR);
        });

        it("should handle array parameters in update", async () => {
          const mockMR = { id: 1, iid: 1, title: "Updated MR" };
          mockGitlab.put.mockResolvedValueOnce(mockMR);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          await tool.handler({
            action: "update",
            project_id: "test/project",
            merge_request_iid: 1,
            assignee_ids: ["1", "2", "3"],
            reviewer_ids: ["4", "5"],
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1",
            expect.objectContaining({
              body: expect.objectContaining({
                assignee_ids: "1,2,3", // Arrays are joined
                reviewer_ids: "4,5",
              }),
            })
          );
        });
      });

      describe("action: merge", () => {
        it("should merge MR with options when status is mergeable", async () => {
          // Mock pre-check GET request
          const mockMrStatus = {
            detailed_merge_status: "mergeable",
            merge_status: "can_be_merged",
            has_conflicts: false,
            blocking_discussions_resolved: true,
            state: "opened",
            draft: false,
          };
          mockGitlab.get.mockResolvedValueOnce(mockMrStatus);

          // Mock merge PUT request
          const mockResult = { state: "merged" };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
            merge_commit_message: "Custom merge message",
            should_remove_source_branch: true,
          });

          // Verify pre-check GET was called
          expect(mockGitlab.get).toHaveBeenCalledWith("projects/test%2Fproject/merge_requests/1");

          // Verify merge PUT was called
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/merge",
            expect.objectContaining({
              body: expect.objectContaining({
                merge_commit_message: "Custom merge message",
                should_remove_source_branch: true,
              }),
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should skip pre-check and use auto-merge when merge_when_pipeline_succeeds is true", async () => {
          const mockResult = { state: "merged", merge_when_pipeline_succeeds: true };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
            merge_when_pipeline_succeeds: true,
          });

          // Should NOT call GET for pre-check when auto-merge requested
          expect(mockGitlab.get).not.toHaveBeenCalled();

          // Should call PUT with auto-merge flag
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/merge",
            expect.objectContaining({
              body: expect.objectContaining({
                merge_when_pipeline_succeeds: true,
              }),
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should return structured error when pipeline is running", async () => {
          // Mock pre-check showing pipeline running
          const mockMrStatus = {
            detailed_merge_status: "ci_still_running",
            merge_status: "can_be_merged",
            has_conflicts: false,
            blocking_discussions_resolved: true,
            state: "opened",
            draft: false,
          };
          mockGitlab.get.mockResolvedValueOnce(mockMrStatus);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = (await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
          })) as Record<string, unknown>;

          // Should return structured error, not throw
          expect(result.error).toBe(true);
          expect(result.detailed_merge_status).toBe("ci_still_running");
          expect(result.is_retryable).toBe(true);
          expect(result.can_auto_merge).toBe(true);
          expect(result.suggested_action).toContain("merge_when_pipeline_succeeds");
          expect(result.hint).toContain("auto-merge");

          // Should NOT attempt to merge
          expect(mockGitlab.put).not.toHaveBeenCalled();
        });

        it("should return structured error when approval required", async () => {
          // Mock pre-check showing approval required
          const mockMrStatus = {
            detailed_merge_status: "not_approved",
            merge_status: "cannot_be_merged",
            has_conflicts: false,
            blocking_discussions_resolved: true,
            state: "opened",
            draft: false,
          };
          mockGitlab.get.mockResolvedValueOnce(mockMrStatus);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = (await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
          })) as Record<string, unknown>;

          // Should return structured error
          expect(result.error).toBe(true);
          expect(result.detailed_merge_status).toBe("not_approved");
          expect(result.is_retryable).toBe(false);
          expect(result.can_auto_merge).toBe(false);
          expect(result.hint).toContain("approval");

          // Should NOT attempt to merge
          expect(mockGitlab.put).not.toHaveBeenCalled();
        });

        it("should return structured error when conflicts exist", async () => {
          // Mock pre-check showing conflicts
          const mockMrStatus = {
            detailed_merge_status: "conflict",
            merge_status: "cannot_be_merged",
            has_conflicts: true,
            blocking_discussions_resolved: true,
            state: "opened",
            draft: false,
          };
          mockGitlab.get.mockResolvedValueOnce(mockMrStatus);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = (await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
          })) as Record<string, unknown>;

          // Should return structured error
          expect(result.error).toBe(true);
          expect(result.detailed_merge_status).toBe("conflict");
          expect(result.has_conflicts).toBe(true);
          expect(result.is_retryable).toBe(false);
          expect(result.can_auto_merge).toBe(false);
          expect(result.hint).toContain("conflicts");
        });

        it("should suggest retry for checking status", async () => {
          // Mock pre-check showing mergeability check in progress
          const mockMrStatus = {
            detailed_merge_status: "checking",
            merge_status: "checking",
            has_conflicts: false,
            blocking_discussions_resolved: true,
            state: "opened",
            draft: false,
          };
          mockGitlab.get.mockResolvedValueOnce(mockMrStatus);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = (await tool.handler({
            action: "merge",
            project_id: "test/project",
            merge_request_iid: 1,
          })) as Record<string, unknown>;

          // Should return structured error with retry suggestion
          expect(result.error).toBe(true);
          expect(result.detailed_merge_status).toBe("checking");
          expect(result.is_retryable).toBe(true);
          expect(result.can_auto_merge).toBe(false);
          expect(result.suggested_action).toContain("Wait");
          expect(result.hint).toContain("retry");
        });
      });

      describe("action: approve", () => {
        it("should approve MR without sha", async () => {
          const mockResult = { id: 1, user: { id: 123, name: "Test User" } };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "approve",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/approve",
            expect.objectContaining({
              body: undefined,
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should approve MR with specific sha", async () => {
          const mockResult = { id: 1, user: { id: 123, name: "Test User" } };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "approve",
            project_id: "test/project",
            merge_request_iid: 1,
            sha: "abc123def456",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/approve",
            expect.objectContaining({
              body: { sha: "abc123def456" },
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });
      });

      describe("action: unapprove", () => {
        it("should remove approval from MR", async () => {
          const mockResult = { id: 1 };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "unapprove",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/unapprove"
          );
          expect(result).toEqual(mockResult);
        });
      });

      describe("action: get_approval_state", () => {
        it("should get approval state for MR", async () => {
          const mockResult = {
            approval_rules_overwritten: false,
            rules: [{ id: 1, name: "All Members", eligible_approvers: [], approvals_required: 1 }],
          };
          mockGitlab.get.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_merge_request")!;
          const result = await tool.handler({
            action: "get_approval_state",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.get).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/approval_state"
          );
          expect(result).toEqual(mockResult);
        });
      });
    });

    describe("manage_mr_discussion handler", () => {
      describe("action: comment", () => {
        it("should create note for merge request", async () => {
          const mockNote = { id: 1, body: "Test comment" };
          mockGitlab.post.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "comment",
            project_id: "test/project",
            noteable_type: "merge_request",
            noteable_id: 1,
            body: "Test comment",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/notes",
            expect.objectContaining({
              body: { body: "Test comment" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });

        it("should create note for issue", async () => {
          const mockNote = { id: 1, body: "Test comment" };
          mockGitlab.post.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          await tool.handler({
            action: "comment",
            project_id: "test/project",
            noteable_type: "issue",
            noteable_id: 1,
            body: "Test comment",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/issues/1/notes",
            expect.objectContaining({
              body: { body: "Test comment" },
              contentType: "form",
            })
          );
        });
      });

      describe("action: thread", () => {
        it("should create MR thread", async () => {
          const mockDiscussion = { id: "abc123", notes: [] };
          mockGitlab.post.mockResolvedValueOnce(mockDiscussion);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "thread",
            project_id: "test/project",
            merge_request_iid: 1,
            body: "Thread comment",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              body: { body: "Thread comment" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockDiscussion);
        });
      });

      describe("action: reply", () => {
        it("should reply to existing thread", async () => {
          const mockNote = { id: 1, body: "Reply comment" };
          mockGitlab.post.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "reply",
            project_id: "test/project",
            merge_request_iid: 1,
            discussion_id: "abc123",
            body: "Reply comment",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions/abc123/notes",
            expect.objectContaining({
              body: { body: "Reply comment" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });
      });

      describe("action: update", () => {
        it("should update MR note", async () => {
          const mockNote = { id: 1, body: "Updated comment" };
          mockGitlab.put.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "update",
            project_id: "test/project",
            merge_request_iid: 1,
            note_id: 1,
            body: "Updated comment",
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/notes/1",
            expect.objectContaining({
              body: { body: "Updated comment" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });
      });

      describe("action: apply_suggestion", () => {
        it("should apply a single suggestion", async () => {
          const mockResult = { id: 12345, applied: true };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "apply_suggestion",
            project_id: "test/project",
            merge_request_iid: 42,
            suggestion_id: 12345,
          });

          // GitLab suggestions API uses global endpoint: PUT /suggestions/:id/apply
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "suggestions/12345/apply",
            expect.objectContaining({
              body: undefined,
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should apply a suggestion with custom commit message", async () => {
          const mockResult = { id: 12345, applied: true };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "apply_suggestion",
            project_id: "test/project",
            merge_request_iid: 42,
            suggestion_id: 12345,
            commit_message: "Apply suggestion: fix typo",
          });

          // GitLab suggestions API uses global endpoint: PUT /suggestions/:id/apply
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "suggestions/12345/apply",
            expect.objectContaining({
              body: { commit_message: "Apply suggestion: fix typo" },
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });
      });

      describe("action: apply_suggestions", () => {
        it("should batch apply multiple suggestions", async () => {
          const mockResult = { applied_count: 3 };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "apply_suggestions",
            project_id: "test/project",
            merge_request_iid: 42,
            suggestion_ids: [12345, 12346, 12347],
          });

          // GitLab suggestions API uses global endpoint: PUT /suggestions/batch_apply
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "suggestions/batch_apply",
            expect.objectContaining({
              body: { ids: [12345, 12346, 12347] },
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should batch apply suggestions with custom commit message", async () => {
          const mockResult = { applied_count: 2 };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "apply_suggestions",
            project_id: "test/project",
            merge_request_iid: 42,
            suggestion_ids: [12345, 12346],
            commit_message: "Apply code review suggestions",
          });

          // GitLab suggestions API uses global endpoint: PUT /suggestions/batch_apply
          expect(mockGitlab.put).toHaveBeenCalledWith(
            "suggestions/batch_apply",
            expect.objectContaining({
              body: {
                ids: [12345, 12346],
                commit_message: "Apply code review suggestions",
              },
              contentType: "json",
            })
          );
          expect(result).toEqual(mockResult);
        });
      });

      describe("action: resolve", () => {
        it("should resolve a discussion thread", async () => {
          const mockResult = { id: "abc123", resolved: true };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "resolve",
            project_id: "test/project",
            merge_request_iid: 1,
            discussion_id: "abc123",
            resolved: true,
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions/abc123",
            expect.objectContaining({
              body: { resolved: true },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should unresolve a discussion thread", async () => {
          const mockResult = { id: "abc123", resolved: false };
          mockGitlab.put.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "resolve",
            project_id: "test/project",
            merge_request_iid: 1,
            discussion_id: "abc123",
            resolved: false,
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions/abc123",
            expect.objectContaining({
              body: { resolved: false },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });
      });

      describe("action: suggest", () => {
        it("should create a code suggestion without line range", async () => {
          const mockResult = { id: "def456", notes: [] };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "suggest",
            project_id: "test/project",
            merge_request_iid: 1,
            position: {
              base_sha: "abc123",
              head_sha: "def456",
              start_sha: "ghi789",
              new_path: "src/file.ts",
              new_line: 10,
            },
            suggestion: "const x = 1;",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              body: {
                body: "```suggestion\nconst x = 1;\n```",
                "position[base_sha]": "abc123",
                "position[head_sha]": "def456",
                "position[start_sha]": "ghi789",
                "position[new_path]": "src/file.ts",
                "position[new_line]": 10,
              },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should create a code suggestion with line range", async () => {
          const mockResult = { id: "def456", notes: [] };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "suggest",
            project_id: "test/project",
            merge_request_iid: 1,
            position: {
              base_sha: "abc123",
              head_sha: "def456",
              start_sha: "ghi789",
              new_path: "src/file.ts",
              new_line: 10,
            },
            suggestion: "const x = 1;\nconst y = 2;",
            lines_above: 2,
            lines_below: 1,
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              body: {
                body: "```suggestion:-2+1\nconst x = 1;\nconst y = 2;\n```",
                "position[base_sha]": "abc123",
                "position[head_sha]": "def456",
                "position[start_sha]": "ghi789",
                "position[new_path]": "src/file.ts",
                "position[new_line]": 10,
              },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });

        it("should create a code suggestion with comment", async () => {
          const mockResult = { id: "def456", notes: [] };
          mockGitlab.post.mockResolvedValueOnce(mockResult);

          const tool = mrsToolRegistry.get("manage_mr_discussion")!;
          const result = await tool.handler({
            action: "suggest",
            project_id: "test/project",
            merge_request_iid: 1,
            position: {
              base_sha: "abc123",
              head_sha: "def456",
              start_sha: "ghi789",
              new_path: "src/file.ts",
              new_line: 10,
            },
            suggestion: "const x = 1;",
            comment: "Consider using const instead of let",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/discussions",
            expect.objectContaining({
              body: {
                body: "Consider using const instead of let\n\n```suggestion\nconst x = 1;\n```",
                "position[base_sha]": "abc123",
                "position[head_sha]": "def456",
                "position[start_sha]": "ghi789",
                "position[new_path]": "src/file.ts",
                "position[new_line]": 10,
              },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockResult);
        });
      });
    });

    describe("manage_draft_notes handler", () => {
      describe("action: create", () => {
        it("should create draft note", async () => {
          const mockNote = { id: 1, note: "Draft comment" };
          mockGitlab.post.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "create",
            project_id: "test/project",
            merge_request_iid: 1,
            note: "Draft comment",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes",
            expect.objectContaining({
              body: { note: "Draft comment" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });

        it("should create draft note with in_reply_to_discussion_id", async () => {
          const mockNote = { id: 2, note: "Reply draft" };
          mockGitlab.post.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "create",
            project_id: "test/project",
            merge_request_iid: 1,
            note: "Reply draft",
            in_reply_to_discussion_id: "abc123",
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes",
            expect.objectContaining({
              body: {
                note: "Reply draft",
                in_reply_to_discussion_id: "abc123",
              },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });
      });

      describe("action: update", () => {
        it("should update draft note", async () => {
          const mockNote = { id: 1, note: "Updated draft" };
          mockGitlab.put.mockResolvedValueOnce(mockNote);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "update",
            project_id: "test/project",
            merge_request_iid: 1,
            draft_note_id: 1,
            note: "Updated draft",
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes/1",
            expect.objectContaining({
              body: { note: "Updated draft" },
              contentType: "form",
            })
          );
          expect(result).toEqual(mockNote);
        });
      });

      describe("action: publish", () => {
        it("should publish draft note", async () => {
          // gitlab.put returns undefined for 204 No Content
          mockGitlab.put.mockResolvedValueOnce(undefined);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "publish",
            project_id: "test/project",
            merge_request_iid: 1,
            draft_note_id: 1,
          });

          expect(mockGitlab.put).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes/1/publish"
          );
          expect(result).toEqual({ published: true });
        });
      });

      describe("action: publish_all", () => {
        it("should bulk publish draft notes", async () => {
          // gitlab.post returns undefined for 204 No Content
          mockGitlab.post.mockResolvedValueOnce(undefined);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "publish_all",
            project_id: "test/project",
            merge_request_iid: 1,
          });

          expect(mockGitlab.post).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes/bulk_publish"
          );
          expect(result).toEqual({ published: true });
        });
      });

      describe("action: delete", () => {
        it("should delete draft note", async () => {
          mockGitlab.delete.mockResolvedValueOnce(undefined);

          const tool = mrsToolRegistry.get("manage_draft_notes")!;
          const result = await tool.handler({
            action: "delete",
            project_id: "test/project",
            merge_request_iid: 1,
            draft_note_id: 1,
          });

          expect(mockGitlab.delete).toHaveBeenCalledWith(
            "projects/test%2Fproject/merge_requests/1/draft_notes/1"
          );
          expect(result).toEqual({ success: true, message: "Draft note deleted successfully" });
        });
      });
    });

    describe("Error handling", () => {
      it("should handle validation errors", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Test with invalid action
        await expect(
          tool.handler({
            action: "invalid_action",
            project_id: "test/project",
          })
        ).rejects.toThrow();
      });

      it("should handle API errors with proper error messages", async () => {
        mockGitlab.get.mockRejectedValueOnce(new Error("GitLab API error: 500 Error"));

        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        await expect(
          tool.handler({
            action: "list",
            project_id: "test/project",
          })
        ).rejects.toThrow("GitLab API error: 500 Error");
      });

      it("should handle network errors", async () => {
        mockGitlab.get.mockRejectedValueOnce(new Error("Network error"));

        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        await expect(
          tool.handler({
            action: "get",
            project_id: "test/project",
            merge_request_iid: 1,
          })
        ).rejects.toThrow("Network error");
      });
    });

    describe("Schema validation - superRefine checks", () => {
      it("should reject list-only fields in get action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'state' (list-only field) with 'get' action should fail
        await expect(
          tool.handler({
            action: "get",
            project_id: "test/project",
            merge_request_iid: 1,
            state: "opened", // list-only field
          })
        ).rejects.toThrow();
      });

      it("should reject compare-only fields in list action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'from' (compare-only field) with 'list' action should fail
        await expect(
          tool.handler({
            action: "list",
            project_id: "test/project",
            from: "main", // compare-only field
          })
        ).rejects.toThrow();
      });

      it("should reject get-only fields in list action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'merge_request_iid' (get-only field) with 'list' action should fail
        await expect(
          tool.handler({
            action: "list",
            project_id: "test/project",
            merge_request_iid: 1, // get-only field
          })
        ).rejects.toThrow();
      });

      it("should reject diffs-only fields in list action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'exclude_lockfiles' (diffs-only field) with 'list' action should fail
        await expect(
          tool.handler({
            action: "list",
            project_id: "test/project",
            exclude_lockfiles: true, // diffs-only field
          })
        ).rejects.toThrow();
      });

      it("should reject diffs-only fields in get action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'exclude_patterns' (diffs-only field) with 'get' action should fail
        await expect(
          tool.handler({
            action: "get",
            project_id: "test/project",
            merge_request_iid: 1,
            exclude_patterns: ["*.lock"], // diffs-only field
          })
        ).rejects.toThrow();
      });

      it("should reject diffs-only fields in compare action", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'exclude_generated' (diffs-only field) with 'compare' action should fail
        await expect(
          tool.handler({
            action: "compare",
            project_id: "test/project",
            from: "main",
            to: "feature",
            exclude_generated: true, // diffs-only field
          })
        ).rejects.toThrow();
      });

      it("should accept valid combination of action and fields", async () => {
        mockGitlab.get.mockResolvedValueOnce([{ id: 1, iid: 1 }]);
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // list action with list-only fields should work
        const result = await tool.handler({
          action: "list",
          project_id: "test/project",
          state: "opened",
          per_page: 10,
        });

        expect(result).toBeDefined();
      });

      it("should reject version_id in non-version actions", async () => {
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // Using 'version_id' (version-only field) with 'list' action should fail
        await expect(
          tool.handler({
            action: "list",
            project_id: "test/project",
            version_id: "123", // version-only field
          })
        ).rejects.toThrow();
      });

      it("should accept version_id in version action", async () => {
        mockGitlab.get.mockResolvedValueOnce({ id: 123, diffs: [] });
        const tool = mrsToolRegistry.get("browse_merge_requests")!;

        // version action with version_id should work
        const result = await tool.handler({
          action: "version",
          project_id: "test/project",
          merge_request_iid: 1,
          version_id: "123",
        });

        expect(result).toBeDefined();
      });
    });
  });
});
