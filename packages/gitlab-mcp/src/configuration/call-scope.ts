/**
 * Projects the running tool call may read beyond the ones it names. The call's own targets
 * are checked before it runs; a tool that reaches further projects on its own, such as the
 * downstream pipelines of a pipeline search, checks each one here against the operator's
 * project list and the caller's working scope.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { GITLAB_ALLOWED_PROJECT_IDS } from '../config';
import type { ScopeEnforcer } from '../profiles/scope-enforcer';
import { canonicalProjectPath } from '../utils/api-path';
import { gitlab } from '../utils/gitlab-api';
import { withTargetPaths } from './scope-ids';

const storage = new AsyncLocalStorage<ScopeEnforcer | undefined>();

/**
 * Run `fn` with `workingScope` as the caller's working scope of everything it does. It is
 * the scope as the caller set it, not narrowed to the call's targets.
 */
export function runInCallScope<T>(workingScope: ScopeEnforcer | undefined, fn: () => T): T {
  return storage.run(workingScope, fn);
}

/**
 * Whether the running call may read the project with this numeric ID. An ID that the
 * operator's list and the working scope name is allowed as is; otherwise the project is
 * read from GitLab and checked as the path it stands for. A project GitLab does not show
 * is not allowed.
 */
export async function projectInCallScope(projectId: string): Promise<boolean> {
  const working = storage.getStore();
  const operator = GITLAB_ALLOWED_PROJECT_IDS.map((entry) =>
    canonicalProjectPath(entry).toLowerCase(),
  );
  const checkOperator = operator.length > 0 && !operator.includes(projectId);
  const checkWorking =
    working !== undefined && working.hasRestrictions() && !working.listsId(projectId, 'project');
  if (!checkOperator && !checkWorking) return true;
  const resolved = String((await withTargetPaths({ project_id: projectId })).project_id);
  if (/^\d+$/.test(resolved)) return false;
  if (checkOperator && !operator.includes(canonicalProjectPath(resolved).toLowerCase()))
    return false;
  return !checkWorking || working.isAllowed(resolved);
}

/**
 * Whether the running call may list work items of the project or group at this path.
 * The operator's list names projects only, so under it a group is never allowed; a path
 * it does not name literally is looked up for the ID it may name instead.
 */
export async function namespaceInCallScope(path: string): Promise<boolean> {
  const working = storage.getStore();
  if (working?.hasRestrictions() && !working.isAllowed(path) && !working.isGroupAllowed(path)) {
    return false;
  }
  const operator = GITLAB_ALLOWED_PROJECT_IDS.map((entry) =>
    canonicalProjectPath(entry).toLowerCase(),
  );
  if (operator.length === 0 || operator.includes(canonicalProjectPath(path).toLowerCase())) {
    return true;
  }
  try {
    const project = await gitlab.get<{ id?: unknown }>(`projects/${encodeURIComponent(path)}`);
    return operator.includes(String(project.id));
  } catch {
    // A group, or a project GitLab does not show, is not one the operator listed.
    return false;
  }
}

/**
 * Whether the running call may also list work items of every group and project below
 * the namespace at this path. The operator's list names projects only, which have none.
 */
export function descendantsInCallScope(path: string): boolean {
  if (GITLAB_ALLOWED_PROJECT_IDS.length > 0) return false;
  return storage.getStore()?.coversSubgroupsOf(path) ?? true;
}
