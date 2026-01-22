import { BrowseWorkItemsSchema } from "../../../../src/entities/workitems/schema-readonly";

describe("BrowseWorkItemsSchema", () => {
  describe("list action", () => {
    it("should validate list action with namespace", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "list",
        namespace: "group/project",
      });
      expect(result.success).toBe(true);
    });

    it("should validate list action with all parameters", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "list",
        namespace: "group/project",
        types: ["EPIC", "ISSUE"],
        state: ["OPEN", "CLOSED"],
        first: 50,
        after: "cursor123",
        simple: false,
      });
      expect(result.success).toBe(true);
    });

    it("should reject list action without namespace", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "list",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("get action - ID lookup", () => {
    it("should validate get action with id", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        id: "12345",
      });
      expect(result.success).toBe(true);
    });

    it("should validate get action with GID format id", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        id: "gid://gitlab/WorkItem/12345",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("get action - IID lookup (new functionality)", () => {
    it("should validate get action with namespace + iid", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        namespace: "group/project",
        iid: "95",
      });
      expect(result.success).toBe(true);
    });

    it("should validate get action with namespace + iid for epic", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        namespace: "my-group",
        iid: "1",
      });
      expect(result.success).toBe(true);
    });

    it("should reject get action with only namespace (missing iid)", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        namespace: "group/project",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Either 'id' (global ID) or both 'namespace' and 'iid'"
        );
      }
    });

    it("should reject get action with only iid (missing namespace)", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        iid: "95",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Either 'id' (global ID) or both 'namespace' and 'iid'"
        );
      }
    });

    it("should reject get action without any identifier", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Either 'id' (global ID) or both 'namespace' and 'iid'"
        );
      }
    });

    it("should accept get action with both namespace+iid and id (namespace+iid takes priority)", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "get",
        namespace: "group/project",
        iid: "95",
        id: "12345",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid action", () => {
    it("should reject unknown action", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        action: "unknown",
        namespace: "group/project",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = BrowseWorkItemsSchema.safeParse({
        namespace: "group/project",
      });
      expect(result.success).toBe(false);
    });
  });
});
