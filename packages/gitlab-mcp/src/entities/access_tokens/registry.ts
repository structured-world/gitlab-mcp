import * as z from 'zod';
import { BrowseAccessTokensSchema } from './schema-readonly';
import { ManageAccessTokenSchema } from './schema';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';

// Personal/project/group access tokens are Free tier. Project access tokens
// landed in 13.0, group access tokens in 14.7; the tool degrades per-action
// rather than gating the whole pair, so the lowest floor is declared here.
const FREE_REQ = { tier: 'free', minVersion: '13.0' } as const;

const NEW_TOKEN_NOTICE =
  'This response contains a token value shown only once. Store it securely; it cannot be retrieved again.';

/**
 * Wrap a create/rotate response so the secret it carries is explicitly flagged.
 * The result is serialized to the tool output, so the marker travels with it.
 */
function flagSensitive(response: unknown): unknown {
  if (response && typeof response === 'object') {
    return {
      ...(response as Record<string, unknown>),
      _meta: { sensitive: true, notice: NEW_TOKEN_NOTICE },
    };
  }
  return response;
}

/**
 * Resolve the REST collection path for a single-token action (get/rotate/revoke).
 * A token belongs to exactly one scope: project, group, or the current user.
 */
function tokenBasePath(input: { project_id?: string; group_id?: string }): string {
  if (input.project_id) {
    return `projects/${encodeURIComponent(input.project_id)}/access_tokens`;
  }
  if (input.group_id) {
    return `groups/${encodeURIComponent(input.group_id)}/access_tokens`;
  }
  return 'personal_access_tokens';
}

/**
 * Access-tokens tools registry - 2 CQRS tools.
 *
 * browse_access_tokens (Query): list_personal, list_project, list_group, get
 * manage_access_token (Command): create_project, create_group, rotate, revoke
 *
 * Backed by the GitLab REST access-token endpoints (no GraphQL surface exists).
 * The personal/project/group scopes fold in as actions; get/rotate/revoke infer
 * the scope from project_id / group_id. Gated behind USE_ACCESS_TOKENS. Free tier;
 * project/group creation requires owner/admin on the namespace.
 */
export const accessTokensToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_access_tokens - CQRS Query Tool
  // ============================================================================
  [
    'browse_access_tokens',
    {
      name: 'browse_access_tokens',
      description:
        "Inspect access tokens (CI/automation credentials). Actions: list_personal (the current user's PATs; admins may filter by user_id), list_project / list_group (a project's or group's tokens), get (a single token by ID - pass project_id or group_id for project/group tokens, neither for personal). Related: manage_access_token to create, rotate, or revoke.",
      inputSchema: z.toJSONSchema(BrowseAccessTokensSchema),
      requirements: { default: FREE_REQ },
      gate: { envVar: 'USE_ACCESS_TOKENS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseAccessTokensSchema.parse(args);
        assertActionAllowed('browse_access_tokens', input.action);

        switch (input.action) {
          case 'list_personal': {
            const { action: _action, ...query } = input;
            return gitlab.get('personal_access_tokens', { query: toQuery(query, []) });
          }

          case 'list_project': {
            const { action: _action, project_id, ...query } = input;
            return gitlab.get(`projects/${encodeURIComponent(project_id)}/access_tokens`, {
              query: toQuery(query, []),
            });
          }

          case 'list_group': {
            const { action: _action, group_id, ...query } = input;
            return gitlab.get(`groups/${encodeURIComponent(group_id)}/access_tokens`, {
              query: toQuery(query, []),
            });
          }

          case 'get':
            return gitlab.get(`${tokenBasePath(input)}/${input.token_id}`);

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_access_token - CQRS Command Tool
  // ============================================================================
  [
    'manage_access_token',
    {
      name: 'manage_access_token',
      description:
        'Create, rotate, or revoke access tokens. Actions: create_project / create_group (issue a new token with name + scopes, returns the value once), rotate (revoke the old token and return a new value), revoke (delete a token permanently). For rotate/revoke pass project_id or group_id for project/group tokens, neither for personal. Related: browse_access_tokens to discover token IDs.',
      inputSchema: z.toJSONSchema(ManageAccessTokenSchema),
      requirements: { default: FREE_REQ },
      gate: { envVar: 'USE_ACCESS_TOKENS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageAccessTokenSchema.parse(args);
        assertActionAllowed('manage_access_token', input.action);

        switch (input.action) {
          case 'create_project': {
            const { action: _action, project_id, ...body } = input;
            const res = await gitlab.post(
              `projects/${encodeURIComponent(project_id)}/access_tokens`,
              { body, contentType: 'json' },
            );
            return flagSensitive(res);
          }

          case 'create_group': {
            const { action: _action, group_id, ...body } = input;
            const res = await gitlab.post(`groups/${encodeURIComponent(group_id)}/access_tokens`, {
              body,
              contentType: 'json',
            });
            return flagSensitive(res);
          }

          case 'rotate': {
            const body = input.expires_at ? { expires_at: input.expires_at } : {};
            const res = await gitlab.post(`${tokenBasePath(input)}/${input.token_id}/rotate`, {
              body,
              contentType: 'json',
            });
            return flagSensitive(res);
          }

          case 'revoke': {
            await gitlab.delete(`${tokenBasePath(input)}/${input.token_id}`);
            return { revoked: true, token_id: input.token_id };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/** Read-only tool names from the registry (for read-only mode filtering). */
export function getAccessTokensReadOnlyToolNames(): string[] {
  return ['browse_access_tokens'];
}
