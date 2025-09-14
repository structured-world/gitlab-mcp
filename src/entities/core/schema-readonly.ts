import { z } from 'zod';
import { flexibleBoolean } from '../utils';
import { PaginationOptionsSchema, ProjectParamsSchema } from '../shared';

// READ-ONLY OPERATION SCHEMAS

// Repository content response schemas (read-only)
export const GitLabFileContentSchema = z.object({
  file_name: z.string(),
  file_path: z.string(),
  size: z.number(),
  encoding: z.string(),
  content_sha256: z.string().optional(),
  ref: z.string().optional(),
  blob_id: z.string(),
  commit_id: z.string(),
  last_commit_id: z.string(),
  content: z.string().optional(),
});

export const GitLabDirectoryContentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tree', 'blob']),
  path: z.string(),
  mode: z.string(),
});

export const GitLabContentSchema = z.union([GitLabFileContentSchema, GitLabDirectoryContentSchema]);

// Response schemas (read-only)
export const GitLabCreateUpdateFileResponseSchema = z.object({
  file_path: z.string(),
  branch: z.string(),
});

export const GitLabSearchResponseSchema = z.object({
  data: z.array(z.unknown()),
  total_count: z.number(),
});

export const GitLabTreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tree', 'blob']),
  path: z.string(),
  mode: z.string(),
});

export const GitLabReferenceSchema = z.object({
  type: z.string(),
  name: z.string(),
  path: z.string(),
  location: z.string(),
});

export const GitLabCompareResultSchema = z.object({
  commit: z.object({
    id: z.string(),
    short_id: z.string(),
    title: z.string(),
    author_name: z.string(),
    author_email: z.string(),
    authored_date: z.string(),
    committer_name: z.string(),
    committer_email: z.string(),
    committed_date: z.string(),
    message: z.string(),
  }),
  commits: z.array(z.unknown()),
  diffs: z.array(z.unknown()),
});

// READ-ONLY OPERATION SCHEMAS

// Get Users Schema (read-only)
export const GetUsersSchema = z
  .object({
    username: z.string().optional().describe('Get a single user by username'),
    public_email: z.string().optional().describe('Get a single user with a specific public email'),
    search: z.string().optional().describe('Search for users by name, username, or public email'),
    active: flexibleBoolean.optional().describe('Filter only active users'),
    external: flexibleBoolean.optional().describe('Filter only external users'),
    blocked: flexibleBoolean.optional().describe('Filter only blocked users'),
    humans: flexibleBoolean
      .optional()
      .describe('Filter only regular users that are not bot or internal users'),
    created_after: z
      .string()
      .optional()
      .describe('Return users created after specified time (ISO 8601)'),
    created_before: z
      .string()
      .optional()
      .describe('Return users created before specified time (ISO 8601)'),
    exclude_active: flexibleBoolean.optional().describe('Filter only non-active users'),
    exclude_external: flexibleBoolean.optional().describe('Filter only non-external users'),
    exclude_humans: flexibleBoolean.optional().describe('Filter only bot or internal users'),
    exclude_internal: flexibleBoolean.optional().describe('Filter only non-internal users'),
    without_project_bots: flexibleBoolean.optional().describe('Filter users without project bots'),
  })
  .merge(PaginationOptionsSchema);

// Repository operations (read-only)
export const GetRepositoryTreeSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  path: z.string().optional().describe('The path inside repository'),
  ref: z.string().optional().describe('The name of a repository branch or tag'),
  recursive: flexibleBoolean.optional().describe('Boolean value used to get a recursive tree'),
  per_page: z.number().int().min(1).max(100).optional().describe('Number of results per page'),
  page: z.number().int().min(1).optional().describe('Page number'),
});

// Search repositories (read-only)
export const SearchRepositoriesSchema = z
  .object({
    q: z
      .string()
      .min(1)
      .describe(
        "Search query. Can include operators like 'language:javascript' or 'user:username'",
      ),
    sort: z
      .enum(['updated', 'created', 'pushed', 'full_name'])
      .optional()
      .describe('Sort repositories by this field'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  })
  .merge(PaginationOptionsSchema);

// Get file contents (read-only)
export const GetFileContentsSchema = ProjectParamsSchema.extend({
  file_path: z.string().describe('URL-encoded full path to the file'),
  ref: z.string().optional().describe('The name of branch, tag or commit'),
});

// Get branch diffs (read-only)
export const GetBranchDiffsSchema = ProjectParamsSchema.extend({
  from: z.string().describe('The commit SHA or branch name to compare from'),
  to: z.string().describe('The commit SHA or branch name to compare to'),
  straight: flexibleBoolean
    .optional()
    .describe('Comparison method, true for direct comparison, false for merge-base comparison'),
});

// Merge request operations (read-only)
export const GetMergeRequestSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  include_diverged_commits_count: z.boolean().optional().describe('If true, response includes commits behind the target branch'),
  include_rebase_in_progress: z.boolean().optional().describe('If true, response includes whether a rebase operation is in progress'),
});

