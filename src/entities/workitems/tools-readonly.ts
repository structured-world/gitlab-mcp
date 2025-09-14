import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from './schema-readonly';
import { ToolDefinition } from '../../types';

export const workitemsReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'list_work_items',
    description: 'List work items from a GitLab group with optional filtering by type',
    inputSchema: zodToJsonSchema(ListWorkItemsSchema),
  },
  {
    name: 'get_work_item',
    description: 'Get details of a specific work item by ID',
    inputSchema: zodToJsonSchema(GetWorkItemSchema),
  },
  {
    name: 'get_work_item_types',
    description: 'Get available work item types for a group',
    inputSchema: zodToJsonSchema(GetWorkItemTypesSchema),
  },
];

export const workitemsReadOnlyTools = workitemsReadOnlyToolsArray.map((tool) => tool.name);
