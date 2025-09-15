import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListLabelsSchema, GetLabelSchema } from './schema-readonly';
import { ToolDefinition } from '../../types';

export const labelsReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'list_labels',
    description: 'List labels for a project',
    inputSchema: zodToJsonSchema(ListLabelsSchema),
  },
  {
    name: 'get_label',
    description: 'Get a single label from a project',
    inputSchema: zodToJsonSchema(GetLabelSchema),
  },
];

// Define which label tools are read-only (list of tool names)
export const labelsReadOnlyTools = ['list_labels', 'get_label'];
