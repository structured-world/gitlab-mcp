import { z } from 'zod';
import { requiredId, paginationFields, flexibleBoolean } from '../utils';

// ============================================================================
// browse_access_tokens - CQRS Query Tool (discriminated union schema)
// Actions: list_personal, list_project, list_group, get
//
// Access tokens (personal / project / group) are CI and automation credentials.
// GitLab exposes them only through REST (no GraphQL surface), so all actions map
// to the /personal_access_tokens, /projects/:id/access_tokens and
// /groups/:id/access_tokens endpoints. The three scopes fold in as actions, not
// separate tools. Gated behind USE_ACCESS_TOKENS. Free tier.
// ============================================================================

export const projectIdField = requiredId.describe(
  "Project ID or URL-encoded path (e.g. 'group/project' or '123').",
);
export const groupIdField = requiredId.describe(
  "Group ID or URL-encoded path (e.g. 'my-group' or '42').",
);
export const tokenIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric access-token ID (from a list action).');

const stateFilter = z.enum(['active', 'inactive']).optional().describe('Filter by token state.');

// --- Action: list_personal (the current user's PATs; admin can pass user_id) ---
const ListPersonalSchema = z.object({
  action: z
    .literal('list_personal')
    .describe('List personal access tokens for the current user (admins may filter by user_id)'),
  user_id: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Admin only: list PATs belonging to this user ID.'),
  revoked: flexibleBoolean.optional().describe('Filter by revoked state.'),
  state: stateFilter,
  search: z.string().optional().describe('Filter by token name substring.'),
  ...paginationFields(),
});

// --- Action: list_project ---
const ListProjectSchema = z.object({
  action: z.literal('list_project').describe('List a project access tokens'),
  project_id: projectIdField,
  state: stateFilter,
  ...paginationFields(),
});

// --- Action: list_group ---
const ListGroupSchema = z.object({
  action: z.literal('list_group').describe('List a group access tokens'),
  group_id: groupIdField,
  state: stateFilter,
  ...paginationFields(),
});

// --- Action: get (single token; scope inferred from project_id/group_id) ---
const GetTokenSchema = z.object({
  action: z
    .literal('get')
    .describe(
      'Get a single access token by ID. Pass project_id for a project token, group_id for a group token, or neither for a personal token.',
    ),
  token_id: tokenIdField,
  project_id: requiredId.optional().describe('Set for a project access token.'),
  group_id: requiredId.optional().describe('Set for a group access token.'),
});

// --- Discriminated union combining all actions ---
export const BrowseAccessTokensSchema = z
  .discriminatedUnion('action', [
    ListPersonalSchema,
    ListProjectSchema,
    ListGroupSchema,
    GetTokenSchema,
  ])
  // A token is owned by exactly one scope; project_id and group_id are mutually exclusive.
  .refine((data) => data.action !== 'get' || !(data.project_id && data.group_id), {
    message: 'Pass at most one of project_id or group_id (a token belongs to a single scope)',
    path: ['project_id'],
  });

export type BrowseAccessTokensInput = z.infer<typeof BrowseAccessTokensSchema>;
