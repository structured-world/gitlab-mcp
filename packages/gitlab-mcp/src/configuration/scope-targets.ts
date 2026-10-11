/**
 * Listing and search calls that name no project or group read across everything the
 * account can see. Under a working scope they are narrowed to it: the scope becomes the
 * call's own filter where the tool has one, and otherwise the results are filtered.
 */

import type { ScopeConfig } from '../profiles/types';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';

type Args = Record<string, unknown>;

/** The scope as one group or one project, when it is exactly that. */
function singleTarget(scope: ScopeConfig): { group: string } | { project: string } | undefined {
  const lists = (scope.projects?.length ?? 0) + (scope.groups?.length ?? 0);
  if (lists > 0 || scope.namespace) return undefined;
  if (scope.group && !scope.project) return { group: scope.group };
  if (scope.project && !scope.group) return { project: scope.project };
  return undefined;
}

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/**
 * Why a targetless call cannot be narrowed to the scope, or null: a creation that names no
 * place, a global search or vulnerability listing no GitLab filter expresses (several
 * projects or groups, or a group without its subgroups, which group results always cover),
 * and instance-wide listings with no per-scope form.
 */
export function targetlessRestriction(tool: string, args: Args, scope: ScopeConfig): string | null {
  const creation = creationRestriction(tool, args, scope);
  if (creation) return creation;
  if (tool === 'browse_vulnerabilities' && isTargetlessList(args)) {
    return unnarrowable(scope, 'vulnerabilities cannot be listed', 'list them for');
  }
  if (tool === 'browse_search' && args.action === 'global') {
    // Group and project search have no snippet_titles scope (lib/api/helpers/search_helpers.rb).
    if (args.scope === 'snippet_titles') {
      return 'snippet titles are searched across the whole instance only and cannot be limited to the working scope';
    }
    return unnarrowable(scope, 'a global search cannot be limited', 'search within');
  }
  return INSTANCE_LISTINGS[tool]?.(args, singleTarget(scope)) ?? null;
}

/** Whether the scope is exactly one project. */
const isProject = (target: Target | undefined): boolean =>
  target !== undefined && 'project' in target;

/**
 * Per tool: why a listing across the whole instance (or all of the caller's activity) cannot
 * be narrowed to the scope, or null. Those it can are rewritten by NARROWERS.
 */
const INSTANCE_LISTINGS: Record<string, (args: Args, target: Target | undefined) => string | null> =
  {
    // Events name their project only by numeric id, which a path scope cannot be matched
    // against; a single project scope reads that project's events instead.
    browse_events: (args, target) =>
      args.action === 'user' && !isProject(target)
        ? "your activity cannot be limited to a working scope of a group or several projects; list a project's events with action 'project'"
        : null,
    // GitLab lists deploy keys per project; the public listing exists only instance-wide.
    browse_deploy_keys: (args, target) => {
      if (args.action !== 'list' || hasValue(args.project_id)) return null;
      if (hasValue(args.public)) {
        return "public deploy keys are listed for the whole instance and cannot be limited to the working scope; list a project's keys with 'project_id'";
      }
      return isProject(target)
        ? null
        : "deploy keys cannot be listed for a group or several projects; list a project's keys with 'project_id'";
    },
    browse_runners: (args, target) =>
      (args.action === 'list_all' || args.action === 'list_owned') && !target
        ? "runners cannot be listed for a working scope of several projects or groups; list them for one of them with action 'list_project' or 'list_group'"
        : null,
    // A group's audit trail holds the group's own events, not those of its projects.
    browse_audit_events: (args, target) =>
      args.action === 'list_instance' &&
      (!isProject(target) || hasValue(args.entity_type) || hasValue(args.entity_id))
        ? "instance audit events cannot be limited to the working scope; list a project's or a group's with action 'list_project' or 'list_group'"
        : null,
  };

/**
 * Why a call GitLab only offers per project or per whole group cannot follow the scope:
 * several targets, or a group without its subgroups (a group's results always cover them).
 */
