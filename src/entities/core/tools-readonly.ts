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
import { ToolDefinition } from '../../types';

export const coreReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'search_repositories',
    description: 'Search for GitLab projects',
    inputSchema: zodToJsonSchema(SearchRepositoriesSchema),
  },
  {
    name: 'list_namespaces',
    description: 'List all namespaces available to the current user',
    inputSchema: zodToJsonSchema(ListNamespacesSchema),
  },
  {
    name: 'get_namespace',
    description: 'Get details of a namespace by ID or path',
    inputSchema: zodToJsonSchema(GetNamespaceSchema),
  },
  {
    name: 'verify_namespace',
    description: 'Verify if a namespace path exists',
    inputSchema: zodToJsonSchema(VerifyNamespaceSchema),
  },
  {
    name: 'get_project',
    description: 'Get details of a specific project',
    inputSchema: zodToJsonSchema(GetProjectSchema),
  },
  {
    name: 'list_projects',
    description: 'List projects accessible by the current user',
    inputSchema: zodToJsonSchema(ListProjectsSchema),
  },
  {
    name: 'list_project_members',
    description: 'List members of a GitLab project',
    inputSchema: zodToJsonSchema(ListProjectMembersSchema),
  },
  {
    name: 'list_group_projects',
    description: 'List projects in a GitLab group with filtering options',
    inputSchema: zodToJsonSchema(ListGroupProjectsSchema),
  },
  {
    name: 'get_users',
    description: 'Get GitLab user details by usernames',
    inputSchema: zodToJsonSchema(GetUsersSchema),
  },
  {
    name: 'list_commits',
    description: 'List repository commits with filtering options',
    inputSchema: zodToJsonSchema(ListCommitsSchema),
  },
  {
    name: 'get_commit',
    description: 'Get details of a specific commit',
    inputSchema: zodToJsonSchema(GetCommitSchema),
  },
  {
    name: 'get_commit_diff',
    description: 'Get changes/diffs of a specific commit',
    inputSchema: zodToJsonSchema(GetCommitDiffSchema),
  },
  {
    name: 'list_group_iterations',
    description: 'List group iterations with filtering options',
    inputSchema: zodToJsonSchema(ListGroupIterationsSchema),
  },
  {
    name: 'download_attachment',
    description: 'Download an uploaded file from a GitLab project by secret and filename',
    inputSchema: zodToJsonSchema(DownloadAttachmentSchema),
  },
  {
    name: 'list_events',
    description:
      'List all events for the currently authenticated user. Note: before/after parameters accept date format YYYY-MM-DD only',
    inputSchema: zodToJsonSchema(ListEventsSchema),
  },
  {
    name: 'get_project_events',
    description:
      'List all visible events for a specified project. Note: before/after parameters accept date format YYYY-MM-DD only',
    inputSchema: zodToJsonSchema(GetProjectEventsSchema),
  },
];

// Define which core tools are read-only (list of tool names)
export const coreReadOnlyTools = [
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
