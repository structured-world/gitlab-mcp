import { ManageMemberSchema } from "../../../../src/entities/members/schema";

describe("ManageMemberSchema - Discriminated Union", () => {
  describe("add_to_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_project",
          project_id: "my-group/my-project",
          user_id: "123",
          access_level: 30,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "add_to_project") {
          expect(result.data.user_id).toBe("123");
          expect(result.data.access_level).toBe(30);
        }
      });

      it("should accept expires_at option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_project",
          project_id: "test-project",
          user_id: "456",
          access_level: 40,
          expires_at: "2025-12-31",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "add_to_project") {
          expect(result.data.expires_at).toBe("2025-12-31");
        }
      });

      it("should accept all valid access levels", () => {
        const accessLevels = [0, 5, 10, 20, 30, 40, 50];
        for (const level of accessLevels) {
          const result = ManageMemberSchema.safeParse({
            action: "add_to_project",
            project_id: "test",
            user_id: "1",
            access_level: level,
          });
          expect(result.success).toBe(true);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing user_id", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_project",
          project_id: "test-project",
          access_level: 30,
        });
        expect(result.success).toBe(false);
      });

      it("should reject missing access_level", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_project",
          project_id: "test-project",
          user_id: "123",
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid access_level", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_project",
          project_id: "test-project",
          user_id: "123",
          access_level: 25, // Invalid level
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("add_to_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_group",
          group_id: "my-group",
          user_id: "123",
          access_level: 20,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "add_to_group") {
          expect(result.data.group_id).toBe("my-group");
          expect(result.data.access_level).toBe(20);
        }
      });

      it("should accept expires_at option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_group",
          group_id: "test-group",
          user_id: "456",
          access_level: 30,
          expires_at: "2026-06-30",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "add_to_group") {
          expect(result.data.expires_at).toBe("2026-06-30");
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = ManageMemberSchema.safeParse({
          action: "add_to_group",
          user_id: "123",
          access_level: 30,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("remove_from_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_project",
          project_id: "my-project",
          user_id: "123",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "remove_from_project") {
          expect(result.data.user_id).toBe("123");
        }
      });

      it("should accept skip_subresources option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_project",
          project_id: "my-project",
          user_id: "123",
          skip_subresources: true,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "remove_from_project") {
          expect(result.data.skip_subresources).toBe(true);
        }
      });

      it("should accept unassign_issuables option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_project",
          project_id: "my-project",
          user_id: "123",
          unassign_issuables: true,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "remove_from_project") {
          expect(result.data.unassign_issuables).toBe(true);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing user_id", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_project",
          project_id: "my-project",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("remove_from_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_group",
          group_id: "my-group",
          user_id: "456",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "remove_from_group") {
          expect(result.data.user_id).toBe("456");
        }
      });

      it("should accept both optional flags", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_group",
          group_id: "my-group",
          user_id: "456",
          skip_subresources: false,
          unassign_issuables: true,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "remove_from_group") {
          expect(result.data.skip_subresources).toBe(false);
          expect(result.data.unassign_issuables).toBe(true);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = ManageMemberSchema.safeParse({
          action: "remove_from_group",
          user_id: "456",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("update_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 40,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "update_project") {
          expect(result.data.access_level).toBe(40);
        }
      });

      it("should accept expires_at option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_project",
          project_id: "my-project",
          user_id: "123",
          access_level: 50,
          expires_at: "2027-01-01",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "update_project") {
          expect(result.data.expires_at).toBe("2027-01-01");
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing access_level", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_project",
          project_id: "my-project",
          user_id: "123",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("update_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 30,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "update_group") {
          expect(result.data.access_level).toBe(30);
        }
      });

      it("should accept member_role_id option (Ultimate)", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 30,
          member_role_id: 5,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "update_group") {
          expect(result.data.member_role_id).toBe(5);
        }
      });

      it("should accept expires_at option", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_group",
          group_id: "my-group",
          user_id: "456",
          access_level: 40,
          expires_at: "2028-12-31",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "update_group") {
          expect(result.data.expires_at).toBe("2028-12-31");
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = ManageMemberSchema.safeParse({
          action: "update_group",
          user_id: "456",
          access_level: 30,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("Discriminated Union behavior", () => {
    it("should correctly narrow types based on action", () => {
      const addProjectResult = ManageMemberSchema.safeParse({
        action: "add_to_project",
        project_id: "test",
        user_id: "1",
        access_level: 30,
      });
      const addGroupResult = ManageMemberSchema.safeParse({
        action: "add_to_group",
        group_id: "test",
        user_id: "1",
        access_level: 30,
      });
      const removeProjectResult = ManageMemberSchema.safeParse({
        action: "remove_from_project",
        project_id: "test",
        user_id: "1",
      });
      const removeGroupResult = ManageMemberSchema.safeParse({
        action: "remove_from_group",
        group_id: "test",
        user_id: "1",
      });
      const updateProjectResult = ManageMemberSchema.safeParse({
        action: "update_project",
        project_id: "test",
        user_id: "1",
        access_level: 40,
      });
      const updateGroupResult = ManageMemberSchema.safeParse({
        action: "update_group",
        group_id: "test",
        user_id: "1",
        access_level: 40,
      });

      expect(addProjectResult.success).toBe(true);
      expect(addGroupResult.success).toBe(true);
      expect(removeProjectResult.success).toBe(true);
      expect(removeGroupResult.success).toBe(true);
      expect(updateProjectResult.success).toBe(true);
      expect(updateGroupResult.success).toBe(true);

      if (addProjectResult.success) expect(addProjectResult.data.action).toBe("add_to_project");
      if (addGroupResult.success) expect(addGroupResult.data.action).toBe("add_to_group");
      if (removeProjectResult.success)
        expect(removeProjectResult.data.action).toBe("remove_from_project");
      if (removeGroupResult.success)
        expect(removeGroupResult.data.action).toBe("remove_from_group");
      if (updateProjectResult.success)
        expect(updateProjectResult.data.action).toBe("update_project");
      if (updateGroupResult.success) expect(updateGroupResult.data.action).toBe("update_group");
    });

    it("should reject unknown action values", () => {
      const result = ManageMemberSchema.safeParse({
        action: "unknown",
        project_id: "test",
        user_id: "1",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = ManageMemberSchema.safeParse({
        project_id: "test",
        user_id: "1",
        access_level: 30,
      });
      expect(result.success).toBe(false);
    });
  });
});
