/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as z from 'zod';
import {
  // Consolidated schemas
  BrowseProjectsSchema,
  BrowseNamespacesSchema,
  BrowseCommitsSchema,
  BrowseEventsSchema,
  BrowseUsersSchema,
  BrowseTodosSchema,
} from './schema-readonly';
import {
  // Consolidated schemas
  ManageProjectSchema,
  ManageNamespaceSchema,
  ManageTodosSchema,
} from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { fetchUsers, smartUserSearch, type UserSearchParams } from '../../utils/smart-user-search';
import { cleanGidsFromObject } from '../../utils/idConversion';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';
import { instanceAtLeast } from '../instance-version';
import { withSafeProjectResponse } from './project-response';
import {
  browseProjects,
  browseNamespaces,
  manageProject,
  manageNamespace,
} from './project-handlers';

const CommitDiffsSchema = z.array(
  z.looseObject({
    diff: z.string(),
    old_path: z.string(),
    new_path: z.string(),
    new_file: z.boolean(),
    deleted_file: z.boolean(),
  }),
);
type CommitDiff = z.infer<typeof CommitDiffsSchema>[number];

/**
 * Prefix a commit diff with unified-diff file headers, as GitLab's own `unidiff`
 * option does (Gitlab::Git::Diff#unidiff): empty and binary diffs stay as they are.
 */
function withUnifiedHeaders(d: CommitDiff): string {
  if (!d.diff || d.diff.startsWith('Binary files')) return d.diff;
  const oldHeader = d.new_file ? '/dev/null' : `a/${d.old_path}`;
  const newHeader = d.deleted_file ? '/dev/null' : `b/${d.new_path}`;
  return `--- ${oldHeader}\n+++ ${newHeader}\n${d.diff}`;
}

/**
 * Core tools registry - CQRS consolidated
 * All tools use discriminated union schema pattern.
 * TypeScript automatically narrows types in each switch case.
 */
