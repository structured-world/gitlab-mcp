/**
 * Listing and search calls that name no project or group read across everything the
 * account can see. Under a working scope they are narrowed to it: the scope becomes the
 * call's own filter where the tool has one, and otherwise the results are filtered.
 */

import type { ScopeConfig } from '../profiles/types';
import { decodePath, type ScopeEnforcer } from '../profiles/scope-enforcer';

type Args = Record<string, unknown>;

/** One group (with or without its subgroups) or one project. */
export type Target = { group: string; subgroups: boolean } | { project: string };

/**
 * The scope as one group or one project, when it is exactly that, however a preset names it:
 * the single field, a list of one, or a namespace. A namespace always covers its subgroups.
 */
export function singleTarget(scope: ScopeConfig): Target | undefined {
  let found: Target | undefined;
  for (const target of scopeTargets(scope)) {
    if (found) return undefined;
    found = target;
  }
  return found;
}

/**
 * Iterate targets by reference, allowing callers to stop without copying a wide preset. A
 * preset may name a place URL-encoded, as tools accept it; targets carry the plain path,
 * which tools encode themselves and listed paths are compared with.
 */
export function* scopeTargets(scope: ScopeConfig): Generator<Target> {
  const subgroups = scope.includeSubgroups !== false;
  if (hasValue(scope.project)) yield { project: decodePath(scope.project as string) };
  for (const project of scope.projects ?? [])
    if (hasValue(project)) yield { project: decodePath(project) };
  if (hasValue(scope.group)) yield { group: decodePath(scope.group as string), subgroups };
  for (const group of scope.groups ?? [])
    if (hasValue(group)) yield { group: decodePath(group), subgroups };
  if (hasValue(scope.namespace))
    yield { group: decodePath(scope.namespace as string), subgroups: true };
}

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/**
 * Search scopes GitLab answers for one project and for one group, so a global search under
 * several targets searches each of them (lib/api/helpers/search_helpers.rb).
 */
export const COMPOSED_SEARCH_SCOPES: ReadonlySet<string> = new Set([
  'issues',
  'merge_requests',
  'milestones',
  'notes',
  'wiki_blobs',
  'commits',
  'blobs',
  'users',
]);

/**
 * Why a targetless call cannot be narrowed to the scope, or null: a creation that names no
 * place, a global search without a multi-target emulator, and instance-wide listings
 * with no per-scope form. A group without its subgroups reads the
 * group's results kept to its own projects instead.
 */
export function targetlessRestriction(tool: string, args: Args, scope: ScopeConfig): string | null {
  const creation = creationRestriction(tool, args, scope);
  if (creation) return creation;
  if (tool === 'browse_search' && args.action === 'global') {
    // Group and project search have no snippet_titles scope (lib/api/helpers/search_helpers.rb);
    // scoped execution searches the scope's project snippets itself.
    if (args.scope === 'snippet_titles') return null;
    // The scope's groups answer a search of groups; a scope of projects reaches no group.
    if (args.scope === 'groups' && scopeProjectsOnly(scope)) {
      return 'groups cannot be searched under a working scope made of projects, which reaches no group';
    }
    // These emulators compose multiple targets; they do not need a single target rewrite.
    // Groups answer a search of projects themselves, and the scope's projects are matched.
    if (args.scope === 'groups' || args.scope === 'projects') return null;
    if (COMPOSED_SEARCH_SCOPES.has(args.scope as string)) return null;
    return unnarrowable(scope, 'a global search cannot be limited', 'search within');
  }
  // GitLab lists namespaces across the instance; a scope of projects reaches no group.
  if (tool === 'browse_namespaces' && args.action === 'list' && scopeProjectsOnly(scope)) {
    return 'namespaces cannot be listed for a working scope made of projects, which reaches no group';
  }
  return INSTANCE_LISTINGS[tool]?.(args) ?? null;
}

/**
 * Per tool: why a listing across the whole instance (or all of the caller's activity) cannot
 * be narrowed to the scope, or null. Those it can are rewritten by NARROWERS or composed by
 * scoped execution. A user search (browse_users) stays the instance's user directory: users
 * belong to the instance, and the search finds people not yet members of the scope, to add,
 * assign or mention them. The scope's members are found with a global search of users, which
 * the scope narrows to its projects and groups.
 */
