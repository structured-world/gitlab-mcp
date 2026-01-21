import { refsToolRegistry } from "../../../../src/entities/refs/registry";
import { gitlab } from "../../../../src/utils/gitlab-api";

// Mock the GitLab API module
jest.mock("../../../../src/utils/gitlab-api", () => ({
  gitlab: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
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

describe("Refs Tool Registry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("browse_refs tool", () => {
    const browseRefsTool = refsToolRegistry.get("browse_refs");

    it("should be registered in the registry", () => {
      expect(browseRefsTool).toBeDefined();
      expect(browseRefsTool?.name).toBe("browse_refs");
    });

    describe("list_branches action", () => {
      it("should list branches with minimal params", async () => {
        const mockBranches = [
          { name: "main", protected: true },
          { name: "develop", protected: false },
        ];
        mockGitlab.get.mockResolvedValue(mockBranches);

        const result = await browseRefsTool?.handler({
          action: "list_branches",
          project_id: "my-group/my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-group%2Fmy-project/repository/branches",
          expect.any(Object)
        );
        expect(result).toEqual(mockBranches);
      });

      it("should list branches with search filter", async () => {
        mockGitlab.get.mockResolvedValue([{ name: "feature/test" }]);

        await browseRefsTool?.handler({
          action: "list_branches",
          project_id: "123",
          search: "feature*",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/123/repository/branches",
          expect.objectContaining({
            query: expect.objectContaining({ search: "feature*" }),
          })
        );
      });
    });

    describe("get_branch action", () => {
      it("should get a specific branch", async () => {
        const mockBranch = { name: "main", protected: true, commit: { id: "abc123" } };
        mockGitlab.get.mockResolvedValue(mockBranch);

        const result = await browseRefsTool?.handler({
          action: "get_branch",
          project_id: "my-project",
          branch: "main",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/my-project/repository/branches/main");
        expect(result).toEqual(mockBranch);
      });

      it("should encode branch names with slashes", async () => {
        mockGitlab.get.mockResolvedValue({ name: "feature/new-feature" });

        await browseRefsTool?.handler({
          action: "get_branch",
          project_id: "123",
          branch: "feature/new-feature",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/123/repository/branches/feature%2Fnew-feature"
        );
      });
    });

    describe("list_tags action", () => {
      it("should list tags with minimal params", async () => {
        const mockTags = [{ name: "v1.0.0" }, { name: "v2.0.0" }];
        mockGitlab.get.mockResolvedValue(mockTags);

        const result = await browseRefsTool?.handler({
          action: "list_tags",
          project_id: "my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-project/repository/tags",
          expect.any(Object)
        );
        expect(result).toEqual(mockTags);
      });

      it("should list tags with order_by and sort", async () => {
        mockGitlab.get.mockResolvedValue([{ name: "v1.0.0" }]);

        await browseRefsTool?.handler({
          action: "list_tags",
          project_id: "123",
          order_by: "version",
          sort: "asc",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/123/repository/tags",
          expect.objectContaining({
            query: expect.objectContaining({ order_by: "version", sort: "asc" }),
          })
        );
      });
    });

    describe("get_tag action", () => {
      it("should get a specific tag", async () => {
        const mockTag = { name: "v1.0.0", message: "Release 1.0.0" };
        mockGitlab.get.mockResolvedValue(mockTag);

        const result = await browseRefsTool?.handler({
          action: "get_tag",
          project_id: "my-project",
          tag_name: "v1.0.0",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/my-project/repository/tags/v1.0.0");
        expect(result).toEqual(mockTag);
      });
    });

    describe("list_protected_branches action", () => {
      it("should list protected branches", async () => {
        const mockProtected = [{ name: "main", push_access_levels: [] }];
        mockGitlab.get.mockResolvedValue(mockProtected);

        const result = await browseRefsTool?.handler({
          action: "list_protected_branches",
          project_id: "my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-project/protected_branches",
          expect.any(Object)
        );
        expect(result).toEqual(mockProtected);
      });
    });

    describe("get_protected_branch action", () => {
      it("should get protection rules for a branch", async () => {
        const mockProtection = { name: "main", push_access_levels: [{ access_level: 40 }] };
        mockGitlab.get.mockResolvedValue(mockProtection);

        const result = await browseRefsTool?.handler({
          action: "get_protected_branch",
          project_id: "my-project",
          name: "main",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/my-project/protected_branches/main");
        expect(result).toEqual(mockProtection);
      });
    });

    describe("list_protected_tags action", () => {
      it("should list protected tags", async () => {
        const mockProtectedTags = [{ name: "v*", create_access_levels: [] }];
        mockGitlab.get.mockResolvedValue(mockProtectedTags);

        const result = await browseRefsTool?.handler({
          action: "list_protected_tags",
          project_id: "my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-project/protected_tags",
          expect.any(Object)
        );
        expect(result).toEqual(mockProtectedTags);
      });
    });
  });

  describe("manage_ref tool", () => {
    const manageRefTool = refsToolRegistry.get("manage_ref");

    it("should be registered in the registry", () => {
      expect(manageRefTool).toBeDefined();
      expect(manageRefTool?.name).toBe("manage_ref");
    });

    describe("create_branch action", () => {
      it("should create a branch", async () => {
        const mockBranch = { name: "feature/test", protected: false };
        mockGitlab.post.mockResolvedValue(mockBranch);

        const result = await manageRefTool?.handler({
          action: "create_branch",
          project_id: "my-project",
          branch: "feature/test",
          ref: "main",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/repository/branches", {
          body: { branch: "feature/test", ref: "main" },
          contentType: "json",
        });
        expect(result).toEqual(mockBranch);
      });
    });

    describe("delete_branch action", () => {
      it("should delete a branch", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageRefTool?.handler({
          action: "delete_branch",
          project_id: "my-project",
          branch: "feature/old",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith(
          "projects/my-project/repository/branches/feature%2Fold"
        );
        expect(result).toEqual({ deleted: true, branch: "feature/old" });
      });
    });

    describe("protect_branch action", () => {
      it("should protect a branch with minimal params", async () => {
        const mockProtection = { name: "main", push_access_levels: [] };
        mockGitlab.post.mockResolvedValue(mockProtection);

        const result = await manageRefTool?.handler({
          action: "protect_branch",
          project_id: "my-project",
          name: "main",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/protected_branches", {
          body: { name: "main" },
          contentType: "json",
        });
        expect(result).toEqual(mockProtection);
      });

      it("should protect a branch with access levels", async () => {
        mockGitlab.post.mockResolvedValue({ name: "main" });

        await manageRefTool?.handler({
          action: "protect_branch",
          project_id: "123",
          name: "release-*",
          push_access_level: 40,
          merge_access_level: 30,
          allow_force_push: false,
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/123/protected_branches", {
          body: {
            name: "release-*",
            push_access_level: 40,
            merge_access_level: 30,
            allow_force_push: false,
          },
          contentType: "json",
        });
      });
    });

    describe("unprotect_branch action", () => {
      it("should unprotect a branch", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageRefTool?.handler({
          action: "unprotect_branch",
          project_id: "my-project",
          name: "old-protected",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith(
          "projects/my-project/protected_branches/old-protected"
        );
        expect(result).toEqual({ unprotected: true, name: "old-protected" });
      });
    });

    describe("update_branch_protection action", () => {
      it("should update branch protection", async () => {
        const mockUpdated = { name: "main", allow_force_push: true };
        mockGitlab.patch.mockResolvedValue(mockUpdated);

        const result = await manageRefTool?.handler({
          action: "update_branch_protection",
          project_id: "my-project",
          name: "main",
          allow_force_push: true,
        });

        expect(mockGitlab.patch).toHaveBeenCalledWith(
          "projects/my-project/protected_branches/main",
          {
            body: { allow_force_push: true },
            contentType: "json",
          }
        );
        expect(result).toEqual(mockUpdated);
      });
    });

    describe("create_tag action", () => {
      it("should create a lightweight tag", async () => {
        const mockTag = { name: "v1.0.0" };
        mockGitlab.post.mockResolvedValue(mockTag);

        const result = await manageRefTool?.handler({
          action: "create_tag",
          project_id: "my-project",
          tag_name: "v1.0.0",
          ref: "main",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/repository/tags", {
          body: { tag_name: "v1.0.0", ref: "main" },
          contentType: "json",
        });
        expect(result).toEqual(mockTag);
      });

      it("should create an annotated tag with message", async () => {
        mockGitlab.post.mockResolvedValue({ name: "v2.0.0" });

        await manageRefTool?.handler({
          action: "create_tag",
          project_id: "123",
          tag_name: "v2.0.0",
          ref: "release-2.0",
          message: "Release 2.0.0",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/123/repository/tags", {
          body: { tag_name: "v2.0.0", ref: "release-2.0", message: "Release 2.0.0" },
          contentType: "json",
        });
      });
    });

    describe("delete_tag action", () => {
      it("should delete a tag", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageRefTool?.handler({
          action: "delete_tag",
          project_id: "my-project",
          tag_name: "v0.9.0",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith(
          "projects/my-project/repository/tags/v0.9.0"
        );
        expect(result).toEqual({ deleted: true, tag_name: "v0.9.0" });
      });
    });

    describe("protect_tag action", () => {
      it("should protect a tag pattern", async () => {
        const mockProtection = { name: "v*", create_access_levels: [] };
        mockGitlab.post.mockResolvedValue(mockProtection);

        const result = await manageRefTool?.handler({
          action: "protect_tag",
          project_id: "my-project",
          name: "v*",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/protected_tags", {
          body: { name: "v*" },
          contentType: "json",
        });
        expect(result).toEqual(mockProtection);
      });

      it("should protect a tag with access level", async () => {
        mockGitlab.post.mockResolvedValue({ name: "release-*" });

        await manageRefTool?.handler({
          action: "protect_tag",
          project_id: "123",
          name: "release-*",
          create_access_level: 40,
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/123/protected_tags", {
          body: { name: "release-*", create_access_level: 40 },
          contentType: "json",
        });
      });
    });

    describe("unprotect_tag action", () => {
      it("should unprotect a tag pattern", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageRefTool?.handler({
          action: "unprotect_tag",
          project_id: "my-project",
          name: "old-*",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith("projects/my-project/protected_tags/old-*");
        expect(result).toEqual({ unprotected: true, name: "old-*" });
      });
    });
  });

  describe("Registry exports", () => {
    it("should have browse_refs and manage_ref tools", () => {
      expect(refsToolRegistry.has("browse_refs")).toBe(true);
      expect(refsToolRegistry.has("manage_ref")).toBe(true);
      expect(refsToolRegistry.size).toBe(2);
    });
  });
});
