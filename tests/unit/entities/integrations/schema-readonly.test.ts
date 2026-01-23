/**
 * BrowseIntegrationsSchema Unit Tests
 * Tests schema validation for browse_integrations CQRS Query tool
 */

import { BrowseIntegrationsSchema } from "../../../../src/entities/integrations/schema-readonly";

describe("BrowseIntegrationsSchema", () => {
  describe("Action: list - Valid inputs", () => {
    it("should accept minimal valid input (action + project_id only)", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "my-group/my-project",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe("list");
        expect(result.data.project_id).toBe("my-group/my-project");
      }
    });

    it("should accept numeric project_id", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "12345",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.project_id).toBe("12345");
      }
    });

    it("should accept pagination parameters", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 50,
        page: 2,
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "list") {
        expect(result.data.per_page).toBe(50);
        expect(result.data.page).toBe(2);
      }
    });

    it("should accept per_page at minimum value (1)", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 1,
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "list") {
        expect(result.data.per_page).toBe(1);
      }
    });

    it("should accept per_page at maximum value (100)", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 100,
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "list") {
        expect(result.data.per_page).toBe(100);
      }
    });

    it("should accept URL-encoded project path", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "my-group%2Fmy-project",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Action: list - Invalid inputs", () => {
    it("should reject missing project_id", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const projectIdError = result.error.issues.find(i => i.path.includes("project_id"));
        expect(projectIdError).toBeDefined();
      }
    });

    it("should reject per_page exceeding 100", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 150,
      });
      expect(result.success).toBe(false);
    });

    it("should reject per_page less than 1", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative per_page", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: -10,
      });
      expect(result.success).toBe(false);
    });

    it("should reject page less than 1", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        page: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer per_page", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        per_page: 10.5,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer page", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "test/project",
        page: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Action: get - Valid inputs", () => {
    it("should accept valid get parameters", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "get",
        project_id: "123",
        integration: "slack",
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "get") {
        expect(result.data.action).toBe("get");
        expect(result.data.integration).toBe("slack");
      }
    });

    it("should support all integration types", () => {
      const integrationTypes = [
        "slack",
        "jira",
        "discord",
        "microsoft-teams",
        "jenkins",
        "emails-on-push",
      ];

      for (const integrationType of integrationTypes) {
        const result = BrowseIntegrationsSchema.safeParse({
          action: "get",
          project_id: "123",
          integration: integrationType,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Action: get - Invalid inputs", () => {
    it("should reject invalid integration type", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "get",
        project_id: "123",
        integration: "invalid-integration",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing integration field", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "get",
        project_id: "123",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing project_id", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "get",
        integration: "slack",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Action discriminator", () => {
    it("should reject invalid action", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "invalid",
        project_id: "123",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        project_id: "123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle project path with special characters", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "my-group/my-project_v2.0",
      });
      expect(result.success).toBe(true);
    });

    it("should handle deeply nested project path", () => {
      const result = BrowseIntegrationsSchema.safeParse({
        action: "list",
        project_id: "org/team/subteam/project",
      });
      expect(result.success).toBe(true);
    });
  });
});
