/**
 * Calls under a working scope that one GitLab request cannot answer: listings whose rows
 * are filtered after GitLab paginated them, the projects of a scope made of projects, and
 * mark_all_done, which GitLab would apply to every todo.
 */

import type { EffectivePolicy } from './policy';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import type { ScopeConfig } from '../profiles/types';
import { parseGitLabApiError } from '../utils/error-handler';
import { mapBounded } from '../utils/bounded-map';
import { assertActionAllowed } from '../entities/utils';
import { withTargetPaths } from './scope-ids';
import { matchesScopeProject, readScopeProject, simpleProject } from './scope-projects';
import {
  multiTargetRunners,
  multiTargetSearch,
  multiTargetVulnerabilities,
  scopeAuditEvents,
  scopeProjectSnippets,
  scopeSnippetTitleSearch,
} from './composed-feeds';
import type { ZodType } from 'zod';
import {
  BrowseEventsSchema,
  BrowseNamespacesSchema,
  BrowseProjectsSchema,
  BrowseTodosSchema,
} from '../entities/core/schema-readonly';
import { ManageProjectSchema, ManageTodosSchema } from '../entities/core/schema';
import { BrowseSearchSchema } from '../entities/search/schema-readonly';
import { BrowseMergeRequestsSchema } from '../entities/mrs/schema-readonly';
import { BrowseRunnersSchema } from '../entities/runners/schema-readonly';
import { BrowseVulnerabilitiesSchema } from '../entities/vulnerabilities/schema-readonly';
import { BrowseAuditEventsSchema } from '../entities/audit_events/schema-readonly';
import { BrowseDeployKeysSchema } from '../entities/deploy-keys/schema-readonly';
import { BrowseSnippetsSchema } from '../entities/snippets/schema-readonly';
import {
  COMPOSED_SEARCH_SCOPES,
  isFilteredListing,
  scopedArgs,
  scopedResult,
  scopeProjectsOnly,
  scopeTargets,
  singleTarget,
  type Target,
} from './scope-targets';
import {
  DIRECT_PROJECTS_READ,
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
/** The input schemas of the tools whose calls the scope rewrites, filters or emulates. */
const SCOPED_TOOL_SCHEMAS: Readonly<Record<string, ZodType>> = {
  browse_projects: BrowseProjectsSchema,
  browse_search: BrowseSearchSchema,
  browse_merge_requests: BrowseMergeRequestsSchema,
  browse_todos: BrowseTodosSchema,
  manage_todos: ManageTodosSchema,
  browse_namespaces: BrowseNamespacesSchema,
  browse_events: BrowseEventsSchema,
  browse_deploy_keys: BrowseDeployKeysSchema,
  browse_snippets: BrowseSnippetsSchema,
  browse_runners: BrowseRunnersSchema,
  browse_audit_events: BrowseAuditEventsSchema,
  browse_vulnerabilities: BrowseVulnerabilitiesSchema,
  manage_project: ManageProjectSchema,
};
/** Requests one scoped call keeps in flight, so a large scope stays within rate limits. */
const REQUEST_CONCURRENCY = 5;

/** The selected action's validated arguments, shared by scope preflight and execution. */
export function parseScopedArguments(tool: string, requested: Args): Args {
  const schema = SCOPED_TOOL_SCHEMAS[tool];
  return schema ? (schema.parse(requested) as Args) : requested;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value > 0 ? value : fallback;

/** Runs a call for the caller's working scope, narrowing or emulating where needed. */
export async function executeScoped(
  unguarded: RunTool,
  tool: string,
  requested: Args,
  policy: EffectivePolicy,
  validated = false,
): Promise<unknown> {
  const { scope, scopeEnforcer } = policy;
  if (!scope || !scopeEnforcer) return unguarded(tool, requested);
  // The emulations below run other actions in place of the requested one; an action the
  // operator or the preset denied must stay denied rather than run through them.
  if (typeof requested.action === 'string') assertActionAllowed(tool, requested.action);
  const run = withPresetDenials(unguarded, policy);
  // Read as the tool reads it, before anything is rewritten or paged: a scoped call is
  // validated and coerced exactly like an unscoped one, and an invalid call is refused.
  const call = validated ? requested : parseScopedArguments(tool, requested);
  const emulation = emulate(run, tool, call, scope, scopeEnforcer);
  if (emulation) return emulation;
  const args = scopedArgs(tool, call, scope);
  const group = directGroup(scope);
  // A group without its subgroups: GitLab's group search covers them, so its rows are kept.
  // A group search can only name the scope group itself, as its subgroups are outside.
  if (group && tool === 'browse_search' && (call.action === 'global' || call.action === 'group')) {
    return directGroupSearch(run, args, group, scopeEnforcer);
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
  // The group's vulnerabilities cover its subgroups, whether the scope or the caller named it.
  if (
    group &&
    tool === 'browse_vulnerabilities' &&
    args.action === 'list' &&
    args.project_id === undefined
  ) {
    return keepNodes(result, isScopeVulnerability(scopeEnforcer));
  }
  return result;
}

/** A request an emulation needs that the preset denies; it fails the whole call. */
class PresetDeniedActionError extends Error {}

/** Runs only actions the preset allows; the operator's denials are checked by the tools. */
function withPresetDenials(run: RunTool, policy: EffectivePolicy): RunTool {
  return (tool, args) => {
    const action = typeof args.action === 'string' ? args.action : undefined;
    if (action !== undefined && policy.deniedActions.get(tool)?.has(action)) {
      return Promise.reject(
        new PresetDeniedActionError(
          `preset '${policy.presetName}' denies the '${action}' action of ${tool}, which this call runs under the working scope`,
        ),
      );
    }
    return run(tool, args);
  };
}

/**
 * A global or group search under a group scope without subgroups: the group search, its rows kept to
 * the group and its direct projects and paged like the search, in the search's answer shape.
 */
async function directGroupSearch(
  run: RunTool,
  args: Args,
  group: string,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const { keep, complete } = await directGroupSearchRows(run, group, args.scope, enforcer, {
    requests: 0,
  });
  // The search tool answers with its rows under `results`.
  const rows: RunTool = async (tool, toolArgs) => {
    const answer = await run(tool, toolArgs);
    const results = (answer as { results?: unknown } | undefined)?.results;
    return Array.isArray(results) ? results : answer;
  };
  const page = await fillScopedPage(rows, 'browse_search', args, keep);
  const marked = complete
    ? page
    : withPartialReason(
        page,
        `Results are kept to the first ${DIRECT_PROJECTS_READ} direct projects of group '${group}'; results of its other projects are not shown.`,
      );
  return searchAnswer(marked, { group_id: args.group_id, scope: args.scope });
}

/**
 * A scoped page in the search tool's answer shape (`count` and `results`, beside what the
 * search was for), keeping a partial page's reason. Anything else passes as it came.
 */
function searchAnswer(page: unknown, about: Args): unknown {
  if (Array.isArray(page)) return { ...about, count: page.length, results: page };
  const partial = page as { items?: unknown; partial?: unknown; message?: unknown } | undefined;
  if (partial?.partial !== true || !Array.isArray(partial.items)) return page;
  return {
    ...about,
    count: partial.items.length,
    results: partial.items,
    partial: true,
    message: partial.message,
  };
}

/**
 * The answer to a call that the scope replaces by other requests, or undefined when the
 * call runs as itself. The call has been validated as the tool validates it.
 */
function emulate(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  const instanceOnly = emulateInstanceOnly(run, tool, requested, scope, enforcer);
  if (instanceOnly) return instanceOnly;
  const target = singleTarget(scope);
  // One project's trail and snippets are its own listings; other scopes read their places'.
  const placed =
    target && 'project' in target
      ? undefined
      : emulateScopePlaces(run, tool, requested, scope, enforcer);
  if (placed) return placed;
  const composed = target ? undefined : emulateMultiTarget(run, tool, requested, scope, enforcer);
  if (composed) return composed;
  return (
    emulateTargetFeed(run, tool, requested, scope, enforcer) ??
    emulateScopeProjects(run, tool, requested, scope)
  );
}

/** Calls GitLab answers only for everything the account sees, answered from the scope. */
function emulateInstanceOnly(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  if (tool === 'manage_todos' && requested.action === 'mark_all_done') {
    return markScopeTodosDone(run, scope, enforcer);
  }
  // A project search has no groups scope, and a group search only from GitLab 19.4: the
  // scope's groups matching the search answer it, read from the namespace listing.
  if (tool === 'browse_search' && requested.action === 'global' && requested.scope === 'groups') {
    return scopeGroupSearch(run, requested, enforcer);
  }
  // Snippet titles are searched, and audit events filtered by entity, only across the
  // instance: every scope, one project too, answers them from its own places.
  if (
    tool === 'browse_search' &&
    requested.action === 'global' &&
    requested.scope === 'snippet_titles'
  ) {
    return scopeSnippetTitleSearch(run, requested, scope, enforcer).then((found) =>
      searchAnswer(found, { scope: 'snippet_titles' }),
    );
  }
  if (
    tool === 'browse_audit_events' &&
    requested.action === 'list_instance' &&
    (requested.entity_type !== undefined || requested.entity_id !== undefined)
  ) {
    return scopeAuditEvents(run, requested, scope, enforcer);
  }
  return undefined;
}

/** Project listings and searches under a scope made of projects, read from its projects. */
function emulateScopeProjects(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
): Promise<unknown> | undefined {
  const projects = scopeProjectsOnly(scope);
  if (!projects) return undefined;
  if (
    tool === 'browse_projects' &&
    requested.action === 'list' &&
    Object.keys(requested).every((key) => PROJECT_LIST_OPTIONS.has(key))
  ) {
    return listScopeProjects(run, projects, requested);
  }
  // Project search has no projects scope: search the selected projects themselves.
  if (isProjectSearch(tool, requested)) {
    const { search, page, per_page, sort, order_by } = requested;
    return listScopeProjects(run, projects, { search, page, per_page, sort, order_by }).then(
      (found) => searchAnswer(found, { scope: 'projects' }),
    );
  }
  return undefined;
}

/** Targetless listings under a scope of several projects or groups, composed per target. */
function emulateMultiTarget(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  if (
    tool === 'browse_vulnerabilities' &&
    requested.action === 'list' &&
    requested.project_id === undefined &&
    requested.group_id === undefined
  ) {
    return multiTargetVulnerabilities(run, requested, scope, enforcer);
  }
  if (
    tool === 'browse_runners' &&
    (requested.action === 'list_owned' || requested.action === 'list_all')
  ) {
    return multiTargetRunners(run, requested, scope);
  }
  // A scope made of projects only answers a search of projects from its projects' listing.
  if (
    isComposedSearch(tool, requested) ||
    (isProjectSearch(tool, requested) && !scopeProjectsOnly(scope))
  ) {
    return multiTargetSearch(run, requested, scope, enforcer);
  }
  if (isScopeKeyListing(tool, requested)) {
    return scopeDeployKeys(run, requested, scope, enforcer);
  }
  return undefined;
}

/**
 * Listings GitLab keeps per project or per group, read from each place of the scope: the
 * instance audit trail and project snippets that name no project.
 */
function emulateScopePlaces(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  if (tool === 'browse_audit_events' && requested.action === 'list_instance') {
    return scopeAuditEvents(run, requested, scope, enforcer);
  }
  if (
    tool === 'browse_snippets' &&
    requested.action === 'list' &&
    requested.scope === 'project' &&
    !requested.projectId
  ) {
    return scopeProjectSnippets(run, requested, scope, enforcer);
  }
  return undefined;
}

/** A global search every target answers itself, composed under several targets. */
const isComposedSearch = (tool: string, requested: Args): boolean =>
  tool === 'browse_search' &&
  requested.action === 'global' &&
  COMPOSED_SEARCH_SCOPES.has(requested.scope as string);

/** A global search of projects, which a project's own search does not offer. */
const isProjectSearch = (tool: string, requested: Args): boolean =>
  tool === 'browse_search' && requested.action === 'global' && requested.scope === 'projects';

/** A deploy key listing that names no project; the public listing is instance-wide only. */
const isScopeKeyListing = (tool: string, requested: Args): boolean =>
  tool === 'browse_deploy_keys' &&
  requested.action === 'list' &&
  requested.project_id === undefined &&
  requested.public !== true;

/** Feeds whose result needs the scope's project or group membership. */
function emulateTargetFeed(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> | undefined {
  const target = singleTarget(scope);
  // The caller's own runners stay the feed asked for, kept to those the scope can use.
  if (target && tool === 'browse_runners' && requested.action === 'list_owned') {
    return ownedRunnersInScope(run, requested, target);
  }
  if (tool === 'browse_events' && requested.action === 'user' && (!target || 'group' in target)) {
    return userEventsInScope(run, requested, enforcer);
  }
  // A single project's keys are its own listing; a group's are composed from its projects.
  if (target && 'group' in target && isScopeKeyListing(tool, requested)) {
    return scopeDeployKeys(run, requested, scope, enforcer);
  }
  return undefined;
}

/**
 * A search of groups answered by the scope's groups whose name or path match, in the
 * search's order: newest first, or oldest first for `sort: asc`. Groups get their IDs in
 * creation order, so creation order is ID order; the namespace listing has its own order,
 * so the matching groups are read in full (up to 1000 listed) and ordered before paging.
 */
async function scopeGroupSearch(
  run: RunTool,
  requested: Args,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const read = await readScopeGroups(run, requested.search, enforcer);
  if ('answer' in read) return read.answer;
  const { groups } = read;
  const reasons: string[] = [];
  if (!orderGroupsByCreation(groups, requested.sort === 'asc'))
    reasons.push('GitLab omitted the ID of some groups, so they keep the listing order.');
  if (requested.order_by === 'updated_at')
    reasons.push(
      'Groups are listed without their update time, so updated_at ordering is replaced by creation order.',
    );
  if (!read.exhausted)
    reasons.push(
      `Only the first ${MAX_UPSTREAM_PAGES * UPSTREAM_PAGE_SIZE} namespaces matching the search were read; narrow the search.`,
    );
  const perPage = numberOr(requested.per_page, DEFAULT_PAGE_SIZE);
  const start = (numberOr(requested.page, 1) - 1) * perPage;
  const items = groups.slice(start, start + perPage);
  const page = reasons.length === 0 ? items : partialPage(items, reasons.join(' '));
  return searchAnswer(page, { scope: 'groups' });
}

/** The scope's groups matching a search, from up to MAX_UPSTREAM_PAGES namespace pages. */
async function readScopeGroups(
  run: RunTool,
  search: unknown,
  enforcer: ScopeEnforcer,
): Promise<{ groups: Args[]; exhausted: boolean } | { answer: unknown }> {
  const listing: Args = { action: 'list', search };
  const groups: Args[] = [];
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let upstream = 1; upstream <= MAX_UPSTREAM_PAGES; upstream++) {
    const rows = await run('browse_namespaces', {
      ...listing,
      page: upstream,
      per_page: UPSTREAM_PAGE_SIZE,
    });
    if (!Array.isArray(rows)) return { answer: rows };
    for (const namespace of scopedResult('browse_namespaces', listing, rows, enforcer) as Args[])
      if (namespace.kind === 'group') groups.push(namespace);
    if (rows.length < UPSTREAM_PAGE_SIZE) return { groups, exhausted: true };
  }
  return { groups, exhausted: false };
}

/** Orders groups by creation (their IDs); false when some group has no numeric ID. */
function orderGroupsByCreation(groups: Args[], ascending: boolean): boolean {
  if (!groups.every((group) => typeof group.id === 'number')) return false;
  const direction = ascending ? 1 : -1;
  groups.sort((a, b) => ((a.id as number) - (b.id as number)) * direction);
  return true;
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
  keep: (rows: unknown[]) => unknown[] | Promise<unknown[]>,
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
    rows.push(...(await keep(result)));
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

/** User activity kept to allowed projects, with request-local ID resolution and a hard lookup bound. */
async function userEventsInScope(
  run: RunTool,
  requested: Args,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const paths = new Map<string, string | undefined>();
  const lookupLimit = UPSTREAM_PAGE_SIZE;
  let complete = true;
  const idOf = (row: unknown): string | undefined => {
    const value = (row as Args)?.project_id;
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value)))
      return undefined;
    return String(value);
  };
  const keep = async (rows: unknown[]): Promise<unknown[]> => {
    const pending: string[] = [];
    for (const row of rows) {
      const id = idOf(row);
      if (id === undefined || paths.has(id) || enforcer.listsId(id, 'project')) continue;
      if (paths.size === lookupLimit) {
        complete = false;
        continue;
      }
      paths.set(id, undefined);
      pending.push(id);
    }
    await mapBounded(pending, REQUEST_CONCURRENCY, async (id) => {
      const resolved = await withTargetPaths({ project_id: id });
      const path = resolved.project_id;
      if (typeof path === 'string' && !/^\d+$/.test(path)) paths.set(id, path);
    });
    return rows.filter((row) => {
      const id = idOf(row);
      if (id === undefined) return false;
      if (enforcer.listsId(id, 'project')) return true;
      const path = paths.get(id);
      return path !== undefined && enforcer.isAllowed(path);
    });
  };
  const result = await fillScopedPage(run, 'browse_events', requested, keep);
  return complete
    ? result
    : withPartialReason(
        result,
        `Activity was checked against at most ${lookupLimit} distinct projects; unchecked events are omitted.`,
      );
}

/**
 * A deduplicated page of the keys of the scope's projects: those it names and those of its
 * groups, bounded across both the project and the key feeds.
 */
async function scopeDeployKeys(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const page = numberOr(requested.page, 1),
    perPage = numberOr(requested.per_page, DEFAULT_PAGE_SIZE);
  const wanted = page * perPage;
  const readable = MAX_UPSTREAM_PAGES * UPSTREAM_PAGE_SIZE;
  if ((page - 1) * perPage >= readable)
    return partialPage([], `Requested page starts past the ${readable}-key read bound.`);
  const projects = await scopeKeyProjects(run, scope, enforcer);
  if ('answer' in projects) return projects.answer;
  const keys: unknown[] = [];
  const seen = new Set<unknown>();
  let requests = 0;
  const iterator = projects.paths.values();
  let project = iterator.next();
  let upstream = 1;
  while (!project.done && keys.length < wanted) {
    if (requests === MAX_UPSTREAM_PAGES)
      return partialPage(
        keys.slice((page - 1) * perPage, wanted),
        'Reached the key request bound before reading all scope projects.',
      );
    requests++;
    const rows = await run('browse_deploy_keys', {
      action: 'list',
      project_id: project.value,
      page: upstream,
      per_page: UPSTREAM_PAGE_SIZE,
    });
    if (!Array.isArray(rows)) return rows;
    appendUniqueKeys(rows, seen, keys);
    if (rows.length < UPSTREAM_PAGE_SIZE) {
      project = iterator.next();
      upstream = 1;
    } else upstream++;
  }
  const result = keys.slice((page - 1) * perPage, wanted);
  return projects.complete
    ? result
    : partialPage(
        result,
        'Keys cover only the scope projects read within the project listing bound.',
      );
}

/**
 * The scope's projects for a key listing: the projects it names, then each group's own
 * projects, the group listings sharing one page bound.
 */
async function scopeKeyProjects(
  run: RunTool,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<{ paths: Set<string>; complete: boolean } | { answer: unknown }> {
  const paths = new Set<string>();
  const budget = { pages: 0 };
  // Groups are listed in turn: they share one page bound.
  for (const target of scopeTargets(scope)) {
    if ('project' in target) {
      paths.add(target.project);
      continue;
    }
    const listed = await groupProjects(run, target, enforcer, paths, budget);
    if (listed !== true) return listed === false ? { paths, complete: false } : listed;
  }
  return { paths, complete: true };
}

function appendUniqueKeys(rows: unknown[], seen: Set<unknown>, keys: unknown[]): void {
  for (const row of rows) {
    const id = (row as Args).id;
    if (!seen.has(id)) {
      seen.add(id);
      keys.push(row);
    }
  }
}

/**
 * Adds the paths the group owns, excluding projects only shared into it: true once the
 * group is listed to its end, false when the shared page bound stops it first.
 */
async function groupProjects(
  run: RunTool,
  target: { group: string; subgroups: boolean },
  enforcer: ScopeEnforcer,
  projects: Set<string>,
  budget: { pages: number },
): Promise<boolean | { answer: unknown }> {
  let upstream = 0;
  while (budget.pages < MAX_UPSTREAM_PAGES) {
    budget.pages++;
    upstream++;
    const rows = await run('browse_projects', {
      action: 'list',
      group_id: target.group,
      include_subgroups: target.subgroups,
      page: upstream,
      per_page: UPSTREAM_PAGE_SIZE,
    });
    if (!Array.isArray(rows)) return { answer: rows };
    for (const row of rows) {
      const path = (row as Args).path_with_namespace;
      if (typeof path === 'string' && enforcer.isAllowed(path)) projects.add(path);
    }
    if (rows.length < UPSTREAM_PAGE_SIZE) return true;
  }
  return false;
}

/** A scoped page the bounded read could not fill, so it is not taken for the end. */
function partialPage(items: unknown[], reason: string): unknown {
  return {
    items,
    partial: true,
    message: `${reason} Narrow the listing (for example with a search) to see the rest.`,
  };
}

/** A scoped page marked partial for one more reason, whether or not it already was. */
function withPartialReason(page: unknown, reason: string): unknown {
  if (Array.isArray(page)) return partialPage(page, reason);
  const partial = page as { items?: unknown; partial?: unknown; message?: unknown };
  if (partial?.partial !== true || !Array.isArray(partial.items)) return page;
  return { ...partial, message: `${reason} ${String(partial.message)}` };
}

/**
 * browse_projects list for a scope made of projects: the projects themselves, filtered by
 * the listing's search, ordered as GitLab orders it (newest created first unless the call
 * names an order) and paged like it, from at most 1000 of them. Archived projects are left out, as a plain listing
 * and GitLab's project search leave them out. A project GitLab no longer has (404) is left
 * out; any other failure fails the call rather than returning a shorter list.
 */
async function listScopeProjects(
  run: RunTool,
  projects: string[],
  requested: Args,
): Promise<unknown> {
  const search = typeof requested.search === 'string' ? requested.search.toLowerCase() : '';
  const perPage = numberOr(requested.per_page, DEFAULT_PAGE_SIZE);
  const page = numberOr(requested.page, 1);
  const wanted = page * perPage;
  const matching: unknown[] = [];
  const limit = Math.min(projects.length, MAX_UPSTREAM_PAGES * UPSTREAM_PAGE_SIZE);
  // GitLab orders a listing and a search newest first when no order is named, so any page
  // needs every project read and ordered first; a few at a time stays within rate limits.
  for (let start = 0; start < limit; start += REQUEST_CONCURRENCY) {
    const batch = await Promise.all(
      projects
        .slice(start, Math.min(start + REQUEST_CONCURRENCY, limit))
        .map((project_id) => readScopeProject(run, project_id)),
    );
    matching.push(...batch.filter((project) => matchesScopeProject(project, search)));
  }
  const missingSortField = !orderScopeProjects(matching, requested);
  const listed = matching.slice((page - 1) * perPage, wanted);
  // A project is read in full; a listing answers with the simple representation unless
  // simple=false, as GitLab does (its schema default is true).
  const result = requested.simple === false ? listed : listed.map(simpleProject);
  if (missingSortField)
    return partialPage(
      result,
      'GitLab omitted the requested ordering field; results retain scope order.',
    );
  if (limit < projects.length)
    return partialPage(
      result,
      `Sorted matches from the first ${limit} scope projects; other projects were not read.`,
    );
  return result;
}

/** Sort the owned match array without copying it; false means GitLab omitted the required field. */
function orderScopeProjects(matching: unknown[], requested: Args): boolean {
  // Search API basic ordering: created_at/descending when that part is omitted.
  // https://docs.gitlab.com/api/search/#search-an-instance
  const field = requested.order_by === 'updated_at' ? 'updated_at' : 'created_at';
  // A single match is in order whatever GitLab reported for it.
  if (matching.length < 2) return true;
  if (matching.some((row) => typeof (row as Args)[field] !== 'string')) return false;
  matching.sort((a, b) => {
    const left = (a as Args)[field] as string,
      right = (b as Args)[field] as string;
    if (left === right) return 0;
    const order = left < right ? -1 : 1;
    return requested.sort === 'asc' ? order : -order;
  });
  return true;
}

/**
 * mark_all_done for a scoped chat: GitLab's own would also clear todos outside the scope,
 * so the scope's pending todos are marked done one by one. Each project or group of the
 * scope has its todos read with GitLab's own filter, so todos outside the scope never fill
 * the pages read. One call marks at most UPSTREAM_PAGE_SIZE todos, so it finishes within the
 * handler timeout; marked todos leave the pending feed, so a repeated call continues where
 * this one stopped.
 */
async function markScopeTodosDone(
  run: RunTool,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const filters = await mapBounded(uniqueTargets(scope), REQUEST_CONCURRENCY, (target) =>
    todoFilter(run, target),
  );
  // Collected before marking: a todo marked done leaves the pending pages being read.
  const ids = new Set<unknown>();
  // Every target's first page is read, so each call reaches every target; only a group
  // without its subgroups, whose filter also lists theirs, needs pages past its first.
  const furtherPages = { left: MAX_UPSTREAM_PAGES };
  let reason: string | undefined;
  // Targets are read one after another: whether the next one is needed depends on this one.
  for (const filter of filters) {
    if (filter === undefined) continue;
    reason = await collectTargetTodos(run, filter, enforcer, ids, furtherPages);
    if (reason) break;
  }
  // A few requests at a time, so a large scope does not run into GitLab's rate limits;
  // a todo that fails is reported and the rest are still marked.
  const failed: Array<{ id: unknown; error: string }> = [];
  await mapBounded([...ids], REQUEST_CONCURRENCY, (id) =>
    run('manage_todos', { action: 'mark_done', id }).catch((error: unknown) => {
      // A denied action fails every todo alike: the call is refused rather than reported.
      if (error instanceof PresetDeniedActionError) throw error;
      failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }),
  );
  const marked = ids.size - failed.length;
  const failedNote = failed.length > 0 ? `; ${failed.length} could not be marked` : '';
  const message = `Marked ${marked} of ${ids.size} todos of the working scope as done${failedNote}; todos outside it were left pending`;
  return {
    success: failed.length === 0,
    marked,
    failed,
    ...(reason ? { partial: true, message: `${message}. ${reason}` } : { message }),
  };
}

/**
 * Adds one target's pending todos of the scope to `ids`, up to UPSTREAM_PAGE_SIZE; why it
 * stopped before the target's last todo, if it did. A todo of a project inside a group of the
 * scope is listed for both and kept once.
 */
async function collectTargetTodos(
  run: RunTool,
  filter: Args,
  enforcer: ScopeEnforcer,
  ids: Set<unknown>,
  furtherPages: { left: number },
): Promise<string | undefined> {
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let page = 1; ; page++) {
    if (page > 1 && furtherPages.left-- === 0)
      return `Todos of subgroups outside the working scope filled the ${MAX_UPSTREAM_PAGES * UPSTREAM_PAGE_SIZE} pending todos read past each group's first page; any scope todos after them are still pending.`;
    const todos = await run('browse_todos', {
      action: 'list',
      state: 'pending',
      per_page: UPSTREAM_PAGE_SIZE,
      page,
      ...filter,
    });
    if (!Array.isArray(todos)) return undefined;
    const inScope = scopedResult('browse_todos', { action: 'list' }, todos, enforcer) as Array<{
      id?: unknown;
    }>;
    if (!addTodoIds(inScope, ids))
      return `One call marks at most ${UPSTREAM_PAGE_SIZE} todos; call mark_all_done again to mark the rest.`;
    if (todos.length < UPSTREAM_PAGE_SIZE) return undefined;
  }
}

/** Adds the todos' ids not seen yet; false when one did not fit within a call's limit. */
function addTodoIds(todos: Array<{ id?: unknown }>, ids: Set<unknown>): boolean {
  for (const { id } of todos) {
    if (ids.has(id)) continue;
    if (ids.size === UPSTREAM_PAGE_SIZE) return false;
    ids.add(id);
  }
  return true;
}

/** The scope's projects and groups, each once however often a preset names it. */
function uniqueTargets(scope: ScopeConfig): Target[] {
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const target of scopeTargets(scope)) {
    const key = 'project' in target ? `p:${target.project}` : `g:${target.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

/**
 * The todo listing's filter for one target: GitLab filters todos by numeric project or group
 * id only (lib/api/todos.rb), so the target is read for its id. A target GitLab no longer
 * knows has no todos to read.
 */
async function todoFilter(run: RunTool, target: Target): Promise<Args | undefined> {
  const [tool, args, filter] =
    'project' in target
      ? ['browse_projects', { action: 'get', project_id: target.project }, 'project_id']
      : ['browse_namespaces', { action: 'get', namespace_id: target.group }, 'group_id'];
  try {
    const id = ((await run(tool, args)) as Args | undefined)?.id;
    return typeof id === 'number' ? { [filter]: id } : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (parseGitLabApiError(message)?.status === 404) return undefined;
    throw error;
  }
}
