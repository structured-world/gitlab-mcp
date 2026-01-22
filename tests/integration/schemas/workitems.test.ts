/**
 * Work Items Schema Integration Tests
 * Tests BrowseWorkItemsSchema and ManageWorkItemSchema against real GitLab 18.3 API responses
 */

import { BrowseWorkItemsSchema } from "../../../src/entities/workitems/schema-readonly";
import { ManageWorkItemSchema } from "../../../src/entities/workitems/schema";
import { getTestData } from "../../setup/testConfig";
import { IntegrationTestHelper } from "../helpers/registry-helper";

describe("Work Items Schema - GitLab 18.3 Integration", () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    // Initialize integration test helper
    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("✅ Integration test helper initialized for work items testing");
  });

  describe("BrowseWorkItemsSchema", () => {
    it("should validate basic list work items parameters", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const validParams = {
        action: "list" as const,
        namespace: testData.project!.path_with_namespace,
        first: 5,
        types: ["ISSUE" as const, "TASK" as const],
      };

      const result = BrowseWorkItemsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "list") {
        expect(result.data.namespace).toBe(testData.project!.path_with_namespace);
        expect(result.data.first).toBe(5);
        expect(result.data.types).toEqual(["ISSUE", "TASK"]);
      }

      console.log("✅ BrowseWorkItemsSchema validates basic parameters correctly");
    });

    it("should make successful request with validated parameters using handler function", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const params = {
        action: "list" as const,
        namespace: testData.project!.path_with_namespace,
        first: 3,
        types: ["ISSUE" as const],
      };

      // Validate parameters first
      const paramResult = BrowseWorkItemsSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔍 BrowseWorkItemsSchema - Testing list work items using handler function...");
      const result = (await helper.executeTool("browse_work_items", paramResult.data)) as any;

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      console.log(`📋 Found ${result.items.length} work items via handler`);

      // Validate structure if work items exist
      if (result.items.length > 0) {
        const firstWorkItem = result.items[0];
        expect(firstWorkItem).toHaveProperty("id");
        expect(firstWorkItem).toHaveProperty("iid");
        expect(firstWorkItem).toHaveProperty("title");
        expect(firstWorkItem).toHaveProperty("workItemType");
        console.log(`  ✅ Work item: ${firstWorkItem.title} (IID: ${firstWorkItem.iid})`);
      }

      console.log(
        `✅ BrowseWorkItemsSchema API request successful via handler, found ${result.items.length} work items`
      );
    }, 15000);
  });

  describe("BrowseWorkItemsSchema - get action by ID", () => {
    it("should validate get work item parameters with id", async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);

      const firstWorkItem = testData.workItems![0];
      const validParams = {
        action: "get" as const,
        id: firstWorkItem.id,
      };

      const result = BrowseWorkItemsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "get") {
        expect(result.data.id).toBe(firstWorkItem.id);
      }

      console.log("✅ BrowseWorkItemsSchema validates parameters correctly");
    });

    it("should make successful GraphQL request for single work item by ID", async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);

      const firstWorkItem = testData.workItems![0];
      const params = {
        action: "get" as const,
        id: firstWorkItem.id,
      };

      // Validate parameters first
      const paramResult = BrowseWorkItemsSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔍 Getting single work item by ID using handler function...");
      const workItem = (await helper.executeTool("browse_work_items", paramResult.data)) as any;

      expect(workItem).toBeDefined();
      expect(workItem).toHaveProperty("id");
      expect(workItem).toHaveProperty("iid");
      expect(workItem).toHaveProperty("title");
      expect(workItem).toHaveProperty("workItemType");

      console.log(
        `✅ BrowseWorkItemsSchema API request successful via handler: ${workItem.title} (IID: ${workItem.iid})`
      );
    }, 15000);
  });

  // === IID LOOKUP TESTS (Issue #99) ===
  describe("BrowseWorkItemsSchema - get action by namespace + IID", () => {
    it("should validate get work item parameters with namespace + iid", async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);
      expect(testData.project?.path_with_namespace).toBeDefined();

      const firstWorkItem = testData.workItems![0];
      const validParams = {
        action: "get" as const,
        namespace: testData.project!.path_with_namespace,
        iid: firstWorkItem.iid,
      };

      const result = BrowseWorkItemsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === "get") {
        expect(result.data.namespace).toBe(testData.project!.path_with_namespace);
        expect(result.data.iid).toBe(firstWorkItem.iid);
      }

      console.log("✅ BrowseWorkItemsSchema validates namespace + iid parameters correctly");
    });

    it("should make successful GraphQL request for work item by namespace + IID", async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);
      expect(testData.project?.path_with_namespace).toBeDefined();

      const firstWorkItem = testData.workItems![0];
      const params = {
        action: "get" as const,
        namespace: testData.project!.path_with_namespace,
        iid: firstWorkItem.iid,
      };

      // Validate parameters first
      const paramResult = BrowseWorkItemsSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔍 Getting work item by namespace + IID using handler function...");
      const workItem = (await helper.executeTool("browse_work_items", paramResult.data)) as any;

      expect(workItem).toBeDefined();
      expect(workItem).toHaveProperty("id");
      expect(workItem).toHaveProperty("iid");
      expect(workItem).toHaveProperty("title");
      expect(workItem).toHaveProperty("workItemType");

      // Verify the IID matches what we requested
      expect(workItem.iid).toBe(firstWorkItem.iid);

      console.log(
        `✅ BrowseWorkItemsSchema IID lookup successful: ${workItem.title} (IID: ${workItem.iid})`
      );
    }, 15000);

    it("should return same work item whether looked up by ID or by namespace + IID", async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);
      expect(testData.project?.path_with_namespace).toBeDefined();

      const firstWorkItem = testData.workItems![0];

      // Lookup by ID
      const byIdParams = {
        action: "get" as const,
        id: firstWorkItem.id,
      };
      const byIdResult = BrowseWorkItemsSchema.safeParse(byIdParams);
      expect(byIdResult.success).toBe(true);
      if (!byIdResult.success) return;

      const workItemById = (await helper.executeTool("browse_work_items", byIdResult.data)) as any;

      // Lookup by namespace + IID
      const byIidParams = {
        action: "get" as const,
        namespace: testData.project!.path_with_namespace,
        iid: firstWorkItem.iid,
      };
      const byIidResult = BrowseWorkItemsSchema.safeParse(byIidParams);
      expect(byIidResult.success).toBe(true);
      if (!byIidResult.success) return;

      const workItemByIid = (await helper.executeTool(
        "browse_work_items",
        byIidResult.data
      )) as any;

      // Both lookups should return the same work item
      expect(workItemById.id).toBe(workItemByIid.id);
      expect(workItemById.iid).toBe(workItemByIid.iid);
      expect(workItemById.title).toBe(workItemByIid.title);

      console.log(
        `✅ Both lookup methods return same work item: ${workItemById.title} (ID: ${workItemById.id}, IID: ${workItemById.iid})`
      );
    }, 30000);

    it("should reject get action without id or namespace+iid", async () => {
      // Missing both id and namespace+iid
      const invalidParams1 = {
        action: "get" as const,
      };

      const result1 = BrowseWorkItemsSchema.safeParse(invalidParams1);
      expect(result1.success).toBe(false);

      // Has namespace but missing iid
      const invalidParams2 = {
        action: "get" as const,
        namespace: "test/project",
      };

      const result2 = BrowseWorkItemsSchema.safeParse(invalidParams2);
      expect(result2.success).toBe(false);

      // Has iid but missing namespace
      const invalidParams3 = {
        action: "get" as const,
        iid: "1",
      };

      const result3 = BrowseWorkItemsSchema.safeParse(invalidParams3);
      expect(result3.success).toBe(false);

      console.log("✅ BrowseWorkItemsSchema correctly rejects invalid get parameters");
    });
  });

  describe("CRUD Operations Integration Tests", () => {
    let crudTestWorkItemId: string | null = null;

    it("should create work item via GraphQL API using handler function", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      // Create new work item using handler function
      const createParams = {
        action: "create" as const,
        namespace: testData.project!.path_with_namespace,
        title: `Schema Test Work Item ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Test work item created for schema validation",
      };

      // Validate parameters first
      const paramResult = ManageWorkItemSchema.safeParse(createParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔧 Creating test work item using handler function...");
      const workItem = (await helper.executeTool("manage_work_item", paramResult.data)) as any;

      expect(workItem).toBeDefined();
      expect(workItem).toHaveProperty("id");
      expect(workItem).toHaveProperty("iid");
      expect(workItem).toHaveProperty("title");
      expect(workItem.title).toBe(createParams.title);

      crudTestWorkItemId = workItem.id;

      console.log(
        `✅ ManageWorkItemSchema successful via handler: ${workItem.title} (ID: ${workItem.id}, IID: ${workItem.iid})`
      );
    }, 15000);

    it("should read the created work item via GraphQL API", async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test BrowseWorkItemsSchema with actual GraphQL API call
      const getParams = {
        action: "get" as const,
        id: crudTestWorkItemId!,
      };

      const paramResult = BrowseWorkItemsSchema.safeParse(getParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔍 Reading created work item using handler function...");
      const workItem = (await helper.executeTool("browse_work_items", paramResult.data)) as any;

      expect(workItem).toBeDefined();
      expect(workItem.id).toBe(crudTestWorkItemId);
      expect(workItem).toHaveProperty("iid");
      expect(workItem).toHaveProperty("title");

      console.log(
        `✅ BrowseWorkItemsSchema read successful via handler: ${workItem.title} (ID: ${workItem.id})`
      );
    }, 15000);

    it("should update the work item via GraphQL API", async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test ManageWorkItemSchema with required fields for GraphQL
      const updateParams = {
        action: "update" as const,
        id: crudTestWorkItemId!,
        title: `Updated Schema Test Work Item ${Date.now()}`,
        description: "Updated description for schema validation test",
        assigneeIds: [], // Empty array for assignees
      };

      const paramResult = ManageWorkItemSchema.safeParse(updateParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🔧 Updating work item using handler function...");
      const updatedWorkItem = (await helper.executeTool(
        "manage_work_item",
        paramResult.data
      )) as any;

      expect(updatedWorkItem).toBeDefined();
      expect(updatedWorkItem.id).toBe(crudTestWorkItemId);
      expect(updatedWorkItem.title).toBe(updateParams.title);

      console.log(`✅ ManageWorkItemSchema successful via handler: ${updatedWorkItem.title}`);
    }, 15000);

    it("should delete the created work item via GraphQL API", async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test ManageWorkItemSchema
      const deleteParams = {
        action: "delete" as const,
        id: crudTestWorkItemId!,
      };

      const paramResult = ManageWorkItemSchema.safeParse(deleteParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log("🗑️ Deleting test work item using handler function...");
      const result = (await helper.executeTool("manage_work_item", paramResult.data)) as any;

      // Deletion might return different structures depending on implementation
      console.log(`✅ ManageWorkItemSchema successful via handler: ${JSON.stringify(result)}`);

      // Clear the test work item ID since it's been deleted
      crudTestWorkItemId = null;
    }, 15000);
  });
});
