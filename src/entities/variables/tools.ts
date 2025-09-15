import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateVariableSchema, UpdateVariableSchema, DeleteVariableSchema } from './schema';
import { ToolDefinition } from '../../types';

export const variablesWriteTools: ToolDefinition[] = [
  {
    name: 'create_variable',
    description:
      'Create a new CI/CD variable for automated deployments and pipeline configuration in a project or group. Supports environment scoping, security settings (protected/masked), and different variable types (env_var/file)',
    inputSchema: zodToJsonSchema(CreateVariableSchema),
  },
  {
    name: 'update_variable',
    description:
      "Update an existing CI/CD variable's value, security settings, or configuration in a project or group. Can modify variable type, environment scope, and protection settings",
    inputSchema: zodToJsonSchema(UpdateVariableSchema),
  },
  {
    name: 'delete_variable',
    description:
      'Remove a CI/CD variable from a project or group. Can target specific environment scope variants when multiple variables exist with the same key',
    inputSchema: zodToJsonSchema(DeleteVariableSchema),
  },
];
