import {
  membersToolRegistry,
  getMembersReadOnlyToolNames,
  getMembersToolDefinitions,
  getFilteredMembersTools,
} from "../../../../src/entities/members/registry";
// Import from index.ts to cover re-exports
import {
  BrowseMembersSchema,
  ManageMemberSchema,
  membersToolRegistry as indexMembersToolRegistry,
} from "../../../../src/entities/members";
import { gitlab } from "../../../../src/utils/gitlab-api";
import { isActionDenied } from "../../../../src/config";

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
const mockIsActionDenied = isActionDenied as jest.MockedFunction<typeof isActionDenied>;

describe("Members Tool Registry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("browse_members tool", () => {
    const browseMembersTool = membersToolRegistry.get("browse_members");

    it("should be registered in the registry", () => {
      expect(browseMembersTool).toBeDefined();
      expect(browseMembersTool?.name).toBe("browse_members");
    });

    describe("list_project action", () => {
      it("should list project members with minimal params", async () => {
        const mockMembers = [
          { id: 1, username: "john", access_level: 30 },
          { id: 2, username: "jane", access_level: 40 },
        ];
        mockGitlab.get.mockResolvedValue(mockMembers);

        const result = await browseMembersTool?.handler({
          action: "list_project",
          project_id: "my-group/my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-group%2Fmy-project/members",
          expect.any(Object)
        );
        expect(result).toEqual(mockMembers);
      });

      it("should list project members with query filter", async () => {
        mockGitlab.get.mockResolvedValue([{ id: 1, username: "john" }]);

        await browseMembersTool?.handler({
          action: "list_project",
          project_id: "123",
          query: "john",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/123/members",
          expect.objectContaining({
            query: expect.objectContaining({ query: "john" }),
          })
        );
      });
    });

    describe("list_group action", () => {
      it("should list group members with minimal params", async () => {
        const mockMembers = [{ id: 1, username: "admin", access_level: 50 }];
        mockGitlab.get.mockResolvedValue(mockMembers);

        const result = await browseMembersTool?.handler({
          action: "list_group",
          group_id: "my-group",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("groups/my-group/members", expect.any(Object));
        expect(result).toEqual(mockMembers);
      });
    });

    describe("get_project action", () => {
      it("should get a specific project member", async () => {
        const mockMember = { id: 123, username: "john", access_level: 30 };
        mockGitlab.get.mockResolvedValue(mockMember);

        const result = await browseMembersTool?.handler({
          action: "get_project",
          project_id: "my-project",
          user_id: "123",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/my-project/members/123");
        expect(result).toEqual(mockMember);
      });

      it("should get member with include_inherited", async () => {
        mockGitlab.get.mockResolvedValue({ id: 123, username: "john" });

        await browseMembersTool?.handler({
          action: "get_project",
          project_id: "my-project",
          user_id: "123",
          include_inherited: true,
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("projects/my-project/members/all/123");
      });
    });

    describe("get_group action", () => {
      it("should get a specific group member", async () => {
        const mockMember = { id: 456, username: "jane", access_level: 40 };
        mockGitlab.get.mockResolvedValue(mockMember);

        const result = await browseMembersTool?.handler({
          action: "get_group",
          group_id: "my-group",
          user_id: "456",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("groups/my-group/members/456");
        expect(result).toEqual(mockMember);
      });

      it("should get member with include_inherited", async () => {
        mockGitlab.get.mockResolvedValue({ id: 456, username: "jane" });

        await browseMembersTool?.handler({
          action: "get_group",
          group_id: "my-group",
          user_id: "456",
          include_inherited: true,
        });

        expect(mockGitlab.get).toHaveBeenCalledWith("groups/my-group/members/all/456");
      });
    });

    describe("list_all_project action", () => {
      it("should list all project members including inherited", async () => {
        const mockMembers = [
          { id: 1, username: "john" },
          { id: 2, username: "jane" },
        ];
        mockGitlab.get.mockResolvedValue(mockMembers);

        const result = await browseMembersTool?.handler({
          action: "list_all_project",
          project_id: "my-project",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-project/members/all",
          expect.any(Object)
        );
        expect(result).toEqual(mockMembers);
      });

      it("should accept state filter", async () => {
        mockGitlab.get.mockResolvedValue([]);

        await browseMembersTool?.handler({
          action: "list_all_project",
          project_id: "my-project",
          state: "active",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "projects/my-project/members/all",
          expect.objectContaining({
            query: expect.objectContaining({ state: "active" }),
          })
        );
      });
    });

    describe("list_all_group action", () => {
      it("should list all group members including inherited", async () => {
        const mockMembers = [{ id: 1, username: "admin" }];
        mockGitlab.get.mockResolvedValue(mockMembers);

        const result = await browseMembersTool?.handler({
          action: "list_all_group",
          group_id: "my-group",
        });

        expect(mockGitlab.get).toHaveBeenCalledWith(
          "groups/my-group/members/all",
          expect.any(Object)
        );
        expect(result).toEqual(mockMembers);
      });
    });
  });

  describe("manage_member tool", () => {
    const manageMemberTool = membersToolRegistry.get("manage_member");

    it("should be registered in the registry", () => {
      expect(manageMemberTool).toBeDefined();
      expect(manageMemberTool?.name).toBe("manage_member");
    });

    describe("add_to_project action", () => {
      it("should add member to project", async () => {
        const mockMember = { id: 123, username: "john", access_level: 30 };
        mockGitlab.post.mockResolvedValue(mockMember);

        const result = await manageMemberTool?.handler({
          action: "add_to_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 30,
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/members", {
          body: { user_id: "123", access_level: 30 },
          contentType: "json",
        });
        expect(result).toEqual(mockMember);
      });

      it("should add member with expires_at", async () => {
        mockGitlab.post.mockResolvedValue({ id: 123 });

        await manageMemberTool?.handler({
          action: "add_to_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 30,
          expires_at: "2025-12-31",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("projects/my-project/members", {
          body: { user_id: "123", access_level: 30, expires_at: "2025-12-31" },
          contentType: "json",
        });
      });
    });

    describe("add_to_group action", () => {
      it("should add member to group", async () => {
        const mockMember = { id: 456, username: "jane", access_level: 40 };
        mockGitlab.post.mockResolvedValue(mockMember);

        const result = await manageMemberTool?.handler({
          action: "add_to_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 40,
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("groups/my-group/members", {
          body: { user_id: "456", access_level: 40 },
          contentType: "json",
        });
        expect(result).toEqual(mockMember);
      });

      it("should add member with expires_at", async () => {
        mockGitlab.post.mockResolvedValue({ id: 456 });

        await manageMemberTool?.handler({
          action: "add_to_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 40,
          expires_at: "2026-06-30",
        });

        expect(mockGitlab.post).toHaveBeenCalledWith("groups/my-group/members", {
          body: { user_id: "456", access_level: 40, expires_at: "2026-06-30" },
          contentType: "json",
        });
      });
    });

    describe("remove_from_project action", () => {
      it("should remove member from project", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageMemberTool?.handler({
          action: "remove_from_project",
          project_id: "my-project",
          user_id: "123",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith("projects/my-project/members/123", {
          query: {},
        });
        expect(result).toEqual({ removed: true, project_id: "my-project", user_id: "123" });
      });

      it("should remove with skip_subresources and unassign_issuables", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        await manageMemberTool?.handler({
          action: "remove_from_project",
          project_id: "my-project",
          user_id: "123",
          skip_subresources: true,
          unassign_issuables: true,
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith("projects/my-project/members/123", {
          query: { skip_subresources: true, unassign_issuables: true },
        });
      });
    });

    describe("remove_from_group action", () => {
      it("should remove member from group", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        const result = await manageMemberTool?.handler({
          action: "remove_from_group",
          group_id: "my-group",
          user_id: "456",
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith("groups/my-group/members/456", {
          query: {},
        });
        expect(result).toEqual({ removed: true, group_id: "my-group", user_id: "456" });
      });

      it("should remove with skip_subresources", async () => {
        mockGitlab.delete.mockResolvedValue(undefined);

        await manageMemberTool?.handler({
          action: "remove_from_group",
          group_id: "my-group",
          user_id: "456",
          skip_subresources: false,
        });

        expect(mockGitlab.delete).toHaveBeenCalledWith("groups/my-group/members/456", {
          query: { skip_subresources: false },
        });
      });
    });

    describe("update_project action", () => {
      it("should update project member access level", async () => {
        const mockMember = { id: 123, username: "john", access_level: 40 };
        mockGitlab.put.mockResolvedValue(mockMember);

        const result = await manageMemberTool?.handler({
          action: "update_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 40,
        });

        expect(mockGitlab.put).toHaveBeenCalledWith("projects/my-project/members/123", {
          body: { access_level: 40 },
          contentType: "json",
        });
        expect(result).toEqual(mockMember);
      });

      it("should update with expires_at", async () => {
        mockGitlab.put.mockResolvedValue({ id: 123 });

        await manageMemberTool?.handler({
          action: "update_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 50,
          expires_at: "2027-01-01",
        });

        expect(mockGitlab.put).toHaveBeenCalledWith("projects/my-project/members/123", {
          body: { access_level: 50, expires_at: "2027-01-01" },
          contentType: "json",
        });
      });
    });

    describe("update_group action", () => {
      it("should update group member access level", async () => {
        const mockMember = { id: 456, username: "jane", access_level: 50 };
        mockGitlab.put.mockResolvedValue(mockMember);

        const result = await manageMemberTool?.handler({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 50,
        });

        expect(mockGitlab.put).toHaveBeenCalledWith("groups/my-group/members/456", {
          body: { access_level: 50 },
          contentType: "json",
        });
        expect(result).toEqual(mockMember);
      });

      it("should update with member_role_id (Ultimate)", async () => {
        mockGitlab.put.mockResolvedValue({ id: 456 });

        await manageMemberTool?.handler({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 30,
          member_role_id: 5,
        });

        expect(mockGitlab.put).toHaveBeenCalledWith("groups/my-group/members/456", {
          body: { access_level: 30, member_role_id: 5 },
          contentType: "json",
        });
      });

      it("should update with expires_at", async () => {
        mockGitlab.put.mockResolvedValue({ id: 456 });

        await manageMemberTool?.handler({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 40,
          expires_at: "2028-12-31",
        });

        expect(mockGitlab.put).toHaveBeenCalledWith("groups/my-group/members/456", {
          body: { access_level: 40, expires_at: "2028-12-31" },
          contentType: "json",
        });
      });
    });
  });

  describe("Action denied handling", () => {
    const browseMembersTool = membersToolRegistry.get("browse_members");
    const manageMemberTool = membersToolRegistry.get("manage_member");

    it("should throw error when browse_members action is denied", async () => {
      mockIsActionDenied.mockReturnValueOnce(true);

      await expect(
        browseMembersTool?.handler({
          action: "list_project",
          project_id: "my-project",
        })
      ).rejects.toThrow("Action 'list_project' is not allowed for browse_members tool");
    });

    it("should throw error when manage_member action is denied", async () => {
      mockIsActionDenied.mockReturnValueOnce(true);

      await expect(
        manageMemberTool?.handler({
          action: "add_to_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 30,
        })
      ).rejects.toThrow("Action 'add_to_project' is not allowed for manage_member tool");
    });
  });

  describe("Index re-exports", () => {
    it("should export BrowseMembersSchema from index", () => {
      expect(BrowseMembersSchema).toBeDefined();
      const result = BrowseMembersSchema.safeParse({
        action: "list_project",
        project_id: "test",
      });
      expect(result.success).toBe(true);
    });

    it("should export ManageMemberSchema from index", () => {
      expect(ManageMemberSchema).toBeDefined();
      const result = ManageMemberSchema.safeParse({
        action: "add_to_project",
        project_id: "test",
        user_id: "1",
        access_level: 30,
      });
      expect(result.success).toBe(true);
    });

    it("should export membersToolRegistry from index", () => {
      expect(indexMembersToolRegistry).toBeDefined();
      expect(indexMembersToolRegistry.has("browse_members")).toBe(true);
      expect(indexMembersToolRegistry.has("manage_member")).toBe(true);
    });
  });

  describe("Helper functions", () => {
    it("getMembersReadOnlyToolNames should return browse_members", () => {
      const readOnlyNames = getMembersReadOnlyToolNames();
      expect(readOnlyNames).toEqual(["browse_members"]);
    });

    it("getMembersToolDefinitions should return all tool definitions", () => {
      const definitions = getMembersToolDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map(d => d.name)).toEqual(["browse_members", "manage_member"]);
    });

    it("getFilteredMembersTools should return all tools when readOnlyMode is false", () => {
      const tools = getFilteredMembersTools(false);
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toEqual(["browse_members", "manage_member"]);
    });

    it("getFilteredMembersTools should return only read-only tools when readOnlyMode is true", () => {
      const tools = getFilteredMembersTools(true);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("browse_members");
    });

    it("getFilteredMembersTools should default to readOnlyMode false", () => {
      const tools = getFilteredMembersTools();
      expect(tools).toHaveLength(2);
    });
  });

  describe("Registry exports", () => {
    it("should have browse_members and manage_member tools", () => {
      expect(membersToolRegistry.has("browse_members")).toBe(true);
      expect(membersToolRegistry.has("manage_member")).toBe(true);
      expect(membersToolRegistry.size).toBe(2);
    });
  });
});
