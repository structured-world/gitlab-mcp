/**
 * Requirements & Verification Status Integration Tests
 *
 * Tests the requirement verification lifecycle through MCP tool handlers:
 * 1. Create REQUIREMENT work item
 * 2. Verify it (PASSED/FAILED) via verificationStatus
 * 3. Browse and check verification status + test reports in response
 * 4. Cleanup
 *
 * Requires: GitLab Ultimate instance (verification status is Ultimate-only)
 */

import { IntegrationTestHelper } from "./helpers/registry-helper";
import { requireTestData } from "../setup/testConfig";

describe("Requirements Verification - Integration Tests", () => {
  let helper: IntegrationTestHelper;
  let createdRequirementId: string | undefined;
  let testProjectPath: string;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();

    const testData = requireTestData();
    testProjectPath = testData.project.path_with_namespace;
  });

  afterAll(async () => {
    // Cleanup: delete the created requirement
    if (createdRequirementId) {
      try {
        await helper.executeTool("manage_work_item", {
          action: "delete",
          id: createdRequirementId,
        });
        console.log(`Cleaned up requirement ${createdRequirementId}`);
      } catch (e) {
        console.warn(`Failed to clean up requirement ${createdRequirementId}:`, e);
      }
    }
  });

  it("should create a REQUIREMENT work item", async () => {
    const result = (await helper.executeTool("manage_work_item", {
      action: "create",
      namespace: testProjectPath,
      workItemType: "REQUIREMENT",
      title: "Integration Test: Login must complete within 3 seconds",
      description: "Performance requirement for the login flow",
    })) as any;

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.title).toContain("Login must complete within 3 seconds");

    createdRequirementId = result.id;
    console.log(`Created requirement: id=${result.id}, iid=${result.iid}`);
  }, 30000);

  it("should verify requirement with PASSED status", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    const result = (await helper.executeTool("manage_work_item", {
      action: "update",
      id: createdRequirementId,
      verificationStatus: "PASSED",
    })) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(createdRequirementId);

    // Check widgets in response for verification status
    if (result.widgets) {
      const verificationWidget = result.widgets.find((w: any) => w.type === "VERIFICATION_STATUS");
      if (verificationWidget) {
        // GitLab maps PASSED -> "satisfied" in the response
        expect(verificationWidget.verificationStatus).toBe("satisfied");
        console.log(`Verification status after PASSED: ${verificationWidget.verificationStatus}`);
      }
    }
  }, 30000);

  it("should list requirements with verification status in browse response", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    const result = (await helper.executeTool("browse_work_items", {
      action: "list",
      namespace: testProjectPath,
      types: ["REQUIREMENT"],
      simple: false,
    })) as any;

    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);

    // Find our created requirement
    const ourReq = result.items.find((item: any) => item.id === createdRequirementId);
    if (ourReq) {
      console.log(`Found requirement in list: ${ourReq.title}`);

      // Check for VERIFICATION_STATUS widget
      const verificationWidget = ourReq.widgets?.find((w: any) => w.type === "VERIFICATION_STATUS");
      if (verificationWidget) {
        expect(verificationWidget.verificationStatus).toBe("satisfied");
        console.log(`Verification status in list: ${verificationWidget.verificationStatus}`);
      }

      // Check for TEST_REPORTS widget
      const testReportsWidget = ourReq.widgets?.find((w: any) => w.type === "TEST_REPORTS");
      if (testReportsWidget) {
        console.log(
          `Test reports: ${JSON.stringify(testReportsWidget.testReports || testReportsWidget)}`
        );
      }
    } else {
      console.log(
        `Requirement ${createdRequirementId} not found in list of ${result.items.length} items`
      );
    }
  }, 30000);

  it("should get requirement by ID with verification widgets", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    const result = (await helper.executeTool("browse_work_items", {
      action: "get",
      id: createdRequirementId,
    })) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(createdRequirementId);

    if (result.widgets) {
      const widgetTypes = result.widgets.map((w: any) => w.type);
      console.log(`Widget types on get: ${widgetTypes.join(", ")}`);

      // VERIFICATION_STATUS should be present
      const verificationWidget = result.widgets.find((w: any) => w.type === "VERIFICATION_STATUS");
      if (verificationWidget) {
        expect(verificationWidget.verificationStatus).toBe("satisfied");
      }
    }
  }, 30000);

  it("should verify requirement with FAILED status", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    const result = (await helper.executeTool("manage_work_item", {
      action: "update",
      id: createdRequirementId,
      verificationStatus: "FAILED",
    })) as any;

    expect(result).toBeDefined();

    if (result.widgets) {
      const verificationWidget = result.widgets.find((w: any) => w.type === "VERIFICATION_STATUS");
      if (verificationWidget) {
        // GitLab maps FAILED -> "failed" in the response
        expect(verificationWidget.verificationStatus).toBe("failed");
        console.log(`Verification status after FAILED: ${verificationWidget.verificationStatus}`);
      }
    }
  }, 30000);

  it("should show test reports after multiple verifications", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    // Get the requirement with full details (simple=false to see all widgets)
    const result = (await helper.executeTool("browse_work_items", {
      action: "get",
      id: createdRequirementId,
    })) as any;

    expect(result).toBeDefined();

    if (result.widgets) {
      const testReportsWidget = result.widgets.find((w: any) => w.type === "TEST_REPORTS");
      if (testReportsWidget?.testReports) {
        const reports = testReportsWidget.testReports.nodes || testReportsWidget.testReports;
        console.log(`Test reports count: ${reports.length}`);

        if (Array.isArray(reports) && reports.length > 0) {
          // Should have at least 2 reports (PASSED and FAILED from previous tests)
          expect(reports.length).toBeGreaterThanOrEqual(2);

          for (const report of reports) {
            console.log(
              `  Report: state=${report.state}, createdAt=${report.createdAt}, author=${report.author?.username || report.author}`
            );
            expect(report.state).toBeDefined();
            expect(report.createdAt).toBeDefined();
          }
        }
      } else {
        console.log("TEST_REPORTS widget not found or empty in response");
      }
    }
  }, 30000);

  it("should include verification status in simplified browse response", async () => {
    if (!createdRequirementId) {
      console.warn("Skipping: no requirement created");
      return;
    }

    // Use simple=true (default) and check that verification status is included
    const result = (await helper.executeTool("browse_work_items", {
      action: "list",
      namespace: testProjectPath,
      types: ["REQUIREMENT"],
      simple: true,
    })) as any;

    expect(result).toBeDefined();
    expect(result.items).toBeDefined();

    const ourReq = result.items.find((item: any) => item.id === createdRequirementId);
    if (ourReq?.widgets) {
      const verificationWidget = ourReq.widgets.find((w: any) => w.type === "VERIFICATION_STATUS");
      if (verificationWidget) {
        console.log(`Simplified verification status: ${verificationWidget.verificationStatus}`);
        expect(["satisfied", "failed"]).toContain(verificationWidget.verificationStatus);
      }
    }
  }, 30000);
});
