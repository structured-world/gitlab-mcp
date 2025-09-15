/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListLabelsSchema, GetLabelSchema } from './schema-readonly';
import { CreateLabelSchema, UpdateLabelSchema, DeleteLabelSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Labels tools registry - unified registry containing all labels tools with their handlers
 */
export const labelsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_labels',
    {
      name: 'list_labels',
      description: 'List labels for a project or group',
      inputSchema: zodToJsonSchema(ListLabelsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListLabelsSchema.parse(args);
        const { project_id, group_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'group_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const labels = await response.json();
        return labels;
      },
    },
  ],
  [
    'get_label',
    {
      name: 'get_label',
      description: 'Get a single label from a project or group',
      inputSchema: zodToJsonSchema(GetLabelSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetLabelSchema.parse(args);
        const { project_id, group_id, label_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(label_id)}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const label = await response.json();
        return label;
      },
    },
  ],
  // Write tools
  [
    'create_label',
    {
      name: 'create_label',
      description: 'Create a new label in a project or group',
      inputSchema: zodToJsonSchema(CreateLabelSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateLabelSchema.parse(args);
        const { project_id, group_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const body = new URLSearchParams();
        body.set('name', options.name);
        body.set('color', options.color);
        if (options.description) {
          body.set('description', options.description);
        }
        if (options.priority !== undefined) {
          body.set('priority', String(options.priority));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const label = await response.json();
        return label;
      },
    },
  ],
  [
    'update_label',
    {
      name: 'update_label',
      description: 'Update an existing label in a project or group',
      inputSchema: zodToJsonSchema(UpdateLabelSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateLabelSchema.parse(args);
        const { project_id, group_id, label_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (
            value !== undefined &&
            key !== 'project_id' &&
            key !== 'group_id' &&
            key !== 'label_id'
          ) {
            body.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(label_id)}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const label = await response.json();
        return label;
      },
    },
  ],
  [
    'delete_label',
    {
      name: 'delete_label',
      description: 'Delete a label from a project or group',
      inputSchema: zodToJsonSchema(DeleteLabelSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteLabelSchema.parse(args);
        const { project_id, group_id, label_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(label_id)}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        return { success: true, message: 'Label deleted successfully' };
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getLabelsReadOnlyToolNames(): string[] {
  return ['list_labels', 'get_label'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getLabelsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(labelsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredLabelsTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getLabelsReadOnlyToolNames();
    return Array.from(labelsToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getLabelsToolDefinitions();
}
