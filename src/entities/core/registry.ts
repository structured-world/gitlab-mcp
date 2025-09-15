/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SearchRepositoriesSchema,
  ListNamespacesSchema,
  GetNamespaceSchema,
  VerifyNamespaceSchema,
  GetProjectSchema,
  ListProjectsSchema,
  ListProjectMembersSchema,
  ListGroupProjectsSchema,
  GetUsersSchema,
  ListCommitsSchema,
  GetCommitSchema,
  GetCommitDiffSchema,
  ListEventsSchema,
  GetProjectEventsSchema,
  ListGroupIterationsSchema,
  DownloadAttachmentSchema,
} from './schema-readonly';
import { CreateRepositorySchema, ForkRepositorySchema, CreateBranchSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Core tools registry - unified registry containing all core tools with their handlers
 */
export const coreToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'search_repositories',
    {
      name: 'search_repositories',
      description: 'Search for GitLab projects',
      inputSchema: zodToJsonSchema(SearchRepositoriesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = SearchRepositoriesSchema.parse(args);

        // Build query parameters
        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            queryParams.set(key, String(value));
          }
        });

        // Make REAL GitLab API call to search projects
        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const projects = await response.json();
        return projects;
      },
    },
  ],
  [
    'list_projects',
    {
      name: 'list_projects',
      description: 'List projects accessible by the current user',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListProjectsSchema.parse(args);

        // Build query parameters
        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            queryParams.set(key, String(value));
          }
        });

        // Make REAL GitLab API call
        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const projects = await response.json();
        return projects;
      },
    },
  ],
  [
    'list_namespaces',
    {
      name: 'list_namespaces',
      description: 'List all namespaces available to the current user',
      inputSchema: zodToJsonSchema(ListNamespacesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListNamespacesSchema.parse(args);

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const namespaces = await response.json();
        return namespaces;
      },
    },
  ],
  [
    'get_users',
    {
      name: 'get_users',
      description: 'Get GitLab user details by usernames',
      inputSchema: zodToJsonSchema(GetUsersSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetUsersSchema.parse(args);

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/users?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const users = await response.json();
        return users;
      },
    },
  ],
  [
    'get_project',
    {
      name: 'get_project',
      description: 'Get details of a specific project',
      inputSchema: zodToJsonSchema(GetProjectSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetProjectSchema.parse(args);
        const { project_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const project = await response.json();
        return project;
      },
    },
  ],
  // Additional core read-only tools
  [
    'get_namespace',
    {
      name: 'get_namespace',
      description: 'Get details of a namespace by ID or path',
      inputSchema: zodToJsonSchema(GetNamespaceSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetNamespaceSchema.parse(args);
        const { namespace_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace_id)}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const namespace = await response.json();
        return namespace;
      },
    },
  ],
  [
    'verify_namespace',
    {
      name: 'verify_namespace',
      description: 'Verify if a namespace path exists',
      inputSchema: zodToJsonSchema(VerifyNamespaceSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = VerifyNamespaceSchema.parse(args);
        const { namespace } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace)}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        return {
          exists: response.ok,
          status: response.status,
          namespace: namespace,
          data: response.ok ? await response.json() : null,
        };
      },
    },
  ],
  [
    'list_project_members',
    {
      name: 'list_project_members',
      description: 'List members of a GitLab project',
      inputSchema: zodToJsonSchema(ListProjectMembersSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListProjectMembersSchema.parse(args);
        const { project_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/members?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const members = await response.json();
        return members;
      },
    },
  ],
  [
    'list_group_projects',
    {
      name: 'list_group_projects',
      description: 'List projects in a GitLab group with filtering options',
      inputSchema: zodToJsonSchema(ListGroupProjectsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListGroupProjectsSchema.parse(args);
        const { group_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'group_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/projects?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const projects = await response.json();
        return projects;
      },
    },
  ],
  [
    'list_commits',
    {
      name: 'list_commits',
      description: 'List repository commits with filtering options',
      inputSchema: zodToJsonSchema(ListCommitsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListCommitsSchema.parse(args);
        const { project_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const commits = await response.json();
        return commits;
      },
    },
  ],
  [
    'get_commit',
    {
      name: 'get_commit',
      description: 'Get details of a specific commit',
      inputSchema: zodToJsonSchema(GetCommitSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetCommitSchema.parse(args);
        const { project_id, commit_sha } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'commit_sha') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(commit_sha)}?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const commit = await response.json();
        return commit;
      },
    },
  ],
  [
    'get_commit_diff',
    {
      name: 'get_commit_diff',
      description: 'Get changes/diffs of a specific commit',
      inputSchema: zodToJsonSchema(GetCommitDiffSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetCommitDiffSchema.parse(args);
        const { project_id, commit_sha } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'commit_sha') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(commit_sha)}/diff?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const diff = await response.json();
        return diff;
      },
    },
  ],
  [
    'list_group_iterations',
    {
      name: 'list_group_iterations',
      description: 'List group iterations with filtering options',
      inputSchema: zodToJsonSchema(ListGroupIterationsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListGroupIterationsSchema.parse(args);
        const { group_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'group_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/iterations?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const iterations = await response.json();
        return iterations;
      },
    },
  ],
  [
    'download_attachment',
    {
      name: 'download_attachment',
      description: 'Download an uploaded file from a GitLab project by secret and filename',
      inputSchema: zodToJsonSchema(DownloadAttachmentSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DownloadAttachmentSchema.parse(args);
        const { project_id, secret, filename } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/uploads/${secret}/${filename}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const attachment = await response.arrayBuffer();
        return {
          filename,
          content: Buffer.from(attachment).toString('base64'),
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        };
      },
    },
  ],
  [
    'list_events',
    {
      name: 'list_events',
      description:
        'List all events for the currently authenticated user. Note: before/after parameters accept date format YYYY-MM-DD only',
      inputSchema: zodToJsonSchema(ListEventsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListEventsSchema.parse(args);

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/events?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const events = await response.json();
        return events;
      },
    },
  ],
  [
    'get_project_events',
    {
      name: 'get_project_events',
      description:
        'List all visible events for a specified project. Note: before/after parameters accept date format YYYY-MM-DD only',
      inputSchema: zodToJsonSchema(GetProjectEventsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetProjectEventsSchema.parse(args);
        const { project_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/events?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const events = await response.json();
        return events;
      },
    },
  ],

  // Write tools
  [
    'create_repository',
    {
      name: 'create_repository',
      description: 'Create a new GitLab project',
      inputSchema: zodToJsonSchema(CreateRepositorySchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateRepositorySchema.parse(args);

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              body.set(key, value.join(','));
            } else {
              body.set(key, String(value));
            }
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects`;
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

        const project = await response.json();
        return project;
      },
    },
  ],
  [
    'fork_repository',
    {
      name: 'fork_repository',
      description: 'Fork a GitLab project to your account or specified namespace',
      inputSchema: zodToJsonSchema(ForkRepositorySchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ForkRepositorySchema.parse(args);

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id') {
            body.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/fork`;
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

        const fork = await response.json();
        return fork;
      },
    },
  ],
  [
    'create_branch',
    {
      name: 'create_branch',
      description: 'Create a new branch in a GitLab project',
      inputSchema: zodToJsonSchema(CreateBranchSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateBranchSchema.parse(args);

        const body = new URLSearchParams();
        body.set('branch', options.branch);
        body.set('ref', options.ref);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/branches`;
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

        const branch = await response.json();
        return branch;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getCoreReadOnlyToolNames(): string[] {
  // Return tools that are considered read-only
  return [
    'search_repositories',
    'list_namespaces',
    'get_namespace',
    'verify_namespace',
    'get_project',
    'list_projects',
    'list_project_members',
    'list_group_projects',
    'get_users',
    'list_commits',
    'get_commit',
    'get_commit_diff',
    'list_group_iterations',
    'download_attachment',
    'list_events',
    'get_project_events',
  ];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getCoreToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(coreToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredCoreTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getCoreReadOnlyToolNames();
    return Array.from(coreToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getCoreToolDefinitions();
}
