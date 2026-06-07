import { z } from 'zod';
import { requiredId, flexibleBoolean } from '../utils';

// ============================================================================
// browse_runners - CQRS Query Tool (discriminated union schema)
// Actions: list_all, list_owned, list_project, list_group, get, list_jobs
// Backed by the GitLab GraphQL runners API. Jobs fold in as the list_jobs action
// rather than a separate tool. Gated behind USE_RUNNERS. Free tier.
// ============================================================================

const projectPathField = requiredId.describe(
  "Project full path (e.g., 'my-group/my-project') - required by the GraphQL project lookup",
);
const groupPathField = requiredId.describe(
  "Group full path (e.g., 'my-group' or 'my-group/sub') - required by the GraphQL group lookup",
);
const runnerIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the runner (from a list action); expanded to a global ID internally');

const runnerTypeFilter = z
  .enum(['INSTANCE_TYPE', 'GROUP_TYPE', 'PROJECT_TYPE'])
  .optional()
  .describe('Filter by runner type');
const runnerStatusFilter = z
  .enum(['ONLINE', 'OFFLINE', 'STALE', 'NEVER_CONTACTED'])
  .optional()
  .describe('Filter by runner status');
const pausedFilter = flexibleBoolean.optional().describe('Filter by paused state');
const tagListFilter = z
  .array(z.string())
  .optional()
  .describe('Filter by runners that have ALL of these tags');
const searchFilter = z.string().optional().describe('Filter by description/token substring');
const firstField = z.coerce
  .number()
  .int()
  .positive()
  .max(100)
  .optional()
  .describe('Max items to return (cursor pagination, default 20, max 100)');
const afterField = z.string().optional().describe('Cursor for the next page (endCursor)');

// Shared filter fields reused across the list actions.
const listFilters = {
  type: runnerTypeFilter,
  status: runnerStatusFilter,
  paused: pausedFilter,
  tag_list: tagListFilter,
  search: searchFilter,
  first: firstField,
  after: afterField,
};

// --- Action: list_all (instance-wide; admin) ---
const ListAllRunnersSchema = z.object({
  action: z
    .literal('list_all')
    .describe('List all runners on the instance (requires admin / elevated access)'),
  ...listFilters,
});

// --- Action: list_owned (current user) ---
const ListOwnedRunnersSchema = z.object({
  action: z.literal('list_owned').describe('List runners owned by the current user'),
  ...listFilters,
});

// --- Action: list_project ---
const ListProjectRunnersSchema = z.object({
  action: z.literal('list_project').describe('List runners available to a project'),
  project_id: projectPathField,
  ...listFilters,
});

// --- Action: list_group ---
const ListGroupRunnersSchema = z.object({
  action: z.literal('list_group').describe('List runners available to a group'),
  group_id: groupPathField,
  ...listFilters,
});

// --- Action: get ---
const GetRunnerSchema = z.object({
  action: z.literal('get').describe('Get a single runner by its numeric ID'),
  runner_id: runnerIdField,
});

// --- Action: list_jobs ---
const ListRunnerJobsSchema = z.object({
  action: z.literal('list_jobs').describe('List jobs that have run on a runner'),
  runner_id: runnerIdField,
  statuses: z
    .enum([
      'CREATED',
      'PENDING',
      'RUNNING',
      'FAILED',
      'SUCCESS',
      'CANCELED',
      'SKIPPED',
      'MANUAL',
      'SCHEDULED',
      'WAITING_FOR_RESOURCE',
      'PREPARING',
      'CANCELING',
    ])
    .optional()
    .describe('Filter jobs by status'),
  first: firstField,
  after: afterField,
});

// --- Discriminated union combining all actions ---
export const BrowseRunnersSchema = z.discriminatedUnion('action', [
  ListAllRunnersSchema,
  ListOwnedRunnersSchema,
  ListProjectRunnersSchema,
  ListGroupRunnersSchema,
  GetRunnerSchema,
  ListRunnerJobsSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseRunnersInput = z.infer<typeof BrowseRunnersSchema>;
