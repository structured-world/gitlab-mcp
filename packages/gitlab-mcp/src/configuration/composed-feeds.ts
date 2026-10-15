/** Multiple scope targets share one request budget, not a budget per target. */
import type { ScopeConfig } from '../profiles/types';
import type { RunTool } from './scoped-execution';
import {
  keepNodes,
  isScopeVulnerability,
  directGroupSearchRows,
  type KeepRows,
} from './scoped-feeds';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import { createHash } from 'node:crypto';
import { parseGitLabApiError } from '../utils/error-handler';
import { scopeTargets, type Target } from './scope-targets';
import { matchesScopeProject, readScopeProject, simpleProject } from './scope-projects';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;
const MAX_REQUESTS = 10;
const PAGE_SIZE = 100;

/** Requests made so far for one call, shared by all of its targets. */
interface Budget {
  requests: number;
}
/** `more`: a target was read only as far as the page needs and has further rows. */
type ScanResult = { complete: boolean; more?: boolean; answer?: unknown };
type PageInfo = { hasNextPage?: boolean; endCursor?: unknown };
/** Counts the rows of a page that rank in the composed listing. */
type Visit = (rows: Row[]) => number;

/** The listing action a target's connection is read with. */
function connectionAction(tool: string, target: Args): string {
  if (tool !== 'browse_runners') return 'list';
  return 'group_id' in target ? 'list_group' : 'list_project';
}

/** The next page's cursor, null at the end, undefined when GitLab gave no usable cursor. */
function nextCursor(
  nodes: unknown[],
  pageInfo: PageInfo | undefined,
  after: string | undefined,
): string | null | undefined {
  if (pageInfo?.hasNextPage === false || (!pageInfo && nodes.length === 0)) return null;
  const cursor = pageInfo?.endCursor;
  if (pageInfo?.hasNextPage !== true || typeof cursor !== 'string' || !cursor || cursor === after)
    return undefined;
  return cursor;
}

/**
 * Page one target's connection until it ends or `wanted` of its rows rank; the stopping result
 * when it cannot be read that far.
 */
async function scanTargetConnection(
  run: RunTool,
  tool: string,
  args: Args,
  budget: Budget & { more: boolean },
  visit: Visit,
  wanted: number,
): Promise<ScanResult | undefined> {
  let after: string | undefined;
  let ranked = 0;
  for (;;) {
    if (budget.requests === MAX_REQUESTS) return { complete: false };
    budget.requests++;
    const answer = await run(tool, {
      ...args,
      first: PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    });
    const connection = answer as { nodes?: unknown; pageInfo?: PageInfo } | null;
    if (!Array.isArray(connection?.nodes)) return { complete: false, answer };
    if (connection.nodes.length > PAGE_SIZE)
      throw new Error('GitLab returned an oversized scoped connection page');
    ranked += visit(connection.nodes as Row[]);
    const cursor = nextCursor(connection.nodes, connection.pageInfo, after);
    if (cursor === null) return undefined;
    // The target lists in the composed order: its later rows rank after those the page needs.
    if (ranked >= wanted) {
      budget.more = true;
      return undefined;
    }
    if (cursor === undefined) return { complete: false };
    after = cursor;
  }
}

/**
 * Visit at most ten connection pages across the entire scope; upstream errors propagate. With
 * `wanted`, each target is read only until that many of its rows rank: the first `wanted` rows
 * of a merge of listings in one order include at most `wanted` from each listing.
 */
export async function scanScopeConnections(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  visit: Visit,
  wanted = Number.POSITIVE_INFINITY,
): Promise<ScanResult> {
  const { after: _after, first: _first, ...filters } = requested;
  const seen = new Set<string>();
  const budget = { requests: 0, more: false };
  const result = (scan: ScanResult): ScanResult => (budget.more ? { ...scan, more: true } : scan);
  // Targets are read in turn: they share one request budget.
  for (const configured of scopeTargets(scope)) {
    const target =
      'project' in configured ? { project_id: configured.project } : { group_id: configured.group };
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    if (budget.requests === MAX_REQUESTS) return result({ complete: false });
    seen.add(key);
    const args = { ...filters, ...target, action: connectionAction(tool, target) };
    const stopped = await scanTargetConnection(run, tool, args, budget, visit, wanted);
    if (stopped) return 'answer' in stopped ? stopped : result(stopped);
  }
  return result({ complete: true });
}

/** A runner row's ID as a set key, or undefined for a row without a usable one. */
function runnerKey(row: Row): string | undefined {
  return typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : undefined;
}

