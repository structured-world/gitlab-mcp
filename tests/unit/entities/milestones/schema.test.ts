import { BrowseMilestonesSchema } from "../../../../src/entities/milestones/schema-readonly";
import { ManageMilestoneSchema } from "../../../../src/entities/milestones/schema";

/**
 * Milestone Schemas Tests
 *
 * NOTE: milestone_id accepts the IID (Internal ID) from URL paths like /milestones/3
 * GitLab API response contains both 'id' (global unique) and 'iid' (project-scoped).
 * When the AI agent sees /milestones/3 in a URL, it should use '3' as milestone_id.
 */
describe("Milestone Schemas", () => {
  describe("BrowseMilestonesSchema", () => {
    describe("list action", () => {
      it("should validate list action with namespace", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "list",
          namespace: "group/project",
        });
        expect(result.success).toBe(true);
      });

      it("should validate list action with iids filter", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "list",
          namespace: "group/project",
          iids: ["1", "2", "3"],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("get action - milestone_id lookup", () => {
      it("should validate get action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "get",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject get action without milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "get",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("issues action", () => {
      it("should validate issues action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "issues",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject issues action without milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "issues",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("merge_requests action", () => {
      it("should validate merge_requests action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "merge_requests",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject merge_requests action without milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "merge_requests",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("burndown action", () => {
      it("should validate burndown action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "burndown",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject burndown action without milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "burndown",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("ManageMilestoneSchema", () => {
    describe("create action", () => {
      it("should validate create action (no identifier needed)", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "create",
          namespace: "group/project",
          title: "v1.0",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("update action", () => {
      it("should validate update action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "update",
          namespace: "group/project",
          milestone_id: "1",
          title: "Updated Title",
        });
        expect(result.success).toBe(true);
      });

      it("should reject update action without milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "update",
          namespace: "group/project",
          title: "Updated Title",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("delete action", () => {
      it("should validate delete action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "delete",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject delete action without milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "delete",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("promote action", () => {
      it("should validate promote action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "promote",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should reject promote action without milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "promote",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
