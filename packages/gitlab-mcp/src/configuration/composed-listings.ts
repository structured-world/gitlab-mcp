/**
 * Project and merge request listings that name no project or group, under a scope of several
 * targets: each target's own listing, merged without repeats, ordered as GitLab orders the
 * listing and paged after the merge. The instance-wide feed is not read, as its first pages
 * may hold nothing of the scope.
 */

import type { ScopeConfig } from '../profiles/types';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import type { RunTool } from './scoped-execution';
import {
  composedBounds,
  composedPage,
  MAX_REQUESTS,
  PAGE_SIZE,
  type Budget,
} from './composed-feeds';
import { scopedResult, scopeTargets, targetArgs, type Target } from './scope-targets';
import { matchesScopeProject, readScopeProject, simpleProject } from './scope-projects';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;
type Read = { rows: Row[]; bounded: boolean } | { answer: unknown };
export type Ordering = { field: string; direction: number };

/** Project listing options a project of the scope answers itself, read on its own. */
const PROJECT_TARGET_OPTIONS: ReadonlySet<string> = new Set([
  'action',
  'search',
  'page',
  'per_page',
  'simple',
  'order_by',
  'sort',
]);

/**
 * The fields each listing is ordered by that its rows carry, so the merge can order them as
 * one listing would; similarity and priority are GitLab's own ranking within one listing.
 */
const MERGEABLE_ORDER: Readonly<Record<string, ReadonlySet<string>>> = {
  browse_projects: new Set(['id', 'name', 'path', 'created_at', 'updated_at', 'last_activity_at']),
  browse_merge_requests: new Set(['created_at', 'updated_at', 'title']),
};

/**
 * Whether a targetless listing is composed from the scope's targets. A project of the scope
 * is read on its own, which answers only the options it can apply itself; with others the
 * listing stays the filtered instance-wide one.
 */
export function isComposedListing(tool: string, requested: Args, scope: ScopeConfig): boolean {
  if (requested.action !== 'list' || requested.project_id !== undefined) return false;
  if (tool === 'browse_merge_requests') return requested.group_id === undefined;
  if (tool !== 'browse_projects' || requested.group_id !== undefined) return false;
  if (Object.keys(requested).every((key) => PROJECT_TARGET_OPTIONS.has(key))) return true;
  for (const target of scopeTargets(scope)) if ('project' in target) return false;
  return true;
}

/** A targetless project or merge request listing composed from the scope's targets. */
export async function multiTargetListing(
  run: RunTool,
  tool: string,
  requested: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
): Promise<unknown> {
  const what = tool === 'browse_projects' ? 'projects' : 'merge requests';
  const bounds = composedBounds(requested, what);
  if ('answer' in bounds) return bounds.answer;
  const { page: _page, per_page: _perPage, ...filters } = requested;
  const read = await readTargets(run, tool, filters, scope, enforcer, bounds.wanted);
  if ('answer' in read) return read.answer;
  const reasons: string[] = [];
  if (read.bounded)
    reasons.push(
      `The ${what} of the scope are read with at most ${MAX_REQUESTS} requests; rows of unread projects or groups may belong on this page.`,
    );
  const ordering = listingOrder(tool, requested);
  const ordered = ordering ? orderRows(read.rows, ordering) : undefined;
  if (!ordered && read.contributing > 1)
    reasons.push(
      ordering
        ? `GitLab omitted the ${ordering.field} of some ${what}; they keep target order.`
        : `The ${String(requested.order_by)} order is GitLab's own within one listing and cannot be merged across projects and groups; ${what} keep target order.`,
    );
  return composedPage(ordered ?? read.rows, bounds.start, bounds.wanted, reasons);
}

/**
 * Each target's rows in target order, without repeats, within one request bound; the number
 * of targets that added rows. A target named twice is read once.
 */
