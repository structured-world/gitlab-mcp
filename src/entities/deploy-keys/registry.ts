import * as z from 'zod';
import { BrowseDeployKeysSchema } from './schema-readonly';
import { ManageDeployKeySchema } from './schema';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';

// Deploy keys have existed since early GitLab and are Free tier throughout.
const FREE_REQ = { tier: 'free', minVersion: '8.0' } as const;

/**
 * Deploy keys tools registry - 2 CQRS tools.
 *
 * browse_deploy_keys (Query): list, get
 * manage_deploy_key (Command): add, enable, update, delete
 *
 * Deploy keys are SSH public keys granting a project repository access without
 * a user PAT — used by CI/automation. Project-level, Free tier.
 */
export const deployKeysToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_deploy_keys - CQRS Query Tool
  // ============================================================================
  [
    'browse_deploy_keys',
    {
      name: 'browse_deploy_keys',
      description:
        'List and inspect deploy keys (SSH keys granting repo access to CI/automation). Actions: list (a project’s keys, or all instance keys when project_id is omitted — admin only), get (a single project key by ID). Related: manage_deploy_key to add/enable/update/delete.',
      inputSchema: z.toJSONSchema(BrowseDeployKeysSchema),
      requirements: { default: FREE_REQ },
      gate: { envVar: 'USE_CI_TOKENS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseDeployKeysSchema.parse(args);
        assertActionAllowed('browse_deploy_keys', input.action);

        if (input.action === 'get') {
          const encodedProjectId = encodeURIComponent(input.project_id);
          return gitlab.get(`projects/${encodedProjectId}/deploy_keys/${input.key_id}`);
        }

        // list: project-scoped when project_id is provided, otherwise instance-wide
        const { action: _action, project_id, ...query } = input;
        const path = project_id
          ? `projects/${encodeURIComponent(project_id)}/deploy_keys`
          : 'deploy_keys';
        return gitlab.get(path, { query: toQuery(query, []) });
      },
    },
  ],

  // ============================================================================
  // manage_deploy_key - CQRS Command Tool
  // ============================================================================
  [
    'manage_deploy_key',
    {
      name: 'manage_deploy_key',
      description:
        'Add, enable, update, or remove project deploy keys. Actions: add (register a new SSH public key with title and optional push access/expiry), enable (attach an existing key from another project), update (change title or can_push), delete (remove from this project). Related: browse_deploy_keys to inspect.',
      inputSchema: z.toJSONSchema(ManageDeployKeySchema),
      requirements: { default: FREE_REQ },
      gate: { envVar: 'USE_CI_TOKENS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageDeployKeySchema.parse(args);
        assertActionAllowed('manage_deploy_key', input.action);

        const encodedProjectId = encodeURIComponent(input.project_id);
        const base = `projects/${encodedProjectId}/deploy_keys`;

        switch (input.action) {
          case 'add': {
            const { action: _action, project_id: _project_id, ...body } = input;
            return gitlab.post(base, { body, contentType: 'json' });
          }

          case 'enable':
            return gitlab.post(`${base}/${input.key_id}/enable`);

          case 'update': {
            const { action: _action, project_id: _project_id, key_id, ...body } = input;
            return gitlab.put(`${base}/${key_id}`, { body, contentType: 'json' });
          }

          case 'delete': {
            await gitlab.delete(`${base}/${input.key_id}`);
            return { deleted: true, key_id: input.key_id };
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
export function getDeployKeysReadOnlyToolNames(): string[] {
  return ['browse_deploy_keys'];
}
