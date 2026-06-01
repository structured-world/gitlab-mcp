import * as z from 'zod';
import { BrowseJobTokenScopeSchema } from './schema-readonly';
import { ManageJobTokenScopeSchema } from './schema';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';

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

/** Base path for a project's job token scope endpoints. */
function scopeBase(projectId: number): string {
  return `projects/${projectId}/job_token_scope`;
}

// Free tier throughout; the inbound project allowlist lands in GitLab 15.9 and
// the group allowlist in 16.0.
const SCOPE_REQ = { tier: 'free', minVersion: '15.9' } as const;
const GROUP_REQ = { tier: 'free', minVersion: '16.0' } as const;

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
      requirements: { default: SCOPE_REQ, actions: { list_groups: GROUP_REQ } },
      gate: { envVar: 'USE_JOB_TOKEN_SCOPE', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseJobTokenScopeSchema.parse(args);
        assertActionAllowed('browse_job_token_scope', input.action);

        const base = scopeBase(await resolveProjectNumericId(input.project_id));

        if (input.action === 'get') {
          return gitlab.get(base);
        }

        // list_projects | list_groups — same shape, different allowlist endpoint
        const suffix = input.action === 'list_projects' ? 'allowlist' : 'groups_allowlist';
        const { action: _action, project_id: _project_id, ...pagination } = input;
        return gitlab.get(`${base}/${suffix}`, { query: toQuery(pagination, []) });
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
        default: SCOPE_REQ,
        actions: { add_group: GROUP_REQ, remove_group: GROUP_REQ },
      },
      gate: { envVar: 'USE_JOB_TOKEN_SCOPE', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageJobTokenScopeSchema.parse(args);
        assertActionAllowed('manage_job_token_scope', input.action);

        const base = scopeBase(await resolveProjectNumericId(input.project_id));

        if (input.action === 'set_enabled') {
          return gitlab.patch(base, { body: { enabled: input.enabled }, contentType: 'json' });
        }

        // The remaining actions all target one of the two allowlists.
        const isProject = input.action === 'add_project' || input.action === 'remove_project';
        const suffix = isProject ? 'allowlist' : 'groups_allowlist';

        if (input.action === 'add_project' || input.action === 'add_group') {
          const body =
            input.action === 'add_project'
              ? { target_project_id: input.target_project_id }
              : { target_group_id: input.target_group_id };
          return gitlab.post(`${base}/${suffix}`, { body, contentType: 'json' });
        }

        // remove_project | remove_group
        const targetId =
          input.action === 'remove_project' ? input.target_project_id : input.target_group_id;
        await gitlab.delete(`${base}/${suffix}/${targetId}`);
        return isProject
          ? { removed: true, target_project_id: targetId }
          : { removed: true, target_group_id: targetId };
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
