import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateLabelSchema, UpdateLabelSchema, DeleteLabelSchema } from './schema';
import { ToolDefinition } from '../../types';

export const labelsWriteTools: ToolDefinition[] = [
  {
    name: 'create_label',
    description: 'Create a new label in a project',
    inputSchema: zodToJsonSchema(CreateLabelSchema),
  },
  {
    name: 'update_label',
    description: 'Update an existing label in a project',
    inputSchema: zodToJsonSchema(UpdateLabelSchema),
  },
  {
    name: 'delete_label',
    description: 'Delete a label from a project',
    inputSchema: zodToJsonSchema(DeleteLabelSchema),
  },
];
