import * as z from 'zod';
import { BrowseJobTokenScopeSchema } from './schema-readonly';
import { ManageJobTokenScopeSchema } from './schema';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { isActionDenied } from '../../config';

/**
 * Resolve a project identifier to its numeric ID.
 *
 * The job_token_scope allowlist endpoints (POST/DELETE on GitLab 19.x) reject a
 * URL-encoded path in `:id` with "400 id is invalid" and require the numeric ID.
 * A numeric input is returned as-is (no API call); a path is looked up once so
 * the agent can pass either form transparently.
 */
async function resolveProjectNumericId(projectId: string): Promise<number> {
  const trimmed = projectId.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const project = await gitlab.get<{ id: number }>(`projects/${encodeURIComponent(trimmed)}`);
  return project.id;
}

/**
 * CI/CD job token scope tools registry - 2 CQRS tools.
 *
 * browse_job_token_scope (Query): get, list_projects, list_groups
 * manage_job_token_scope (Command): set_enabled, add_project, remove_project,
 *                                   add_group, remove_group
 *
 * Manages the inbound job token allowlist (which other projects/groups may use
 * their CI_JOB_TOKEN to access this project). Project-level, Free tier.
 */
export const jobTokenScopeToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_job_token_scope - CQRS Query Tool
  // ============================================================================
  [
    'browse_job_token_scope',
    {
      name: 'browse_job_token_scope',
      description:
        'Inspect a project CI/CD job token inbound access scope. Actions: get (the inbound/outbound scope toggles), list_projects (projects allowed to reach this project via CI_JOB_TOKEN), list_groups (groups on the allowlist). Related: manage_job_token_scope to change the allowlist.',
      inputSchema: z.toJSONSchema(BrowseJobTokenScopeSchema),
      requirements: {
        default: { tier: 'free', minVersion: '15.9' },
        actions: {
          list_groups: { tier: 'free', minVersion: '16.0' },
        },
      },
      gate: { envVar: 'USE_JOB_TOKEN_SCOPE', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseJobTokenScopeSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied('browse_job_token_scope', input.action)) {
          throw new Error(
            `Action '${input.action}' is not allowed for browse_job_token_scope tool`,
          );
        }

        const projectId = await resolveProjectNumericId(input.project_id);

        switch (input.action) {
          case 'get':
            return gitlab.get(`projects/${projectId}/job_token_scope`);

          case 'list_projects': {
            const { action: _action, project_id: _project_id, ...pagination } = input;
            return gitlab.get(`projects/${projectId}/job_token_scope/allowlist`, {
              query: toQuery(pagination, []),
            });
          }

          case 'list_groups': {
            const { action: _action, project_id: _project_id, ...pagination } = input;
            return gitlab.get(`projects/${projectId}/job_token_scope/groups_allowlist`, {
              query: toQuery(pagination, []),
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
  // manage_job_token_scope - CQRS Command Tool
  // ============================================================================
  [
    'manage_job_token_scope',
    {
      name: 'manage_job_token_scope',
      description:
        'Manage a project CI/CD job token inbound allowlist. Actions: set_enabled (turn allowlist enforcement on/off), add_project / remove_project (grant or revoke a project), add_group / remove_group (grant or revoke a group). Required to allow cross-project CI_JOB_TOKEN access once the legacy open-access mode is removed. Related: browse_job_token_scope to inspect.',
      inputSchema: z.toJSONSchema(ManageJobTokenScopeSchema),
      requirements: {
        default: { tier: 'free', minVersion: '15.9' },
        actions: {
          add_group: { tier: 'free', minVersion: '16.0' },
          remove_group: { tier: 'free', minVersion: '16.0' },
        },
      },
      gate: { envVar: 'USE_JOB_TOKEN_SCOPE', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageJobTokenScopeSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied('manage_job_token_scope', input.action)) {
          throw new Error(
            `Action '${input.action}' is not allowed for manage_job_token_scope tool`,
          );
        }

        const projectId = await resolveProjectNumericId(input.project_id);

        switch (input.action) {
          case 'set_enabled':
            return gitlab.patch(`projects/${projectId}/job_token_scope`, {
              body: { enabled: input.enabled },
              contentType: 'json',
            });

          case 'add_project':
            return gitlab.post(`projects/${projectId}/job_token_scope/allowlist`, {
              body: { target_project_id: input.target_project_id },
              contentType: 'json',
            });

          case 'remove_project': {
            await gitlab.delete(
              `projects/${projectId}/job_token_scope/allowlist/${input.target_project_id}`,
            );
            return { removed: true, target_project_id: input.target_project_id };
          }

          case 'add_group':
            return gitlab.post(`projects/${projectId}/job_token_scope/groups_allowlist`, {
              body: { target_group_id: input.target_group_id },
              contentType: 'json',
            });

          case 'remove_group': {
            await gitlab.delete(
              `projects/${projectId}/job_token_scope/groups_allowlist/${input.target_group_id}`,
            );
            return { removed: true, target_group_id: input.target_group_id };
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
export function getJobTokenScopeReadOnlyToolNames(): string[] {
  return ['browse_job_token_scope'];
}

/**
 * Get all tool definitions from the registry
 */
export function getJobTokenScopeToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(jobTokenScopeToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredJobTokenScopeTools(
  readOnlyMode: boolean = false,
): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getJobTokenScopeReadOnlyToolNames();
    return Array.from(jobTokenScopeToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getJobTokenScopeToolDefinitions();
}
