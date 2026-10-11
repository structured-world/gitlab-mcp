/**
 * Calls under a working scope that one GitLab request cannot answer: listings whose rows
 * are filtered after GitLab paginated them, the projects of a scope made of projects, and
 * mark_all_done, which GitLab would apply to every todo.
 */

import type { EffectivePolicy } from './policy';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import type { ScopeConfig } from '../profiles/types';
import { parseGitLabApiError } from '../utils/error-handler';
import { assertActionAllowed } from '../entities/utils';
import { BrowseProjectsSchema } from '../entities/core/schema-readonly';
import { ManageTodosSchema } from '../entities/core/schema';
import { BrowseSearchSchema } from '../entities/search/schema-readonly';
import {
  isFilteredListing,
  scopedArgs,
  scopedResult,
  scopeProjectsOnly,
  singleTarget,
} from './scope-targets';
import {
  directGroup,
  directGroupSearchRows,
  isScopeVulnerability,
  keepNodes,
  ownedRunnersInScope,
} from './scoped-feeds';

type Args = Record<string, unknown>;
/** Runs one tool call with the caller's instance and token scopes. */
export type RunTool = (tool: string, args: Args) => Promise<unknown>;

/** GitLab's largest page, so a scoped page needs as few requests as possible. */
const UPSTREAM_PAGE_SIZE = 100;
/** Bounds the requests one scoped page may cost: up to 1000 rows read. */
const MAX_UPSTREAM_PAGES = 10;
/** GitLab's own default page size, used when the call names none. */
const DEFAULT_PAGE_SIZE = 20;
/** Listing options a scope made of projects can apply to its projects itself. */
const PROJECT_LIST_OPTIONS = new Set(['action', 'search', 'page', 'per_page', 'simple']);
/** GitLab's simple project representation (BasicProjectDetails), returned unless simple=false. */
const SIMPLE_PROJECT_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'description',
  'name',
  'name_with_namespace',
  'path',
  'path_with_namespace',
  'created_at',
  'default_branch',
  'tag_list',
  'topics',
  'ssh_url_to_repo',
  'http_url_to_repo',
  'web_url',
  'readme_url',
  'forks_count',
  'license_url',
  'license',
  'avatar_url',
  'star_count',
  'last_activity_at',
  'visibility',
  'namespace',
  'custom_attributes',
  'repository_storage',
]);
/** Requests one scoped call keeps in flight, so a large scope stays within rate limits. */
const REQUEST_CONCURRENCY = 5;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value > 0 ? value : fallback;

/** Runs a call for the caller's working scope, narrowing or emulating where needed. */
export async function executeScoped(
  run: RunTool,
  tool: string,
  requested: Args,
  policy: EffectivePolicy,
): Promise<unknown> {
  const { scope, scopeEnforcer } = policy;
  if (!scope || !scopeEnforcer) return run(tool, requested);
  // The emulations below run other actions in place of the requested one; an action the
  // operator denied must stay denied rather than run through them.
  if (typeof requested.action === 'string') assertActionAllowed(tool, requested.action);
  const emulation = emulate(run, tool, requested, scope, scopeEnforcer);
  if (emulation) return emulation;
  const args = scopedArgs(tool, requested, scope);
  const group = directGroup(scope);
  // A group without its subgroups: GitLab's group search covers them, so its rows are kept.
  if (group && tool === 'browse_search' && requested.action === 'global') {
    const keep = await directGroupSearchRows(run, group, args.scope, scopeEnforcer);
    return fillScopedPage(run, tool, args, keep);
  }
  if (isFilteredListing(tool, args)) {
    return fillScopedPage(
      run,
      tool,
      args,
      (rows) => scopedResult(tool, args, rows, scopeEnforcer) as unknown[],
    );
  }
  const result = await run(tool, args);
  if (group && tool === 'browse_vulnerabilities' && requested.group_id === undefined) {
    return keepNodes(result, isScopeVulnerability(scopeEnforcer));
  }
  return isGroupAuditTrail(requested, args) ? groupAuditTrail(result, args.group_id) : result;
}

/**
 * The answer to a call that the scope replaces by other requests, or undefined when the
 * call runs as itself. The call is validated as the tool would validate it first, so an
 * invalid call is refused instead of answered with the scope's data.
 */
function emulate(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  if (tool === 'manage_todos' && requested.action === 'mark_all_done') {
    ManageTodosSchema.parse(requested);
    return markScopeTodosDone(run, enforcer);
  }
  // The caller's own runners stay the feed asked for, kept to those the scope can use.
  const target = singleTarget(scope);
  if (target && tool === 'browse_runners' && requested.action === 'list_owned') {
    return ownedRunnersInScope(run, requested, target);
  }
  const projects = scopeProjectsOnly(scope);
  if (!projects) return undefined;
  if (
    tool === 'browse_projects' &&
    requested.action === 'list' &&
    Object.keys(requested).every((key) => PROJECT_LIST_OPTIONS.has(key))
  ) {
    return listScopeProjects(run, projects, BrowseProjectsSchema.parse(requested));
  }
  // Project search has no projects scope: the scope's projects matching the search answer it.
  if (tool === 'browse_search' && requested.action === 'global' && requested.scope === 'projects') {
    const { search, page, per_page } = BrowseSearchSchema.parse(requested);
    return listScopeProjects(run, projects, { search, page, per_page });
  }
  return undefined;
}

/** An instance audit listing a group scope answered with the group's own audit trail. */
const isGroupAuditTrail = (requested: Args, args: Args): boolean =>
  requested.action === 'list_instance' && args.action === 'list_group';

/**
 * The group's own audit events, marked partial: GitLab keeps the events of the group's
 * projects in each project's trail, which an instance listing would also have shown.
 */
