/**
 * A working scope is checked against project and group paths, while GitLab accepts either a
 * path or a numeric id, and so does a preset's scope. Numeric ids are read from GitLab and
 * checked as the paths they stand for.
 */

import { numericTargets, ScopeEnforcer, type NumericTargetKind } from '../profiles/scope-enforcer';
import type { ScopeConfig } from '../profiles/types';
import { gitlab } from '../utils/gitlab-api';
import { parseGitLabApiError } from '../utils/error-handler';
import type { EffectivePolicy } from './policy';

type Args = Record<string, unknown>;
/** Reads one GitLab REST resource with the caller's token and instance. */
export type ReadResource = (path: string) => Promise<unknown>;

const readWithCaller: ReadResource = (path) => gitlab.get(path);

/**
 * The call's arguments with every numeric project or group id replaced by its path, for the
 * scope check only; the call itself keeps the ids. An id GitLab does not know stays numeric,
 * and the check refuses it, as does an id the scope lists itself, which the check accepts.
 * No request is made when no target needs a path.
 */
export async function withTargetPaths(
  args: Args,
  read: ReadResource = readWithCaller,
  scope?: ScopeEnforcer,
): Promise<Args> {
  const targets = numericTargets(args).filter(({ id, kind }) => !scope?.listsId(id, kind));
  if (targets.length === 0) return args;
  const paths = await Promise.all(targets.map(({ id, kind }) => pathOf(read, id, kind)));
  const resolved: Args = { ...args };
  targets.forEach(({ field }, index) => {
    const path = paths[index];
    if (path !== undefined) resolved[field] = path;
  });
  return resolved;
}

const isNumeric = (value: string | undefined): value is string =>
  value !== undefined && /^\d+$/.test(value);

/**
 * The policy with each project and group its scope names by numeric id named by its path: a
 * preset may name them either way, while scope checks and listed rows compare paths. An id
 * GitLab does not know stays numeric. No request is made for a scope of paths.
 */
export async function withScopePaths(
  policy: EffectivePolicy,
  read: ReadResource = readWithCaller,
): Promise<EffectivePolicy> {
  const scope = policy.scope;
  if (!scope) return policy;
  // One request per distinct id: a preset may name a group both as group and as namespace.
  const lookups = new Map<string, { id: string; kind: NumericTargetKind }>();
  for (const id of [scope.project, ...(scope.projects ?? [])])
    if (isNumeric(id)) lookups.set(`project:${id}`, { id, kind: 'project' });
  for (const id of [scope.group, scope.namespace, ...(scope.groups ?? [])])
    if (isNumeric(id)) lookups.set(`group:${id}`, { id, kind: 'group' });
  if (lookups.size === 0) return policy;
  const paths = new Map<string, string>();
  await Promise.all(
    [...lookups].map(async ([key, { id, kind }]) => {
      const path = await pathOf(read, id, kind);
      if (path !== undefined) paths.set(key, path);
    }),
  );
  const project = (id: string): string => paths.get(`project:${id}`) ?? id;
  const group = (id: string): string => paths.get(`group:${id}`) ?? id;
  const resolved: ScopeConfig = {
    ...scope,
    ...(scope.project ? { project: project(scope.project) } : {}),
    ...(scope.projects ? { projects: scope.projects.map(project) } : {}),
    ...(scope.group ? { group: group(scope.group) } : {}),
    ...(scope.groups ? { groups: scope.groups.map(group) } : {}),
    ...(scope.namespace ? { namespace: group(scope.namespace) } : {}),
  };
  return { ...policy, scope: resolved, scopeEnforcer: new ScopeEnforcer(resolved) };
}

/**
 * The path a numeric id stands for, or undefined. A group-valued argument names a namespace
 * (a user's too). An argument that may name either is read as a group, then as a project, as
 * the handlers read it (utils/namespace.ts): a user namespace sharing the id is neither.
 */
async function pathOf(
  read: ReadResource,
  id: string,
  kind: NumericTargetKind,
): Promise<string | undefined> {
  if (kind === 'group') return field(read, `namespaces/${id}`, 'full_path');
  if (kind === 'either') {
    const group = await field(read, `groups/${id}`, 'full_path');
    if (group !== undefined) return group;
  }
  return field(read, `projects/${id}`, 'path_with_namespace');
}

/**
 * One field of a GitLab resource, or undefined when GitLab has no such resource (404). Any
 * other failure fails the call with GitLab's error, so a rejected token reaches the
 * reauthorization challenge instead of reading as a target outside the scope.
 */
async function field(read: ReadResource, path: string, name: string): Promise<string | undefined> {
  let resource: unknown;
  try {
    resource = await read(path);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (parseGitLabApiError(message)?.status === 404) return undefined;
    throw error;
  }
  const value = (resource as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
}