async function readTargets(
  run: RunTool,
  tool: string,
  filters: Args,
  scope: ScopeConfig,
  enforcer: ScopeEnforcer,
  wanted: number,
): Promise<{ rows: Row[]; bounded: boolean; contributing: number } | { answer: unknown }> {
  const rows: Row[] = [];
  const seen = new Set<unknown>();
  const targets = new Set<string>();
  const budget: Budget = { requests: 0 };
  // A group's listing also returns projects shared into it, and a group's merge requests
  // those of subgroups a scope without them leaves out.
  const keep = (found: Row[]): Row[] =>
    scopedResult(tool, { action: 'list' }, found, enforcer) as Row[];
  let contributing = 0;
  // Targets are read in turn: they share one request budget.
  for (const target of scopeTargets(scope)) {
    const key = JSON.stringify(target);
    if (targets.has(key)) continue;
    targets.add(key);
    const read = await readTarget(run, tool, filters, target, wanted, budget, keep);
    if ('answer' in read) return read;
    let added = 0;
    for (const row of read.rows) {
      const id = row.id ?? JSON.stringify(row);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added++;
    }
    if (added > 0) contributing++;
    if (read.bounded) return { rows, bounded: true, contributing };
  }
  return { rows, bounded: false, contributing };
}

/**
 * One target's rows of the scope, read until it holds `wanted` of them or ends: the first
 * `wanted` rows of the merge include at most `wanted` from each target.
 */
async function readTarget(
  run: RunTool,
  tool: string,
  filters: Args,
  target: Target,
  wanted: number,
  budget: Budget,
  keep: (rows: Row[]) => Row[],
): Promise<Read> {
  if (tool === 'browse_projects' && 'project' in target)
    return readProjectTarget(run, target.project, filters, budget);
  const args = targetArgs(tool, filters, target) ?? filters;
  const rows: Row[] = [];
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let page = 1; rows.length < wanted; page++) {
    if (budget.requests === MAX_REQUESTS) return { rows, bounded: true };
    budget.requests++;
    const answer = await run(tool, { ...args, page, per_page: PAGE_SIZE });
    if (!Array.isArray(answer)) return { answer };
    rows.push(...keep(answer as Row[]));
    if (answer.length < PAGE_SIZE) break;
  }
  return { rows, bounded: false };
}

/** A project of the scope as a listing of projects shows it: itself when it matches. */
async function readProjectTarget(
  run: RunTool,
  project: string,
  filters: Args,
  budget: Budget,
): Promise<Read> {
  if (budget.requests === MAX_REQUESTS) return { rows: [], bounded: true };
  budget.requests++;
  const found = await readScopeProject(run, project);
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
  if (!matchesScopeProject(found, search)) return { rows: [], bounded: false };
  // A listing answers with the simple representation unless simple=false, as GitLab does.
  const row = (filters.simple === false ? found : simpleProject(found)) as Row;
  return { rows: [row], bounded: false };
}

/**
 * The order of the listing, newest created first unless the call names one (lib/api/projects.rb,
 * lib/api/helpers/merge_requests_helpers.rb), or undefined for a ranking within one listing.
 */
export function listingOrder(tool: string, requested: Args): Ordering | undefined {
  const field = typeof requested.order_by === 'string' ? requested.order_by : 'created_at';
  if (!MERGEABLE_ORDER[tool]?.has(field)) return undefined;
  return { field, direction: requested.sort === 'asc' ? 1 : -1 };
}

/** A row's value for ordering: times as instants, IDs as numbers, anything else as text. */
function orderValue(row: Row, field: string): number | string | undefined {
  const value = row[field];
  if (field.endsWith('_at')) {
    const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? time : undefined;
  }
  if (field === 'id') return typeof value === 'number' ? value : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** The rows in the given order, equal values by ID the same way; undefined when one lacks it. */
export function orderRows(rows: Row[], { field, direction }: Ordering): Row[] | undefined {
  const keyed = rows.map((row) => ({
    row,
    value: orderValue(row, field),
    id: typeof row.id === 'number' ? row.id : 0,
  }));
  if (keyed.some(({ value }) => value === undefined)) return undefined;
  keyed.sort((a, b) => {
    const left = a.value as number | string,
      right = b.value as number | string;
    if (left !== right) return (left < right ? -1 : 1) * direction;
    return (a.id - b.id) * direction;
  });
  return keyed.map(({ row }) => row);
}
