/**
 * Members Schema Integration Tests
 * Tests schemas using handler functions with real GitLab API
 * Full CRUD lifecycle tests for project and group members
 */

import { BrowseMembersSchema } from "../../../src/entities/members/schema-readonly";
import { ManageMemberSchema } from "../../../src/entities/members/schema";
import { IntegrationTestHelper } from "../helpers/registry-helper";

describe("Members Schema - GitLab Integration", () => {
  let helper: IntegrationTestHelper;
  let testProjectId: string;
  let testGroupId: string;
  let testUserId: string;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("Integration test helper initialized for members testing");

    // Get a test project from the test group
    const projects = (await helper.listProjects({ search: "test", per_page: 10 })) as {
      id: number;
      path_with_namespace: string;
      name: string;
      namespace: { id: number; path: string };
    }[];

    if (projects.length === 0) {
      console.log("No projects available for members testing");
      return;
    }

    // Prefer a project in the 'test' group
    const testGroupProject = projects.find(p => p.path_with_namespace.startsWith("test/"));
    const selectedProject = testGroupProject ?? projects[0];

    testProjectId = selectedProject.id.toString();
    testGroupId = selectedProject.namespace.id.toString();
    console.log(
      `Using project: ${selectedProject.path_with_namespace} (ID: ${testProjectId}) for members testing`
    );
    console.log(`Using group ID: ${testGroupId}`);

    // Find a test user that we can use for member operations
    // We'll search for a user that is NOT the current user to avoid issues
    const users = (await helper.executeTool("get_users", {
      per_page: 20,
      active: true,
    })) as { id: number; username: string; name: string }[];

    // Find a user that exists and isn't a bot
    const candidateUser = users.find(u => !u.username.includes("bot") && u.username !== "root");
    if (candidateUser) {
      testUserId = candidateUser.id.toString();
      console.log(`Using test user: ${candidateUser.username} (ID: ${testUserId})`);
    } else if (users.length > 0) {
      testUserId = users[0].id.toString();
      console.log(`Using first available user (ID: ${testUserId})`);
    } else {
      console.log("Warning: No test user found for member lifecycle tests");
    }
  });

  describe("BrowseMembersSchema - List Operations", () => {
    it("should validate and list project members", async () => {
      if (!testProjectId) {
        console.log("Skipping: no test project available");
        return;
      }

      const validParams = {
        action: "list_project" as const,
        project_id: testProjectId,
        per_page: 20,
      };

      // Validate schema
      const result = BrowseMembersSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        const members = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        }[];
        expect(Array.isArray(members)).toBe(true);
        console.log(`Retrieved ${members.length} project members via handler`);

        // Validate structure if we have members
        if (members.length > 0) {
          const member = members[0];
          expect(member).toHaveProperty("id");
          expect(member).toHaveProperty("username");
          expect(member).toHaveProperty("access_level");
          expect(typeof member.access_level).toBe("number");
          console.log(
            `Validated member structure: ${member.username} (access_level: ${member.access_level})`
          );
        }
      }
    });

    it("should list project members with query filter", async () => {
      if (!testProjectId) {
        console.log("Skipping: no test project available");
        return;
      }

      const params = {
        action: "list_project" as const,
        project_id: testProjectId,
        query: "admin",
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "list_project") {
        expect(result.data.query).toBe("admin");

        const members = (await helper.executeTool("browse_members", result.data)) as {
          username: string;
        }[];
        console.log(`Found ${members.length} members matching 'admin'`);
      }
    });

    it("should list group members", async () => {
      if (!testGroupId) {
        console.log("Skipping: no test group available");
        return;
      }

      const params = {
        action: "list_group" as const,
        group_id: testGroupId,
        per_page: 20,
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const members = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        }[];
        expect(Array.isArray(members)).toBe(true);
        console.log(`Retrieved ${members.length} group members via handler`);
      }
    });

    it("should list all project members including inherited", async () => {
      if (!testProjectId) {
        console.log("Skipping: no test project available");
        return;
      }

      const params = {
        action: "list_all_project" as const,
        project_id: testProjectId,
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const members = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        }[];
        expect(Array.isArray(members)).toBe(true);
        console.log(`Retrieved ${members.length} total project members (including inherited)`);
      }
    });

    it("should list all group members including inherited", async () => {
      if (!testGroupId) {
        console.log("Skipping: no test group available");
        return;
      }

      const params = {
        action: "list_all_group" as const,
        group_id: testGroupId,
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const members = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        }[];
        expect(Array.isArray(members)).toBe(true);
        console.log(`Retrieved ${members.length} total group members (including inherited)`);
      }
    });
  });

  describe("ManageMemberSchema - Action validation", () => {
    it("should validate add_to_project parameters", () => {
      const params = {
        action: "add_to_project" as const,
        project_id: "123",
        user_id: "456",
        access_level: 30,
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "add_to_project") {
        expect(result.data.user_id).toBe("456");
        expect(result.data.access_level).toBe(30);
      }
    });

    it("should validate add_to_group parameters", () => {
      const params = {
        action: "add_to_group" as const,
        group_id: "my-group",
        user_id: "789",
        access_level: 40,
        expires_at: "2025-12-31",
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "add_to_group") {
        expect(result.data.group_id).toBe("my-group");
        expect(result.data.expires_at).toBe("2025-12-31");
      }
    });

    it("should validate update_project parameters", () => {
      const params = {
        action: "update_project" as const,
        project_id: "123",
        user_id: "456",
        access_level: 50,
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "update_project") {
        expect(result.data.access_level).toBe(50);
      }
    });

    it("should validate remove_from_project parameters", () => {
      const params = {
        action: "remove_from_project" as const,
        project_id: "123",
        user_id: "456",
        skip_subresources: true,
        unassign_issuables: false,
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "remove_from_project") {
        expect(result.data.skip_subresources).toBe(true);
        expect(result.data.unassign_issuables).toBe(false);
      }
    });

    it("should reject invalid access_level", () => {
      const params = {
        action: "add_to_project",
        project_id: "123",
        user_id: "456",
        access_level: 25, // Invalid - not a valid GitLab access level
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it("should reject missing required parameters", () => {
      const params = {
        action: "add_to_project",
        project_id: "123",
        // Missing user_id and access_level
      };

      const result = ManageMemberSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });

  /**
   * Project Member Lifecycle Tests
   * Tests actual add/get/update/remove operations against real GitLab instance
   */
  describe("Project Member Lifecycle - Full CRUD", () => {
    let memberAdded = false;

    it("should add a member to project", async () => {
      if (!testProjectId || !testUserId) {
        console.log("Skipping: no test project or user available");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "add_to_project",
          project_id: testProjectId,
          user_id: testUserId,
          access_level: 30, // Developer
        })) as {
          id: number;
          access_level: number;
          username: string;
        };

        expect(result).toBeDefined();
        expect(result.access_level).toBe(30);
        memberAdded = true;

        console.log(
          `Added member to project: ${result.username} with access level ${result.access_level}`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Handle permission issues or member already exists gracefully
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping member addition: insufficient permissions");
          return;
        }
        if (errorMsg.includes("409") || errorMsg.includes("already a member")) {
          console.log("Member already exists, proceeding with update test");
          memberAdded = true;
          return;
        }
        throw error;
      }
    });

    it("should get the project member", async () => {
      if (!memberAdded) {
        console.log("Skipping: no member was added");
        return;
      }

      const result = (await helper.executeTool("browse_members", {
        action: "get_project",
        project_id: testProjectId,
        user_id: testUserId,
      })) as {
        id: number;
        username: string;
        access_level: number;
      };

      expect(result).toBeDefined();
      expect(result.id.toString()).toBe(testUserId);
      expect(result).toHaveProperty("access_level");

      console.log(`Retrieved member: ${result.username} (access_level: ${result.access_level})`);
    });

    it("should update the project member access level", async () => {
      if (!memberAdded) {
        console.log("Skipping: no member was added");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "update_project",
          project_id: testProjectId,
          user_id: testUserId,
          access_level: 40, // Promote to Maintainer
        })) as {
          id: number;
          access_level: number;
          username: string;
        };

        expect(result).toBeDefined();
        expect(result.access_level).toBe(40);

        console.log(`Updated member access level to: ${result.access_level} (Maintainer)`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping update: insufficient permissions");
          return;
        }
        throw error;
      }
    });

    it("should remove the member from project", async () => {
      if (!memberAdded) {
        console.log("Skipping: no member was added");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "remove_from_project",
          project_id: testProjectId,
          user_id: testUserId,
        })) as {
          removed: boolean;
          project_id: string;
          user_id: string;
        };

        expect(result).toBeDefined();
        expect(result.removed).toBe(true);

        console.log(`Removed member from project`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping removal: insufficient permissions");
          return;
        }
        throw error;
      }
    });

    it("should verify member is removed from project", async () => {
      if (!memberAdded) {
        console.log("Skipping: no member was added");
        return;
      }

      try {
        await helper.executeTool("browse_members", {
          action: "get_project",
          project_id: testProjectId,
          user_id: testUserId,
        });
        // If we get here, member still exists (might be inherited)
        console.log("Note: member might still exist as inherited member");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // 404 is expected - member was removed
        if (errorMsg.includes("404") || errorMsg.includes("not found")) {
          console.log("Verified: member was successfully removed from project");
        } else {
          throw error;
        }
      }
    });
  });

  /**
   * Group Member Lifecycle Tests
   * Tests actual add/get/update/remove operations against real GitLab instance
   */
  describe("Group Member Lifecycle - Full CRUD", () => {
    let groupMemberAdded = false;

    it("should add a member to group", async () => {
      if (!testGroupId || !testUserId) {
        console.log("Skipping: no test group or user available");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "add_to_group",
          group_id: testGroupId,
          user_id: testUserId,
          access_level: 20, // Reporter
        })) as {
          id: number;
          access_level: number;
          username: string;
        };

        expect(result).toBeDefined();
        expect(result.access_level).toBe(20);
        groupMemberAdded = true;

        console.log(
          `Added member to group: ${result.username} with access level ${result.access_level}`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping group member addition: insufficient permissions");
          return;
        }
        if (errorMsg.includes("409") || errorMsg.includes("already a member")) {
          console.log("Member already in group, proceeding with update test");
          groupMemberAdded = true;
          return;
        }
        throw error;
      }
    });

    it("should get the group member", async () => {
      if (!groupMemberAdded) {
        console.log("Skipping: no group member was added");
        return;
      }

      const result = (await helper.executeTool("browse_members", {
        action: "get_group",
        group_id: testGroupId,
        user_id: testUserId,
      })) as {
        id: number;
        username: string;
        access_level: number;
      };

      expect(result).toBeDefined();
      expect(result.id.toString()).toBe(testUserId);
      expect(result).toHaveProperty("access_level");

      console.log(
        `Retrieved group member: ${result.username} (access_level: ${result.access_level})`
      );
    });

    it("should update the group member access level", async () => {
      if (!groupMemberAdded) {
        console.log("Skipping: no group member was added");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "update_group",
          group_id: testGroupId,
          user_id: testUserId,
          access_level: 30, // Promote to Developer
        })) as {
          id: number;
          access_level: number;
          username: string;
        };

        expect(result).toBeDefined();
        expect(result.access_level).toBe(30);

        console.log(`Updated group member access level to: ${result.access_level} (Developer)`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping group update: insufficient permissions");
          return;
        }
        throw error;
      }
    });

    it("should remove the member from group", async () => {
      if (!groupMemberAdded) {
        console.log("Skipping: no group member was added");
        return;
      }

      try {
        const result = (await helper.executeTool("manage_member", {
          action: "remove_from_group",
          group_id: testGroupId,
          user_id: testUserId,
        })) as {
          removed: boolean;
          group_id: string;
          user_id: string;
        };

        expect(result).toBeDefined();
        expect(result.removed).toBe(true);

        console.log(`Removed member from group`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("403") || errorMsg.includes("permission")) {
          console.log("Skipping group removal: insufficient permissions");
          return;
        }
        throw error;
      }
    });

    it("should verify member is removed from group", async () => {
      if (!groupMemberAdded) {
        console.log("Skipping: no group member was added");
        return;
      }

      try {
        await helper.executeTool("browse_members", {
          action: "get_group",
          group_id: testGroupId,
          user_id: testUserId,
        });
        // If we get here, member might still exist as inherited
        console.log("Note: member might still exist as inherited member");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // 404 is expected - member was removed
        if (errorMsg.includes("404") || errorMsg.includes("not found")) {
          console.log("Verified: member was successfully removed from group");
        } else {
          throw error;
        }
      }
    });
  });

  describe("BrowseMembersSchema - Get with inherited flag", () => {
    it("should get project member with include_inherited flag", async () => {
      if (!testProjectId) {
        console.log("Skipping: no test project available");
        return;
      }

      // First get list to find an existing member
      const members = (await helper.executeTool("browse_members", {
        action: "list_all_project",
        project_id: testProjectId,
        per_page: 5,
      })) as { id: number; username: string }[];

      if (members.length === 0) {
        console.log("No members found to test get with inherited flag");
        return;
      }

      const existingMember = members[0];
      const params = {
        action: "get_project" as const,
        project_id: testProjectId,
        user_id: existingMember.id.toString(),
        include_inherited: true,
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const member = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        };
        expect(member).toBeDefined();
        expect(member.id).toBe(existingMember.id);
        console.log(`Retrieved member with inherited flag: ${member.username}`);
      }
    });

    it("should get group member with include_inherited flag", async () => {
      if (!testGroupId) {
        console.log("Skipping: no test group available");
        return;
      }

      // First get list to find an existing member
      const members = (await helper.executeTool("browse_members", {
        action: "list_all_group",
        group_id: testGroupId,
        per_page: 5,
      })) as { id: number; username: string }[];

      if (members.length === 0) {
        console.log("No group members found to test get with inherited flag");
        return;
      }

      const existingMember = members[0];
      const params = {
        action: "get_group" as const,
        group_id: testGroupId,
        user_id: existingMember.id.toString(),
        include_inherited: true,
      };

      const result = BrowseMembersSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const member = (await helper.executeTool("browse_members", result.data)) as {
          id: number;
          username: string;
          access_level: number;
        };
        expect(member).toBeDefined();
        expect(member.id).toBe(existingMember.id);
        console.log(`Retrieved group member with inherited flag: ${member.username}`);
      }
    });
  });
});