export const coreToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // BROWSE TOOLS (read-only queries)
  // ============================================================================

  [
    'browse_projects',
    {
      name: 'browse_projects',
      description:
        'Find, list, or inspect GitLab projects. Actions: search (find by name/topic across GitLab), list (browse accessible projects or group projects), get (retrieve full project details). Related: manage_project to create/update/delete projects.',
      inputSchema: z.toJSONSchema(BrowseProjectsSchema),
      requirements: {
        default: { tier: 'free' },
        // Listing soft-deleted projects needs active admin-mode elevation; the
        // registry strips this parameter when elevation is known inactive (non-admin
        // OR admin role without elevation), and keeps it when elevated or unknown
        // (fail-open). marked_for_deletion_on is a Premium/Ultimate filter (17.1+);
        // the registry strips it on lower tiers/older versions.
        parameters: {
          include_deleted: { requiresAdmin: true },
          marked_for_deletion_on: { tier: 'premium', minVersion: '17.1' },
        },
      },
      handler: withSafeProjectResponse(browseProjects),
    },
  ],

  [
    'browse_namespaces',
    {
      name: 'browse_namespaces',
      description:
        'Explore GitLab groups and user namespaces. Actions: list (discover available namespaces), get (retrieve details with storage stats), verify (check if path exists). Related: manage_namespace to create/update/delete groups.',
      inputSchema: z.toJSONSchema(BrowseNamespacesSchema),
      requirements: { default: { tier: 'free' } },
      handler: withSafeProjectResponse(browseNamespaces),
    },
  ],

  [
    'browse_commits',
    {
      name: 'browse_commits',
      description:
        'Explore repository commit history and diffs. Actions: list (browse commits with filters), get (retrieve commit metadata and stats), diff (view code changes). Related: browse_refs for branch/tag info.',
      inputSchema: z.toJSONSchema(BrowseCommitsSchema),
      requirements: { default: { tier: 'free' } },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseCommitsSchema.parse(args);

        assertActionAllowed('browse_commits', input.action);

        switch (input.action) {
          case 'list': {
            const {
              project_id,
              ref_name,
              since,
              until,
              path,
              author,
              all,
              with_stats,
              first_parent,
              order,
              trailers,
              per_page,
              page,
            } = input;
            const queryParams = new URLSearchParams();

            if (ref_name) queryParams.set('ref_name', ref_name);
            if (since) queryParams.set('since', since);
            if (until) queryParams.set('until', until);
            if (path) queryParams.set('path', path);
            if (author) queryParams.set('author', author);
            if (all !== undefined) queryParams.set('all', String(all));
            if (with_stats !== undefined) queryParams.set('with_stats', String(with_stats));
            if (first_parent !== undefined) queryParams.set('first_parent', String(first_parent));
            if (order) queryParams.set('order', order);
            if (trailers !== undefined) queryParams.set('trailers', String(trailers));
            if (per_page) queryParams.set('per_page', String(per_page));
            if (page) queryParams.set('page', String(page));

            const apiUrl = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(project_id)}/repository/commits?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case 'get': {
            const { project_id, sha, stats } = input;

            const queryParams = new URLSearchParams();
            if (stats) queryParams.set('stats', 'true');

            const apiUrl = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(project_id)}/repository/commits/${encodeURIComponent(sha)}?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case 'diff': {
            const { project_id, sha, unidiff, per_page, page } = input;
            // `unidiff` landed in GitLab 16.5; before that the headers are added here.
            const nativeUnidiff = instanceAtLeast('16.5');

            const queryParams = new URLSearchParams();
            if (unidiff && nativeUnidiff) queryParams.set('unidiff', 'true');
            if (per_page) queryParams.set('per_page', String(per_page));
            if (page) queryParams.set('page', String(page));

            const apiUrl = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(project_id)}/repository/commits/${encodeURIComponent(sha)}/diff?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const diffs = (await response.json()) as unknown;
            if (!unidiff || nativeUnidiff) return diffs;
            const parsed = CommitDiffsSchema.safeParse(diffs);
            if (!parsed.success) {
              throw new Error(
                `GitLab API error: unexpected commit diff response (${parsed.error.issues[0]?.message ?? 'invalid'})`,
              );
            }
            return parsed.data.map((d) => ({ ...d, diff: withUnifiedHeaders(d) }));
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    'browse_events',
    {
      name: 'browse_events',
      description:
        'Track GitLab activity and events. Actions: user (your activity across all projects), project (specific project activity feed). Filter by date range, action type, or target type.',
      inputSchema: z.toJSONSchema(BrowseEventsSchema),
      requirements: { default: { tier: 'free' } },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseEventsSchema.parse(args);

        assertActionAllowed('browse_events', input.action);

        const buildQueryParams = (opts: {
          target_type?: string;
          event_action?: string;
          before?: string;
          after?: string;
          sort?: string;
          per_page?: number;
          page?: number;
        }) => {
          const queryParams = new URLSearchParams();
          if (opts.target_type) queryParams.set('target_type', opts.target_type);
          if (opts.event_action) queryParams.set('action', opts.event_action);
          if (opts.before) queryParams.set('before', opts.before);
          if (opts.after) queryParams.set('after', opts.after);
          if (opts.sort) queryParams.set('sort', opts.sort);
          if (opts.per_page) queryParams.set('per_page', String(opts.per_page));
          if (opts.page) queryParams.set('page', String(opts.page));
          return queryParams;
        };

        switch (input.action) {
          case 'user': {
            const queryParams = buildQueryParams(input);
            const apiUrl = `${getGitLabBaseUrl()}/api/v4/events?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case 'project': {
            const { project_id } = input;
            const queryParams = buildQueryParams(input);
            const apiUrl = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(project_id)}/events?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    'browse_users',
    {
      name: 'browse_users',
      description:
        'Find GitLab users with smart pattern detection. Actions: search (find users by name/email/username with transliteration support), get (retrieve specific user by ID). Related: browse_members for project/group membership.',
      inputSchema: z.toJSONSchema(BrowseUsersSchema),
      // User-type filters newer than the floor are emulated on older instances (fetchUsers).
      requirements: { default: { tier: 'free' } },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseUsersSchema.parse(args);

        assertActionAllowed('browse_users', input.action);

        switch (input.action) {
          case 'search': {
            const { smart_search, search, username, public_email, ...otherParams } = input;

            const hasUsernameOrEmail = Boolean(username) || Boolean(public_email);
            const hasOnlySearch = Boolean(search) && !hasUsernameOrEmail;
            const shouldUseSmartSearch =
              smart_search === false ? false : smart_search === true || hasOnlySearch;

            if (shouldUseSmartSearch && (search || username || public_email)) {
              const query = search ?? username ?? public_email ?? '';
              const additionalParams: UserSearchParams = {};

              Object.entries(otherParams).forEach(([key, value]) => {
                if (value !== undefined && key !== 'smart_search' && key !== 'action') {
                  additionalParams[key] = value;
                }
              });

              return await smartUserSearch(query, additionalParams);
            } else {
              const { smart_search: _smart, action: _action, ...params } = input;
              const { users, warning } = await fetchUsers(params);
              // The plain list stays the shape; a filter the instance could only
              // partly apply is reported alongside it.
              return warning
                ? { users: cleanGidsFromObject(users), _warning: warning }
                : cleanGidsFromObject(users);
            }
          }

          case 'get': {
            const { user_id } = input;

            const apiUrl = `${getGitLabBaseUrl()}/api/v4/users/${encodeURIComponent(user_id)}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const user = await response.json();
            return cleanGidsFromObject(user);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  [
    'browse_todos',
    {
      name: 'browse_todos',
      description:
        'View your GitLab todo queue (notifications requiring action). Actions: list (filter by state, action type, target type). Todos are auto-created for assignments, mentions, reviews, and pipeline failures. Related: manage_todos to mark done/restore.',
      inputSchema: z.toJSONSchema(BrowseTodosSchema),
      requirements: { default: { tier: 'free' } },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseTodosSchema.parse(args);

        assertActionAllowed('browse_todos', input.action);

        switch (input.action) {
          case 'list': {
            const queryParams = new URLSearchParams();
            const { action: _action, todo_action, ...rest } = input;

            // Map todo_action to API 'action' parameter
            if (todo_action) queryParams.set('action', todo_action);

            Object.entries(rest).forEach(([key, value]) => {
              if (value !== undefined) {
                queryParams.set(key, String(value));
              }
            });

            const apiUrl = `${getGitLabBaseUrl()}/api/v4/todos?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todos = await response.json();
            return cleanGidsFromObject(todos);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // MANAGE TOOLS (write operations)
  // ============================================================================

  [
    'manage_project',
    {
      name: 'manage_project',
      description:
        'Create, update, or manage GitLab projects. Actions: create (new project with settings), fork (copy existing project), update (modify settings, including GitLab Duo settings such as automatic Duo code review; any Duo setting GitLab could not apply is listed in not_applied with what it requires), delete (remove permanently), restore (recover a soft-deleted project before purge), archive/unarchive (toggle read-only), transfer (move to different namespace). Related: browse_projects for discovery, including include_deleted to find restorable projects.',
      inputSchema: z.toJSONSchema(ManageProjectSchema),
      requirements: {
        default: { tier: 'free' },
        parameters: {
          issues_template: { tier: 'premium' },
          merge_requests_template: { tier: 'premium' },
          merge_pipelines_enabled: { tier: 'premium' },
          merge_trains_enabled: { tier: 'premium' },
          only_allow_merge_if_all_status_checks_passed: { tier: 'ultimate' },
          requirements_access_level: { tier: 'ultimate' },
          auto_duo_code_review_enabled: { tier: 'premium', minVersion: '18.0' },
          duo_remote_flows_enabled: { tier: 'premium', minVersion: '18.4' },
          duo_sast_fp_detection_enabled: { tier: 'ultimate', minVersion: '18.7' },
          duo_sast_vr_workflow_enabled: { tier: 'ultimate', minVersion: '18.9' },
          duo_secret_detection_fp_enabled: { tier: 'ultimate', minVersion: '18.10' },
          duo_dependency_bump_breaking_changes_enabled: { tier: 'ultimate', minVersion: '19.2' },
        },
      },
      handler: withSafeProjectResponse(manageProject),
    },
  ],

  [
    'manage_namespace',
    {
      name: 'manage_namespace',
      description:
        'Create, update, or delete GitLab groups/namespaces. Actions: create (new group with visibility/settings), update (modify group settings, including automatic GitLab Duo code review cascading to subgroups and projects; a Duo setting GitLab could not apply is listed in not_applied with what it requires), delete (remove permanently), restore (recover a soft-deleted group before purge; on GitLab Free needs 18.0+). Related: browse_namespaces for discovery.',
      inputSchema: z.toJSONSchema(ManageNamespaceSchema),
      requirements: {
        default: { tier: 'free' },
        parameters: {
          membership_lock: { tier: 'premium' },
          wiki_access_level: { tier: 'premium' },
          ip_restriction_ranges: { tier: 'premium' },
          allowed_email_domains_list: { tier: 'premium', minVersion: '17.4' },
          unique_project_download_limit: { tier: 'ultimate' },
          auto_duo_code_review_enabled: { tier: 'premium', minVersion: '18.7' },
        },
      },
      handler: withSafeProjectResponse(manageNamespace),
    },
  ],

  // ============================================================================
  // TODOS TOOLS
  // ============================================================================

  [
    'manage_todos',
    {
      name: 'manage_todos',
      description:
        'Manage your GitLab todo queue. Actions: mark_done (complete a single todo), mark_all_done (clear entire queue), restore (undo completion). Related: browse_todos to view your todo list.',
      inputSchema: z.toJSONSchema(ManageTodosSchema),
      requirements: { default: { tier: 'free' } },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageTodosSchema.parse(args);

        assertActionAllowed('manage_todos', input.action);

        switch (input.action) {
          case 'mark_done': {
            const apiUrl = `${getGitLabBaseUrl()}/api/v4/todos/${encodeApiSegment(input.id)}/mark_as_done`;
            const response = await enhancedFetch(apiUrl, { method: 'POST' });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todo = await response.json();
            return cleanGidsFromObject(todo);
          }

          case 'mark_all_done': {
            const apiUrl = `${getGitLabBaseUrl()}/api/v4/todos/mark_all_as_done`;
            const response = await enhancedFetch(apiUrl, { method: 'POST' });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return { success: true, message: 'All todos marked as done' };
          }

          case 'restore': {
            const apiUrl = `${getGitLabBaseUrl()}/api/v4/todos/${encodeApiSegment(input.id)}/mark_as_pending`;
            const response = await enhancedFetch(apiUrl, { method: 'POST' });

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            const todo = await response.json();
            return cleanGidsFromObject(todo);
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
export function getCoreReadOnlyToolNames(): string[] {
  return [
    'browse_projects',
    'browse_namespaces',
    'browse_commits',
    'browse_events',
    'browse_users',
    'browse_todos',
  ];
}

/**
 * Get all tool definitions from the registry
 */
export function getCoreToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(coreToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredCoreTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getCoreReadOnlyToolNames();
    return Array.from(coreToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getCoreToolDefinitions();
}
