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
 * Why a targetless call cannot be narrowed to the scope, or null. Only a global search
 * under a scope of several projects or groups: no single filter expresses it.
 */
export function targetlessRestriction(tool: string, args: Args, scope: ScopeConfig): string | null {
  if (tool === 'browse_search' && args.action === 'global' && !singleTarget(scope)) {
    return 'a global search cannot be limited to a working scope of several projects or groups; search within one of them';
  }
  return null;
}

/** The call's arguments with the scope as its filter, where the tool takes one. */
export function scopedArgs(tool: string, args: Args, scope: ScopeConfig): Args {
  const target = singleTarget(scope);
  if (!target) return args;
  if (tool === 'browse_search' && args.action === 'global') {
    // Group search always covers subgroups: GitLab has no option to exclude them.
    return 'group' in target
      ? { ...args, action: 'group', group_id: target.group }
      : { ...args, action: 'project', project_id: target.project };
  }
  if (tool === 'browse_projects' && args.action === 'list' && !hasValue(args.group_id)) {
    if ('group' in target) {
      return {
        ...args,
        group_id: target.group,
        include_subgroups: scope.includeSubgroups !== false,
      };
    }
  }
  if (tool === 'browse_merge_requests' && args.action === 'list' && !hasValue(args.project_id)) {
    if ('project' in target) return { ...args, project_id: target.project };
  }
  return args;
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

/**
 * The results of a call that stayed targetless, narrowed to the scope. An item whose
 * place cannot be told is left out: listing it could show something outside the scope.
 */
export function scopedResult(
  tool: string,
  args: Args,
  result: unknown,
  enforcer: ScopeEnforcer,
): unknown {
  if (!Array.isArray(result)) return result;
  const listing =
    (tool === 'browse_projects' &&
      (args.action === 'search' || (args.action === 'list' && !hasValue(args.group_id)))) ||
    (tool === 'browse_merge_requests' && args.action === 'list' && !hasValue(args.project_id));
  if (listing) {
    return result.filter((item: Record<string, unknown>) => {
      const path = projectPathOf(tool, item);
      return path !== undefined && enforcer.isAllowed(path);
    });
  }
  if (
    tool === 'browse_todos' &&
    args.action === 'list' &&
    !hasValue(args.project_id) &&
    !hasValue(args.group_id)
  ) {
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
