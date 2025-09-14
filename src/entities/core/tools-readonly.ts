import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SearchRepositoriesSchema,
  GetFileContentsSchema,
  GetMergeRequestSchema,
  GetMergeRequestDiffsSchema,
  ListMergeRequestDiffsSchema,
  GetBranchDiffsSchema,
  ListMergeRequestDiscussionsSchema,
  GetDraftNoteSchema,
  ListDraftNotesSchema,
  // Removed unused issue imports - migrated to Work Items GraphQL
  ListNamespacesSchema,
  GetNamespaceSchema,
  VerifyNamespaceSchema,
  GetProjectSchema,
  ListProjectsSchema,
  ListProjectMembersSchema,
  ListLabelsSchema,
  GetLabelSchema,
  ListGroupProjectsSchema,
  GetRepositoryTreeSchema,
  ListMergeRequestsSchema,
  GetUsersSchema,
  ListCommitsSchema,
  GetCommitSchema,
  GetCommitDiffSchema,
  ListGroupIterationsSchema,
  DownloadAttachmentSchema,
  ListEventsSchema,
  GetProjectEventsSchema,
} from './schema-readonly';
import { ToolDefinition } from '../../types';

export const coreReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'search_repositories',
    description: 'Search for GitLab projects',
    inputSchema: zodToJsonSchema(SearchRepositoriesSchema),
  },
  {
    name: 'get_file_contents',
    description: 'Get the contents of a file or directory from a GitLab project',
    inputSchema: zodToJsonSchema(GetFileContentsSchema),
  },
  {
    name: 'get_merge_request',
    description:
      'Get details of a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(GetMergeRequestSchema),
  },
  {
    name: 'get_merge_request_diffs',
    description:
      'Get the changes/diffs of a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(GetMergeRequestDiffsSchema),
  },
  {
    name: 'list_merge_request_diffs',
    description:
      'List merge request diffs with pagination support (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(ListMergeRequestDiffsSchema),
  },
  {
    name: 'get_branch_diffs',
    description: 'Get the changes/diffs between two branches or commits in a GitLab project',
    inputSchema: zodToJsonSchema(GetBranchDiffsSchema),
  },
  {
    name: 'mr_discussions',
    description: 'List discussion items for a merge request',
    inputSchema: zodToJsonSchema(ListMergeRequestDiscussionsSchema),
  },
  {
    name: 'get_draft_note',
    description: 'Get a single draft note from a merge request',
    inputSchema: zodToJsonSchema(GetDraftNoteSchema),
  },
  {
    name: 'list_draft_notes',
    description: 'List draft notes for a merge request',
    inputSchema: zodToJsonSchema(ListDraftNotesSchema),
  },
  // DEPRECATED: Issue REST endpoints removed - use Work Items GraphQL instead
  // Migration: list_issues/my_issues → list_work_items
  // Migration: get_issue → get_work_item
  // Migration: list_issue_links/get_issue_link → use LINKED_ITEMS widget
  // Migration: list_issue_discussions → use NOTES widget
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
    name: 'list_labels',
    description: 'List labels for a project',
    inputSchema: zodToJsonSchema(ListLabelsSchema),
  },
  {
    name: 'get_label',
    description: 'Get a single label from a project',
    inputSchema: zodToJsonSchema(GetLabelSchema),
  },
  {
    name: 'list_group_projects',
    description: 'List projects in a GitLab group with filtering options',
    inputSchema: zodToJsonSchema(ListGroupProjectsSchema),
  },
  {
    name: 'get_repository_tree',
    description: 'Get the repository tree for a GitLab project (list files and directories)',
    inputSchema: zodToJsonSchema(GetRepositoryTreeSchema),
  },
  {
    name: 'list_merge_requests',
    description: 'List merge requests in a GitLab project with filtering options',
    inputSchema: zodToJsonSchema(ListMergeRequestsSchema),
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
  'get_file_contents',
  'get_merge_request',
  'get_merge_request_diffs',
  'get_branch_diffs',
  'mr_discussions',
  // REMOVED: Issue REST endpoints - use Work Items GraphQL instead
  // 'list_issues' → use 'list_work_items'
  // 'my_issues' → use 'list_work_items' with assignee filter
  // 'get_issue' → use 'get_work_item'
  // 'list_issue_links' → use LINKED_ITEMS widget
  // 'list_issue_discussions' → use NOTES widget
  // 'get_issue_link' → use LINKED_ITEMS widget
  'list_merge_requests',
  'list_namespaces',
  'get_namespace',
  'verify_namespace',
  'get_project',
  'list_projects',
  'list_project_members',
  'list_labels',
  'get_label',
  'list_group_projects',
  'get_repository_tree',
  'get_users',
  'list_commits',
  'get_commit',
  'get_commit_diff',
  'list_group_iterations',
  'download_attachment',
  'list_events',
  'get_project_events',
];
