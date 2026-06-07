import * as z from 'zod';
import { BrowseEnvironmentsSchema } from './schema-readonly';
import { ManageEnvironmentSchema } from './schema';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';

/**
 * Environments tools registry - 2 CQRS tools
 *
 * browse_environments (Query): list, get, list_deployments
 * manage_environment (Command): create, update, stop, delete, update_deployment_status
 *
 * Deployments are folded into these tools as actions (list_deployments,
 * update_deployment_status) rather than a separate CQRS pair, to keep the MCP
 * tool count lean. Gated behind USE_ENVIRONMENTS. Free tier.
 */
export const environmentsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_environments - CQRS Query Tool (discriminated union schema)
  // ============================================================================
  [
    'browse_environments',
    {
      name: 'browse_environments',
      description:
        'Inspect project environments and their deployments. Actions: list (environments filtered by state/name), get (single environment with its last deployment), list_deployments (deployment history, filterable by environment and status). Related: manage_environment to create, update, stop, or delete environments and update deployment status.',
      inputSchema: z.toJSONSchema(BrowseEnvironmentsSchema),
      requirements: { default: { tier: 'free', minVersion: '8.0' } },
      gate: { envVar: 'USE_ENVIRONMENTS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseEnvironmentsSchema.parse(args);

        assertActionAllowed('browse_environments', input.action);

        const encodedProjectId = encodeURIComponent(input.project_id);

        switch (input.action) {
          case 'list': {
            const { action: _action, project_id: _projectId, ...queryOptions } = input;
            return gitlab.get(`projects/${encodedProjectId}/environments`, {
              query: toQuery(queryOptions, []),
            });
          }

          case 'get': {
            return gitlab.get(`projects/${encodedProjectId}/environments/${input.environment_id}`);
          }

          case 'list_deployments': {
            const { action: _action, project_id: _projectId, ...queryOptions } = input;
            return gitlab.get(`projects/${encodedProjectId}/deployments`, {
              query: toQuery(queryOptions, []),
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_environment - CQRS Command Tool (discriminated union schema)
  // ============================================================================
  [
    'manage_environment',
    {
      name: 'manage_environment',
      description:
        'Create and control project environments and deployment status. Actions: create (new environment), update (external_url/tier/description), stop (required before delete), delete (stopped environment), update_deployment_status (set a non-pipeline deployment to running/success/failed/canceled). Related: browse_environments to list and inspect.',
      inputSchema: z.toJSONSchema(ManageEnvironmentSchema),
      requirements: { default: { tier: 'free', minVersion: '8.0' } },
      gate: { envVar: 'USE_ENVIRONMENTS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageEnvironmentSchema.parse(args);

        assertActionAllowed('manage_environment', input.action);

        const encodedProjectId = encodeURIComponent(input.project_id);

        switch (input.action) {
          case 'create': {
            const { name, external_url, tier, description } = input;
            const body: Record<string, unknown> = { name };
            if (external_url !== undefined) body.external_url = external_url;
            if (tier !== undefined) body.tier = tier;
            if (description !== undefined) body.description = description;

            return gitlab.post(`projects/${encodedProjectId}/environments`, {
              body,
              contentType: 'json',
            });
          }

          case 'update': {
            const { environment_id, external_url, tier, description } = input;
            const body: Record<string, unknown> = {};
            if (external_url !== undefined) body.external_url = external_url;
            if (tier !== undefined) body.tier = tier;
            if (description !== undefined) body.description = description;

            return gitlab.put(`projects/${encodedProjectId}/environments/${environment_id}`, {
              body,
              contentType: 'json',
            });
          }

          case 'stop': {
            const { environment_id, force } = input;
            const body: Record<string, unknown> = {};
            if (force !== undefined) body.force = force;

            return gitlab.post(`projects/${encodedProjectId}/environments/${environment_id}/stop`, {
              body,
              contentType: 'json',
            });
          }

          case 'delete': {
            const { environment_id } = input;
            await gitlab.delete(`projects/${encodedProjectId}/environments/${environment_id}`);
            return { deleted: true, environment_id };
          }

          case 'update_deployment_status': {
            const { deployment_id, status } = input;
            return gitlab.put(`projects/${encodedProjectId}/deployments/${deployment_id}`, {
              body: { status },
              contentType: 'json',
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getEnvironmentsReadOnlyToolNames(): string[] {
  return ['browse_environments'];
}
