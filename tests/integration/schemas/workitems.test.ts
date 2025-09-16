/**
 * Work Items Schema Integration Tests
 * Tests ListWorkItemsSchema, GetWorkItemSchema, and GetWorkItemTypesSchema against real GitLab 18.3 API responses
 */

import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from '../../../src/entities/workitems/schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from '../../../src/entities/workitems/schema';
import { getTestData } from '../../setup/testConfig';
import { IntegrationTestHelper } from '../helpers/registry-helper';

describe('Work Items Schema - GitLab 18.3 Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    // Initialize integration test helper
    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log('✅ Integration test helper initialized for work items testing');
  });

  describe('GetWorkItemTypesSchema', () => {
    it('should validate get work item types parameters', async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const validParams = {
        groupPath: testData.project!.path_with_namespace,
      };

      const result = GetWorkItemTypesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.groupPath).toBe(testData.project!.path_with_namespace);
      }

      console.log('✅ GetWorkItemTypesSchema validates parameters correctly');
    });

    it('should make successful GraphQL request for work item types using handler function', async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const params = {
        groupPath: testData.project!.path_with_namespace,
      };

      // Validate parameters first
      const paramResult = GetWorkItemTypesSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 Getting work item types using handler function...');
      const workItemTypes = await helper.executeTool('get_work_item_types', paramResult.data) as any[];

      expect(Array.isArray(workItemTypes)).toBe(true);
      expect(workItemTypes.length).toBeGreaterThan(0);

      // Validate structure of work item types
      for (const workItemType of workItemTypes.slice(0, 3)) {
        expect(workItemType).toHaveProperty('id');
        expect(workItemType).toHaveProperty('name');
        expect(typeof workItemType.name).toBe('string');
        console.log(`  ✅ Work item type: ${workItemType.name} (ID: ${workItemType.id})`);
      }

      console.log(`✅ GetWorkItemTypesSchema API request successful via handler, found ${workItemTypes.length} work item types`);
    }, 15000);
  });

  describe('ListWorkItemsSchema', () => {
    it('should validate basic list work items parameters', async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const validParams = {
        groupPath: testData.project!.path_with_namespace,
        first: 5,
        types: ['ISSUE' as const, 'TASK' as const],
      };

      const result = ListWorkItemsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.groupPath).toBe(testData.project!.path_with_namespace);
        expect(result.data.first).toBe(5);
        expect(result.data.types).toEqual(['ISSUE', 'TASK']);
      }

      console.log('✅ ListWorkItemsSchema validates basic parameters correctly');
    });

    it('should make successful request with validated parameters using handler function', async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      const params = {
        groupPath: testData.project!.path_with_namespace,
        first: 3,
        types: ['ISSUE' as const],
      };

      // Validate parameters first
      const paramResult = ListWorkItemsSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 ListWorkItemsSchema - Testing list work items using handler function...');
      const workItems = await helper.executeTool('list_work_items', paramResult.data) as any[];

      expect(Array.isArray(workItems)).toBe(true);
      console.log(`📋 Found ${workItems.length} work items via handler`);

      // Validate structure if work items exist
      if (workItems.length > 0) {
        const firstWorkItem = workItems[0];
        expect(firstWorkItem).toHaveProperty('id');
        expect(firstWorkItem).toHaveProperty('iid');
        expect(firstWorkItem).toHaveProperty('title');
        expect(firstWorkItem).toHaveProperty('workItemType');
        console.log(`  ✅ Work item: ${firstWorkItem.title} (IID: ${firstWorkItem.iid})`);
      }

      console.log(`✅ ListWorkItemsSchema API request successful via handler, found ${workItems.length} work items`);
    }, 15000);
  });

  describe('GetWorkItemSchema', () => {
    it('should validate get work item parameters', async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);

      const firstWorkItem = testData.workItems![0];
      const validParams = {
        id: firstWorkItem.id,
      };

      const result = GetWorkItemSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.id).toBe(firstWorkItem.id);
      }

      console.log('✅ GetWorkItemSchema validates parameters correctly');
    });

    it('should make successful GraphQL request for single work item', async () => {
      const testData = getTestData();
      expect(testData.workItems).toBeDefined();
      expect(testData.workItems!.length).toBeGreaterThan(0);

      const firstWorkItem = testData.workItems![0];
      const params = {
        id: firstWorkItem.id,
      };

      // Validate parameters first
      const paramResult = GetWorkItemSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 Getting single work item using handler function...');
      const workItem = await helper.executeTool('get_work_item', paramResult.data) as any;

      expect(workItem).toBeDefined();
      expect(workItem).toHaveProperty('id');
      expect(workItem).toHaveProperty('iid');
      expect(workItem).toHaveProperty('title');
      expect(workItem).toHaveProperty('workItemType');

      console.log(`✅ GetWorkItemSchema API request successful via handler: ${workItem.title} (IID: ${workItem.iid})`);
    }, 15000);
  });

  describe('CRUD Operations Integration Tests', () => {
    let crudTestWorkItemId: string | null = null;

    it('should create work item via GraphQL API using handler function', async () => {
      const testData = getTestData();
      expect(testData.project?.path_with_namespace).toBeDefined();

      // Create new work item using handler function
      const createParams = {
        namespacePath: testData.project!.path_with_namespace,
        title: `Schema Test Work Item ${Date.now()}`,
        workItemType: 'ISSUE',
        description: 'Test work item created for schema validation',
      };

      // Validate parameters first
      const paramResult = CreateWorkItemSchema.safeParse(createParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔧 Creating test work item using handler function...');
      const workItem = await helper.executeTool('create_work_item', paramResult.data) as any;

      expect(workItem).toBeDefined();
      expect(workItem).toHaveProperty('id');
      expect(workItem).toHaveProperty('iid');
      expect(workItem).toHaveProperty('title');
      expect(workItem.title).toBe(createParams.title);

      crudTestWorkItemId = workItem.id;

      console.log(`✅ CreateWorkItemSchema successful via handler: ${workItem.title} (ID: ${workItem.id}, IID: ${workItem.iid})`);
    }, 15000);

    it('should read the created work item via GraphQL API', async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test GetWorkItemSchema with actual GraphQL API call
      const getParams = {
        id: crudTestWorkItemId!,
      };

      const paramResult = GetWorkItemSchema.safeParse(getParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 Reading created work item using handler function...');
      const workItem = await helper.executeTool('get_work_item', paramResult.data) as any;

      expect(workItem).toBeDefined();
      expect(workItem.id).toBe(crudTestWorkItemId);
      expect(workItem).toHaveProperty('iid');
      expect(workItem).toHaveProperty('title');

      console.log(`✅ GetWorkItemSchema read successful via handler: ${workItem.title} (ID: ${workItem.id})`);
    }, 15000);

    it('should update the work item via GraphQL API', async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test UpdateWorkItemSchema with required fields for GraphQL
      const updateParams = {
        id: crudTestWorkItemId!,
        title: `Updated Schema Test Work Item ${Date.now()}`,
        description: 'Updated description for schema validation test',
        assigneeIds: [], // Empty array for assignees
      };

      const paramResult = UpdateWorkItemSchema.safeParse(updateParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔧 Updating work item using handler function...');
      const updatedWorkItem = await helper.executeTool('update_work_item', paramResult.data) as any;

      expect(updatedWorkItem).toBeDefined();
      expect(updatedWorkItem.id).toBe(crudTestWorkItemId);
      expect(updatedWorkItem.title).toBe(updateParams.title);

      console.log(`✅ UpdateWorkItemSchema successful via handler: ${updatedWorkItem.title}`);
    }, 15000);

    it('should delete the created work item via GraphQL API', async () => {
      expect(crudTestWorkItemId).toBeDefined();

      // Test DeleteWorkItemSchema
      const deleteParams = {
        id: crudTestWorkItemId!,
      };

      const paramResult = DeleteWorkItemSchema.safeParse(deleteParams);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🗑️ Deleting test work item using handler function...');
      const result = await helper.executeTool('delete_work_item', paramResult.data) as any;

      // Deletion might return different structures depending on implementation
      console.log(`✅ DeleteWorkItemSchema successful via handler: ${JSON.stringify(result)}`);

      // Clear the test work item ID since it's been deleted
      crudTestWorkItemId = null;
    }, 15000);
  });
});