function unnarrowable(scope: ScopeConfig, what: string, instead: string): string | null {
  const target = singleTarget(scope);
  if (!target) {
    return `${what} for a working scope of several projects or groups; ${instead} one of them`;
  }
  if ('group' in target && scope.includeSubgroups === false) {
    return `${what} to a group without its subgroups; ${instead} one of its projects`;
  }
  return null;
}

/** A project created or forked: its `namespace` names the group it goes into. */
function isProjectCreation(tool: string, args: Args): boolean {
  return tool === 'manage_project' && (args.action === 'create' || args.action === 'fork');
}

/** Whether a project created or forked names the group it goes into. */
function namesDestination(args: Args): boolean {
  return hasValue(args.namespace) || hasValue(args.namespace_path);
}

/**
 * The call's arguments as the scope check reads them. A created or forked project's
 * `namespace` is the group it goes into, so it is checked as a group: the scope group itself
 * is a valid place also when its subgroups are not part of the scope.
 */
export function scopeCheckArgs(tool: string, args: Args): Args {
  if (!isProjectCreation(tool, args) || !hasValue(args.namespace)) return args;
  // Checked as the group-valued namespace_id, which create and fork do not take, so a fork
  // naming both namespace and namespace_path has each destination checked.
  const { namespace, ...rest } = args;
  return { ...rest, namespace_id: namespace };
}

/**
 * Creation that names no place lands outside the scope: a project created or forked without
 * a namespace in the user's own namespace (filled in with the scope group when there is a
 * single one), a group without a parent at the top level.
 */
function creationRestriction(tool: string, args: Args, scope: ScopeConfig): string | null {
  if (isProjectCreation(tool, args) && !namesDestination(args)) {
    const target = singleTarget(scope);
    if (target && 'group' in target) return null;
    return "a project without a namespace would be created outside the working scope; name the group to put it in with 'namespace'";
  }
  if (tool === 'manage_namespace' && args.action === 'create' && !hasValue(args.parent_id)) {
    return "a top-level group would be outside the working scope; create it inside a group of the scope with 'parent_id'";
  }
  return null;
}

/**
 * The projects of a scope made of projects only, or null. Listing them directly replaces a
 * project listing that GitLab paginates before the scope could filter it.
 */
export function scopeProjectsOnly(scope: ScopeConfig): string[] | null {
  if (scope.group || scope.groups?.length || scope.namespace) return null;
  const projects = [...(scope.project ? [scope.project] : []), ...(scope.projects ?? [])];
  return projects.length > 0 ? projects : null;
}

type Target = { group: string } | { project: string };

/** A listing that names neither a project nor a group. */
const isTargetlessList = (args: Args): boolean =>
  args.action === 'list' && !hasValue(args.project_id) && !hasValue(args.group_id);

/**
 * Per tool: the call's arguments with the single scope target as their filter, or null
 * when the call keeps its own arguments.
 */