export const GetMergeRequestDiffsSchema = GetMergeRequestSchema.extend({
  page: z.number().optional(),
  per_page: z.number().optional(),
});

export const ListMergeRequestDiffsSchema = GetMergeRequestSchema.extend({
  page: z.number().optional(),
  per_page: z.number().optional(),
});

// List merge request discussions (read-only)
export const ListMergeRequestDiscussionsSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
}).merge(PaginationOptionsSchema);

// Draft notes (read-only)
export const GetDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  draft_note_id: z.coerce.string().describe('The ID of the draft note'),
});

export const ListDraftNotesSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
});

// List issues (read-only)
export const ListIssuesSchema = z
  .object({
    project_id: z.coerce
      .string()
      .optional()
      .describe('Project ID to filter issues by project (optional for global search)'),
    state: z
      .enum(['opened', 'closed', 'all'])
      .optional()
      .describe('Return all issues or just those that are opened or closed'),
    labels: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Comma-separated list of label names or an array'),
    with_labels_details: flexibleBoolean
      .optional()
      .describe('If true, response returns more details for each label in labels field'),
    milestone: z
      .string()
      .optional()
      .describe(
        'The milestone title. None lists all issues with no milestone. Any lists all issues that have an assigned milestone',
      ),
    scope: z
      .enum(['created_by_me', 'assigned_to_me', 'all'])
      .optional()
      .describe('Return issues created by the current user, assigned to them, or all issues'),
    author_id: z.number().optional().describe('Return issues created by the given user id'),
    author_username: z.string().optional().describe('Return issues created by the given username'),
    assignee_id: z
      .union([z.number(), z.literal('None'), z.literal('Any')])
      .optional()
      .describe(
        'Return issues assigned to the given user id. None returns unassigned issues. Any returns issues with an assignee',
      ),
    assignee_username: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Return issues assigned to the given username(s)'),
    my_reaction_emoji: z
      .string()
      .optional()
      .describe('Return issues reacted by the current user by the given emoji'),
    weight: z.union([z.number(), z.literal('None'), z.literal('Any')]).optional(),
    iids: z.array(z.number()).optional().describe('Return only the issues having the given iid'),
    order_by: z
      .enum([
        'created_at',
        'updated_at',
        'priority',
        'due_date',
        'relative_position',
        'label_priority',
        'milestone_due',
        'popularity',
        'weight',
      ])
      .optional()
      .describe(
        'Return issues ordered by created_at, updated_at, priority, due_date, relative_position, label_priority, milestone_due, popularity, or weight fields',
      ),
    sort: z.enum(['asc', 'desc']).optional().describe('Return issues sorted in asc or desc order'),
    search: z.string().optional().describe('Search issues against their title and description'),
    in: z
      .enum(['title', 'description'])
      .optional()
      .describe('Modify the scope of the search attribute'),
    created_after: z
      .string()
      .optional()
      .describe('Return issues created on or after the given time'),
    created_before: z
      .string()
      .optional()
      .describe('Return issues created on or before the given time'),
    updated_after: z
      .string()
      .optional()
      .describe('Return issues updated on or after the given time'),
    updated_before: z
      .string()
      .optional()
      .describe('Return issues updated on or before the given time'),
    confidential: flexibleBoolean.optional().describe('Filter confidential or public issues'),
    not: z
      .object({
        labels: z.union([z.string(), z.array(z.string())]).optional(),
        milestone: z.string().optional(),
        author_id: z.number().optional(),
        author_username: z.string().optional(),
        assignee_id: z.number().optional(),
        assignee_username: z.union([z.string(), z.array(z.string())]).optional(),
        my_reaction_emoji: z.string().optional(),
        weight: z.union([z.number(), z.literal('None'), z.literal('Any')]).optional(),
        iids: z.array(z.number()).optional(),
      })
      .optional()
      .describe('Return issues that do not match the parameters supplied'),
  })
  .merge(PaginationOptionsSchema);

