/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWikiPagesSchema, GetWikiPageSchema } from './schema-readonly';
import { CreateWikiPageSchema, UpdateWikiPageSchema, DeleteWikiPageSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Wiki tools registry - unified registry containing all wiki operation tools with their handlers
 */
export const wikiToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_wiki_pages',
    {
      name: 'list_wiki_pages',
      description: 'List wiki pages in a GitLab project or group',
      inputSchema: zodToJsonSchema(ListWikiPagesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListWikiPagesSchema.parse(args);
        const { project_id, group_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id' && key !== 'group_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const wikiPages = await response.json();
        return wikiPages;
      },
    },
  ],
  [
    'get_wiki_page',
    {
      name: 'get_wiki_page',
      description: 'Get details of a specific wiki page from a project or group',
      inputSchema: zodToJsonSchema(GetWikiPageSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWikiPageSchema.parse(args);
        const { project_id, group_id, slug } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            key !== 'project_id' &&
            key !== 'group_id' &&
            key !== 'slug'
          ) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(slug)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const wikiPage = await response.json();
        return wikiPage;
      },
    },
  ],
  // Write tools
  [
    'create_wiki_page',
    {
      name: 'create_wiki_page',
      description: 'Create a new wiki page in a GitLab project or group',
      inputSchema: zodToJsonSchema(CreateWikiPageSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateWikiPageSchema.parse(args);
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

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis`;
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

        const wikiPage = await response.json();
        return wikiPage;
      },
    },
  ],
  [
    'update_wiki_page',
    {
      name: 'update_wiki_page',
      description: 'Update an existing wiki page in a GitLab project or group',
      inputSchema: zodToJsonSchema(UpdateWikiPageSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateWikiPageSchema.parse(args);
        const { project_id, group_id, slug } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            key !== 'project_id' &&
            key !== 'group_id' &&
            key !== 'slug'
          ) {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(slug)}`;
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

        const wikiPage = await response.json();
        return wikiPage;
      },
    },
  ],
  [
    'delete_wiki_page',
    {
      name: 'delete_wiki_page',
      description: 'Delete a wiki page from a GitLab project or group',
      inputSchema: zodToJsonSchema(DeleteWikiPageSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteWikiPageSchema.parse(args);
        const { project_id, group_id, slug } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(slug)}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        // Wiki deletion may return empty response
        const result = response.status === 204 ? { deleted: true } : await response.json();
        return result;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getWikiReadOnlyToolNames(): string[] {
  return ['list_wiki_pages', 'get_wiki_page'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getWikiToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(wikiToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredWikiTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getWikiReadOnlyToolNames();
    return Array.from(wikiToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getWikiToolDefinitions();
}
