/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListVariablesSchema, GetVariableSchema } from './schema-readonly';
import { CreateVariableSchema, UpdateVariableSchema, DeleteVariableSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Variables tools registry - unified registry containing all variable operation tools with their handlers
 */
export const variablesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_variables',
    {
      name: 'list_variables',
      description:
        'List all CI/CD variables for a project or group with their configuration and security settings. Supports both project-level and group-level variables',
      inputSchema: zodToJsonSchema(ListVariablesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListVariablesSchema.parse(args);
        const { project_id, group_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const variables = await response.json();
        return variables;
      },
    },
  ],
  [
    'get_variable',
    {
      name: 'get_variable',
      description:
        'Get a specific CI/CD variable by key from a project or group, optionally filtered by environment scope. Useful for checking variable configuration and troubleshooting pipeline issues',
      inputSchema: zodToJsonSchema(GetVariableSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetVariableSchema.parse(args);
        const { project_id, group_id, key, filter } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const queryParams = new URLSearchParams();
        if (filter?.environment_scope) {
          queryParams.set('filter[environment_scope]', filter.environment_scope);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const variable = await response.json();
        return variable;
      },
    },
  ],
  // Write tools
  [
    'create_variable',
    {
      name: 'create_variable',
      description:
        'Create a new CI/CD variable for automated deployments and pipeline configuration in a project or group. Supports environment scoping, security settings (protected/masked), and different variable types (env_var/file)',
      inputSchema: zodToJsonSchema(CreateVariableSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateVariableSchema.parse(args);
        const { project_id, group_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id' && key !== 'group_id') {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables`;
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

        const variable = await response.json();
        return variable;
      },
    },
  ],
  [
    'update_variable',
    {
      name: 'update_variable',
      description:
        "Update an existing CI/CD variable's value, security settings, or configuration in a project or group. Can modify variable type, environment scope, and protection settings",
      inputSchema: zodToJsonSchema(UpdateVariableSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateVariableSchema.parse(args);
        const { project_id, group_id, key, filter } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([k, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            k !== 'project_id' &&
            k !== 'group_id' &&
            k !== 'key' &&
            k !== 'filter'
          ) {
            body[k] = value;
          }
        });

        // Add filter as query parameter if provided
        const queryParams = new URLSearchParams();
        if (filter?.environment_scope) {
          queryParams.set('filter[environment_scope]', filter.environment_scope);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}?${queryParams}`;
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

        const variable = await response.json();
        return variable;
      },
    },
  ],
  [
    'delete_variable',
    {
      name: 'delete_variable',
      description:
        'Remove a CI/CD variable from a project or group. Can target specific environment scope variants when multiple variables exist with the same key',
      inputSchema: zodToJsonSchema(DeleteVariableSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteVariableSchema.parse(args);
        const { project_id, group_id, key, filter } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        // Add filter as query parameter if provided
        const queryParams = new URLSearchParams();
        if (filter?.environment_scope) {
          queryParams.set('filter[environment_scope]', filter.environment_scope);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getVariablesReadOnlyToolNames(): string[] {
  return ['list_variables', 'get_variable'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getVariablesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(variablesToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredVariablesTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getVariablesReadOnlyToolNames();
    return Array.from(variablesToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getVariablesToolDefinitions();
}
