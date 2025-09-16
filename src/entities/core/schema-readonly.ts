import { z } from 'zod';
import { flexibleBoolean } from '../utils';
import { PaginationOptionsSchema } from '../shared';

// READ-ONLY OPERATION SCHEMAS

// Response schemas (read-only)
export const GitLabSearchResponseSchema = z.object({
  data: z.array(z.unknown()),
  total_count: z.number(),
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

// Namespace operations (read-only)
export const ListNamespacesSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe(
        'Returns a list of namespaces the user is authorized to see based on the search criteria',
      ),
    owned_only: flexibleBoolean.optional().describe('Filter to only owned namespaces'),
    top_level_only: flexibleBoolean.optional().describe('Include only top level namespaces'),
    with_statistics: flexibleBoolean.optional().describe('Include namespace statistics'),
    min_access_level: z.number().optional().describe('Limit by current user minimal access level'),
  })
  .merge(PaginationOptionsSchema);

export const GetNamespaceSchema = z.object({
  namespace_id: z.coerce.string().describe('ID or URL-encoded path of the namespace'),
});

export const VerifyNamespaceSchema = z.object({
  namespace: z.string().describe('A potential namespace name or path'),
});

// Project operations (read-only)
export const GetProjectSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  statistics: flexibleBoolean.optional().describe('Include project statistics'),
  license: flexibleBoolean.optional().describe('Include project license data'),
  with_custom_attributes: flexibleBoolean
    .optional()
    .describe('Include custom attributes in response'),
});

export const ListProjectsSchema = z
  .object({
    archived: flexibleBoolean.optional().describe('Limit by archived status'),
    visibility: z
      .enum(['public', 'internal', 'private'])
      .optional()
      .describe('Limit by visibility'),
    order_by: z
      .enum([
        'id',
        'name',
        'path',
        'created_at',
        'updated_at',
        'last_activity_at',
        'similarity',
        'repository_size',
        'storage_size',
        'packages_size',
        'wiki_size',
      ])
      .optional()
      .default('created_at')
      .describe('Return projects ordered by field'),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .default('desc')
      .describe('Return projects sorted in asc or desc order'),
    search: z.string().optional().describe('Return list of projects matching the search criteria'),
    search_namespaces: flexibleBoolean
      .optional()
      .describe('Include ancestor namespaces when matching search criteria'),
    simple: flexibleBoolean
      .optional()
      .default(true)
      .describe('Return only limited fields for each project'),
    owned: flexibleBoolean
      .optional()
      .describe('Limit by projects explicitly owned by the current user'),
    membership: flexibleBoolean
      .optional()
      .describe('Limit by projects that the current user is a member of'),
    starred: flexibleBoolean.optional().describe('Limit by projects starred by the current user'),
    statistics: flexibleBoolean.optional().describe('Include project statistics'),
    with_custom_attributes: flexibleBoolean
      .optional()
      .describe('Include custom attributes in response'),
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
      .describe('Limit results to projects with last_activity after specified time (ISO 8601)'),
    last_activity_before: z
      .string()
      .optional()
      .describe('Limit results to projects with last_activity before specified time (ISO 8601)'),
    repository_storage: z
      .string()
      .optional()
      .describe('Limit results to projects stored on repository_storage'),
  })
  .merge(PaginationOptionsSchema);

export const ListProjectMembersSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    query: z.string().optional().describe('A query string to search for members'),
    user_ids: z.array(z.number()).optional().describe('Filter the results on the given user IDs'),
  })
  .merge(PaginationOptionsSchema);

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
    include_subgroups: flexibleBoolean.optional().describe('Include projects in subgroups'),
    min_access_level: z.number().optional().describe('Limit by current user minimal access level'),
    with_custom_attributes: flexibleBoolean
      .optional()
      .describe('Include custom attributes in response'),
    with_security_reports: flexibleBoolean
      .optional()
      .describe('Only return projects that have security reports artifacts'),
  })
  .merge(PaginationOptionsSchema);

