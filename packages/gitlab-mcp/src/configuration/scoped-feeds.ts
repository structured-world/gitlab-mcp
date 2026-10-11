/**
 * Feeds GitLab only offers wider than the working scope, kept to it: the search and
 * vulnerabilities of a group without its subgroups (GitLab's group results always include
 * them), and the caller's own runners available to the scope's project or group.
 */

import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import type { ScopeConfig } from '../profiles/types';
import type { RunTool } from './scoped-execution';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

/** GitLab's largest page, for the listings these feeds read in full. */
const PAGE_SIZE = 100;
/** Bounds those listings: up to 1000 direct projects or runners. */
const MAX_PAGES = 10;

/** The scope's group when it is exactly one group without its subgroups. */
export function directGroup(scope: ScopeConfig): string | undefined {
  const lists = (scope.projects?.length ?? 0) + (scope.groups?.length ?? 0);
  if (lists > 0 || scope.namespace || scope.project || !scope.group) return undefined;
  return scope.includeSubgroups === false ? scope.group : undefined;
}

/**
 * Keeps the search rows of a group without its subgroups: projects by their path, results
 * of a project (issues, merge requests, notes, commits, code, wiki, milestones) by the
 * group's direct projects, results of the group itself by its id. Users belong to no
 * project, so a group's user search stays as GitLab gives it.
 */
export async function directGroupSearchRows(
  run: RunTool,
  group: string,
  searchScope: unknown,
  enforcer: ScopeEnforcer,
): Promise<(rows: unknown[]) => unknown[]> {
  if (searchScope === 'users') return (rows) => rows;
  if (searchScope === 'projects') {
    return (rows) =>
      rows.filter((row) => {
        const path = (row as Row).path_with_namespace;
        return typeof path === 'string' && enforcer.isAllowed(path);
      });
  }
  const [namespace, projectIds] = await Promise.all([
    run('browse_namespaces', { action: 'get', namespace_id: group }),
    directProjectIds(run, group, enforcer),
  ]);
  const groupId = (namespace as Row | undefined)?.id;
  return (rows) =>
    rows.filter((row) => {
      const { project_id, group_id } = row as Row;
      if (project_id !== undefined && project_id !== null) return projectIds.has(project_id);
      return group_id !== undefined && group_id === groupId;
    });
}

/**
 * Ids of the group's own projects. A group's listing also returns projects shared with it
 * from other namespaces; those are left out.
 */
async function directProjectIds(
  run: RunTool,
  group: string,
  enforcer: ScopeEnforcer,
): Promise<Set<unknown>> {
  const ids = new Set<unknown>();
  // Pages are read one after another: whether the next one is needed depends on this one.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const projects = await run('browse_projects', {
      action: 'list',
      group_id: group,
      include_subgroups: false,
      per_page: PAGE_SIZE,
      page,
    });
    if (!Array.isArray(projects)) break;
    for (const project of projects as Row[]) {
      const path = project.path_with_namespace;
      if (typeof path === 'string' && enforcer.isAllowed(path)) ids.add(project.id);
    }
    if (projects.length < PAGE_SIZE) break;
  }
  return ids;
}

/**
 * A connection (`nodes` and `pageInfo`) with only the nodes that pass. Its cursor stays the
 * one GitLab gave, so paging on continues the same feed; a page may come back shorter.
 */
export function keepNodes(result: unknown, keep: (node: Row) => boolean): unknown {
  const nodes = (result as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return result;
  return { ...(result as Row), nodes: (nodes as Row[]).filter(keep) };
}

/** A vulnerability of the scope: its project is one the scope allows. */
export function isScopeVulnerability(enforcer: ScopeEnforcer): (node: Row) => boolean {
  return (node) => {
    const path = (node.project as { fullPath?: unknown } | undefined)?.fullPath;
    return typeof path === 'string' && enforcer.isAllowed(path);
  };
}

/**
 * The caller's own runners available to the scope's project or group: the owned feed as
 * requested, with its own cursor, kept to the runners the target can use.
 */
export async function ownedRunnersInScope(
  run: RunTool,
  requested: Args,
  target: { group: string } | { project: string },
): Promise<unknown> {
  const available: Args =
    'group' in target
      ? { action: 'list_group', group_id: target.group }
      : { action: 'list_project', project_id: target.project };
  const [owned, ids] = await Promise.all([
    run('browse_runners', requested),
    runnerIds(run, available),
  ]);
  return keepNodes(owned, (node) => ids.has(node.id));
}

async function runnerIds(run: RunTool, args: Args): Promise<Set<unknown>> {
  const ids = new Set<unknown>();
  let after: unknown;
  // Pages are read one after another: each continues from the previous page's cursor.
  for (let page = 0; page < MAX_PAGES; page++) {
    const connection = (await run('browse_runners', {
      ...args,
      first: PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    })) as { nodes?: Row[]; pageInfo?: { hasNextPage?: boolean; endCursor?: unknown } };
    for (const node of connection?.nodes ?? []) ids.add(node.id);
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return ids;
}