/**
 * The runners of several targets. The caller's own runners keep their feed's cursor,
 * intersected with the union of runners available to the targets. All runners are that
 * union itself: GitLab lists the instance's runners to administrators only.
 */
export async function multiTargetRunners(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
): Promise<unknown> {
  if (requested.action === 'list_all') return targetRunners(run, requested, scope);
  const ids = new Set<string>();
  const [feed, scan] = await Promise.all([
    run('browse_runners', requested),
    // The owned feed has its own order, so the union of the targets is read in full.
    scanScopeConnections(run, 'browse_runners', requested, scope, (rows) => {
      for (const row of rows) {
        const key = runnerKey(row);
        if (key !== undefined) ids.add(key);
      }
      return rows.length;
    }),
  ]);
  if ('answer' in scan) return scan.answer;
  const result = keepNodes(feed, (row) => {
    const key = runnerKey(row);
    return key !== undefined && ids.has(key);
  });
  return scan.complete || result === feed
    ? result
    : {
        ...(result as Row),
        partial: true,
        message:
          'Runner availability is limited to ten connection requests across the working scope; other usable runners may be omitted.',
      };
}

/**
 * The runners available to the scope's targets, each once, newest first as GitLab lists
 * runners (Ci::RunnersFinder sorts by creation, and IDs grow with it), paged under a cursor
 * of their own.
 */
async function targetRunners(run: RunTool, requested: Args, scope: ScopeConfig): Promise<unknown> {
  const { offset, prefix } = composedOffset(requested, scope, 'runner');
  if (offset >= MAX_REQUESTS * PAGE_SIZE) return pastReadBound();
  // The tool schema already holds `first` to an integer from 1 to 100.
  const first = typeof requested.first === 'number' ? requested.first : 20;
  const end = offset + first;
  const rows: Array<{ row: Row; id: string }> = [];
  const seen = new Set<string>();
  let ordered = true;
  const scan = await scanScopeConnections(
    run,
    'browse_runners',
    requested,
    scope,
    (batch) => {
      let ranked = 0;
      for (const row of batch) {
        const id = runnerKey(row);
        if (id === undefined) continue;
        ranked++;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!/^\d+$/.test(id)) ordered = false;
        rows.push({ row, id });
      }
      return ranked;
    },
    end,
  );
  if ('answer' in scan) return scan.answer;
  // Numeric IDs compared as digit strings: a longer one is larger, without Number's limit.
  if (ordered)
    rows.sort((a, b) => {
      if (a.id.length !== b.id.length) return b.id.length - a.id.length;
      if (a.id === b.id) return 0;
      return a.id < b.id ? 1 : -1;
    });
  const hasNextPage = rows.length > end || scan.more === true;
  const result = {
    nodes: rows.slice(offset, end).map(({ row }) => row),
    pageInfo: { hasNextPage, endCursor: hasNextPage ? `${prefix}${end}` : null },
  };
  if (scan.complete && ordered) return result;
  return {
    ...result,
    partial: true,
    message: ordered
      ? 'Runners cover ten connection requests across the scope; runners of unread targets or pages are not listed. Narrow the scope for a complete listing.'
      : 'GitLab omitted runner IDs needed for ordering; results keep target order.',
  };
}

const positiveOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value > 0 ? value : fallback;

/** A group or project of the scope whose own listing a composed feed reads. */
type Place = { group: string } | { project: string };
/** Whether the scope's groups were listed to their end, or the answer that stopped them. */
type Listed = { complete: boolean } | { answer: unknown };

/**
 * The scope's places in reading order, listed only as far as the reader asks: the projects
 * it names, then each group followed by its projects, each project after the subgroups on
 * the way to it. The group project listings share one bound of MAX_REQUESTS pages.
 */
