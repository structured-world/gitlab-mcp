import { z } from 'zod';
import { flexibleBoolean } from '../utils';
import { PaginationOptionsSchema, ProjectParamsSchema } from '../shared';

// READ-ONLY MERGE REQUEST OPERATION SCHEMAS

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
  merge_request_iid: z.coerce.string().optional().describe('The internal ID of the merge request'),
  branch_name: z.string().optional().describe('Source branch name to find the merge request'),
  include_diverged_commits_count: z
    .boolean()
    .optional()
    .describe('If true, response includes commits behind the target branch'),
  include_rebase_in_progress: z
    .boolean()
    .optional()
    .describe('If true, response includes whether a rebase operation is in progress'),
}).refine((data) => data.merge_request_iid ?? data.branch_name, {
  message: 'Either merge_request_iid or branch_name must be provided',
});

// Base schema for MR operations with just project and IID (no refinements)
const BaseMergeRequestSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  include_diverged_commits_count: z
    .boolean()
    .optional()
    .describe('If true, response includes commits behind the target branch'),
  include_rebase_in_progress: z
    .boolean()
    .optional()
    .describe('If true, response includes whether a rebase operation is in progress'),
});

export const GetMergeRequestDiffsSchema = BaseMergeRequestSchema.extend({
  page: z.number().optional(),
  per_page: z.number().optional(),
});

export const ListMergeRequestDiffsSchema = BaseMergeRequestSchema.extend({
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
    sort: z.enum(['asc', 'desc']).optional().describe('Sort order'),
    milestone: z.string().optional().describe('Filter by milestone title'),
    view: z
      .enum(['simple', 'full'])
      .optional()
      .describe('Return a limited set of merge request attributes'),
    labels: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Label names or comma-separated list of label names'),
    with_labels_details: flexibleBoolean
      .optional()
      .describe('Include detailed label information instead of just label names'),
    with_merge_status_recheck: flexibleBoolean
      .optional()
      .describe(
        'Whether merge status for all returned merge requests should be rechecked asynchronously',
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
      .describe('Return merge requests for the given scope'),
    author_id: z
      .number()
      .optional()
      .describe('Returns merge requests created by the given user id'),
    author_username: z
      .string()
      .optional()
      .describe('Returns merge requests created by the given username'),
    assignee_id: z
      .number()
      .optional()
      .describe('Returns merge requests assigned to the given user id'),
    assignee_username: z
      .string()
      .optional()
      .describe('Returns merge requests assigned to the given username'),
    my_reaction_emoji: z
      .string()
      .optional()
      .describe('Return merge requests reacted by the authenticated user by the given emoji'),
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
      .enum(['title', 'description', 'title,description'])
      .optional()
      .describe('Modify the scope of the search attribute'),
    wip: z
      .enum(['yes', 'no'])
      .optional()
      .describe('Filter merge requests against their wip status'),
    not: z
      .object({
        labels: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe('Return merge requests that do not match the parameters supplied'),
        milestone: z
          .string()
          .optional()
          .describe('Return merge requests that do not match the milestone'),
        author_id: z
          .number()
          .optional()
          .describe('Return merge requests that do not match the author id'),
        author_username: z
          .string()
          .optional()
          .describe('Return merge requests that do not match the author username'),
        assignee_id: z
          .number()
          .optional()
          .describe('Return merge requests that do not match the assignee id'),
        assignee_username: z
          .string()
          .optional()
          .describe('Return merge requests that do not match the assignee username'),
        my_reaction_emoji: z
          .string()
          .optional()
          .describe(
            'Return merge requests not reacted by the authenticated user by the given emoji',
          ),
      })
      .optional(),
    environment: z
      .string()
      .optional()
      .describe('Returns merge requests deployed to the given environment'),
    deployed_before: z
      .string()
      .optional()
      .describe('Return merge requests deployed before the given date/time'),
    deployed_after: z
      .string()
      .optional()
      .describe('Return merge requests deployed after the given date/time'),
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
      .number()
      .optional()
      .describe('Returns merge requests which have the user as a reviewer with the given user id'),
    reviewer_username: z
      .string()
      .optional()
      .describe('Returns merge requests which have the user as a reviewer with the given username'),
    with_api_entity_associations: flexibleBoolean
      .optional()
      .describe('Include associations that are normally only returned with the merge request API'),
    min_access_level: z.number().optional().describe('Limit by current user minimal access level'),
  })
  .merge(PaginationOptionsSchema);

// Export type definitions
export type GetBranchDiffsOptions = z.infer<typeof GetBranchDiffsSchema>;
export type GetMergeRequestOptions = z.infer<typeof GetMergeRequestSchema>;
export type GetMergeRequestDiffsOptions = z.infer<typeof GetMergeRequestDiffsSchema>;
export type ListMergeRequestDiffsOptions = z.infer<typeof ListMergeRequestDiffsSchema>;
export type ListMergeRequestDiscussionsOptions = z.infer<typeof ListMergeRequestDiscussionsSchema>;
export type GetDraftNoteOptions = z.infer<typeof GetDraftNoteSchema>;
export type ListDraftNotesOptions = z.infer<typeof ListDraftNotesSchema>;
export type ListMergeRequestsOptions = z.infer<typeof ListMergeRequestsSchema>;
