import { z } from 'zod';
import { requiredId, paginationFields } from '../utils';

// ============================================================================
// browse_job_token_scope - CQRS Query Tool (discriminated union schema)
// Actions: get, list_projects, list_groups
//
// The CI/CD job token "inbound" scope controls which OTHER projects/groups may
// access this project's resources using their pipeline CI_JOB_TOKEN. These
// read actions inspect the current scope toggle and the inbound allowlists.
// Project-level only (no group equivalent in the GitLab API).
// ============================================================================

const projectIdField = requiredId.describe(
  "Project whose job token scope is inspected. Numeric ID or URL-encoded path (e.g. 'group/project' or '123').",
);

// --- Action: get ---
const GetJobTokenScopeSchema = z.object({
  action: z
    .literal('get')
    .describe('Get the job token scope settings (inbound_enabled / outbound_enabled)'),
  project_id: projectIdField,
});

// --- Action: list_projects ---
const ListProjectsSchema = z.object({
  action: z
    .literal('list_projects')
    .describe('List projects on the inbound job token allowlist for this project'),
  project_id: projectIdField,
  ...paginationFields(),
});

// --- Action: list_groups ---
const ListGroupsSchema = z.object({
  action: z
    .literal('list_groups')
    .describe('List groups on the inbound job token allowlist for this project'),
  project_id: projectIdField,
  ...paginationFields(),
});

// --- Discriminated union combining all actions ---
export const BrowseJobTokenScopeSchema = z.discriminatedUnion('action', [
  GetJobTokenScopeSchema,
  ListProjectsSchema,
  ListGroupsSchema,
]);

export type BrowseJobTokenScopeInput = z.infer<typeof BrowseJobTokenScopeSchema>;
