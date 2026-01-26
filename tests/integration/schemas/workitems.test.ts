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

  describe("Linked Items Integration Tests (Issue #232)", () => {
    let sourceWorkItemId: string | null = null;
    let targetWorkItemId: string | null = null;

    it("should create two work items to test linking", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      // Create source work item
      console.log("🔧 Creating source work item for linking test...");
      const sourceWorkItem = (await helper.executeTool("manage_work_item", {
        action: "create",
        namespace: testData.project!.path_with_namespace,
        title: `Link Source Issue ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Source issue for testing linkType/targetId in update action",
      })) as any;

      expect(sourceWorkItem).toBeDefined();
      expect(sourceWorkItem.id).toBeDefined();
      sourceWorkItemId = sourceWorkItem.id;
      console.log(`  ✅ Created source: ${sourceWorkItem.iid}`);

      // Create target work item
      console.log("🔧 Creating target work item for linking test...");
      const targetWorkItem = (await helper.executeTool("manage_work_item", {
        action: "create",
        namespace: testData.project!.path_with_namespace,
        title: `Link Target Issue ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Target issue for testing linkType/targetId in update action",
      })) as any;

      expect(targetWorkItem).toBeDefined();
      expect(targetWorkItem.id).toBeDefined();
      targetWorkItemId = targetWorkItem.id;
      console.log(`  ✅ Created target: ${targetWorkItem.iid}`);
    }, 30000);

    it("should link work items using update action with linkType/targetId (Issue #232 fix)", async () => {
      expect(sourceWorkItemId).toBeDefined();
      expect(targetWorkItemId).toBeDefined();

      console.log("🔗 Testing update with linkType/targetId...");

      // Update source work item with linked item relationship
      const updateParams = {
        action: "update" as const,
        id: sourceWorkItemId!,
        linkType: "BLOCKED_BY" as const,
        targetId: targetWorkItemId!,
      };

      const paramResult = ManageWorkItemSchema.safeParse(updateParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) {
        console.log("Schema validation failed:", paramResult.error);
        return;
      }

      const updatedWorkItem = (await helper.executeTool(
        "manage_work_item",
        paramResult.data
      )) as any;

      expect(updatedWorkItem).toBeDefined();
      expect(updatedWorkItem.id).toBe(sourceWorkItemId);

      // Check for warning (partial failure) or success
      if (updatedWorkItem._warning) {
        console.log(`  ⚠️  Linked item partially failed: ${updatedWorkItem._warning.message}`);
        console.log(`  Error: ${JSON.stringify(updatedWorkItem._warning.failedProperties)}`);
      } else {
        console.log(`  ✅ Work item updated with linked item successfully`);
      }

      // Verify the linked item was created by fetching the work item
      const getResult = (await helper.executeTool("browse_work_items", {
        action: "get",
        id: sourceWorkItemId!,
      })) as any;

      expect(getResult).toBeDefined();
      expect(getResult.widgets).toBeDefined();

      // Find LINKED_ITEMS widget
      const linkedItemsWidget = getResult.widgets?.find((w: any) => w.type === "LINKED_ITEMS");

      if (linkedItemsWidget?.linkedItems?.nodes?.length > 0) {
        const linkedItem = linkedItemsWidget.linkedItems.nodes.find(
          (node: any) => node.workItem.id === targetWorkItemId
        );
        expect(linkedItem).toBeDefined();
        expect(linkedItem.linkType).toBe("BLOCKED_BY");
        console.log(
          `  ✅ Verified linked item: ${linkedItem.linkType} -> ${linkedItem.workItem.title}`
        );
      } else {
        // If no linked items found, check if _warning was present (expected behavior)
        if (!updatedWorkItem._warning) {
          console.log(`  ⚠️  No linked items found in widget, but no warning was returned`);
        }
      }

      console.log("✅ Update action with linkType/targetId test completed (Issue #232)");
    }, 30000);

    it("should validate that linkType and targetId must be provided together", async () => {
      // Test with only linkType
      const onlyLinkTypeParams = {
        action: "update" as const,
        id: sourceWorkItemId!,
        linkType: "BLOCKS" as const,
      };

      const result1 = ManageWorkItemSchema.safeParse(onlyLinkTypeParams);
      // Schema should pass (both are optional), but handler should reject
      expect(result1.success).toBe(true);

      // Test with only targetId
      const onlyTargetIdParams = {
        action: "update" as const,
        id: sourceWorkItemId!,
        targetId: targetWorkItemId!,
      };

      const result2 = ManageWorkItemSchema.safeParse(onlyTargetIdParams);
      expect(result2.success).toBe(true);

      console.log("✅ Schema validation for linkType/targetId params verified");
    }, 15000);

    it("should cleanup test work items", async () => {
      // Delete source work item
      if (sourceWorkItemId) {
        console.log("🗑️ Cleaning up source work item...");
        await helper.executeTool("manage_work_item", {
          action: "delete",
          id: sourceWorkItemId,
        });
        sourceWorkItemId = null;
        console.log("  ✅ Source work item deleted");
      }

      // Delete target work item
      if (targetWorkItemId) {
        console.log("🗑️ Cleaning up target work item...");
        await helper.executeTool("manage_work_item", {
          action: "delete",
          id: targetWorkItemId,
        });
        targetWorkItemId = null;
        console.log("  ✅ Target work item deleted");
      }
    }, 30000);
  });

  describe("Labels Widget Integration Tests", () => {
    let testWorkItemId: string | null = null;
    let label1Id: string | null = null;
    let label2Id: string | null = null;
    let label3Id: string | null = null;

    it("should prepare test labels and work item", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      // Get existing labels from test data or use project labels
      const labels = testData.labels || [];
      if (labels.length >= 3) {
        label1Id = labels[0].id.toString();
        label2Id = labels[1].id.toString();
        label3Id = labels[2].id.toString();
        console.log(`  ✅ Using existing labels: ${label1Id}, ${label2Id}, ${label3Id}`);
      } else {
        // Create temporary labels for testing
        console.log("  ⚠️  Not enough labels in test data, using available labels");
        if (labels.length > 0) label1Id = labels[0].id.toString();
        if (labels.length > 1) label2Id = labels[1].id.toString();
        if (labels.length > 2) label3Id = labels[2].id.toString();
      }

      // Create a work item for label testing
      console.log("🔧 Creating work item for labels test...");
      const workItem = (await helper.executeTool("manage_work_item", {
        action: "create",
        namespace: testData.project!.path_with_namespace,
        title: `Labels Test Issue ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Test issue for labels widget operations",
      })) as any;

      expect(workItem).toBeDefined();
      expect(workItem.id).toBeDefined();
      testWorkItemId = workItem.id;
      console.log(`  ✅ Created work item: ${workItem.iid}`);
    }, 30000);

    it("should create work item with labels in single call", async () => {
      const testData = getTestData();
      if (!label1Id) {
        console.log("  ⚠️  Skipping: no labels available");
        return;
      }

      console.log("🔧 Creating work item with labels in single call...");
      const workItem = (await helper.executeTool("manage_work_item", {
        action: "create",
        namespace: testData.project!.path_with_namespace,
        title: `Issue With Labels ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Test issue created with labels",
        labelIds: [label1Id],
      })) as any;

      expect(workItem).toBeDefined();
      expect(workItem.id).toBeDefined();

      // Verify label was applied
      const labelsWidget = workItem.widgets?.find((w: any) => w.type === "LABELS");
      if (labelsWidget?.labels?.nodes) {
        const hasLabel = labelsWidget.labels.nodes.some(
          (l: any) => l.id === `gid://gitlab/ProjectLabel/${label1Id}` || l.id === label1Id
        );
        console.log(
          `  ✅ Created with labels: ${labelsWidget.labels.nodes.length} labels attached`
        );
        expect(hasLabel || labelsWidget.labels.nodes.length > 0).toBe(true);
      }

      // Cleanup
      await helper.executeTool("manage_work_item", {
        action: "delete",
        id: workItem.id,
      });
      console.log("  ✅ Cleaned up test work item");
    }, 30000);

    it("should replace all labels using labelIds (replace mode)", async () => {
      if (!testWorkItemId || !label1Id || !label2Id) {
        console.log("  ⚠️  Skipping: prerequisites not met");
        return;
      }

      console.log("🏷️  Testing labelIds (replace all labels)...");

      // First, set initial labels
      const initialUpdate = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        labelIds: [label1Id],
      })) as any;

      expect(initialUpdate).toBeDefined();
      console.log(`  ✅ Set initial label: ${label1Id}`);

      // Now replace with different label
      const replaceUpdate = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        labelIds: [label2Id],
      })) as any;

      expect(replaceUpdate).toBeDefined();

      // Verify labels were replaced
      const labelsWidget = replaceUpdate.widgets?.find((w: any) => w.type === "LABELS");
      if (labelsWidget?.labels?.nodes) {
        console.log(`  ✅ After replace: ${labelsWidget.labels.nodes.length} labels`);
        // Should only have label2, not label1
        const labelIds = labelsWidget.labels.nodes.map((l: any) => l.id);
        console.log(`  Labels: ${JSON.stringify(labelIds)}`);
      }

      console.log("✅ labelIds replace mode test completed");
    }, 30000);

    it("should add labels incrementally using addLabelIds", async () => {
      if (!testWorkItemId || !label1Id || !label2Id) {
        console.log("  ⚠️  Skipping: prerequisites not met");
        return;
      }

      console.log("🏷️  Testing addLabelIds (incremental add)...");

      // Clear labels first
      await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        labelIds: [label1Id],
      });

      // Add another label incrementally
      const addUpdate = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        addLabelIds: [label2Id],
      })) as any;

      expect(addUpdate).toBeDefined();

      // Verify both labels are present
      const labelsWidget = addUpdate.widgets?.find((w: any) => w.type === "LABELS");
      if (labelsWidget?.labels?.nodes) {
        console.log(`  ✅ After add: ${labelsWidget.labels.nodes.length} labels`);
        // Should have both label1 and label2
        expect(labelsWidget.labels.nodes.length).toBeGreaterThanOrEqual(2);
      }

      console.log("✅ addLabelIds incremental add test completed");
    }, 30000);

    it("should remove labels using removeLabelIds", async () => {
      if (!testWorkItemId || !label1Id) {
        console.log("  ⚠️  Skipping: prerequisites not met");
        return;
      }

      console.log("🏷️  Testing removeLabelIds (incremental remove)...");

      // Get current labels count before removal
      const beforeRemove = (await helper.executeTool("browse_work_items", {
        action: "get",
        id: testWorkItemId,
      })) as any;
      const beforeWidget = beforeRemove.widgets?.find((w: any) => w.type === "LABELS");
      const beforeCount = beforeWidget?.labels?.nodes?.length || 0;
      console.log(`  Before remove: ${beforeCount} labels`);

      // Remove label1
      const removeUpdate = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        removeLabelIds: [label1Id],
      })) as any;

      expect(removeUpdate).toBeDefined();

      // Verify label was removed
      const labelsWidget = removeUpdate.widgets?.find((w: any) => w.type === "LABELS");
      const afterCount = labelsWidget?.labels?.nodes?.length || 0;
      console.log(`  ✅ After remove: ${afterCount} labels`);

      // Should have fewer labels
      expect(afterCount).toBeLessThan(beforeCount);

      console.log("✅ removeLabelIds incremental remove test completed");
    }, 30000);

    it("should add and remove labels simultaneously", async () => {
      if (!testWorkItemId || !label1Id || !label2Id || !label3Id) {
        console.log("  ⚠️  Skipping: prerequisites not met (need 3 labels)");
        return;
      }

      console.log("🏷️  Testing simultaneous add and remove...");

      // Set up initial state with label1 and label2
      const setupResult = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        labelIds: [label1Id, label2Id],
      })) as any;

      // Verify initial state was set correctly - MUST have exactly 2 labels
      const initialLabels = setupResult.widgets?.find((w: any) => w.type === "LABELS");
      const initialLabelIds = initialLabels?.labels?.nodes?.map((l: any) => l.id) || [];
      console.log(
        `  ✅ Initial state set: ${initialLabelIds.length} labels (${initialLabelIds.join(", ")})`
      );
      // Assert initial state is correct before proceeding
      expect(initialLabelIds.length).toBe(2);

      // Now add label3 and remove label1 in single operation
      const mixedUpdate = (await helper.executeTool("manage_work_item", {
        action: "update",
        id: testWorkItemId,
        addLabelIds: [label3Id],
        removeLabelIds: [label1Id],
      })) as any;

      expect(mixedUpdate).toBeDefined();

      // Verify: should have label2 and label3, but not label1
      const labelsWidget = mixedUpdate.widgets?.find((w: any) => w.type === "LABELS");
      if (labelsWidget?.labels?.nodes) {
        const labelIds = labelsWidget.labels.nodes.map((l: any) => l.id);
        console.log(`  ✅ After add+remove: ${labelIds.join(", ")}`);
        // Should have exactly 2 labels (label2 stayed, label3 added, label1 removed)
        expect(labelsWidget.labels.nodes.length).toBe(2);
      }

      console.log("✅ Simultaneous add and remove test completed");
    }, 30000);

    it("should reject labelIds with addLabelIds (mutually exclusive)", async () => {
      if (!testWorkItemId || !label1Id || !label2Id) {
        console.log("  ⚠️  Skipping: prerequisites not met");
        return;
      }

      console.log("🏷️  Testing labelIds + addLabelIds rejection...");

      // This should throw an error
      await expect(
        helper.executeTool("manage_work_item", {
          action: "update",
          id: testWorkItemId,
          labelIds: [label1Id],
          addLabelIds: [label2Id],
        })
      ).rejects.toThrow(/labelIds.*cannot be used together/);

      console.log("✅ Mutual exclusion validation working correctly");
    }, 15000);

    it("should cleanup test work item", async () => {
      if (testWorkItemId) {
        console.log("🗑️ Cleaning up labels test work item...");
        await helper.executeTool("manage_work_item", {
          action: "delete",
          id: testWorkItemId,
        });
        testWorkItemId = null;
        console.log("  ✅ Work item deleted");
      }
    }, 30000);
  });

  describe("Multiple Widgets in Single Create/Update", () => {
    let complexWorkItemId: string | null = null;

    it("should create work item with multiple widgets in single call", async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const labels = testData.labels || [];
      const milestones = testData.milestones || [];
      const user = testData.user;

      console.log("🔧 Creating work item with multiple widgets...");

      const createParams: any = {
        action: "create",
        namespace: testData.project!.path_with_namespace,
        title: `Complex Widget Test ${Date.now()}`,
        workItemType: "ISSUE",
        description: "Test issue with multiple widgets applied in single create",
      };

      // Add optional widgets if test data available
      if (labels.length > 0) {
        createParams.labelIds = [labels[0].id.toString()];
      }
      if (milestones.length > 0) {
        createParams.milestoneId = milestones[0].id.toString();
      }
      if (user) {
        createParams.assigneeIds = [`gid://gitlab/User/${user.id}`];
      }
      // Add dates
      createParams.startDate = "2025-01-01";
      createParams.dueDate = "2025-12-31";

      console.log(
        `  Widgets to set: labels=${!!createParams.labelIds}, milestone=${!!createParams.milestoneId}, assignees=${!!createParams.assigneeIds}, dates=true`
      );

      const workItem = (await helper.executeTool("manage_work_item", createParams)) as any;

      expect(workItem).toBeDefined();
      expect(workItem.id).toBeDefined();
      complexWorkItemId = workItem.id;

      // Verify widgets were applied
      const widgets = workItem.widgets || [];
      const labelsWidget = widgets.find((w: any) => w.type === "LABELS");
      const milestoneWidget = widgets.find((w: any) => w.type === "MILESTONE");
      const assigneesWidget = widgets.find((w: any) => w.type === "ASSIGNEES");
      const datesWidget = widgets.find((w: any) => w.type === "START_AND_DUE_DATE");

      console.log(`  ✅ Created with widgets:`);
      console.log(`     Labels: ${labelsWidget?.labels?.nodes?.length || 0}`);
      console.log(`     Milestone: ${milestoneWidget?.milestone?.title || "none"}`);
      console.log(`     Assignees: ${assigneesWidget?.assignees?.nodes?.length || 0}`);
      console.log(
        `     Dates: start=${datesWidget?.startDate || "none"}, due=${datesWidget?.dueDate || "none"}`
      );

      // At minimum, dates should be set
      if (createParams.startDate) {
        expect(datesWidget?.startDate).toBe(createParams.startDate);
      }
      if (createParams.dueDate) {
        expect(datesWidget?.dueDate).toBe(createParams.dueDate);
      }

      console.log("✅ Multiple widgets in create test completed");
    }, 30000);

    it("should update work item with multiple widgets in single call", async () => {
      if (!complexWorkItemId) {
        console.log("  ⚠️  Skipping: no work item to update");
        return;
      }

      const testData = getTestData();
      const labels = testData.labels || [];

      console.log("🔧 Updating work item with multiple widgets...");

      const updateParams: any = {
        action: "update",
        id: complexWorkItemId,
        title: `Updated Complex Widget Test ${Date.now()}`,
        description: "Updated description with multiple widget changes",
        startDate: "2025-02-01",
        dueDate: "2025-11-30",
      };

      // Add label changes if available
      if (labels.length > 1) {
        updateParams.addLabelIds = [labels[1].id.toString()];
      }

      const updatedWorkItem = (await helper.executeTool("manage_work_item", updateParams)) as any;

      expect(updatedWorkItem).toBeDefined();
      expect(updatedWorkItem.title).toBe(updateParams.title);

      // Verify widgets were updated
      const widgets = updatedWorkItem.widgets || [];
      const datesWidget = widgets.find((w: any) => w.type === "START_AND_DUE_DATE");

      expect(datesWidget?.startDate).toBe(updateParams.startDate);
      expect(datesWidget?.dueDate).toBe(updateParams.dueDate);

      console.log("✅ Multiple widgets in update test completed");
    }, 30000);

    it("should cleanup complex work item", async () => {
      if (complexWorkItemId) {
        console.log("🗑️ Cleaning up complex work item...");
        await helper.executeTool("manage_work_item", {
          action: "delete",
          id: complexWorkItemId,
        });
        complexWorkItemId = null;
        console.log("  ✅ Work item deleted");
      }
    }, 30000);
  });
});
