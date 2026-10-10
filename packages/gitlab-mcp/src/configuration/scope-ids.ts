/**
 * A working scope is saved as project and group paths, while GitLab accepts either a path
 * or a numeric id. Numeric ids are read from GitLab and checked as the paths they stand for.
 */

import { numericTargets, type NumericTargetKind } from '../profiles/scope-enforcer';
import { gitlab } from '../utils/gitlab-api';

type Args = Record<string, unknown>;
/** Reads one GitLab REST resource with the caller's token and instance. */
export type ReadResource = (path: string) => Promise<unknown>;

const readWithCaller: ReadResource = (path) => gitlab.get(path);

/**
 * The call's arguments with every numeric project or group id replaced by its path, for the
 * scope check only; the call itself keeps the ids. An id GitLab does not resolve stays
 * numeric, and the check refuses it. No request is made when no target is numeric.
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

async function field(read: ReadResource, path: string, name: string): Promise<string | undefined> {
  try {
    const value = ((await read(path)) as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' ? value : undefined;
  } catch {
    // Unknown or unreadable: the id stays numeric and the scope check refuses it.
    return undefined;
  }
}
