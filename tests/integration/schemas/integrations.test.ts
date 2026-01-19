/**
 * Integrations Schema Integration Tests
 * Tests schemas using handler functions with real GitLab API
 */

import { ListIntegrationsSchema } from "../../../src/entities/integrations/schema-readonly";
import { ManageIntegrationSchema } from "../../../src/entities/integrations/schema";
import { IntegrationTestHelper } from "../helpers/registry-helper";

describe("Integrations Schema - GitLab Integration", () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("Integration test helper initialized for integrations testing");
  });

  describe("ListIntegrationsSchema", () => {
    it("should validate and list integrations with real project data", async () => {
      console.log("Getting real project for integrations testing");

      // Get actual project from data lifecycle
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        path_with_namespace: string;
        name: string;
        id: number;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for testing");
        return;
      }

      const testProject = projects[0];
      console.log(`Using project: ${testProject.name} (ID: ${testProject.id})`);

      const validParams = {
        project_id: testProject.id.toString(),
        per_page: 20,
      };

      // Validate schema
      const result = ListIntegrationsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        // Test actual handler function
        const integrations = (await helper.executeTool(
          "list_integrations",
          result.data
        )) as {
          slug: string;
          title: string;
          active: boolean;
        }[];
        expect(Array.isArray(integrations)).toBe(true);
        console.log(`Retrieved ${integrations.length} active integrations via handler`);

        // Validate structure if we have integrations
        if (integrations.length > 0) {
          const integration = integrations[0];
          expect(integration).toHaveProperty("slug");
          expect(integration).toHaveProperty("title");
          expect(integration).toHaveProperty("active");
          console.log(
            `Validated integration structure: ${integration.title} (${integration.slug})`
          );
        }
      }

      console.log("ListIntegrationsSchema test completed with real data");
    });

    it("should validate pagination parameters", async () => {
      // Get actual project for validation
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        id: number;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for pagination testing");
        return;
      }

      const testProject = projects[0];
      const paginationParams = {
        project_id: testProject.id.toString(),
        per_page: 10,
        page: 1,
      };

      const result = ListIntegrationsSchema.safeParse(paginationParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.per_page).toBe(10);
        expect(result.data.page).toBe(1);
      }

      console.log("ListIntegrationsSchema validates pagination parameters");
    });

    it("should reject invalid parameters", async () => {
      const invalidParams = {
        project_id: "123",
        per_page: 150, // Exceeds max of 100
      };

      const result = ListIntegrationsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }

      console.log("ListIntegrationsSchema correctly rejects invalid parameters");
    });
  });

  describe("ManageIntegrationSchema - get action", () => {
    it("should validate get integration parameters", async () => {
      const params = {
        action: "get" as const,
        project_id: "123",
        integration: "slack" as const,
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.action).toBe("get");
        expect(result.data.integration).toBe("slack");
      }

      console.log("ManageIntegrationSchema get action validates correctly");
    });

    it("should support all integration types", async () => {
      const integrationTypes = [
        "slack",
        "jira",
        "discord",
        "microsoft-teams",
        "jenkins",
        "emails-on-push",
      ];

      for (const integrationType of integrationTypes) {
        const params = {
          action: "get" as const,
          project_id: "123",
          integration: integrationType,
        };

        const result = ManageIntegrationSchema.safeParse(params);
        expect(result.success).toBe(true);
      }

      console.log("ManageIntegrationSchema supports multiple integration types");
    });
  });

  describe("ManageIntegrationSchema - update action", () => {
    it("should validate update integration parameters with event triggers", async () => {
      const params = {
        action: "update" as const,
        project_id: "123",
        integration: "slack" as const,
        active: true,
        push_events: true,
        issues_events: true,
        merge_requests_events: true,
        pipeline_events: false,
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.action).toBe("update");
        expect(result.data.active).toBe(true);
        expect(result.data.push_events).toBe(true);
        expect(result.data.issues_events).toBe(true);
        expect(result.data.merge_requests_events).toBe(true);
        expect(result.data.pipeline_events).toBe(false);
      }

      console.log("ManageIntegrationSchema update action validates event triggers");
    });

    it("should validate update with config object", async () => {
      const params = {
        action: "update" as const,
        project_id: "123",
        integration: "slack" as const,
        config: {
          webhook_url: "https://hooks.slack.com/services/xxx/yyy/zzz",
          username: "GitLab Bot",
          channel: "#general",
        },
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.config).toBeDefined();
        expect(result.data.config?.webhook_url).toBe(
          "https://hooks.slack.com/services/xxx/yyy/zzz"
        );
      }

      console.log("ManageIntegrationSchema update action validates config object");
    });

    it("should accept integration-specific fields via passthrough", async () => {
      const params = {
        action: "update" as const,
        project_id: "123",
        integration: "jira" as const,
        url: "https://jira.example.com",
        username: "jira-user",
        password: "secret",
        jira_issue_transition_id: "5",
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      console.log("ManageIntegrationSchema accepts passthrough fields");
    });
  });

  describe("ManageIntegrationSchema - disable action", () => {
    it("should validate disable integration parameters", async () => {
      const params = {
        action: "disable" as const,
        project_id: "123",
        integration: "slack" as const,
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.action).toBe("disable");
        expect(result.data.integration).toBe("slack");
      }

      console.log("ManageIntegrationSchema disable action validates correctly");
    });
  });

  describe("ManageIntegrationSchema - event triggers", () => {
    it("should accept all common event trigger types", async () => {
      const params = {
        action: "update" as const,
        project_id: "123",
        integration: "discord" as const,
        push_events: true,
        issues_events: false,
        merge_requests_events: true,
        tag_push_events: false,
        note_events: true,
        confidential_issues_events: false,
        pipeline_events: true,
        wiki_page_events: false,
        job_events: true,
        deployment_events: false,
        releases_events: true,
        vulnerability_events: false,
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.push_events).toBe(true);
        expect(result.data.issues_events).toBe(false);
        expect(result.data.merge_requests_events).toBe(true);
        expect(result.data.pipeline_events).toBe(true);
        expect(result.data.wiki_page_events).toBe(false);
        expect(result.data.releases_events).toBe(true);
      }

      console.log("ManageIntegrationSchema accepts all event trigger types");
    });
  });

  describe("ManageIntegrationSchema - integration type validation", () => {
    it("should reject invalid integration type", async () => {
      const params = {
        action: "get" as const,
        project_id: "123",
        integration: "invalid-integration" as const,
      };

      const result = ManageIntegrationSchema.safeParse(params);
      expect(result.success).toBe(false);

      console.log("ManageIntegrationSchema rejects invalid integration type");
    });
  });
});
