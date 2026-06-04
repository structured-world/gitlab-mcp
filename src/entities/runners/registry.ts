import * as z from 'zod';
import { BrowseRunnersSchema } from './schema-readonly';
import { ManageRunnerSchema } from './schema';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';
import { ConnectionManager } from '../../services/ConnectionManager';
import { cleanGidsFromObject } from '../../utils/idConversion';
import { gitlab } from '../../utils/gitlab-api';
import {
  LIST_RUNNERS,
  LIST_OWNED_RUNNERS,
  LIST_GROUP_RUNNERS,
  LIST_PROJECT_RUNNERS,
  GET_RUNNER,
  LIST_RUNNER_JOBS,
  RESOLVE_GROUP_ID,
  RESOLVE_PROJECT_ID,
  RUNNER_CREATE,
  RUNNER_UPDATE,
  RUNNER_DELETE,
  type RunnerListVars,
} from '../../graphql/runners';

/**
 * Runners tools registry - 2 CQRS tools
 *
 * browse_runners (Query): list_all, list_owned, list_project, list_group, get, list_jobs
 * manage_runner (Command): create_authentication_token, update, pause, resume, delete,
 *                          reset_authentication_token
 *
 * Backed by the GitLab GraphQL runner API. pause/resume map to runnerUpdate(paused).
 * Per-runner token reset has no GraphQL mutation, so reset_authentication_token uses
 * the REST endpoint. Gated behind USE_RUNNERS. Free tier (writes require the
 * create_runner / manage_runner scope; list_all needs admin).
 */

const runnerGid = (id: number): string => `gid://gitlab/Ci::Runner/${id}`;

/** Build the shared GraphQL list filter variables from the parsed input. */
function listVars(input: {
  type?: string;
  status?: string;
  paused?: boolean;
  tag_list?: string[];
  search?: string;
  first?: number;
  after?: string;
}): RunnerListVars {
  return {
    type: input.type ?? null,
    status: input.status ?? null,
    paused: input.paused ?? null,
    tagList: input.tag_list ?? null,
    search: input.search ?? null,
    first: input.first ?? 20,
    after: input.after ?? null,
  };
}

interface RunnerSettingsInput {
  description?: string | null;
  paused?: boolean | null;
  locked?: boolean | null;
  runUntagged?: boolean | null;
  tagList?: string[] | null;
  accessLevel?: string | null;
  maximumTimeout?: number | null;
  maintenanceNote?: string | null;
}

/** Map provided snake_case settings onto a camelCase mutation input (omitting absent ones). */
function applyRunnerSettings(
  target: RunnerSettingsInput,
  src: {
    description?: string;
    paused?: boolean;
    locked?: boolean;
    run_untagged?: boolean;
    tag_list?: string[];
    access_level?: string;
    maximum_timeout?: number;
    maintenance_note?: string;
  },
): void {
  if (src.description !== undefined) target.description = src.description;
  if (src.paused !== undefined) target.paused = src.paused;
  if (src.locked !== undefined) target.locked = src.locked;
  if (src.run_untagged !== undefined) target.runUntagged = src.run_untagged;
  if (src.tag_list !== undefined) target.tagList = src.tag_list;
  if (src.access_level !== undefined) target.accessLevel = src.access_level;
  if (src.maximum_timeout !== undefined) target.maximumTimeout = src.maximum_timeout;
  if (src.maintenance_note !== undefined) target.maintenanceNote = src.maintenance_note;
}

/** Throw on a non-empty GraphQL mutation `errors` array. */
function assertNoErrors(errors: string[] | undefined): void {
  if (errors && errors.length > 0) {
    throw new Error(`GitLab API error: ${errors.join(', ')}`);
  }
}