// My Issues Schema (read-only)
export const MyIssuesSchema = ListIssuesSchema;

// Get issue (read-only)
export const GetIssueSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  issue_iid: z.coerce.string().describe('The internal ID of the project issue'),
});

// Issue links (read-only)
export const ListIssueLinksSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  issue_iid: z.coerce.string().describe('The internal ID of the project issue'),
});

export const ListIssueDiscussionsSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    issue_iid: z.coerce.string().describe('The internal ID of the project issue'),
  })
  .merge(PaginationOptionsSchema);

export const GetIssueLinkSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  issue_iid: z.coerce.string().describe('The internal ID of the project issue'),
  issue_link_id: z.coerce.string().describe('The ID of the issue link'),
});

// Namespace operations (read-only)
export const ListNamespacesSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe(
        'Returns a list of namespaces the user is authorized to see based on the search criteria',
      ),
    owned_only: flexibleBoolean
      .optional()
      .describe('In GitLab 14.2 and later, returns a list of owned namespaces only'),
  })
  .merge(PaginationOptionsSchema);

export const GetNamespaceSchema = z.object({
  id: z.coerce.string().describe('ID or URL-encoded path of the namespace'),
});

export const VerifyNamespaceSchema = GetNamespaceSchema;

// Project operations (read-only)
export const GetProjectSchema = z.object({
  id: z.coerce.string().describe('The ID or URL-encoded path of the project'),
});

export const ListProjectsSchema = z
  .object({
    archived: flexibleBoolean.optional().describe('Limit by archived status'),
    visibility: z
      .enum(['public', 'internal', 'private'])
      .optional()
      .describe('Limit by visibility public, internal, or private'),
    order_by: z
      .enum(['id', 'name', 'path', 'created_at', 'updated_at', 'last_activity_at', 'similarity'])
      .optional()
      .describe('Return projects ordered by field'),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Return projects sorted in asc or desc order'),
    search: z.string().optional().describe('Return list of projects matching the search criteria'),
    search_namespaces: flexibleBoolean
      .optional()
      .describe('Include ancestor namespaces when matching search criteria'),
    simple: flexibleBoolean.optional().describe('Return only limited fields for each project'),
    owned: flexibleBoolean
      .optional()
      .describe('Limit by projects explicitly owned by the current user'),
    membership: flexibleBoolean
      .optional()
      .describe('Limit by projects that the current user is a member of'),
    starred: flexibleBoolean.optional().describe('Limit by projects starred by the current user'),
    statistics: flexibleBoolean
      .optional()
      .describe(
        'Include project statistics. Available only to Reporter or higher level role members',
      ),
    with_custom_attributes: flexibleBoolean
      .optional()
      .describe('Include custom attributes in response (admins only)'),
    with_issues_enabled: flexibleBoolean.optional().describe('Limit by enabled issues feature'),
    with_merge_requests_enabled: flexibleBoolean
      .optional()
      .describe('Limit by enabled merge requests feature'),
    with_programming_language: z
      .string()
      .optional()
      .describe('Limit by projects which use the given programming language'),
    wiki_checksum_failed: flexibleBoolean
      .optional()
      .describe('Limit projects where the wiki checksum calculation has failed'),
    repository_checksum_failed: flexibleBoolean
      .optional()
      .describe('Limit projects where the repository checksum calculation has failed'),
    min_access_level: z.number().optional().describe('Limit by current user minimal access level'),
    id_after: z
      .number()
      .optional()
      .describe('Limit results to projects with IDs greater than the specified ID'),
    id_before: z
      .number()
      .optional()
      .describe('Limit results to projects with IDs less than the specified ID'),
    last_activity_after: z
      .string()
      .optional()
      .describe('Limit results to projects with last_activity after specified time'),
    last_activity_before: z
      .string()
      .optional()
      .describe('Limit results to projects with last_activity before specified time'),
    repository_storage: z
      .string()
      .optional()
      .describe('Limit results to projects stored on repository_storage'),
  })
  .merge(PaginationOptionsSchema);

// Project members (read-only)
export const ListProjectMembersSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    query: z.string().optional().describe('A query string to search for members'),
    user_ids: z.array(z.number()).optional().describe('Filter the results on the given user IDs'),
  })
  .merge(PaginationOptionsSchema);

