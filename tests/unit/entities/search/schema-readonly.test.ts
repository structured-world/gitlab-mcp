import {
  BrowseSearchSchema,
  SearchScopeSchema,
} from "../../../../src/entities/search/schema-readonly";

describe("BrowseSearchSchema - Discriminated Union", () => {
  describe("global action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "projects",
          search: "test query",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "global") {
          expect(result.data.scope).toBe("projects");
          expect(result.data.search).toBe("test query");
        }
      });

      it("should accept all valid scope values", () => {
        const scopes = [
          "projects",
          "issues",
          "merge_requests",
          "milestones",
          "snippet_titles",
          "users",
          "groups",
          "blobs",
          "commits",
          "wiki_blobs",
          "notes",
        ] as const;

        for (const scope of scopes) {
          const result = BrowseSearchSchema.safeParse({
            action: "global",
            scope,
            search: "test",
          });
          expect(result.success).toBe(true);
        }
      });

      it("should accept state filter for issues scope", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "issues",
          search: "bug",
          state: "opened",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "global") {
          expect(result.data.state).toBe("opened");
        }
      });

      it("should accept all state values", () => {
        const states = ["opened", "closed", "merged", "all"] as const;
        for (const state of states) {
          const result = BrowseSearchSchema.safeParse({
            action: "global",
            scope: "merge_requests",
            search: "feature",
            state,
          });
          expect(result.success).toBe(true);
        }
      });

      it("should accept confidential filter", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "issues",
          search: "secret",
          confidential: true,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "global") {
          expect(result.data.confidential).toBe(true);
        }
      });

      it("should accept order_by and sort options", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "issues",
          search: "test",
          order_by: "updated_at",
          sort: "desc",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "global") {
          expect(result.data.order_by).toBe("updated_at");
          expect(result.data.sort).toBe("desc");
        }
      });

      it("should accept pagination options", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "projects",
          search: "test",
          per_page: 50,
          page: 2,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "global") {
          expect(result.data.per_page).toBe(50);
          expect(result.data.page).toBe(2);
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing search", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "projects",
        });
        expect(result.success).toBe(false);
      });

      it("should reject empty search", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "projects",
          search: "",
        });
        expect(result.success).toBe(false);
      });

      it("should reject missing scope", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          search: "test",
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid scope", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "invalid_scope",
          search: "test",
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid state value", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "issues",
          search: "test",
          state: "invalid",
        });
        expect(result.success).toBe(false);
      });

      it("should reject per_page over 100", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "global",
          scope: "projects",
          search: "test",
          per_page: 101,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("project action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          project_id: "my-group/my-project",
          scope: "blobs",
          search: "function",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "project") {
          expect(result.data.project_id).toBe("my-group/my-project");
          expect(result.data.scope).toBe("blobs");
          expect(result.data.search).toBe("function");
        }
      });

      it("should accept numeric project_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          project_id: 123,
          scope: "commits",
          search: "fix",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "project") {
          expect(result.data.project_id).toBe("123");
        }
      });

      it("should accept ref parameter for code search", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          project_id: "test-project",
          scope: "blobs",
          search: "TODO",
          ref: "develop",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "project") {
          expect(result.data.ref).toBe("develop");
        }
      });

      it("should accept all optional parameters", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          project_id: "test-project",
          scope: "issues",
          search: "bug",
          ref: "main",
          state: "opened",
          confidential: false,
          order_by: "created_at",
          sort: "asc",
          per_page: 25,
          page: 1,
        });
        expect(result.success).toBe(true);
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing project_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          scope: "blobs",
          search: "test",
        });
        expect(result.success).toBe(false);
      });

      it("should reject empty project_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "project",
          project_id: "",
          scope: "blobs",
          search: "test",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("group action", () => {
    describe("Valid inputs", () => {
      it("should accept minimal valid input", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "group",
          group_id: "my-group",
          scope: "issues",
          search: "feature",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "group") {
          expect(result.data.group_id).toBe("my-group");
          expect(result.data.scope).toBe("issues");
          expect(result.data.search).toBe("feature");
        }
      });

      it("should accept numeric group_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "group",
          group_id: 456,
          scope: "merge_requests",
          search: "refactor",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "group") {
          expect(result.data.group_id).toBe("456");
        }
      });

      it("should accept state and other filters", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "group",
          group_id: "test-group",
          scope: "merge_requests",
          search: "fix",
          state: "merged",
          order_by: "updated_at",
          sort: "desc",
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.action === "group") {
          expect(result.data.state).toBe("merged");
          expect(result.data.order_by).toBe("updated_at");
          expect(result.data.sort).toBe("desc");
        }
      });
    });

    describe("Invalid inputs", () => {
      it("should reject missing group_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "group",
          scope: "issues",
          search: "test",
        });
        expect(result.success).toBe(false);
      });

      it("should reject empty group_id", () => {
        const result = BrowseSearchSchema.safeParse({
          action: "group",
          group_id: "",
          scope: "issues",
          search: "test",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("Discriminated Union behavior", () => {
    it("should correctly narrow types based on action", () => {
      const globalResult = BrowseSearchSchema.safeParse({
        action: "global",
        scope: "projects",
        search: "test",
      });
      const projectResult = BrowseSearchSchema.safeParse({
        action: "project",
        project_id: "test-project",
        scope: "blobs",
        search: "function",
      });
      const groupResult = BrowseSearchSchema.safeParse({
        action: "group",
        group_id: "test-group",
        scope: "issues",
        search: "bug",
      });

      expect(globalResult.success).toBe(true);
      expect(projectResult.success).toBe(true);
      expect(groupResult.success).toBe(true);

      if (globalResult.success) {
        expect(globalResult.data.action).toBe("global");
      }
      if (projectResult.success) {
        expect(projectResult.data.action).toBe("project");
      }
      if (groupResult.success) {
        expect(groupResult.data.action).toBe("group");
      }
    });

    it("should reject unknown action values", () => {
      const result = BrowseSearchSchema.safeParse({
        action: "unknown",
        scope: "projects",
        search: "test",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = BrowseSearchSchema.safeParse({
        scope: "projects",
        search: "test",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("SearchScopeSchema", () => {
  it("should accept all valid scopes", () => {
    const validScopes = [
      "projects",
      "issues",
      "merge_requests",
      "milestones",
      "snippet_titles",
      "users",
      "groups",
      "blobs",
      "commits",
      "wiki_blobs",
      "notes",
    ];

    for (const scope of validScopes) {
      const result = SearchScopeSchema.safeParse(scope);
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid scopes", () => {
    const invalidScopes = ["invalid", "code", "files", "repositories", ""];

    for (const scope of invalidScopes) {
      const result = SearchScopeSchema.safeParse(scope);
      expect(result.success).toBe(false);
    }
  });
});
