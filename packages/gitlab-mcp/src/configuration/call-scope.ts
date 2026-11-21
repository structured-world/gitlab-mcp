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