// Labels (read-only)
export const ListLabelsSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  with_counts: flexibleBoolean
    .optional()
    .describe('Whether or not to include issue and merge request counts'),
  include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
  search: z.string().optional().describe('Keyword to filter labels by'),
});

export const GetLabelSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  label_id: z.union([z.coerce.string(), z.string()]).describe('The ID or title of a group label'),
  include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
});

// Group projects (read-only)
export const ListGroupProjectsSchema = z
  .object({
    group_id: z.coerce.string().describe('The ID or URL-encoded path of the group'),
    archived: flexibleBoolean.optional().describe('Limit by archived status'),
    visibility: z
      .enum(['public', 'internal', 'private'])
      .optional()
      .describe('Limit by visibility'),
    order_by: z
      .enum(['id', 'name', 'path', 'created_at', 'updated_at', 'last_activity_at'])
      .optional()
      .describe('Return projects ordered by field'),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Return projects sorted in asc or desc order'),
    search: z.string().optional().describe('Return list of projects matching the search criteria'),
    simple: flexibleBoolean.optional().describe('Return only limited fields for each project'),
    owned: flexibleBoolean
      .optional()
      .describe('Limit by projects explicitly owned by the current user'),
    starred: flexibleBoolean.optional().describe('Limit by projects starred by the current user'),
    with_issues_enabled: flexibleBoolean.optional().describe('Limit by enabled issues feature'),
    with_merge_requests_enabled: flexibleBoolean
      .optional()
      .describe('Limit by enabled merge requests feature'),
    with_shared: flexibleBoolean.optional().describe('Include projects shared to this group'),
    include_subgroups: flexibleBoolean
      .optional()
      .describe('Include projects in subgroups of this group'),
    min_access_level: z.number().optional().describe('Limit by current user minimal access level'),
  })
  .merge(PaginationOptionsSchema);

// List merge requests (read-only)
export const ListMergeRequestsSchema = z
  .object({
    project_id: z.coerce
      .string()
      .optional()
      .describe('Project ID to filter merge requests by project (optional for global search)'),
    state: z
      .enum(['opened', 'closed', 'locked', 'merged', 'all'])
      .optional()
      .describe('Return all merge requests or filter by state'),
    order_by: z
      .enum(['created_at', 'updated_at', 'title', 'priority'])
      .optional()
      .describe(
        'Return merge requests ordered by created_at, updated_at, title, or priority fields',
      ),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Return merge requests sorted in asc or desc order'),
    milestone: z.string().optional().describe('Return merge requests for a specific milestone'),
    view: z
      .enum(['simple', 'full'])
      .optional()
      .describe(
        'If simple, returns the iid, URL, title, description, and basic state of merge request',
      ),
    labels: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Return merge requests matching a comma-separated list of labels'),
    with_labels_details: flexibleBoolean
      .optional()
      .describe('If true, response returns more details for each label in labels field'),
    with_merge_status_recheck: flexibleBoolean
      .optional()
      .describe(
        'If true, this projection requests (but does not guarantee) that the merge_status field be recalculated asynchronously',
      ),
    created_after: z
      .string()
      .optional()
      .describe('Return merge requests created on or after the given time'),
    created_before: z
      .string()
      .optional()
      .describe('Return merge requests created on or before the given time'),
    updated_after: z
      .string()
      .optional()
      .describe('Return merge requests updated on or after the given time'),
    updated_before: z
      .string()
      .optional()
      .describe('Return merge requests updated on or before the given time'),
    scope: z
      .enum(['created_by_me', 'assigned_to_me', 'all'])
      .optional()
      .describe('Return merge requests created by current user, assigned to them, or all'),
    author_id: z
      .number()
      .optional()
      .describe('Returns merge requests created by the given user id'),
    author_username: z
      .string()
      .optional()
      .describe('Returns merge requests created by the given username'),
    assignee_id: z
      .union([z.number(), z.literal('None'), z.literal('Any')])
      .optional()
      .describe('Returns merge requests assigned to the given user id'),
    approver_ids: z
      .array(z.number())
      .optional()
      .describe(
        'Returns merge requests which have been approved by all the users with the given ids',
      ),
    approved_by_ids: z
      .array(z.number())
      .optional()
      .describe(
        'Returns merge requests which have been approved by all the users with the given ids',
      ),
    approved_by_usernames: z
      .array(z.string())
      .optional()
      .describe(
        'Returns merge requests which have been approved by all the users with the given usernames',
      ),
    reviewer_id: z
      .union([z.number(), z.literal('None'), z.literal('Any')])
      .optional()
      .describe('Returns merge requests which have the user as a reviewer'),
    reviewer_username: z
      .string()
      .optional()
      .describe('Returns merge requests which have the user as a reviewer with the given username'),
    my_reaction_emoji: z
      .string()
      .optional()
      .describe('Return merge requests reacted by the current user by the given emoji'),
    source_branch: z
      .string()
      .optional()
      .describe('Return merge requests with the given source branch'),
    target_branch: z
      .string()
      .optional()
      .describe('Return merge requests with the given target branch'),
    search: z
      .string()
      .optional()
      .describe('Search merge requests against their title and description'),
    in: z
      .enum(['title', 'description'])
      .optional()
      .describe('Modify the scope of the search attribute'),
    wip: z
      .enum(['yes', 'no'])
      .optional()
      .describe('Filter merge requests against their wip status'),
    not: z
      .object({
        labels: z.union([z.string(), z.array(z.string())]).optional(),
        milestone: z.string().optional(),
        author_id: z.number().optional(),
        author_username: z.string().optional(),
        assignee_id: z.number().optional(),
        assignee_username: z.string().optional(),
        reviewer_id: z.number().optional(),
        reviewer_username: z.string().optional(),
        my_reaction_emoji: z.string().optional(),
      })
      .optional()
      .describe('Return merge requests that do not match the parameters supplied'),
  })
  .merge(PaginationOptionsSchema);

