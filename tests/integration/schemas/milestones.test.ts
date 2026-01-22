/**
 * Milestones Schema Integration Tests
 * Tests schemas using handler functions with real GitLab API
 */

import { BrowseMilestonesSchema } from "../../../src/entities/milestones/schema-readonly";
import { ManageMilestoneSchema } from "../../../src/entities/milestones/schema";
import { IntegrationTestHelper } from "../helpers/registry-helper";
import { getTestData } from "../../setup/testConfig";

describe("Milestones Schema - GitLab Integration", () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("Integration test helper initialized for milestones testing");
  });

  describe("BrowseMilestonesSchema - list action", () => {
    it("should validate and test with real project data using handler functions", async () => {
      console.log("Getting real project for milestones testing");

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
        action: "list" as const,
        namespace: testProject.path_with_namespace,
        state: "active" as const,
        per_page: 10,
      };

      // Validate schema
      const result = BrowseMilestonesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        // Test actual handler function
        const milestones = (await helper.executeTool("browse_milestones", result.data)) as {
          id: number;
          title: string;
          description: string;
          state: string;
          due_date: string | null;
        }[];
        expect(Array.isArray(milestones)).toBe(true);
        console.log(`Retrieved ${milestones.length} milestones via handler`);

        // Validate structure if we have milestones
        if (milestones.length > 0) {
          const milestone = milestones[0];
          expect(milestone).toHaveProperty("id");
          expect(milestone).toHaveProperty("title");
          expect(milestone).toHaveProperty("description");
          expect(milestone).toHaveProperty("state");
          expect(milestone).toHaveProperty("due_date");
          console.log(`Validated milestone structure: ${milestone.title}`);
        }
      }

      console.log("BrowseMilestonesSchema list action test completed with real data");
    });

    it("should validate group-level milestones", async () => {
      // Get a group for testing
      const namespaces = (await helper.executeTool("browse_namespaces", {
        action: "list",
        per_page: 1,
      })) as { kind: string; id: number; full_path: string }[];
      if (namespaces.length === 0) {
        console.log("No namespaces available for group milestones testing");
        return;
      }

      const testGroup = namespaces.find(ns => ns.kind === "group");
      if (!testGroup) {
        console.log("No groups found for group milestones testing");
        return;
      }

      const validParams = {
        action: "list" as const,
        namespace: testGroup.full_path,
        state: "active" as const,
        per_page: 5,
      };

      const result = BrowseMilestonesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        const milestones = (await helper.executeTool("browse_milestones", result.data)) as {
          title: string;
        }[];
        expect(Array.isArray(milestones)).toBe(true);
        console.log(`Retrieved ${milestones.length} group milestones via handler`);
      }

      console.log("BrowseMilestonesSchema group-level test completed");
    });

    it("should validate search and filtering parameters", async () => {
      // Get real project from data lifecycle (CQRS consolidation - Issue #16)
      const projects = (await helper.executeTool("browse_projects", {
        action: "list",
        per_page: 1,
      })) as { path_with_namespace: string }[];
      if (projects.length === 0) {
        console.log("No projects available for milestone search testing");
        return;
      }

      const searchParams = {
        action: "list" as const,
        namespace: projects[0].path_with_namespace, // Use namespace as expected by schema
        state: "closed" as const,
        search: "v1.0",
        include_ancestors: true,
        per_page: 20,
      };

      const result = BrowseMilestonesSchema.safeParse(searchParams);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "list") {
        expect(result.data.namespace).toBe(projects[0].path_with_namespace);
        expect(result.data.state).toBe("closed");
        expect(result.data.search).toBe("v1.0");
        expect(result.data.include_ancestors).toBe(true);
        expect(result.data.per_page).toBe(20);
      }

      console.log("BrowseMilestonesSchema validates search parameters");
    });

    it("should reject invalid parameters", async () => {
      const invalidParams = {
        action: "list",
        namespace: "test/project",
        state: "invalid_state", // Invalid enum value
      };

      const result = BrowseMilestonesSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }

      console.log("BrowseMilestonesSchema correctly rejects invalid parameters");
    });
  });

  describe("BrowseMilestonesSchema - get action by milestone_id", () => {
    it("should validate get milestone parameters with real data", async () => {
      // Get a project and its milestones for testing
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        path_with_namespace: string;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for get milestone testing");
        return;
      }

      const testProject = projects[0];
      const milestones = (await helper.executeTool("browse_milestones", {
        action: "list",
        namespace: testProject.path_with_namespace,
        per_page: 1,
      })) as { id: number }[];

      if (milestones.length === 0) {
        console.log("No milestones found for get milestone testing");
        return;
      }

      const testMilestone = milestones[0];
      const validParams = {
        action: "get" as const,
        namespace: testProject.path_with_namespace,
        milestone_id: testMilestone.id.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "get") {
        expect(result.data.namespace).toBe(testProject.path_with_namespace);
        expect(result.data.milestone_id).toBe(testMilestone.id.toString());
      }

      console.log("BrowseMilestonesSchema get action validates parameters correctly");
    });

    it("should test handler function for single milestone by milestone_id", async () => {
      // Get a project and its milestones for testing
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        path_with_namespace: string;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for handler testing");
        return;
      }

      const testProject = projects[0];
      const milestones = (await helper.executeTool("browse_milestones", {
        action: "list",
        namespace: testProject.path_with_namespace,
        per_page: 1,
      })) as { id: number; title: string }[];

      if (milestones.length === 0) {
        console.log("No milestones found for handler testing");
        return;
      }

      const testMilestone = milestones[0];
      const params = {
        action: "get" as const,
        namespace: testProject.path_with_namespace,
        milestone_id: testMilestone.id.toString(),
      };

      // Validate parameters first
      const paramResult = BrowseMilestonesSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (paramResult.success) {
        // Test handler function
        const milestone = (await helper.executeTool("browse_milestones", paramResult.data)) as {
          id: number;
          title: string;
          description: string;
          state: string;
          created_at: string;
          updated_at: string;
        };

        // Validate milestone structure
        expect(milestone).toHaveProperty("id");
        expect(milestone).toHaveProperty("title");
        expect(milestone).toHaveProperty("description");
        expect(milestone).toHaveProperty("state");
        expect(milestone).toHaveProperty("created_at");
        expect(milestone).toHaveProperty("updated_at");

        console.log(
          `BrowseMilestonesSchema get action handler test successful: ${milestone.title}`
        );
      }
    });

    it("should require milestone_id or iid for get action", async () => {
      const invalidParams = {
        action: "get",
        namespace: "test/project",
        // Missing both milestone_id and iid
      };

      const result = BrowseMilestonesSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }

      console.log("BrowseMilestonesSchema correctly requires milestone_id or iid for get action");
    });
  });

  // === IID LOOKUP TESTS (Issue #99) ===
  describe("BrowseMilestonesSchema - get action by IID", () => {
    it("should validate get milestone parameters with iid", async () => {
      const testData = getTestData();
      if (!testData.project?.path_with_namespace || !testData.milestones?.length) {
        console.log("No test project or milestones available for iid get milestone testing");
        return;
      }

      const testMilestone = testData.milestones[0];
      const validParams = {
        action: "get" as const,
        namespace: testData.project.path_with_namespace,
        iid: testMilestone.iid.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "get") {
        expect(result.data.namespace).toBe(testData.project.path_with_namespace);
        expect(result.data.iid).toBe(testMilestone.iid.toString());
      }

      console.log("BrowseMilestonesSchema validates iid parameters correctly");
    });

    it("should test handler function for single milestone by IID", async () => {
      const testData = getTestData();
      if (!testData.project?.path_with_namespace || !testData.milestones?.length) {
        console.log("No test project or milestones available for iid handler testing");
        return;
      }

      const testMilestone = testData.milestones[0];
      const params = {
        action: "get" as const,
        namespace: testData.project.path_with_namespace,
        iid: testMilestone.iid.toString(),
      };

      const paramResult = BrowseMilestonesSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (paramResult.success) {
        const milestone = (await helper.executeTool("browse_milestones", paramResult.data)) as {
          id: number;
          iid: number;
          title: string;
        };

        expect(milestone).toHaveProperty("id");
        expect(milestone).toHaveProperty("iid");
        expect(milestone).toHaveProperty("title");
        expect(milestone.iid).toBe(testMilestone.iid);

        console.log(
          `BrowseMilestonesSchema IID lookup successful: ${milestone.title} (IID: ${milestone.iid})`
        );
      }
    });

    it("should return same milestone whether looked up by milestone_id or by iid", async () => {
      const testData = getTestData();
      if (!testData.project?.path_with_namespace || !testData.milestones?.length) {
        console.log("No test project or milestones available for comparison testing");
        return;
      }

      const testMilestone = testData.milestones[0];
      const namespace = testData.project.path_with_namespace;

      // Lookup by milestone_id (which is actually IID in GitLab project milestone API)
      const byIdParams = {
        action: "get" as const,
        namespace,
        milestone_id: testMilestone.iid.toString(),
      };
      const byIdResult = BrowseMilestonesSchema.safeParse(byIdParams);
      expect(byIdResult.success).toBe(true);
      if (!byIdResult.success) return;

      const milestoneById = (await helper.executeTool("browse_milestones", byIdResult.data)) as {
        id: number;
        iid: number;
        title: string;
      };

      // Lookup by iid
      const byIidParams = {
        action: "get" as const,
        namespace,
        iid: testMilestone.iid.toString(),
      };
      const byIidResult = BrowseMilestonesSchema.safeParse(byIidParams);
      expect(byIidResult.success).toBe(true);
      if (!byIidResult.success) return;

      const milestoneByIid = (await helper.executeTool("browse_milestones", byIidResult.data)) as {
        id: number;
        iid: number;
        title: string;
      };

      // Both lookups should return the same milestone
      expect(milestoneById.id).toBe(milestoneByIid.id);
      expect(milestoneById.iid).toBe(milestoneByIid.iid);
      expect(milestoneById.title).toBe(milestoneByIid.title);

      console.log(
        `Both lookup methods return same milestone: ${milestoneById.title} (ID: ${milestoneById.id}, IID: ${milestoneById.iid})`
      );
    });
  });

  describe("BrowseMilestonesSchema - issues action with IID", () => {
    it("should list issues in milestone using iid", async () => {
      const testData = getTestData();
      if (!testData.project?.path_with_namespace || !testData.milestones?.length) {
        console.log("No test project or milestones available for issues iid testing");
        return;
      }

      const testMilestone = testData.milestones[0];
      const params = {
        action: "issues" as const,
        namespace: testData.project.path_with_namespace,
        iid: testMilestone.iid.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const issues = (await helper.executeTool("browse_milestones", result.data)) as {
          id: number;
        }[];
        expect(Array.isArray(issues)).toBe(true);
        console.log(
          `Retrieved ${issues.length} issues for milestone ${testMilestone.title} using IID`
        );
      }
    });
  });

  describe("BrowseMilestonesSchema - merge_requests action with IID", () => {
    it("should list merge requests in milestone using iid", async () => {
      const testData = getTestData();
      if (!testData.project?.path_with_namespace || !testData.milestones?.length) {
        console.log("No test project or milestones available for MRs iid testing");
        return;
      }

      const testMilestone = testData.milestones[0];
      const params = {
        action: "merge_requests" as const,
        namespace: testData.project.path_with_namespace,
        iid: testMilestone.iid.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const mrs = (await helper.executeTool("browse_milestones", result.data)) as {
          id: number;
        }[];
        expect(Array.isArray(mrs)).toBe(true);
        console.log(
          `Retrieved ${mrs.length} merge requests for milestone ${testMilestone.title} using IID`
        );
      }
    });
  });

  describe("BrowseMilestonesSchema - issues action", () => {
    it("should list issues in milestone", async () => {
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        path_with_namespace: string;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for milestone issues testing");
        return;
      }

      const testProject = projects[0];
      const milestones = (await helper.executeTool("browse_milestones", {
        action: "list",
        namespace: testProject.path_with_namespace,
        per_page: 1,
      })) as { id: number; title: string }[];

      if (milestones.length === 0) {
        console.log("No milestones found for issues testing");
        return;
      }

      const params = {
        action: "issues" as const,
        namespace: testProject.path_with_namespace,
        milestone_id: milestones[0].id.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const issues = (await helper.executeTool("browse_milestones", result.data)) as {
          id: number;
        }[];
        expect(Array.isArray(issues)).toBe(true);
        console.log(`Retrieved ${issues.length} issues for milestone ${milestones[0].title}`);
      }
    });
  });

  describe("BrowseMilestonesSchema - merge_requests action", () => {
    it("should list merge requests in milestone", async () => {
      const projects = (await helper.listProjects({ per_page: 1 })) as {
        path_with_namespace: string;
      }[];
      if (projects.length === 0) {
        console.log("No projects available for milestone MRs testing");
        return;
      }

      const testProject = projects[0];
      const milestones = (await helper.executeTool("browse_milestones", {
        action: "list",
        namespace: testProject.path_with_namespace,
        per_page: 1,
      })) as { id: number; title: string }[];

      if (milestones.length === 0) {
        console.log("No milestones found for MRs testing");
        return;
      }

      const params = {
        action: "merge_requests" as const,
        namespace: testProject.path_with_namespace,
        milestone_id: milestones[0].id.toString(),
      };

      const result = BrowseMilestonesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const mrs = (await helper.executeTool("browse_milestones", result.data)) as {
          id: number;
        }[];
        expect(Array.isArray(mrs)).toBe(true);
        console.log(`Retrieved ${mrs.length} merge requests for milestone ${milestones[0].title}`);
      }
    });
  });

  describe("ManageMilestoneSchema - create action", () => {
    it("should validate create milestone parameters", async () => {
      const params = {
        action: "create" as const,
        namespace: "test/project",
        title: "Test Milestone",
        description: "A test milestone",
        start_date: "2024-01-01",
        due_date: "2024-03-31",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "create") {
        expect(result.data.title).toBe("Test Milestone");
        expect(result.data.description).toBe("A test milestone");
      }

      console.log("ManageMilestoneSchema create action validates correctly");
    });

    it("should require title for create action", async () => {
      const invalidParams = {
        action: "create",
        namespace: "test/project",
        // Missing title
      };

      const result = ManageMilestoneSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log("ManageMilestoneSchema correctly requires title for create action");
    });
  });

  describe("ManageMilestoneSchema - update action", () => {
    it("should validate update milestone parameters with milestone_id", async () => {
      const params = {
        action: "update" as const,
        namespace: "test/project",
        milestone_id: "1",
        title: "Updated Title",
        state_event: "close",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "update") {
        expect(result.data.milestone_id).toBe("1");
        expect(result.data.state_event).toBe("close");
      }

      console.log("ManageMilestoneSchema update action validates correctly with milestone_id");
    });

    it("should validate update milestone parameters with iid", async () => {
      const params = {
        action: "update" as const,
        namespace: "test/project",
        iid: "5",
        title: "Updated Title",
        state_event: "close",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "update") {
        expect(result.data.iid).toBe("5");
        expect(result.data.state_event).toBe("close");
      }

      console.log("ManageMilestoneSchema update action validates correctly with iid");
    });

    it("should require milestone_id or iid for update action", async () => {
      const invalidParams = {
        action: "update",
        namespace: "test/project",
        title: "Updated Title",
        // Missing both milestone_id and iid
      };

      const result = ManageMilestoneSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log("ManageMilestoneSchema correctly requires milestone_id or iid for update action");
    });
  });

  describe("ManageMilestoneSchema - delete action", () => {
    it("should validate delete milestone parameters with milestone_id", async () => {
      const params = {
        action: "delete" as const,
        namespace: "test/project",
        milestone_id: "1",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "delete") {
        expect(result.data.milestone_id).toBe("1");
      }

      console.log("ManageMilestoneSchema delete action validates correctly with milestone_id");
    });

    it("should validate delete milestone parameters with iid", async () => {
      const params = {
        action: "delete" as const,
        namespace: "test/project",
        iid: "7",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "delete") {
        expect(result.data.iid).toBe("7");
      }

      console.log("ManageMilestoneSchema delete action validates correctly with iid");
    });

    it("should require milestone_id or iid for delete action", async () => {
      const invalidParams = {
        action: "delete",
        namespace: "test/project",
        // Missing both milestone_id and iid
      };

      const result = ManageMilestoneSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log("ManageMilestoneSchema correctly requires milestone_id or iid for delete action");
    });
  });

  describe("ManageMilestoneSchema - promote action", () => {
    it("should validate promote milestone parameters with milestone_id", async () => {
      const params = {
        action: "promote" as const,
        namespace: "test/project",
        milestone_id: "1",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      // Type narrowing: check action to access action-specific properties
      if (result.success && result.data.action === "promote") {
        expect(result.data.milestone_id).toBe("1");
      }

      console.log("ManageMilestoneSchema promote action validates correctly with milestone_id");
    });

    it("should validate promote milestone parameters with iid", async () => {
      const params = {
        action: "promote" as const,
        namespace: "test/project",
        iid: "9",
      };

      const result = ManageMilestoneSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "promote") {
        expect(result.data.iid).toBe("9");
      }

      console.log("ManageMilestoneSchema promote action validates correctly with iid");
    });

    it("should require milestone_id or iid for promote action", async () => {
      const invalidParams = {
        action: "promote",
        namespace: "test/project",
        // Missing both milestone_id and iid
      };

      const result = ManageMilestoneSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log(
        "ManageMilestoneSchema correctly requires milestone_id or iid for promote action"
      );
    });
  });
});
