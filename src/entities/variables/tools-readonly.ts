import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListVariablesSchema, GetVariableSchema } from './schema-readonly';
import { ToolDefinition } from '../../types';

export const variablesReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'list_variables',
    description:
      'List all CI/CD variables for a project or group with their configuration and security settings. Supports both project-level and group-level variables',
    inputSchema: zodToJsonSchema(ListVariablesSchema),
  },
  {
    name: 'get_variable',
    description:
      'Get a specific CI/CD variable by key from a project or group, optionally filtered by environment scope. Useful for checking variable configuration and troubleshooting pipeline issues',
    inputSchema: zodToJsonSchema(GetVariableSchema),
  },
];

export const variablesReadOnlyTools = variablesReadOnlyToolsArray.map((tool) => tool.name);