// Commits (read-only)
export const ListCommitsSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    ref_name: z
      .string()
      .optional()
      .describe('The name of a repository branch, tag or revision range'),
    since: z
      .string()
      .optional()
      .describe(
        'Only commits after or on this date are returned in ISO 8601 format YYYY-MM-DDTHH:MM:SSZ',
      ),
    until: z
      .string()
      .optional()
      .describe(
        'Only commits before or on this date are returned in ISO 8601 format YYYY-MM-DDTHH:MM:SSZ',
      ),
    path: z.string().optional().describe('The file path'),
    author: z.string().optional().describe('Search commits by author name or email'),
    all: flexibleBoolean.optional().describe('Retrieve every commit from the repository'),
    with_stats: flexibleBoolean
      .optional()
      .describe('Stats about each commit are added to the response'),
    first_parent: flexibleBoolean
      .optional()
      .describe('Follow only the first parent commit upon seeing a merge commit'),
    order: z
      .enum(['default', 'topo'])
      .optional()
      .describe('List commits in order. default is by commit date or topo for topological order'),
    trailers: flexibleBoolean.optional().describe('Parse and include Git trailers for each commit'),
  })
  .merge(PaginationOptionsSchema);

export const GetCommitSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  sha: z.string().describe('The commit hash or name of a repository branch or tag'),
  stats: flexibleBoolean.optional().describe('Include commit stats'),
});

export const GetCommitDiffSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  sha: z.string().describe('The commit hash or name of a repository branch or tag'),
  unidiff: flexibleBoolean.optional().describe('Unified diff format'),
});

// Group iterations (read-only)
export const ListGroupIterationsSchema = z
  .object({
    group_id: z.coerce.string().describe('The ID or URL-encoded path of the group'),
    state: z.enum(['opened', 'upcoming', 'current', 'closed', 'all']).optional(),
    search: z.string().optional(),
  })
  .merge(PaginationOptionsSchema);

// Markdown and file operations (read-only)
export const DownloadAttachmentSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  attachment_id: z.string().describe('The ID of the attachment'),
});

// Events (read-only)
export const ListEventsSchema = z
  .object({
    action: z
      .enum([
        'created',
        'updated',
        'closed',
        'reopened',
        'pushed',
        'commented',
        'merged',
        'joined',
        'left',
        'destroyed',
        'expired',
      ])
      .optional(),
    target_type: z
      .enum(['issue', 'milestone', 'merge_request', 'note', 'project', 'snippet', 'user'])
      .optional(),
    before: z
      .string()
      .optional()
      .describe(
        'Include only events created before a particular date. Please see here for the supported date formats.',
      ),
    after: z
      .string()
      .optional()
      .describe(
        'Include only events created after a particular date. Please see here for the supported date formats.',
      ),
    sort: z.enum(['asc', 'desc']).optional(),
  })
  .merge(PaginationOptionsSchema);

