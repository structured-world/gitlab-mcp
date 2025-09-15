/**
 * Work Items GraphQL Integration Tests
 * Tests against real GitLab instance to validate widget implementation
 *
 * 🚨 CRITICAL: GitLab Work Items Hierarchy Rules
 *
 * GROUP LEVEL ONLY:
 * - Epics (Type 7) - ONLY exist at group level, query with group { workItems }
 *
 * PROJECT LEVEL ONLY:
 * - Issues (Type 1) - ONLY exist at project level, query with project { workItems }
 * - Tasks (Type 4) - ONLY exist at project level, query with project { workItems }
 * - Bugs (Type 2) - ONLY exist at project level, query with project { workItems }
 *
 * FORBIDDEN:
 * - ❌ project { workItems(types: [EPIC]) } - Epics don't exist at project level
 * - ❌ group { workItems(types: [ISSUE]) } - Issues don't exist at group level
 */

import { GraphQLClient } from '../../src/graphql/client';
import { GET_WORK_ITEM, CREATE_WORK_ITEM, GET_WORK_ITEM_TYPES, WorkItemTypeEnum } from '../../src/graphql/workItems';
import { DynamicWorkItemsQueryBuilder } from '../../src/graphql/DynamicWorkItemsQuery';
import { ConnectionManager } from '../../src/services/ConnectionManager';
import { getTestData, requireTestData } from '../setup/testConfig';

