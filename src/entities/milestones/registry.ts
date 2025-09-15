/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ListProjectMilestonesSchema,
  GetProjectMilestoneSchema,
  GetMilestoneIssuesSchema,
  GetMilestoneMergeRequestsSchema,
  GetMilestoneBurndownEventsSchema,
} from './schema-readonly';
import {
  CreateProjectMilestoneSchema,
  EditProjectMilestoneSchema,
  DeleteProjectMilestoneSchema,
  PromoteProjectMilestoneSchema,
} from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Milestones tools registry - unified registry containing all milestone operation tools with their handlers
 */
export const milestonesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_milestones',
    {
      name: 'list_milestones',
      description: 'List milestones in a GitLab project or group with filtering options',
      inputSchema: zodToJsonSchema(ListProjectMilestonesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListProjectMilestonesSchema.parse(args);
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

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const milestones = await response.json();
        return milestones;
      },
    },
  ],
  [
    'get_milestone',
    {
      name: 'get_milestone',
      description: 'Get details of a specific project or group milestone',
      inputSchema: zodToJsonSchema(GetProjectMilestoneSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetProjectMilestoneSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const milestone = await response.json();
        return milestone;
      },
    },
  ],
  [
    'get_milestone_issue',
    {
      name: 'get_milestone_issue',
      description: 'Get issues associated with a specific project or group milestone',
      inputSchema: zodToJsonSchema(GetMilestoneIssuesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetMilestoneIssuesSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

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
            key !== 'milestone_id'
          ) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}/issues?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const issues = await response.json();
        return issues;
      },
    },
  ],
  [
    'get_milestone_merge_requests',
    {
      name: 'get_milestone_merge_requests',
      description: 'Get merge requests associated with a specific project or group milestone',
      inputSchema: zodToJsonSchema(GetMilestoneMergeRequestsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetMilestoneMergeRequestsSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

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
            key !== 'milestone_id'
          ) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}/merge_requests?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const mergeRequests = await response.json();
        return mergeRequests;
      },
    },
  ],
  [
    'get_milestone_burndown_events',
    {
      name: 'get_milestone_burndown_events',
      description: 'Get burndown events for a specific project or group milestone',
      inputSchema: zodToJsonSchema(GetMilestoneBurndownEventsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetMilestoneBurndownEventsSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}/burndown_events`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const burndownEvents = await response.json();
        return burndownEvents;
      },
    },
  ],
  // Write tools
  [
    'create_milestone',
    {
      name: 'create_milestone',
      description: 'Create a new milestone in a GitLab project or group',
      inputSchema: zodToJsonSchema(CreateProjectMilestoneSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateProjectMilestoneSchema.parse(args);
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

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones`;
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

        const milestone = await response.json();
        return milestone;
      },
    },
  ],
  [
    'edit_milestone',
    {
      name: 'edit_milestone',
      description: 'Edit an existing milestone in a GitLab project or group',
      inputSchema: zodToJsonSchema(EditProjectMilestoneSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = EditProjectMilestoneSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

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
            key !== 'milestone_id'
          ) {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}`;
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

        const milestone = await response.json();
        return milestone;
      },
    },
  ],
  [
    'delete_milestone',
    {
      name: 'delete_milestone',
      description: 'Delete a milestone from a GitLab project or group',
      inputSchema: zodToJsonSchema(DeleteProjectMilestoneSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteProjectMilestoneSchema.parse(args);
        const { project_id, group_id, milestone_id } = options;

        // Determine entity type and ID
        const isProject = !!project_id;
        const entityType = isProject ? 'projects' : 'groups';
        const entityId = (isProject ? project_id : group_id) as string;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/milestones/${milestone_id}`;
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
  [
    'promote_milestone',
    {
      name: 'promote_milestone',
      description: 'Promote a project milestone to a group milestone',
      inputSchema: zodToJsonSchema(PromoteProjectMilestoneSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = PromoteProjectMilestoneSchema.parse(args);
        const { project_id, milestone_id } = options;

        if (!project_id) {
          throw new Error('project_id is required for promoting milestones');
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/milestones/${encodeURIComponent(milestone_id)}/promote`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const milestone = await response.json();
        return milestone;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getMilestonesReadOnlyToolNames(): string[] {
  return [
    'list_milestones',
    'get_milestone',
    'get_milestone_issue',
    'get_milestone_merge_requests',
    'get_milestone_burndown_events',
  ];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getMilestonesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(milestonesToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredMilestonesTools(
  readOnlyMode: boolean = false,
): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getMilestonesReadOnlyToolNames();
    return Array.from(milestonesToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getMilestonesToolDefinitions();
}