export const GetProjectEventsSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    action: z
      .enum([
        'created',
        'updated',
        'closed',
        'reopened',
        'pushed',
        'commented',
        'merged',
        'joined',
        'left',
        'destroyed',
        'expired',
      ])
      .optional(),
    target_type: z
      .enum(['issue', 'milestone', 'merge_request', 'note', 'project', 'snippet', 'user'])
      .optional(),
    before: z
      .string()
      .optional()
      .describe(
        'Include only events created before a particular date. Please see here for the supported date formats.',
      ),
    after: z
      .string()
      .optional()
      .describe(
        'Include only events created after a particular date. Please see here for the supported date formats.',
      ),
    sort: z.enum(['asc', 'desc']).optional(),
  })
  .merge(PaginationOptionsSchema);

// Type exports for readonly operations
export type GitLabFileContent = z.infer<typeof GitLabFileContentSchema>;
export type GitLabDirectoryContent = z.infer<typeof GitLabDirectoryContentSchema>;
export type GitLabContent = z.infer<typeof GitLabContentSchema>;
export type GitLabCreateUpdateFileResponse = z.infer<typeof GitLabCreateUpdateFileResponseSchema>;
export type GitLabSearchResponse = z.infer<typeof GitLabSearchResponseSchema>;
export type GitLabTree = z.infer<typeof GitLabTreeSchema>;
export type GitLabReference = z.infer<typeof GitLabReferenceSchema>;
export type GitLabCompareResult = z.infer<typeof GitLabCompareResultSchema>;

export type GetUsersOptions = z.infer<typeof GetUsersSchema>;
export type GetRepositoryTreeOptions = z.infer<typeof GetRepositoryTreeSchema>;
export type SearchRepositoriesOptions = z.infer<typeof SearchRepositoriesSchema>;
export type GetFileContentsOptions = z.infer<typeof GetFileContentsSchema>;
export type GetBranchDiffsOptions = z.infer<typeof GetBranchDiffsSchema>;
export type GetMergeRequestOptions = z.infer<typeof GetMergeRequestSchema>;
export type GetMergeRequestDiffsOptions = z.infer<typeof GetMergeRequestDiffsSchema>;
export type ListMergeRequestDiffsOptions = z.infer<typeof ListMergeRequestDiffsSchema>;
export type ListMergeRequestDiscussionsOptions = z.infer<typeof ListMergeRequestDiscussionsSchema>;
export type GetDraftNoteOptions = z.infer<typeof GetDraftNoteSchema>;
export type ListDraftNotesOptions = z.infer<typeof ListDraftNotesSchema>;
export type ListIssuesOptions = z.infer<typeof ListIssuesSchema>;
export type MyIssuesOptions = z.infer<typeof MyIssuesSchema>;
export type GetIssueOptions = z.infer<typeof GetIssueSchema>;
export type ListIssueLinksOptions = z.infer<typeof ListIssueLinksSchema>;
export type ListIssueDiscussionsOptions = z.infer<typeof ListIssueDiscussionsSchema>;
export type GetIssueLinkOptions = z.infer<typeof GetIssueLinkSchema>;
export type ListNamespacesOptions = z.infer<typeof ListNamespacesSchema>;
export type GetNamespaceOptions = z.infer<typeof GetNamespaceSchema>;
export type VerifyNamespaceOptions = z.infer<typeof VerifyNamespaceSchema>;
export type GetProjectOptions = z.infer<typeof GetProjectSchema>;
export type ListProjectsOptions = z.infer<typeof ListProjectsSchema>;
export type ListProjectMembersOptions = z.infer<typeof ListProjectMembersSchema>;
export type ListLabelsOptions = z.infer<typeof ListLabelsSchema>;
export type GetLabelOptions = z.infer<typeof GetLabelSchema>;
export type ListGroupProjectsOptions = z.infer<typeof ListGroupProjectsSchema>;
export type ListMergeRequestsOptions = z.infer<typeof ListMergeRequestsSchema>;
export type ListCommitsOptions = z.infer<typeof ListCommitsSchema>;
export type GetCommitOptions = z.infer<typeof GetCommitSchema>;
export type GetCommitDiffOptions = z.infer<typeof GetCommitDiffSchema>;
export type ListGroupIterationsOptions = z.infer<typeof ListGroupIterationsSchema>;
export type DownloadAttachmentOptions = z.infer<typeof DownloadAttachmentSchema>;
export type ListEventsOptions = z.infer<typeof ListEventsSchema>;
export type GetProjectEventsOptions = z.infer<typeof GetProjectEventsSchema>;