async function* scopePlaces(
  run: RunTool,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): AsyncGenerator<Place, Listed> {
  const seen = new Set<string>();
  // GitLab paths are case-insensitive.
  const fresh = (place: Place): boolean => {
    const key = JSON.stringify(place).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const pages = { read: 0 };
  let complete = true;
  for (const target of scopeTargets(scope)) {
    if ('project' in target) {
      if (fresh({ project: target.project })) yield { project: target.project };
      continue;
    }
    if (fresh({ group: target.group })) yield { group: target.group };
    const listed = yield* groupPlaces(run, target, enforcer, pages, fresh);
    if (listed === false) complete = false;
    else if (listed !== true) return listed;
  }
  return { complete };
}

/**
 * The group's projects and the subgroups on the way to them: true once its project listing
 * ends, false when the shared page bound stops it first.
 */
async function* groupPlaces(
  run: RunTool,
  target: { group: string; subgroups: boolean },
  enforcer: ScopeEnforcer,
  pages: { read: number },
  fresh: (place: Place) => boolean,
): AsyncGenerator<Place, boolean | { answer: unknown }> {
  // Pages are read one after another, and only as far as the reader asks.
  let page = 1;
  while (pages.read < MAX_REQUESTS) {
    pages.read++;
    const rows = await run('browse_projects', {
      action: 'list',
      group_id: target.group,
      include_subgroups: target.subgroups,
      page,
      per_page: PAGE_SIZE,
    });
    if (!Array.isArray(rows)) return { answer: rows };
    for (const row of rows as Row[])
      for (const place of projectPlaces(target.group, row, enforcer)) if (fresh(place)) yield place;
    if (rows.length < PAGE_SIZE) return true;
    page++;
  }
  return false;
}

/**
 * A listed project after the subgroups between the group and it. A project only shared with
 * the group lives in another namespace and gives none.
 */
function projectPlaces(group: string, row: Row, enforcer: ScopeEnforcer): Place[] {
  const path = row.path_with_namespace;
  if (typeof path !== 'string' || !enforcer.isAllowed(path)) return [];
  if (!path.toLowerCase().startsWith(`${group.toLowerCase()}/`)) return [];
  const segments = path.split('/');
  const places: Place[] = [];
  for (let end = group.split('/').length + 1; end < segments.length; end++)
    places.push({ group: segments.slice(0, end).join('/') });
  places.push({ project: path });
  return places;
}

/**
 * One listing, newest first, read until it holds `wanted` rows or ends: the first `wanted`
 * rows of a newest-first merge include at most `wanted` from each listing.
 */
async function readListing(
  run: RunTool,
  tool: string,
  args: Args,
  wanted: number,
  budget: Budget,
): Promise<{ rows: Row[]; bounded: boolean } | { answer: unknown }> {
  const rows: Row[] = [];
  let page = 1;
  while (rows.length < wanted) {
    if (budget.requests === MAX_REQUESTS) return { rows, bounded: true };
    budget.requests++;
    const answer = await run(tool, { ...args, page, per_page: PAGE_SIZE });
    if (!Array.isArray(answer)) return { answer };
    rows.push(...(answer as Row[]));
    if (answer.length < PAGE_SIZE) break;
    page++;
  }
  return { rows, bounded: false };
}

/**
 * The listings of the scope's places, as `listing` gives them (none for a place it skips),
 * each read as far as the page needs within one request bound; a row read twice, as a
 * project named both by ID and through its group, is kept once.
 */
async function readPlaces(
  run: RunTool,
  tool: string,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
  listing: (place: Place) => Args | undefined,
  wanted: number,
): Promise<{ rows: Row[]; bounded: boolean; listed: boolean } | { answer: unknown }> {
  const rows: Row[] = [];
  const ids = new Set<unknown>();
  const budget: Budget = { requests: 0 };
  const places = scopePlaces(run, scope, enforcer);
  // Places are read in turn: they share one request budget.
  let next = await places.next();
  while (!next.done) {
    const args = listing(next.value);
    const read = args ? await readListing(run, tool, args, wanted, budget) : undefined;
    if (read && 'answer' in read) return read;
    for (const row of read?.rows ?? []) {
      if (row.id !== undefined && ids.has(row.id)) continue;
      ids.add(row.id);
      rows.push(row);
    }
    if (read?.bounded) return { rows, bounded: true, listed: false };
    next = await places.next();
  }
  if ('answer' in next.value) return next.value;
  return { rows, bounded: false, listed: next.value.complete };
}

/** Rows newest first by `timeField` (when given), then by ID; undefined when one lacks them. */
function newestFirst(rows: Row[], timeField?: string): Row[] | undefined {
  const keyed = rows.map((row) => {
    const time = timeField === undefined ? 0 : row[timeField];
    return {
      row,
      time: typeof time === 'string' ? Date.parse(time) : time,
      id: row.id,
    };
  });
  if (!keyed.every(({ time, id }) => Number.isFinite(time) && Number.isFinite(id)))
    return undefined;
  keyed.sort(
    (a, b) => (b.time as number) - (a.time as number) || (b.id as number) - (a.id as number),
  );
  return keyed.map(({ row }) => row);
}

/** The requested page, partial with the reasons it may be incomplete. */
function composedPage(rows: Row[], start: number, wanted: number, reasons: string[]): unknown {
  const items = rows.slice(start, wanted);
  return reasons.length === 0 ? items : { items, partial: true, message: reasons.join(' ') };
}

/** The page bounds of a composed listing, or the answer for a page past what it can read. */
function composedBounds(
  requested: Args,
  what: string,
): { start: number; wanted: number } | { answer: unknown } {
  const perPage = positiveOr(requested.per_page, 20);
  const start = (positiveOr(requested.page, 1) - 1) * perPage;
  const readable = MAX_REQUESTS * PAGE_SIZE;
  if (start < readable) return { start, wanted: start + perPage };
  return {
    answer: {
      items: [],
      partial: true,
      message: `The ${what} of the scope are read up to ${readable} rows, and this page starts after them; narrow the listing or the scope.`,
    },
  };
}

/** The reasons a composed read of the scope's places may have left rows out. */
function placeReasons(read: { bounded: boolean; listed: boolean }, what: string): string[] {
  if (read.bounded)
    return [
      `The ${what} of the scope are read with at most ${MAX_REQUESTS} requests; rows of unread projects or groups may belong on this page.`,
    ];
  return read.listed
    ? []
    : [
        `The projects of the scope's groups are listed up to ${MAX_REQUESTS * PAGE_SIZE}; ${what} of the others are not read.`,
      ];
}

/**
 * An instance audit listing under the scope: the trails of its projects and groups, merged
 * newest first and paged after the merge. GitLab keeps a group's trail to the group's own
 * events, so a group is read with its projects and the subgroups on the way to them; a
 * subgroup that holds no project is not found that way, which the result says. An entity
 * filter keeps the trails of that kind of place, or the one trail of the entity it names.
 */
export async function scopeAuditEvents(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const { action: _action, entity_type, entity_id, ...listing } = requested;
  const entity = auditEntity(entity_type, entity_id);
  // A project trail holds the project's events and a group trail the group's
  // (ee/lib/gitlab/audit/levels), so no trail of the scope holds a user's or the instance's.
  if (entity && entity.type !== 'Project' && entity.type !== 'Group') return [];
  if (entity?.id !== undefined) return entityTrail(run, listing, entity.type, entity.id, enforcer);
  const { page: _page, per_page: _perPage, ...filters } = listing;
  const bounds = composedBounds(requested, 'audit trails');
  if ('answer' in bounds) return bounds.answer;
  const read = await readPlaces(
    run,
    'browse_audit_events',
    scope,
    enforcer,
    (place) => {
      if ('project' in place)
        return entity?.type === 'Group'
          ? undefined
          : { ...filters, action: 'list_project', project_id: place.project };
      return entity?.type === 'Project'
        ? undefined
        : { ...filters, action: 'list_group', group_id: place.group };
    },
    bounds.wanted,
  );
  if ('answer' in read) return read.answer;
  const reasons = placeReasons(read, 'audit trails');
  // GitLab lists a trail newest first; equal timestamps keep the newer (higher) ID first.
  const ordered = newestFirst(read.rows, 'created_at');
  if (!ordered)
    reasons.push('GitLab omitted created_at or id on some events; results keep target order.');
  if (
    entity?.type !== 'Project' &&
    [...scopeTargets(scope)].some((target) => 'group' in target && target.subgroups)
  )
    reasons.push(
      "Subgroups are found through their projects; the own events of a subgroup that holds no project are not read, list them with action 'list_group'.",
    );
  return composedPage(ordered ?? read.rows, bounds.start, bounds.wanted, reasons);
}

/** The entity types GitLab filters audit events by (ee/app/finders/audit_event_finder.rb). */
const AUDIT_ENTITY_TYPES: readonly string[] = [
  'Project',
  'User',
  'Group',
  'Gitlab::Audit::InstanceScope',
];

/**
 * The entity filter of an instance audit listing, refused as GitLab refuses it: an unknown
 * type, or an ID without its type (ee/lib/api/audit_events.rb).
 */
function auditEntity(type: unknown, id: unknown): { type: string; id?: number } | undefined {
  if (type === undefined) {
    if (id === undefined) return undefined;
    throw new Error(
      'entity_type is missing; entity_id filters by the ID of an entity of that type',
    );
  }
  if (typeof type !== 'string' || !AUDIT_ENTITY_TYPES.includes(type))
    throw new Error(
      `entity_type does not have a valid value; use one of ${AUDIT_ENTITY_TYPES.join(', ')}`,
    );
  return typeof id === 'number' ? { type, id } : { type };
}

/**
 * The trail of the one project or group an entity filter names, paged by GitLab itself. An
 * entity outside the scope, or one GitLab does not find, has no events in the scope's trails.
 */
async function entityTrail(
  run: RunTool,
  listing: Args,
  type: string,
  id: number,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const path = await entityPath(run, type, String(id), enforcer);
  if (path === undefined) return [];
  return run(
    'browse_audit_events',
    type === 'Project'
      ? { ...listing, action: 'list_project', project_id: path }
      : { ...listing, action: 'list_group', group_id: path },
  );
}

/** The path of a project or group by its ID when the scope holds it; a 404 finds none. */
async function entityPath(
  run: RunTool,
  type: string,
  id: string,
  enforcer: ScopeEnforcer,
): Promise<string | undefined> {
  try {
    if (type === 'Project') {
      const project = (await run('browse_projects', { action: 'get', project_id: id })) as Row;
      const path = project?.path_with_namespace;
      return typeof path === 'string' && enforcer.isAllowed(path) ? path : undefined;
    }
    const namespace = (await run('browse_namespaces', { action: 'get', namespace_id: id })) as Row;
    const path = namespace?.full_path;
    return namespace?.kind === 'group' && typeof path === 'string' && enforcer.isGroupAllowed(path)
      ? path
      : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parseGitLabApiError(message)?.status === 404) return undefined;
    throw error;
  }
}

