/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from './schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Work items tools registry - unified registry containing all work item operation tools with their handlers
 */
export const workitemsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_work_items',
    {
      name: 'list_work_items',
      description: 'List work items from a GitLab group with optional filtering by type',
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
      description: 'Get details of a specific work item by ID',
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
      description: 'Get available work item types for a group',
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
      description: 'Create a new work item (epic, issue, task, etc.) in a GitLab group',
      inputSchema: zodToJsonSchema(CreateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateWorkItemSchema.parse(args);
        const { groupPath } = options;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'groupPath') {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(groupPath)}/work_items`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
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