const INSTANCE_LISTINGS: Record<string, (args: Args) => string | null> = {
  // User events are resolved and filtered by scoped execution for groups and multiple targets.
  // Deploy keys are listed per project and composed across the scope's projects; the public
  // listing exists only instance-wide.
  browse_deploy_keys: (args) =>
    args.action === 'list' && !hasValue(args.project_id) && args.public === true
      ? "public deploy keys are listed for the whole instance and cannot be limited to the working scope; list a project's keys with 'project_id'"
      : null,
  // Public and personal snippets belong to no project: one is listed across the whole
  // instance, the other across the account, and neither can be kept to the scope.
  browse_snippets: (args) => {
    if (args.action !== 'list') return null;
    if (args.scope === 'public')
      return "public snippets are listed across the whole instance only and cannot be limited to the working scope; list a project's snippets with scope 'project'";
    if (args.scope === 'personal')
      return "personal snippets belong to no project and cannot be limited to the working scope; list a project's snippets with scope 'project'";
    return null;
  },
  // Personal access tokens belong to an account, not to any project or group.
  browse_access_tokens: (args) =>
    args.action === 'list_personal'
      ? "personal access tokens belong to no project or group and cannot be limited to the working scope; list a project's or a group's tokens with action 'list_project' or 'list_group'"
      : null,
};

