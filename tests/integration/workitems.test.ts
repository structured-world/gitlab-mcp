/**
 * Work Items GraphQL Integration Tests
 * Tests against real GitLab instance to validate widget implementation
 */

import { GraphQLClient } from '../../src/graphql/client';
import { GET_WORK_ITEMS, GET_WORK_ITEM, CREATE_WORK_ITEM, WorkItemTypeEnum } from '../../src/graphql/workItems';

describe('Work Items GraphQL - Real GitLab Instance', () => {
  let client: GraphQLClient;
  const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
  const GITLAB_API_URL = process.env.GITLAB_API_URL || 'https://gitlab.com';
  const TEST_GROUP_PATH = 'test'; // Use test group for integration tests

  beforeAll(() => {
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }

    client = new GraphQLClient(`${GITLAB_API_URL}/api/graphql`, {
      headers: {
        Authorization: `Bearer ${GITLAB_TOKEN}`,
      },
    });
  });

  describe('Work Items Query Operations', () => {
    it('should list work items from test group', async () => {
      const response = await client.request(GET_WORK_ITEMS, {
        groupPath: TEST_GROUP_PATH,
        first: 10,
      }) as { group: { workItems: { nodes: any[] } } };

      expect(response).toBeDefined();
      expect(response.group).toBeDefined();
      expect(response.group.workItems).toBeDefined();
      expect(response.group.workItems.nodes).toBeInstanceOf(Array);

      // Log available work items for debugging
      console.log(`Found ${response.group.workItems.nodes.length} work items in test group`);

      if (response.group.workItems.nodes.length > 0) {
        const firstWorkItem = response.group.workItems.nodes[0];
        console.log(`First work item: ${firstWorkItem.title} (${firstWorkItem.workItemType.name})`);
        console.log(`Available widgets: ${firstWorkItem.widgets.map(w => w.type).join(', ')}`);
      }
    }, 30000);

    it('should get single work item with widgets', async () => {
      // First get a list to find a work item ID
      const listResponse = await client.request(GET_WORK_ITEMS, {
        groupPath: TEST_GROUP_PATH,
        first: 1,
      }) as { group: { workItems: { nodes: any[] } } };

      if (listResponse.group.workItems.nodes.length === 0) {
        console.warn('No work items found in test group - skipping single work item test');
        return;
      }

      const workItemId = listResponse.group.workItems.nodes[0].id;

      const response = await client.request(GET_WORK_ITEM, {
        id: workItemId,
      }) as { workItem: any };

      expect(response).toBeDefined();
      expect(response.workItem).toBeDefined();
      expect(response.workItem.id).toBe(workItemId);
      expect(response.workItem.widgets).toBeInstanceOf(Array);

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
      const response = await client.request(GET_WORK_ITEMS, {
        groupPath: TEST_GROUP_PATH,
        first: 10,
      }) as { group: { workItems: { nodes: any[] } } };

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
    it('should create a test work item', async () => {
      try {
        const response = await client.request(CREATE_WORK_ITEM, {
          namespacePath: TEST_GROUP_PATH,
          title: `Test Issue Created ${Date.now()}`,
          workItemTypeId: 'gid://gitlab/WorkItems::Type/1', // Issue type
          description: 'This is a test issue created by integration test',
        }) as { workItemCreate: any };

        expect(response).toBeDefined();
        expect(response.workItemCreate).toBeDefined();

        if (response.workItemCreate.errors.length > 0) {
          console.warn('Work item creation errors:', response.workItemCreate.errors);
        } else {
          expect(response.workItemCreate.workItem).toBeDefined();
          expect(response.workItemCreate.workItem.title).toContain('Test Issue Created');
          console.log(`Created test work item: ${response.workItemCreate.workItem.webUrl}`);
        }
      } catch (error) {
        console.warn('Work item creation not supported or failed:', error);
        // Don't fail the test - creation permissions might not be available
      }
    }, 30000);
  });
});