/**
 * A project snippet listing that names no project under a scope other than one project: the
 * snippets of the scope's projects, merged newest (highest ID) first as GitLab lists one
 * project's, and paged after the merge.
 */
export async function scopeProjectSnippets(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const { page: _page, per_page: _perPage, projectId: _projectId, ...filters } = requested;
  const bounds = composedBounds(requested, 'project snippets');
  if ('answer' in bounds) return bounds.answer;
  const read = await readPlaces(
    run,
    'browse_snippets',
    scope,
    enforcer,
    (place) => ('project' in place ? { ...filters, projectId: place.project } : undefined),
    bounds.wanted,
  );
  if ('answer' in read) return read.answer;
  const reasons = placeReasons(read, 'project snippets');
  const ordered = newestFirst(read.rows);
  if (!ordered) reasons.push('GitLab omitted the ID of some snippets; results keep project order.');
  return composedPage(ordered ?? read.rows, bounds.start, bounds.wanted, reasons);
}

/**
 * A search of snippet titles under the scope, which GitLab searches only across the instance:
 * the snippets of the scope's projects that GitLab's search matches, newest updated first
 * (lib/gitlab/snippet_search_results.rb), paged after the merge. No project lists its
 * snippets in that order, so each listing is read in full within the one request bound.
 */