/** Why a call GitLab only offers per project or per group cannot follow several targets. */
function unnarrowable(scope: ScopeConfig, what: string, instead: string): string | null {
  return singleTarget(scope)
    ? null
    : `${what} for a working scope of several projects or groups; ${instead} one of them`;
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

/** A snippet created without a project, which GitLab makes a personal snippet. */
const isPersonalSnippetCreation = (tool: string, args: Args): boolean =>
  tool === 'manage_snippet' && args.action === 'create' && !hasValue(args.projectId);

/**
 * Creation that names no place lands outside the scope: a project created or forked without
 * a namespace in the user's own namespace (filled in with the scope group when there is a
 * single one), a group without a parent at the top level, a snippet without a project as a
 * personal snippet (filled in with the scope project when there is a single one).
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
  if (isPersonalSnippetCreation(tool, args)) {
    const target = singleTarget(scope);
    if (target && 'project' in target) return null;
    return "a snippet without 'projectId' would be a personal snippet outside the working scope; name the project to create it in with 'projectId'";
  }
  return null;
}

/**
 * The projects of a scope made of projects only, or null. Listing them directly replaces a
 * project listing that GitLab paginates before the scope could filter it.
 */
export function scopeProjectsOnly(scope: ScopeConfig): string[] | null {
  if (scope.group || scope.groups?.length || scope.namespace) return null;
  // Consumers only read this list; borrow an existing list instead of copying a wide preset.
  if (!scope.project) return scope.projects?.length ? scope.projects : null;
  return [scope.project, ...(scope.projects ?? [])];
}

/** A listing that names neither a project nor a group. */
const isTargetlessList = (args: Args): boolean =>
  args.action === 'list' && !hasValue(args.project_id) && !hasValue(args.group_id);

/**
 * Per tool: the call's arguments with the single scope target as their filter, or null
 * when the call keeps its own arguments.
 */
const NARROWERS: Record<string, (args: Args, target: Target) => Args | null> = {
  browse_search: (args, target) => {
    if (args.action !== 'global') return null;
    // Group search covers subgroups; under a scope without them its rows are filtered.
    return 'group' in target
      ? { ...args, action: 'group', group_id: target.group }
      : { ...args, action: 'project', project_id: target.project };
  },
  // The caller's own exclusion of subgroups stays; a scope without them excludes them anyway.
  // A plain listing lists active projects, a group listing only when asked: that default is
  // kept unless the caller chose active or archived projects.
  browse_projects: (args, target) =>
    args.action === 'list' && !hasValue(args.group_id) && 'group' in target
      ? {
          ...args,
          group_id: target.group,
          include_subgroups: target.subgroups && args.include_subgroups !== false,
          ...(hasValue(args.active) || hasValue(args.archived) ? {} : { active: true }),
        }
      : null,
  // The targetless listing shows the caller's own merge requests unless asked otherwise, while
  // a project's or group's shows everyone's, so that default is kept. Both of those listings
  // take `scope` too: it is declared in merge_requests_base_params, which they use, and only
  // its created_by_me default is the targetless listing's own (merge_requests_helpers.rb,
  // applied by IssuableFinder#by_scope). A group's listing covers its subgroups; without
  // them it is filtered.
  browse_merge_requests: (args, target) => {
    if (!isTargetlessList(args)) return null;
    const place = 'project' in target ? { project_id: target.project } : { group_id: target.group };
    return { ...args, ...place, scope: args.scope ?? 'created_by_me' };
  },
  // The caller's own activity spans every project; a project scope shows that project's.
  browse_events: (args, target) =>
    args.action === 'user' && 'project' in target
      ? { ...args, action: 'project', project_id: target.project }
      : null,
  browse_snippets: (args, target) =>
    args.action === 'list' &&
    args.scope === 'project' &&
    !hasValue(args.projectId) &&
    'project' in target
      ? { ...args, projectId: target.project }
      : null,
  manage_snippet: (args, target) =>
    isPersonalSnippetCreation('manage_snippet', args) && 'project' in target
      ? { ...args, projectId: target.project }
      : null,
  browse_deploy_keys: (args, target) => {
    if (
      args.action !== 'list' ||
      hasValue(args.project_id) ||
      args.public === true ||
      !('project' in target)
    )
      return null;
    // public=false is the default; the project endpoint does not accept that field.
    const { public: _public, ...listing } = args;
    return { ...listing, project_id: target.project };
  },
  // Runners available to the scope's project or group, with the same filters. The caller's
  // owned runners keep their own feed and are filtered to the scope instead.
  browse_runners: (args, target) => {
    if (args.action !== 'list_all') return null;
    return 'group' in target
      ? { ...args, action: 'list_group', group_id: target.group }
      : { ...args, action: 'list_project', project_id: target.project };
  },
  // A project scope's trail is the project's; a group's holds only the group's own events, so
  // scoped execution reads it with its projects' trails instead.
  browse_audit_events: (args, target) =>
    args.action === 'list_instance' &&
    !hasValue(args.entity_type) &&
    !hasValue(args.entity_id) &&
    'project' in target
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
  if (!target) return args;
  return targetArgs(tool, args, target) ?? args;
}

/** The call's arguments kept to one target of the scope, or null when the tool has no such form. */
export function targetArgs(tool: string, args: Args, target: Target): Args | null {
  return NARROWERS[tool]?.(args, target) ?? null;
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
  return (
    isProjectRowListing(tool, args) ||
    isScopedTodoListing(tool, args) ||
    isNamespaceListing(tool, args)
  );
}

/**
 * A todo listing not kept to one project. A group's todo filter covers its subgroups too, so
 * a listing naming a group of a scope without them is filtered as well.
 */
const isScopedTodoListing = (tool: string, args: Args): boolean =>
  tool === 'browse_todos' && args.action === 'list' && !hasValue(args.project_id);

/** The instance-wide namespace listing, which has no per-group form. */
const isNamespaceListing = (tool: string, args: Args): boolean =>
  tool === 'browse_namespaces' && args.action === 'list';

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
  if (isScopedTodoListing(tool, args)) {
    return result.filter((todo: Record<string, unknown>) => {
      const project = (todo.project as { path_with_namespace?: unknown } | undefined)
        ?.path_with_namespace;
      if (typeof project === 'string') return enforcer.isAllowed(project);
      const group = (todo.group as { full_path?: unknown } | undefined)?.full_path;
      if (typeof group === 'string') return enforcer.isGroupAllowed(group);
      return false;
    });
  }
  if (isNamespaceListing(tool, args)) {
    return result.filter((namespace: Record<string, unknown>) => {
      const path = namespace.full_path;
      return typeof path === 'string' && enforcer.isGroupAllowed(path);
    });
  }
  return result;
}
