/**
 * A working scope is saved as project and group paths, while GitLab accepts either a path
 * or a numeric id. Numeric ids are read from GitLab and checked as the paths they stand for.
 */

import { numericTargets, type NumericTargetKind } from '../profiles/scope-enforcer';
import { gitlab } from '../utils/gitlab-api';
import { parseGitLabApiError } from '../utils/error-handler';

type Args = Record<string, unknown>;
/** Reads one GitLab REST resource with the caller's token and instance. */
export type ReadResource = (path: string) => Promise<unknown>;

const readWithCaller: ReadResource = (path) => gitlab.get(path);

/**
 * The call's arguments with every numeric project or group id replaced by its path, for the
 * scope check only; the call itself keeps the ids. An id GitLab does not know stays numeric,
 * and the check refuses it. No request is made when no target is numeric.
 */
export async function withTargetPaths(
  args: Args,
  read: ReadResource = readWithCaller,
): Promise<Args> {
  const targets = numericTargets(args);
  if (targets.length === 0) return args;
  const paths = await Promise.all(targets.map(({ id, kind }) => pathOf(read, id, kind)));
  const resolved: Args = { ...args };
  targets.forEach(({ field }, index) => {
    const path = paths[index];
    if (path !== undefined) resolved[field] = path;
  });
  return resolved;
}

/**
 * The path a numeric id stands for, or undefined. A group id is a namespace id; an argument
 * that may name either is read as a group first, as the handlers read a path without a slash.
 */
async function pathOf(
  read: ReadResource,
  id: string,
  kind: NumericTargetKind,
): Promise<string | undefined> {
  if (kind !== 'project') {
    const group = await field(read, `namespaces/${id}`, 'full_path');
    if (group !== undefined || kind === 'group') return group;
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
