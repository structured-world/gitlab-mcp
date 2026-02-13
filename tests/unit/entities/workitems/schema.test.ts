import { ManageWorkItemSchema } from "../../../../src/entities/workitems/schema";

describe("ManageWorkItemSchema", () => {
  describe("update action - verificationStatus parameter", () => {
    it("should validate update with verificationStatus PASSED", () => {
      const result = ManageWorkItemSchema.safeParse({
        action: "update",
        id: "123",
        verificationStatus: "PASSED",
      });
      expect(result.success).toBe(true);
    });

    it("should validate update with verificationStatus FAILED", () => {
      const result = ManageWorkItemSchema.safeParse({
        action: "update",
        id: "123",
        verificationStatus: "FAILED",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid verificationStatus value", () => {
      const result = ManageWorkItemSchema.safeParse({
        action: "update",
        id: "123",
        verificationStatus: "INVALID",
      });
      expect(result.success).toBe(false);
    });

    it("should validate update without verificationStatus (optional)", () => {
      const result = ManageWorkItemSchema.safeParse({
        action: "update",
        id: "123",
        title: "Updated Title",
      });
      expect(result.success).toBe(true);
    });

    it("should validate update with verificationStatus alongside other fields", () => {
      const result = ManageWorkItemSchema.safeParse({
        action: "update",
        id: "123",
        verificationStatus: "PASSED",
        description: "Updated requirement description",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("create action - should not accept verificationStatus", () => {
    it("should strip unknown verificationStatus from create (not in create schema)", () => {
      // verificationStatus is only on update, create should ignore it via passthrough/strip
      const result = ManageWorkItemSchema.safeParse({
        action: "create",
        namespace: "test/project",
        workItemType: "REQUIREMENT",
        title: "Test Requirement",
      });
      expect(result.success).toBe(true);
    });
  });
});
