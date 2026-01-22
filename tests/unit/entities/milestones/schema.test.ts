import { BrowseMilestonesSchema } from "../../../../src/entities/milestones/schema-readonly";
import { ManageMilestoneSchema } from "../../../../src/entities/milestones/schema";

describe("Milestone Schemas - IID Support", () => {
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
    });

    describe("get action - IID lookup (new functionality)", () => {
      it("should validate get action with iid", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "get",
          namespace: "group/project",
          iid: "3",
        });
        expect(result.success).toBe(true);
      });

      it("should validate get action with both milestone_id and iid", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "get",
          namespace: "group/project",
          milestone_id: "1",
          iid: "3",
        });
        expect(result.success).toBe(true);
      });

      it("should reject get action without any identifier", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "get",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            "Either 'milestone_id' or 'iid' must be provided"
          );
        }
      });
    });

    describe("issues action - IID support", () => {
      it("should validate issues action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "issues",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should validate issues action with iid", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "issues",
          namespace: "group/project",
          iid: "5",
        });
        expect(result.success).toBe(true);
      });

      it("should reject issues action without any identifier", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "issues",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("merge_requests action - IID support", () => {
      it("should validate merge_requests action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "merge_requests",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should validate merge_requests action with iid", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "merge_requests",
          namespace: "group/project",
          iid: "6",
        });
        expect(result.success).toBe(true);
      });

      it("should reject merge_requests action without any identifier", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "merge_requests",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("burndown action - IID support", () => {
      it("should validate burndown action with milestone_id", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "burndown",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should validate burndown action with iid", () => {
        const result = BrowseMilestonesSchema.safeParse({
          action: "burndown",
          namespace: "group/project",
          iid: "7",
        });
        expect(result.success).toBe(true);
      });

      it("should reject burndown action without any identifier", () => {
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

    describe("update action - IID support", () => {
      it("should validate update action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "update",
          namespace: "group/project",
          milestone_id: "1",
          title: "Updated Title",
        });
        expect(result.success).toBe(true);
      });

      it("should validate update action with iid", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "update",
          namespace: "group/project",
          iid: "8",
          title: "Updated Title",
        });
        expect(result.success).toBe(true);
      });

      it("should reject update action without any identifier", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "update",
          namespace: "group/project",
          title: "Updated Title",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            "Either 'milestone_id' or 'iid' must be provided"
          );
        }
      });
    });

    describe("delete action - IID support", () => {
      it("should validate delete action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "delete",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should validate delete action with iid", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "delete",
          namespace: "group/project",
          iid: "9",
        });
        expect(result.success).toBe(true);
      });

      it("should reject delete action without any identifier", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "delete",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("promote action - IID support", () => {
      it("should validate promote action with milestone_id", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "promote",
          namespace: "group/project",
          milestone_id: "1",
        });
        expect(result.success).toBe(true);
      });

      it("should validate promote action with iid", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "promote",
          namespace: "group/project",
          iid: "10",
        });
        expect(result.success).toBe(true);
      });

      it("should reject promote action without any identifier", () => {
        const result = ManageMilestoneSchema.safeParse({
          action: "promote",
          namespace: "group/project",
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