export const runnersToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_runners - CQRS Query Tool (discriminated union schema)
  // ============================================================================
  [
    'browse_runners',
    {
      name: 'browse_runners',
      description:
        "Inspect CI runners. Actions: list_all (every runner on the instance - admin), list_owned (the current user's runners), list_project / list_group (runners available to a project/group), get (single runner by ID), list_jobs (jobs a runner has executed). Related: manage_runner to register, update, pause/resume, or delete runners.",
      inputSchema: z.toJSONSchema(BrowseRunnersSchema),
      requirements: { default: { tier: 'free', minVersion: '13.2' } },
      gate: { envVar: 'USE_RUNNERS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseRunnersSchema.parse(args);

        assertActionAllowed('browse_runners', input.action);

        const client = ConnectionManager.getInstance().getClient();

        switch (input.action) {
          case 'list_all': {
            const res = await client.request(LIST_RUNNERS, listVars(input));
            return cleanGidsFromObject(res.runners);
          }

          case 'list_owned': {
            const res = await client.request(LIST_OWNED_RUNNERS, listVars(input));
            return cleanGidsFromObject(res.currentUser?.runners ?? { nodes: [] });
          }

          case 'list_project': {
            const res = await client.request(LIST_PROJECT_RUNNERS, {
              fullPath: input.project_id,
              ...listVars(input),
            });
            if (!res.project) {
              throw new Error(`Project "${input.project_id}" not found or not accessible`);
            }
            return cleanGidsFromObject(res.project.runners);
          }

          case 'list_group': {
            const res = await client.request(LIST_GROUP_RUNNERS, {
              fullPath: input.group_id,
              ...listVars(input),
            });
            if (!res.group) {
              throw new Error(`Group "${input.group_id}" not found or not accessible`);
            }
            return cleanGidsFromObject(res.group.runners);
          }

          case 'get': {
            const res = await client.request(GET_RUNNER, { id: runnerGid(input.runner_id) });
            if (!res.runner) {
              throw new Error(`Runner ${input.runner_id} not found`);
            }
            return cleanGidsFromObject(res.runner);
          }

          case 'list_jobs': {
            const res = await client.request(LIST_RUNNER_JOBS, {
              id: runnerGid(input.runner_id),
              statuses: input.statuses ?? null,
              first: input.first ?? 20,
              after: input.after ?? null,
            });
            if (!res.runner) {
              throw new Error(`Runner ${input.runner_id} not found`);
            }
            return cleanGidsFromObject(res.runner.jobs ?? { nodes: [] });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_runner - CQRS Command Tool (discriminated union schema)
  // ============================================================================
  [
    'manage_runner',
    {
      name: 'manage_runner',
      description:
        'Register and control CI runners. Actions: create_authentication_token (register a runner, GitLab 16+, returns a one-time token), update (settings), pause/resume (toggle job pickup), delete, reset_authentication_token (rotate the token). Related: browse_runners to discover runners.',
      inputSchema: z.toJSONSchema(ManageRunnerSchema),
      requirements: { default: { tier: 'free', minVersion: '13.2' } },
      gate: { envVar: 'USE_RUNNERS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageRunnerSchema.parse(args);

        assertActionAllowed('manage_runner', input.action);

        const client = ConnectionManager.getInstance().getClient();

        switch (input.action) {
          case 'create_authentication_token': {
            const createInput: {
              runnerType: string;
              groupId?: string;
              projectId?: string;
            } & RunnerSettingsInput = { runnerType: input.runner_type };
            applyRunnerSettings(createInput, input);

            if (input.runner_type === 'GROUP_TYPE') {
              if (!input.group_id) {
                throw new Error('group_id is required for a GROUP_TYPE runner');
              }
              const g = await client.request(RESOLVE_GROUP_ID, { fullPath: input.group_id });
              if (!g.group) throw new Error(`Group "${input.group_id}" not found`);
              createInput.groupId = g.group.id;
            } else if (input.runner_type === 'PROJECT_TYPE') {
              if (!input.project_id) {
                throw new Error('project_id is required for a PROJECT_TYPE runner');
              }
              const p = await client.request(RESOLVE_PROJECT_ID, { fullPath: input.project_id });
              if (!p.project) throw new Error(`Project "${input.project_id}" not found`);
              createInput.projectId = p.project.id;
            }

            const res = await client.request(RUNNER_CREATE, { input: createInput });
            assertNoErrors(res.runnerCreate?.errors);
            return cleanGidsFromObject(res.runnerCreate?.runner);
          }

          case 'update': {
            const updateInput: { id: string } & RunnerSettingsInput = {
              id: runnerGid(input.runner_id),
            };
            applyRunnerSettings(updateInput, input);
            const res = await client.request(RUNNER_UPDATE, { input: updateInput });
            assertNoErrors(res.runnerUpdate?.errors);
            return cleanGidsFromObject(res.runnerUpdate?.runner);
          }

          case 'pause':
          case 'resume': {
            const res = await client.request(RUNNER_UPDATE, {
              input: { id: runnerGid(input.runner_id), paused: input.action === 'pause' },
            });
            assertNoErrors(res.runnerUpdate?.errors);
            return cleanGidsFromObject(res.runnerUpdate?.runner);
          }

          case 'delete': {
            const res = await client.request(RUNNER_DELETE, {
              input: { id: runnerGid(input.runner_id) },
            });
            assertNoErrors(res.runnerDelete?.errors);
            return { deleted: true, runner_id: input.runner_id };
          }

          case 'reset_authentication_token': {
            // No GraphQL mutation for per-runner token reset; use the REST endpoint.
            return gitlab.post(`runners/${input.runner_id}/reset_authentication_token`, {
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
export function getRunnersReadOnlyToolNames(): string[] {
  return ['browse_runners'];
}