const NARROWERS: Record<string, (args: Args, target: Target, scope: ScopeConfig) => Args | null> = {
  browse_search: (args, target) => {
    if (args.action !== 'global') return null;
    // Group search covers subgroups; a scope without them is refused before this point.
    return 'group' in target
      ? { ...args, action: 'group', group_id: target.group }
      : { ...args, action: 'project', project_id: target.project };
  },
  // The caller's own exclusion of subgroups stays; a scope without them excludes them anyway.
  browse_projects: (args, target, scope) =>
    args.action === 'list' && !hasValue(args.group_id) && 'group' in target
      ? {
          ...args,
          group_id: target.group,
          include_subgroups: scope.includeSubgroups !== false && args.include_subgroups !== false,
        }
      : null,
  browse_merge_requests: (args, target) =>
    args.action === 'list' && !hasValue(args.project_id) && 'project' in target
      ? { ...args, project_id: target.project }
      : null,
  // The caller's own activity spans every project; a project scope shows that project's.
  browse_events: (args, target) =>
    args.action === 'user' && 'project' in target
      ? { ...args, action: 'project', project_id: target.project }
      : null,
  browse_deploy_keys: (args, target) =>
    args.action === 'list' &&
    !hasValue(args.project_id) &&
    !hasValue(args.public) &&
    'project' in target
      ? { ...args, project_id: target.project }
      : null,
  // Runners available to the scope's project or group, with the same filters.
  browse_runners: (args, target) => {
    if (args.action !== 'list_all' && args.action !== 'list_owned') return null;
    return 'group' in target
      ? { ...args, action: 'list_group', group_id: target.group }
      : { ...args, action: 'list_project', project_id: target.project };
  },
  browse_audit_events: (args, target) =>
    args.action === 'list_instance' &&
    'project' in target &&
    !hasValue(args.entity_type) &&
    !hasValue(args.entity_id)
      ? { ...args, action: 'list_project', project_id: target.project }
      : null,
  browse_vulnerabilities: (args, target) => {
    if (!isTargetlessList(args)) return null;
    return 'group' in target
      ? { ...args, group_id: target.group }
      : { ...args, project_id: target.project };
  },
  manage_project: (args, target) => {
    if (!isProjectCreation('manage_project', args) || namesDestination(args)) return null;
    if (!('group' in target)) return null;
    // Fork takes the destination as namespace_path, create as namespace.
    return args.action === 'fork'
      ? { ...args, namespace_path: target.group }
      : { ...args, namespace: target.group };
  },
};

/** The call's arguments with the scope as its filter, where the tool takes one. */
export function scopedArgs(tool: string, args: Args, scope: ScopeConfig): Args {
  const target = singleTarget(scope);
  const narrow = NARROWERS[tool];
  if (!target || !narrow) return args;
  return narrow(args, target, scope) ?? args;
}

/** Project path of a listed project or merge request, as each listing reports it. */
function projectPathOf(tool: string, item: Record<string, unknown>): string | undefined {
  if (tool === 'browse_projects') {
    return typeof item.path_with_namespace === 'string' ? item.path_with_namespace : undefined;
  }
  // A merge request's references.full is "group/project!iid"
  const full = (item.references as { full?: unknown } | undefined)?.full;
  return typeof full === 'string' && full.includes('!')
    ? full.slice(0, full.lastIndexOf('!'))
    : undefined;
}

/** A listing of projects or merge requests whose rows are filtered by their project. */
function isProjectRowListing(tool: string, args: Args): boolean {
  return (
    (tool === 'browse_projects' && (args.action === 'search' || args.action === 'list')) ||
    (tool === 'browse_merge_requests' && args.action === 'list' && !hasValue(args.project_id))
  );
}

/** Whether a call's results are filtered to the scope after GitLab returned them. */
export function isFilteredListing(tool: string, args: Args): boolean {
  return isProjectRowListing(tool, args) || (tool === 'browse_todos' && isTargetlessList(args));
}

/**
 * The results of a listing narrowed to the scope. Project listings are always filtered:
 * a group's listing also returns projects only shared with it from other namespaces.
 * An item whose place cannot be told is left out: listing it could show something
 * outside the scope.
 */
export function scopedResult(
  tool: string,
  args: Args,
  result: unknown,
  enforcer: ScopeEnforcer,
): unknown {
  if (!Array.isArray(result)) return result;
  if (isProjectRowListing(tool, args)) {
    return result.filter((item: Record<string, unknown>) => {
      const path = projectPathOf(tool, item);
      return path !== undefined && enforcer.isAllowed(path);
    });
  }
  if (tool === 'browse_todos' && isTargetlessList(args)) {
    return result.filter((todo: Record<string, unknown>) => {
      const project = (todo.project as { path_with_namespace?: unknown } | undefined)
        ?.path_with_namespace;
      if (typeof project === 'string') return enforcer.isAllowed(project);
      const group = (todo.group as { full_path?: unknown } | undefined)?.full_path;
      if (typeof group === 'string') return enforcer.isGroupAllowed(group);
      return false;
    });
  }
  return result;
}