// Commits (read-only)
export const ListCommitsSchema = z
  .object({
    project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
    ref_name: z.string().optional().describe('The name of a repository branch or tag'),
    since: z.string().optional().describe('Only commits after or on this date (ISO 8601)'),
    until: z.string().optional().describe('Only commits before or on this date (ISO 8601)'),
    path: z.string().optional().describe('The file path'),
    author: z.string().optional().describe('Search commits by author name'),
    all: flexibleBoolean.optional().describe('Retrieve every commit from the repository'),
    with_stats: flexibleBoolean
      .optional()
      .describe('Stats about each commit will be added to the response'),
    first_parent: flexibleBoolean
      .optional()
      .describe('Follow only the first parent commit upon seeing a merge commit'),
    order: z.enum(['default', 'topo']).optional().describe('List commits in order'),
    trailers: flexibleBoolean.optional().describe('Parse and include Git trailers for each commit'),
  })
  .merge(PaginationOptionsSchema);

export const GetCommitSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  commit_sha: z.string().describe('The commit hash or name of a repository branch or tag'),
  stats: flexibleBoolean.optional().describe('Include commit stats'),
});

export const GetCommitDiffSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  commit_sha: z.string().describe('The commit hash or name of a repository branch or tag'),
  unidiff: flexibleBoolean.optional().describe('Diff files returned in raw unified diff format'),
});

// Group iterations (read-only)
export const ListGroupIterationsSchema = z
  .object({
    group_id: z.coerce.string().describe('The ID or URL-encoded path of the group'),
    state: z
      .enum(['opened', 'upcoming', 'current', 'closed', 'all'])
      .optional()
      .describe('Return iterations with a specific state'),
    search: z
      .string()
      .optional()
      .describe('Return iterations with a title matching the provided string'),
    include_ancestors: flexibleBoolean.optional().describe('Include iterations from parent groups'),
  })
  .merge(PaginationOptionsSchema);

// Download attachments (read-only)
export const DownloadAttachmentSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  secret: z.string().describe('The secret token of the uploaded file'),
  filename: z.string().describe('The filename of the uploaded file'),
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
      .optional()
      .describe('Include only events of a particular action type'),
    target_type: z
      .enum(['issue', 'milestone', 'merge_request', 'note', 'project', 'snippet', 'user'])
      .optional()
      .describe('Include only events of a particular target type'),
    before: z
      .string()
      .optional()
      .describe('Include only events created before a particular date (YYYY-MM-DD)'),
    after: z
      .string()
      .optional()
      .describe('Include only events created after a particular date (YYYY-MM-DD)'),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort events in asc or desc order by created_at'),
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
      .optional()
      .describe('Include only events of a particular action type'),
    target_type: z
      .enum(['issue', 'milestone', 'merge_request', 'note', 'project', 'snippet', 'user'])
      .optional()
      .describe('Include only events of a particular target type'),
    before: z
      .string()
      .optional()
      .describe('Include only events created before a particular date (YYYY-MM-DD)'),
    after: z
      .string()
      .optional()
      .describe('Include only events created after a particular date (YYYY-MM-DD)'),
    sort: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort events in asc or desc order by created_at'),
  })
  .merge(PaginationOptionsSchema);

// Export type definitions
export type GitLabSearchResponse = z.infer<typeof GitLabSearchResponseSchema>;
export type GitLabReference = z.infer<typeof GitLabReferenceSchema>;
export type GitLabCompareResult = z.infer<typeof GitLabCompareResultSchema>;
export type GetUsersOptions = z.infer<typeof GetUsersSchema>;
export type SearchRepositoriesOptions = z.infer<typeof SearchRepositoriesSchema>;
export type ListNamespacesOptions = z.infer<typeof ListNamespacesSchema>;
export type GetNamespaceOptions = z.infer<typeof GetNamespaceSchema>;
export type VerifyNamespaceOptions = z.infer<typeof VerifyNamespaceSchema>;
export type GetProjectOptions = z.infer<typeof GetProjectSchema>;
export type ListProjectsOptions = z.infer<typeof ListProjectsSchema>;
export type ListProjectMembersOptions = z.infer<typeof ListProjectMembersSchema>;
export type ListGroupProjectsOptions = z.infer<typeof ListGroupProjectsSchema>;
export type ListCommitsOptions = z.infer<typeof ListCommitsSchema>;
export type GetCommitOptions = z.infer<typeof GetCommitSchema>;
export type GetCommitDiffOptions = z.infer<typeof GetCommitDiffSchema>;
export type ListGroupIterationsOptions = z.infer<typeof ListGroupIterationsSchema>;
export type DownloadAttachmentOptions = z.infer<typeof DownloadAttachmentSchema>;
export type ListEventsOptions = z.infer<typeof ListEventsSchema>;
export type GetProjectEventsOptions = z.infer<typeof GetProjectEventsSchema>;
