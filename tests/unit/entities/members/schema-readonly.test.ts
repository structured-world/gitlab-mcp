import { BrowseMembersSchema } from "../../../../src/entities/members/schema-readonly";

describe("BrowseMembersSchema - Discriminated Union", () => {
  describe("list_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: "my-group/my-project",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_project") {
          expect(result.data.project_id).toBe("my-group/my-project");
        }
      });

      it("should accept numeric project_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: 123,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_project") {
          expect(result.data.project_id).toBe("123");
        }
      });

      it("should accept query filter", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: "test-project",
          query: "john",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_project") {
          expect(result.data.query).toBe("john");
        }
      });

      it("should accept user_ids filter", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: "test-project",
          user_ids: ["1", "2", "3"],
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_project") {
          expect(result.data.user_ids).toEqual(["1", "2", "3"]);
        }
      });

      it("should accept pagination options", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: "test-project",
          per_page: 50,
          page: 2,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_project") {
          expect(result.data.per_page).toBe(50);
          expect(result.data.page).toBe(2);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing project_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
        });
        expect(result.success).toBe(false);
      });

      it("should reject per_page over 100", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_project",
          project_id: "test-project",
          per_page: 101,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("list_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_group",
          group_id: "my-group",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_group") {
          expect(result.data.group_id).toBe("my-group");
        }
      });

      it("should accept query and user_ids filters", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_group",
          group_id: "test-group",
          query: "jane",
          user_ids: ["10", "20"],
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_group") {
          expect(result.data.query).toBe("jane");
          expect(result.data.user_ids).toEqual(["10", "20"]);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_group",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("get_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_project",
          project_id: "my-project",
          user_id: "123",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "get_project") {
          expect(result.data.user_id).toBe("123");
        }
      });

      it("should accept include_inherited option", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_project",
          project_id: "my-project",
          user_id: "123",
          include_inherited: true,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "get_project") {
          expect(result.data.include_inherited).toBe(true);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing user_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_project",
          project_id: "my-project",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("get_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_group",
          group_id: "my-group",
          user_id: "456",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "get_group") {
          expect(result.data.user_id).toBe("456");
        }
      });

      it("should accept include_inherited option", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_group",
          group_id: "my-group",
          user_id: "456",
          include_inherited: false,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "get_group") {
          expect(result.data.include_inherited).toBe(false);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing user_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "get_group",
          group_id: "my-group",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("list_all_project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_project",
          project_id: "my-project",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_all_project") {
          expect(result.data.project_id).toBe("my-project");
        }
      });

      it("should accept state filter", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_project",
          project_id: "my-project",
          state: "active",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_all_project") {
          expect(result.data.state).toBe("active");
        }
      });

      it("should accept all state values", () => {
        const states = ["active", "awaiting", "blocked"] as const;
        for (const state of states) {
          const result = BrowseMembersSchema.safeParse({
            action: "list_all_project",
            project_id: "my-project",
            state,
          });
          expect(result.success).toBe(true);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject invalid state value", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_project",
          project_id: "my-project",
          state: "invalid",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("list_all_group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_group",
          group_id: "my-group",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_all_group") {
          expect(result.data.group_id).toBe("my-group");
        }
      });

      it("should accept state filter", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_group",
          group_id: "my-group",
          state: "blocked",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "list_all_group") {
          expect(result.data.state).toBe("blocked");
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = BrowseMembersSchema.safeParse({
          action: "list_all_group",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("Discriminated Union behavior", () => {
    it("should correctly narrow types based on action", () => {
      const listProjectResult = BrowseMembersSchema.safeParse({
        action: "list_project",
        project_id: "test",
      });
      const listGroupResult = BrowseMembersSchema.safeParse({
        action: "list_group",
        group_id: "test",
      });
      const getProjectResult = BrowseMembersSchema.safeParse({
        action: "get_project",
        project_id: "test",
        user_id: "1",
      });
      const getGroupResult = BrowseMembersSchema.safeParse({
        action: "get_group",
        group_id: "test",
        user_id: "1",
      });

      expect(listProjectResult.success).toBe(true);
      expect(listGroupResult.success).toBe(true);
      expect(getProjectResult.success).toBe(true);
      expect(getGroupResult.success).toBe(true);

      if (listProjectResult.success) {
        expect(listProjectResult.data.action).toBe("list_project");
      }
      if (listGroupResult.success) {
        expect(listGroupResult.data.action).toBe("list_group");
      }
      if (getProjectResult.success) {
        expect(getProjectResult.data.action).toBe("get_project");
      }
      if (getGroupResult.success) {
        expect(getGroupResult.data.action).toBe("get_group");
      }
    });

    it("should reject unknown action values", () => {
      const result = BrowseMembersSchema.safeParse({
        action: "unknown",
        project_id: "test",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = BrowseMembersSchema.safeParse({
        project_id: "test",
      });
      expect(result.success).toBe(false);
    });
  });
});