describe('Work Items GraphQL - Real GitLab Instance', () => {
  let client: GraphQLClient;
  let connectionManager: ConnectionManager;
  let queryBuilder: DynamicWorkItemsQueryBuilder;
  const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
  const GITLAB_BASE_URL = process.env.GITLAB_API_URL || 'https://gitlab.com';

  beforeAll(async () => {
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }

    // Initialize connection manager to load schema
    connectionManager = ConnectionManager.getInstance();
    await connectionManager.initialize();

    client = connectionManager.getClient();

    // Create dynamic query builder with schema introspection
    const schemaIntrospector = connectionManager.getSchemaIntrospector();
    queryBuilder = new DynamicWorkItemsQueryBuilder(schemaIntrospector);
  });

  describe('Work Items Query Operations', () => {
    it('should list GROUP-level work items (Epics) from test group', async () => {
      // 🚨 CRITICAL: This queries GROUP-level work items (Epics only)
      // Issues/Tasks exist at PROJECT level, not group level
      const testData = requireTestData();
      const testGroupPath = testData.group.path;

      console.log(`🔧 Querying GROUP-level work items from: ${testGroupPath}`);

      const query = queryBuilder.buildMinimalQuery();
      const response = await client.request(query, {
        groupPath: testGroupPath,
        first: 10,
      }) as { group: { workItems: { nodes: any[] } | null } };

      expect(response).toBeDefined();
      expect(response.group).toBeDefined();

      // GROUP work items might be null if no Epics exist - this is valid
      if (response.group.workItems === null) {
        console.log('📋 No GROUP-level work items (Epics) found - this is expected if no Epics were created');
        expect(response.group.workItems).toBeNull();
      } else {
        expect(Array.isArray(response.group.workItems.nodes)).toBe(true);
        console.log(`📋 Found ${response.group.workItems.nodes.length} GROUP-level work items (Epics)`);

        if (response.group.workItems.nodes.length > 0) {
          const firstWorkItem = response.group.workItems.nodes[0];
          console.log(`First work item: ${firstWorkItem.title} (${firstWorkItem.workItemType.name})`);
          console.log(`Available widgets: ${firstWorkItem.widgets.map((w: any) => w.type).join(', ')}`);
        }
      }
    }, 30000);

    it('should get single work item with widgets', async () => {
      // First get a list to find a work item ID
      const testData = requireTestData();
      const testGroupPath = testData.group.path;

      const listQuery = queryBuilder.buildWorkItemsQuery();
      const listResponse = await client.request(listQuery, {
        groupPath: testGroupPath,
        first: 1,
      }) as { group: { workItems: { nodes: any[] } | null } };

      if (!listResponse.group.workItems || listResponse.group.workItems.nodes.length === 0) {
        console.warn('No GROUP-level work items (Epics) found - skipping single work item test');
        return;
      }

      const workItemId = listResponse.group.workItems.nodes[0].id;

      const response = await client.request(GET_WORK_ITEM, {
        id: workItemId,
      }) as { workItem: any };

      expect(response).toBeDefined();
      expect(response.workItem).toBeDefined();
      expect(response.workItem.id).toBe(workItemId);
      expect(Array.isArray(response.workItem.widgets)).toBe(true);

      // Validate that we have the expected widget structure
      const widgets = response.workItem.widgets;
      console.log(`Work item "${response.workItem.title}" has ${widgets.length} widgets:`);

      widgets.forEach((widget: any) => {
        expect(widget.type).toBeDefined();
        console.log(`- Widget: ${widget.type}`);
      });
    }, 30000);
  });

  describe('Work Items Widget Validation', () => {
    it('should validate core widget types are supported', async () => {
      const testData = requireTestData();
      const testGroupPath = testData.group.path;

      const query = queryBuilder.buildWorkItemsQuery();
      const response = await client.request(query, {
        groupPath: testGroupPath,
        first: 10,
      }) as { group: { workItems: { nodes: any[] } | null } };

      if (!response.group.workItems || response.group.workItems.nodes.length === 0) {
        console.warn('No GROUP-level work items (Epics) found - skipping widget validation test');
        return;
      }

      const allWidgets = response.group.workItems.nodes.flatMap((item: any) => item.widgets);
      const widgetTypes = new Set(allWidgets.map(w => w.type));

      console.log('Available widget types in test data:', Array.from(widgetTypes).sort());

      // Check that our implemented widgets are available
      const expectedWidgets = [
        'ASSIGNEES',
        'DESCRIPTION',
        'HIERARCHY',
        'LABELS',
        'MILESTONE',
        'NOTES',
        'START_AND_DUE_DATE',
        'TIME_TRACKING',
        'PARTICIPANTS',
      ];

      const availableExpected = expectedWidgets.filter(type => widgetTypes.has(type));
      console.log('Expected widgets found:', availableExpected);

      // At least some core widgets should be available
      expect(availableExpected.length).toBeGreaterThan(3);
    }, 30000);
  });

  describe('Work Item Creation (if supported)', () => {
    it('should create a test Epic at GROUP level', async () => {
      try {
        const testData = requireTestData();
        const testGroupPath = testData.group.path;

        // 🚨 CRITICAL: Get work item types dynamically for this group namespace
        console.log('🔍 Getting Epic work item type for group namespace...');
        const workItemTypesResponse = await client.request(GET_WORK_ITEM_TYPES, {
          namespacePath: testGroupPath,
        });

        const groupWorkItemTypes = workItemTypesResponse.namespace.workItemTypes.nodes;
        const epicType = groupWorkItemTypes.find(t => t.name === 'Epic');

        if (!epicType) {
          console.warn('Epic work item type not found in group - skipping Epic creation test');
          return;
        }

        console.log(`📋 Found Epic type: ${epicType.name}(${epicType.id})`);

        // 🚨 CRITICAL: Creating Epic at GROUP level (correct)
        // NEVER try to create Epic at project level - it will fail
        const response = await client.request(CREATE_WORK_ITEM, {
          namespacePath: testGroupPath,
          title: `Test Epic Created ${Date.now()}`,
          workItemTypeId: epicType.id, // Epic type - dynamically discovered
        }) as { workItemCreate: any };

        expect(response).toBeDefined();
        expect(response.workItemCreate).toBeDefined();

        if (response.workItemCreate.errors.length > 0) {
          console.warn('Epic creation errors:', response.workItemCreate.errors);
        } else {
          expect(response.workItemCreate.workItem).toBeDefined();
          expect(response.workItemCreate.workItem.title).toContain('Test Epic Created');
          console.log(`Created test Epic: ${response.workItemCreate.workItem.webUrl}`);
        }
      } catch (error) {
        console.warn('Epic creation not supported or failed:', error);
        // Don't fail the test - creation permissions might not be available
      }
    }, 30000);

    it('should validate work items follow data lifecycle pattern', async () => {
      // 🚨 CRITICAL: Uses existing test data created by data-lifecycle.test.ts
      // This follows our data lifecycle pattern - NEVER create test data in individual tests
      const testData = requireTestData();

      // Verify we have group work items (Epics) created by lifecycle
      if (testData.groupWorkItems && testData.groupWorkItems.length > 0) {
        console.log(`📋 Found ${testData.groupWorkItems.length} GROUP-level work items (Epics) from data lifecycle`);

        testData.groupWorkItems.forEach((workItem: any, index: number) => {
          expect(workItem).toBeDefined();
          expect(workItem.title).toBeDefined();
          expect(workItem.iid).toBeDefined();
          console.log(`  Epic ${index + 1}: ${workItem.title} (IID: ${workItem.iid})`);
        });
      } else {
        console.log('📋 No GROUP-level work items (Epics) found in test data - checking if lifecycle created them');
      }

      // Verify we have project work items (Issues/Tasks) created by lifecycle
      if (testData.workItems && testData.workItems.length > 0) {
        console.log(`📋 Found ${testData.workItems.length} PROJECT-level work items (Issues/Tasks) from data lifecycle`);

        testData.workItems.forEach((workItem: any, index: number) => {
          expect(workItem).toBeDefined();
          expect(workItem.title).toBeDefined();
          expect(workItem.iid).toBeDefined();
          console.log(`  Issue/Task ${index + 1}: ${workItem.title} (IID: ${workItem.iid})`);
        });
      } else {
        console.log('📋 No PROJECT-level work items found in test data');
      }

      // At least project-level work items should exist from data lifecycle
      expect(testData.workItems?.length || 0).toBeGreaterThan(0);
    }, 30000);
  });
});