export async function scopeSnippetTitleSearch(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const bounds = composedBounds(requested, 'project snippets');
  if ('answer' in bounds) return bounds.answer;
  const read = await readPlaces(
    run,
    'browse_snippets',
    scope,
    enforcer,
    (place) =>
      'project' in place
        ? { action: 'list', scope: 'project', projectId: place.project }
        : undefined,
    Number.POSITIVE_INFINITY,
  );
  if ('answer' in read) return read.answer;
  const found = read.rows.filter(snippetSearchMatcher(requested.search));
  const reasons = placeReasons(read, 'project snippets');
  const ordered = newestFirst(found, 'updated_at');
  if (!ordered)
    reasons.push('GitLab omitted updated_at or id on some snippets; results keep project order.');
  return composedPage(ordered ?? found, bounds.start, bounds.wanted, reasons);
}

/** The snippet fields GitLab's snippet search matches (Snippet.search). */
const SNIPPET_SEARCH_FIELDS = ['title', 'description', 'file_name'] as const;
/** A quoted phrase searched as one word (Gitlab::SQL::Pattern::REGEX_QUOTED_TERM). */
const QUOTED_TERM = /(?<=^| )"[^"]+"(?= |$)/g;

/**
 * Whether a snippet matches a search as Gitlab::SQL::Pattern#fuzzy_search matches it: one
 * field holds every word of three or more characters (quoted phrases included), ignoring
 * case; with no such word, one field equals the whole search, ignoring case.
 */