function groupAuditTrail(result: unknown, group: unknown): unknown {
  if (!Array.isArray(result)) return result;
  return {
    items: result,
    partial: true,
    message: `These are the audit events of group '${String(group)}' itself; events of its projects are listed per project with action 'list_project'.`,
  };
}

/**
 * The requested page of a listing filtered to the scope. GitLab paginates before the scope
 * filters, so its pages are read in turn until the scoped page is full or GitLab has no
 * more rows. At most MAX_UPSTREAM_PAGES pages are read for one call; a page still short
 * then is returned as partial, so it is not taken for the end of the results.
 */
async function fillScopedPage(
  run: RunTool,
  tool: string,
  args: Args,
  keep: (rows: unknown[]) => unknown[],
): Promise<unknown> {
  const perPage = numberOr(args.per_page, DEFAULT_PAGE_SIZE);
  const page = numberOr(args.page, 1);
  const wanted = page * perPage;
  const readable = MAX_UPSTREAM_PAGES * UPSTREAM_PAGE_SIZE;
  if ((page - 1) * perPage >= readable) {
    return partialPage(
      [],
      `A scoped listing reads the first ${readable} rows GitLab returns, and page ${page} starts after them.`,
    );
  }
  const rows: unknown[] = [];
  let exhausted = false;
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let upstream = 1; upstream <= MAX_UPSTREAM_PAGES && rows.length < wanted; upstream++) {
    const result = await run(tool, { ...args, page: upstream, per_page: UPSTREAM_PAGE_SIZE });
    if (!Array.isArray(result)) return result;
    rows.push(...keep(result));
    exhausted = result.length < UPSTREAM_PAGE_SIZE;
    if (exhausted) break;
  }
  const items = rows.slice((page - 1) * perPage, wanted);
  if (exhausted || rows.length >= wanted) return items;
  return partialPage(
    items,
    `Read the first ${readable} rows GitLab returned and found ${rows.length} in the working scope; more may follow.`,
  );
}

/** A scoped page the bounded read could not fill, so it is not taken for the end. */
function partialPage(items: unknown[], reason: string): unknown {
  return {
    items,
    partial: true,
    message: `${reason} Narrow the listing (for example with a search) to see the rest.`,
  };
}

/**
 * browse_projects list for a scope made of projects: the projects themselves, filtered by
 * the listing's search and paged like it. A project GitLab no longer has (404) is left
 * out; any other failure fails the call rather than returning a shorter list.
 */
async function listScopeProjects(
  run: RunTool,
  projects: string[],
  requested: Args,
): Promise<unknown[]> {
  const search = typeof requested.search === 'string' ? requested.search.toLowerCase() : '';
  const matches = (project: unknown): boolean => {
    if (project === undefined) return false;
    if (!search) return true;
    const { name, path_with_namespace } = project as {
      name?: unknown;
      path_with_namespace?: unknown;
    };
    return [name, path_with_namespace].some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(search),
    );
  };
  const perPage = numberOr(requested.per_page, DEFAULT_PAGE_SIZE);
  const page = numberOr(requested.page, 1);
  const wanted = page * perPage;
  const matching: unknown[] = [];
  // A few projects at a time, in the scope's order, and only until the page is full: a
  // large scope must not send a request per project for a small page.
  for (
    let start = 0;
    start < projects.length && matching.length < wanted;
    start += REQUEST_CONCURRENCY
  ) {
    const batch = await Promise.all(
      projects.slice(start, start + REQUEST_CONCURRENCY).map((project_id) =>
        run('browse_projects', { action: 'get', project_id }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (parseGitLabApiError(message)?.status === 404) return undefined;
          throw error;
        }),
      ),
    );
    matching.push(...batch.filter(matches));
  }
  const listed = matching.slice((page - 1) * perPage, wanted);
  // A project is read in full; a listing answers with the simple representation unless
  // simple=false, as GitLab does (its schema default is true).
  return requested.simple === false ? listed : listed.map(simpleProject);
}

function simpleProject(project: unknown): unknown {
  return Object.fromEntries(
    Object.entries(project as Record<string, unknown>).filter(([key]) =>
      SIMPLE_PROJECT_FIELDS.has(key),
    ),
  );
}

/**
 * mark_all_done for a scoped chat: GitLab's own would also clear todos outside the scope,
 * so the scope's pending todos are marked done one by one.
 */
async function markScopeTodosDone(run: RunTool, enforcer: ScopeEnforcer): Promise<unknown> {
  // Collected before marking: a todo marked done leaves the pending pages being read.
  const ids: unknown[] = [];
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let page = 1; ; page++) {
    const todos = await run('browse_todos', {
      action: 'list',
      state: 'pending',
      per_page: UPSTREAM_PAGE_SIZE,
      page,
    });
    if (!Array.isArray(todos)) break;
    const inScope = scopedResult('browse_todos', { action: 'list' }, todos, enforcer) as Array<{
      id?: unknown;
    }>;
    for (const todo of inScope) ids.push(todo.id);
    if (todos.length < UPSTREAM_PAGE_SIZE) break;
  }
  // A few requests at a time, so a large scope does not run into GitLab's rate limits;
  // a todo that fails is reported and the rest are still marked.
  const failed: Array<{ id: unknown; error: string }> = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next++];
      await run('manage_todos', { action: 'mark_done', id }).catch((error: unknown) => {
        failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(REQUEST_CONCURRENCY, ids.length) }, worker));
  const marked = ids.length - failed.length;
  const failedNote = failed.length > 0 ? `; ${failed.length} could not be marked` : '';
  return {
    success: failed.length === 0,
    marked,
    failed,
    message: `Marked ${marked} of ${ids.length} todos of the working scope as done${failedNote}; todos outside it were left pending`,
  };
}
