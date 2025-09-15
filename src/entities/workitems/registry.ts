/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from './schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { ConnectionManager } from '../../services/ConnectionManager';
import {
  CREATE_WORK_ITEM,
  CREATE_WORK_ITEM_WITH_DESCRIPTION,
  GET_WORK_ITEM_TYPES,
} from '../../graphql/workItems';

/**
 * Work items tools registry - unified registry containing all work item operation tools with their handlers
 */
export const workitemsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_work_items',
    {
      name: 'list_work_items',
      description:
        'List work items from a GitLab GROUP. CRITICAL GitLab Hierarchy: EPICS exist ONLY at GROUP level. ISSUES/TASKS/BUGS exist ONLY at PROJECT level. This tool queries GROUP-level work items (Epics). For Issues/Tasks, query the project they belong to, not the group.',
      inputSchema: zodToJsonSchema(ListWorkItemsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListWorkItemsSchema.parse(args);
        const { groupPath } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'groupPath') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(groupPath)}/work_items?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const workItems = await response.json();
        return workItems;
      },
    },
  ],
  [
    'get_work_item',
    {
      name: 'get_work_item',
      description:
        'Get details of a specific work item by ID. Works for both GROUP-level (Epics) and PROJECT-level (Issues/Tasks) work items.',
      inputSchema: zodToJsonSchema(GetWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWorkItemSchema.parse(args);
        const { id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/work_items/${id}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const workItem = await response.json();
        return workItem;
      },
    },
  ],
  [
    'get_work_item_types',
    {
      name: 'get_work_item_types',
      description:
        'Get available work item types for a GROUP. Returns Epic types and other group-level types. Note: Issue/Task/Bug types exist at project level, not group level.',
      inputSchema: zodToJsonSchema(GetWorkItemTypesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWorkItemTypesSchema.parse(args);
        const { groupPath } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(groupPath)}/work_item_types`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const workItemTypes = await response.json();
        return workItemTypes;
      },
    },
  ],
  // Write tools
  [
    'create_work_item',
    {
      name: 'create_work_item',
      description:
        'Create a new work item using namespacePath (group or project). CRITICAL GitLab Hierarchy: EPICS can only be created in GROUPS, ISSUES/TASKS can only be created in PROJECTS. Use the correct namespace type for your work item type.',
      inputSchema: zodToJsonSchema(CreateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateWorkItemSchema.parse(args);
        const { namespacePath, title, workItemType, description } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // First, get work item types for this namespace to get the correct type ID
        const workItemTypesResponse = await client.request(GET_WORK_ITEM_TYPES, {
          namespacePath,
        });

        const workItemTypes = workItemTypesResponse.namespace.workItemTypes.nodes;
        const workItemTypeObj = workItemTypes.find((t) => t.name.toUpperCase() === workItemType);

        if (!workItemTypeObj) {
          throw new Error(
            `Work item type "${workItemType}" not found in namespace "${namespacePath}"`,
          );
        }

        // Use appropriate mutation based on whether description is provided
        const response = description
          ? await client.request(CREATE_WORK_ITEM_WITH_DESCRIPTION, {
              namespacePath,
              title,
              workItemTypeId: workItemTypeObj.id,
              description,
            })
          : await client.request(CREATE_WORK_ITEM, {
              namespacePath,
              title,
              workItemTypeId: workItemTypeObj.id,
            });

        if (response.workItemCreate?.errors?.length && response.workItemCreate.errors.length > 0) {
          throw new Error(`GitLab GraphQL errors: ${response.workItemCreate.errors.join(', ')}`);
        }

        if (!response.workItemCreate?.workItem) {
          throw new Error('Work item creation failed - no work item returned');
        }

        return response.workItemCreate.workItem;
      },
    },
  ],
  [
    'update_work_item',
    {
      name: 'update_work_item',
      description: "Update an existing work item's properties",
      inputSchema: zodToJsonSchema(UpdateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateWorkItemSchema.parse(args);
        const { id } = options;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'id') {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/work_items/${id}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const workItem = await response.json();
        return workItem;
      },
    },
  ],
  [
    'delete_work_item',
    {
      name: 'delete_work_item',
      description: 'Delete a work item',
      inputSchema: zodToJsonSchema(DeleteWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteWorkItemSchema.parse(args);
        const { id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/work_items/${id}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        // Work item deletion may return empty response
        const result = response.status === 204 ? { deleted: true } : await response.json();
        return result;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getWorkitemsReadOnlyToolNames(): string[] {
  return ['list_work_items', 'get_work_item', 'get_work_item_types'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getWorkitemsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(workitemsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredWorkitemsTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getWorkitemsReadOnlyToolNames();
    return Array.from(workitemsToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getWorkitemsToolDefinitions();
}