function snippetSearchMatcher(search: unknown): (row: Row) => boolean {
  const query = typeof search === 'string' ? search.trim().replaceAll(/\s+/g, ' ') : '';
  if (!query) return () => true;
  const quoted: string[] = [];
  const rest = query.replace(QUOTED_TERM, (term) => {
    quoted.push(term.slice(1, -1));
    return '';
  });
  const words = [...rest.split(/\s+/), ...quoted]
    .filter((word) => [...word].length >= 3)
    .map((word) => word.toLowerCase());
  const whole = query.toLowerCase();
  const matches = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const text = value.toLowerCase();
    return words.length > 0 ? words.every((word) => text.includes(word)) : text === whole;
  };
  return (row) => SNIPPET_SEARCH_FIELDS.some((field) => matches(row[field]));
}

type SearchOrdering = { field: string; direction: number };

/**
 * The order GitLab gives a search for every target alike: issues, merge requests and
 * projects by order_by/sort, newest created first by default, milestones newest updated
 * first (lib/gitlab/search_results.rb). Other scopes have no order shared across targets.
 */
function searchOrdering(requested: Args): SearchOrdering | undefined {
  if (
    requested.scope === 'issues' ||
    requested.scope === 'merge_requests' ||
    requested.scope === 'projects'
  ) {
    return {
      field: requested.order_by === 'updated_at' ? 'updated_at' : 'created_at',
      direction: requested.sort === 'asc' ? 1 : -1,
    };
  }
  return requested.scope === 'milestones' ? { field: 'updated_at', direction: -1 } : undefined;
}

/** The rows in the given order, equal times newest ID first; undefined when a time is missing. */
function orderSearchRows(rows: Row[], { field, direction }: SearchOrdering): Row[] | undefined {
  const keyed = rows.map((row) => {
    const value = row[field];
    return {
      row,
      time: typeof value === 'string' ? Date.parse(value) : Number.NaN,
      id: typeof row.id === 'number' ? row.id : 0,
    };
  });
  if (!keyed.every(({ time }) => Number.isFinite(time))) return undefined;
  keyed.sort((a, b) => (a.time - b.time) * direction || b.id - a.id);
  return keyed.map(({ row }) => row);
}

/** A search row's identity across targets: its ID, else the whole row (code and wiki hits). */
const searchRowKey = (row: Row): string =>
  typeof row.id === 'number' || typeof row.id === 'string' ? `id:${row.id}` : JSON.stringify(row);

/**
 * One target's search, appended until it holds `wanted` kept rows or ends: the first
 * `wanted` rows of the merge include at most `wanted` from each target.
 */
async function readSearchTarget(
  run: RunTool,
  args: Args,
  wanted: number,
  budget: Budget,
  keep: KeepRows | undefined,
): Promise<{ rows: Row[]; bounded: boolean } | { answer: unknown }> {
  const rows: Row[] = [];
  let page = 1;
  while (rows.length < wanted) {
    if (budget.requests === MAX_REQUESTS) return { rows, bounded: true };
    budget.requests++;
    const answer = await run('browse_search', { ...args, page, per_page: PAGE_SIZE });
    const results = (answer as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) return { answer };
    rows.push(...((keep ? await keep(results) : results) as Row[]));
    if (results.length < PAGE_SIZE) break;
    page++;
  }
  return { rows, bounded: false };
}

/** The project or group search a target answers a global search with. */
function targetSearchArgs(filters: Args, target: Target): Args {
  return 'project' in target
    ? { ...filters, action: 'project', project_id: target.project }
    : { ...filters, action: 'group', group_id: target.group };
}

/**
 * A global search under several projects or groups: each target's own search, merged
 * without repeats, ordered as GitLab orders the scope and paged after the merge, within
 * one request bound. A group without its subgroups keeps its own and its direct projects'
 * rows. A scope with no order shared across targets keeps target order and says so.
 */
export async function multiTargetSearch(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const { action: _action, page: _page, per_page: _perPage, ...filters } = requested;
  const perPage = positiveOr(requested.per_page, 20);
  const start = (positiveOr(requested.page, 1) - 1) * perPage;
  const wanted = start + perPage;
  const reasons: string[] = [];
  const answer = (results: Row[]): unknown => ({
    scope: requested.scope,
    count: results.length,
    results,
    ...(reasons.length > 0 ? { partial: true, message: reasons.join(' ') } : {}),
  });
  if (start >= MAX_REQUESTS * PAGE_SIZE) {
    reasons.push(
      `The searches of the scope read up to ${MAX_REQUESTS * PAGE_SIZE} results, and this page starts after them; narrow the search.`,
    );
    return answer([]);
  }
  const read = await searchTargets(run, scope, filters, wanted, enforcer);
  if ('answer' in read) return read.answer;
  reasons.push(...read.reasons);
  const ordering = searchOrdering(requested);
  const ordered = ordering ? orderSearchRows(read.rows, ordering) : undefined;
  if (!ordered && read.contributing > 1)
    reasons.push(
      ordering
        ? 'GitLab omitted the ordering time on some results; they keep target order.'
        : 'These results have no order shared across projects and groups; they keep target order.',
    );
  return answer((ordered ?? read.rows).slice(start, wanted));
}

