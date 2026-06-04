import { z } from 'zod';
import { requiredId } from '../utils';
import { projectIdField, groupIdField, tokenIdField } from './schema-readonly';

// ============================================================================
// manage_access_token - CQRS Command Tool (discriminated union schema)
// Actions: create_project, create_group, rotate, revoke
//
// Creates, rotates, and revokes project / group / personal access tokens via the
// GitLab REST endpoints (no GraphQL surface exists). create_* and rotate return a
// token value exactly once; the handler flags those responses as sensitive.
// Personal-token creation is intentionally absent: GitLab only allows it for
// admins against a specific user, which is out of scope for this tool. Gated
// behind USE_ACCESS_TOKENS. Free tier; project/group create needs owner/admin.
// ============================================================================

// Access-token scopes are a free-form, version-dependent set (api, read_api,
// read_repository, write_repository, read_registry, write_registry, ...). Kept
// as strings rather than an enum so new GitLab scopes work without a code change.
const scopesField = z
  .array(z.string())
  .min(1)
  .describe(
    "Token scopes, e.g. ['api'], ['read_repository','write_repository']. At least one required.",
  );

// GitLab member access levels: 10 Guest, 20 Reporter, 30 Developer, 40 Maintainer, 50 Owner.
const accessLevelField = z
  .union([z.literal(10), z.literal(20), z.literal(30), z.literal(40), z.literal(50)])
  .optional()
  .describe('Access level: 10 Guest, 20 Reporter, 30 Developer, 40 Maintainer, 50 Owner.');

const expiresAtField = z
  .string()
  .optional()
  .describe('Expiry date in YYYY-MM-DD format (e.g. "2026-12-31").');

// --- Action: create_project ---
const CreateProjectTokenSchema = z.object({
  action: z
    .literal('create_project')
    .describe('Create a project access token (returns the value once)'),
  project_id: projectIdField,
  name: z.string().describe('Human-readable token name.'),
  scopes: scopesField,
  access_level: accessLevelField,
  expires_at: expiresAtField,
});

// --- Action: create_group ---
const CreateGroupTokenSchema = z.object({
  action: z
    .literal('create_group')
    .describe('Create a group access token (returns the value once)'),
  group_id: groupIdField,
  name: z.string().describe('Human-readable token name.'),
  scopes: scopesField,
  access_level: accessLevelField,
  expires_at: expiresAtField,
});

// --- Action: rotate (scope inferred from project_id/group_id) ---
const RotateTokenSchema = z.object({
  action: z
    .literal('rotate')
    .describe(
      'Rotate a token: revoke the old one and return a new value. Pass project_id for a project token, group_id for a group token, or neither for a personal token.',
    ),
  token_id: tokenIdField,
  project_id: requiredId.optional().describe('Set for a project access token.'),
  group_id: requiredId.optional().describe('Set for a group access token.'),
  expires_at: expiresAtField,
});

// --- Action: revoke (scope inferred from project_id/group_id) ---
const RevokeTokenSchema = z.object({
  action: z
    .literal('revoke')
    .describe(
      'Revoke a token permanently. Pass project_id for a project token, group_id for a group token, or neither for a personal token.',
    ),
  token_id: tokenIdField,
  project_id: requiredId.optional().describe('Set for a project access token.'),
  group_id: requiredId.optional().describe('Set for a group access token.'),
});

// --- Discriminated union combining all actions ---
export const ManageAccessTokenSchema = z
  .discriminatedUnion('action', [
    CreateProjectTokenSchema,
    CreateGroupTokenSchema,
    RotateTokenSchema,
    RevokeTokenSchema,
  ])
  // A token belongs to a single scope; project_id and group_id are mutually exclusive
  // on the scope-inferring actions.
  .refine(
    (data) =>
      (data.action !== 'rotate' && data.action !== 'revoke') || !(data.project_id && data.group_id),
    {
      message: 'Pass at most one of project_id or group_id (a token belongs to a single scope)',
      path: ['project_id'],
    },
  );

export type ManageAccessTokenInput = z.infer<typeof ManageAccessTokenSchema>;