/**
 * Each target's search in target order, merged without repeats within one request bound; the
 * number of targets that added rows, and the reasons rows may be missing.
 */
async function searchTargets(
  run: RunTool,
  scope: ScopeConfig,
  filters: Args,
  wanted: number,
  enforcer: ScopeEnforcer,
): Promise<{ rows: Row[]; contributing: number; reasons: string[] } | { answer: unknown }> {
  const rows: Row[] = [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  const targets = new Set<string>();
  const budget: Budget = { requests: 0 };
  const lookups: Budget = { requests: 0 };
  let contributing = 0;
  // Targets are searched in turn: they share one request budget.
  for (const target of scopeTargets(scope)) {
    const key = JSON.stringify(target);
    if (targets.has(key)) continue;
    targets.add(key);
    const read = await searchTarget(run, target, filters, wanted, { budget, lookups }, enforcer);
    if ('answer' in read) return read;
    if (read.reason) reasons.push(read.reason);
    if (appendUniqueRows(read.rows, seen, rows) > 0) contributing++;
    if (read.bounded) {
      reasons.push(
        `The searches of the scope are limited to ${MAX_REQUESTS} requests; results of unread projects or groups may belong on this page.`,
      );
      break;
    }
  }
  return { rows, contributing, reasons };
}

/**
 * One target's search rows; a group without its subgroups keeps its own and its direct
 * projects' rows, with the reason when those were not all read. The direct-project lookups
 * of every group share one bound of their own, apart from the searches.
 */
async function searchTarget(
  run: RunTool,
  target: Target,
  filters: Args,
  wanted: number,
  { budget, lookups }: { budget: Budget; lookups: Budget },
  enforcer: ScopeEnforcer,
): Promise<{ rows: Row[]; bounded: boolean; reason?: string } | { answer: unknown }> {
  // A project's own search has no projects scope: the project answers it if it matches.
  if ('project' in target && filters.scope === 'projects')
    return projectTargetSearch(run, target.project, filters.search, budget);
  const args = targetSearchArgs(filters, target);
  if (!('group' in target) || target.subgroups)
    return readSearchTarget(run, args, wanted, budget, undefined);
  const direct = await directGroupSearchRows(run, target.group, filters.scope, enforcer, lookups);
  const read = await readSearchTarget(run, args, wanted, budget, direct.keep);
  if ('answer' in read || direct.complete) return read;
  return {
    ...read,
    reason: `Results of group '${target.group}' are kept to the direct projects read within the lookup bound; results of its other projects are not shown.`,
  };
}

/** A project of the scope as the search of projects finds it: itself when it matches. */
async function projectTargetSearch(
  run: RunTool,
  project: string,
  search: unknown,
  budget: Budget,
): Promise<{ rows: Row[]; bounded: boolean }> {
  if (budget.requests === MAX_REQUESTS) return { rows: [], bounded: true };
  budget.requests++;
  const found = await readScopeProject(run, project);
  const query = typeof search === 'string' ? search.toLowerCase() : '';
  return {
    rows: matchesScopeProject(found, query) ? [simpleProject(found) as Row] : [],
    bounded: false,
  };
}

/** Appends the rows not seen yet; the number appended. */
function appendUniqueRows(found: Row[], seen: Set<string>, rows: Row[]): number {
  let added = 0;
  for (const row of found) {
    const key = searchRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    added++;
  }
  return added;
}

// GitLab's enum priorities, not alphabetical order:
// https://github.com/gitlabhq/gitlabhq/blob/v16.0.0/app/models/concerns/enums/vulnerability.rb
const SEVERITY: Readonly<Record<string, number>> = {
  INFO: 1,
  UNKNOWN: 2,
  LOW: 4,
  MEDIUM: 5,
  HIGH: 6,
  CRITICAL: 7,
};
const STATE: Readonly<Record<string, number>> = {
  DETECTED: 1,
  DISMISSED: 2,
  RESOLVED: 3,
  CONFIRMED: 4,
};
function orderingValue(row: Row, field: string): string | number | undefined {
  if (field === 'severity')
    return typeof row.severity === 'string' ? SEVERITY[row.severity] : undefined;
  if (field === 'state') return typeof row.state === 'string' ? STATE[row.state] : undefined;
  if (field === 'title') return typeof row.title === 'string' ? row.title : undefined;
  if (typeof row.detectedAt !== 'string') return undefined;
  const time = Date.parse(row.detectedAt);
  return Number.isFinite(time) ? time : undefined;
}

/** The answer to a composed cursor past the rows one call may read, given without reading. */
const pastReadBound = (): Row => ({
  nodes: [],
  pageInfo: { hasNextPage: false, endCursor: null },
  partial: true,
  message: 'The composed cursor starts past the 1000-row read bound; narrow the scope.',
});

/** Scope/query-bound offset cursor; no per-process snapshot or cross-replica mutable state. */
function composedOffset(
  requested: Args,
  scope: ScopeConfig,
  what: string,
): { offset: number; prefix: string } {
  const { first: _first, after, ...filters } = requested;
  const hash = createHash('sha256')
    .update(JSON.stringify(scope))
    .update(JSON.stringify(filters))
    .digest('hex');
  const prefix = `scope:${hash}:`;
  if (after === undefined) return { offset: 0, prefix };
  if (
    typeof after !== 'string' ||
    after.length > 85 ||
    !after.startsWith(prefix) ||
    !/^\d{1,4}$/.test(after.slice(prefix.length))
  ) {
    throw new Error(`Invalid composed ${what} cursor; restart pagination for this scope and query`);
  }
  return { offset: Number(after.slice(prefix.length)), prefix };
}

/** Sorted union, with one global request bound and deduplication before pagination. */
export async function multiTargetVulnerabilities(
  run: RunTool,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const { offset, prefix } = composedOffset(requested, scope, 'vulnerability');
  if (offset >= MAX_REQUESTS * PAGE_SIZE) return pastReadBound();
  // The tool schema already holds `first` to an integer from 1 to 100.
  const first = typeof requested.first === 'number' ? requested.first : 20;
  const end = offset + first;
  const sort = typeof requested.sort === 'string' ? requested.sort : 'severity_desc';
  const split = sort.lastIndexOf('_');
  const field = sort.slice(0, split);
  const direction = sort.slice(split + 1) === 'asc' ? 1 : -1;
  const rows: Array<{ row: Row; id: string; value: string | number | undefined }> = [];
  const seen = new Set<string>();
  const keep = isScopeVulnerability(enforcer);
  let ordered = true;
  const scan = await scanScopeConnections(
    run,
    'browse_vulnerabilities',
    requested,
    scope,
    (batch) => {
      let ranked = 0;
      for (const row of batch) {
        if (!keep(row)) continue;
        const id = String(row.id);
        if (!/^\d+$/.test(id)) {
          ordered = false;
          continue;
        }
        ranked++;
        if (seen.has(id)) continue;
        seen.add(id);
        const value = orderingValue(row, field);
        if (value === undefined) ordered = false;
        rows.push({ row, id, value });
      }
      return ranked;
    },
    end,
  );
  if ('answer' in scan) return scan.answer;
  if (ordered)
    rows.sort((a, b) => {
      // `ordered` holds only when every row has its ordering value.
      const left = a.value as string | number;
      const right = b.value as string | number;
      if (left !== right) return (left < right ? -1 : 1) * direction;
      // Numeric IDs may exceed Number's safe range. Equal sort keys use ID descending; IDs
      // are unique, as repeats were dropped above.
      if (a.id.length !== b.id.length) return b.id.length - a.id.length;
      return a.id < b.id ? 1 : -1;
    });
  const hasNextPage = rows.length > end || scan.more === true;
  const nodes: Row[] = [];
  for (let index = offset; index < end && index < rows.length; index++) nodes.push(rows[index].row);
  const result = {
    nodes,
    pageInfo: { hasNextPage, endCursor: hasNextPage ? `${prefix}${end}` : null },
  };
  return scan.complete && ordered
    ? result
    : {
        ...result,
        partial: true,
        message: ordered
          ? 'Vulnerabilities cover ten connection requests across the scope; unscanned targets or pages may change the sorted result. Narrow the scope for a complete listing.'
          : 'GitLab omitted data needed for ordering; results retain target order and are partial.',
      };
}
