import { enhancedFetch } from './fetch';
import { getGitLabBaseUrl } from './gitlab-base-url';
import { decodePath } from '../profiles/scope-enforcer';
import { normalizeProjectId } from './projectIdentifier';

/**
 * Extract namespace (group path) from a full project path.
 *
 * Examples:
 * - "group/project" -> "group"
 * - "group/subgroup/project" -> "group/subgroup"
 * - "myproject" (single segment) -> "myproject" (root-level project)
 * - "" (empty) -> undefined
 *
 * @param projectPath - Full project path (e.g., "group/project")
 * @returns Namespace path or undefined if projectPath is empty
 */
export function extractNamespaceFromPath(projectPath: string): string | undefined {
  if (!projectPath) {
    return undefined;
  }

  const pathParts = projectPath.split('/');

  // Single segment = root-level project, namespace equals project path
  if (pathParts.length === 1) {
    return projectPath;
  }

  // Multiple segments = namespace is everything except the last part
  return pathParts.slice(0, -1).join('/');
}

/**
 * Simple heuristic to determine if a path likely represents a project
 * Projects typically contain a slash (group/project), while groups usually don't
 */
export function isLikelyProjectPath(namespacePath: string): boolean {
  return namespacePath.includes('/');
}

/**
 * Whether GitLab knows the path as a project or a group, or null when it confirms neither
 * (the path does not exist, or GitLab could not be reached). The likelier type is asked first.
 * A URL-encoded path, as tools accept it, is looked up and reported decoded.
 */
export async function findNamespaceType(
  namespacePath: string,
  resolvedPath?: (path: string) => void,
): Promise<'project' | 'group' | null> {
  const path = decodePath(namespacePath);
  if (/^\d+$/.test(path)) return findNumericNamespaceType(path, resolvedPath);
  const order: Array<'project' | 'group'> = isLikelyProjectPath(path)
    ? ['project', 'group']
    : ['group', 'project'];
  for (const type of order) {
    if (await verifyNamespaceType(path, type, resolvedPath)) return type;
  }
  return null;
}

/**
 * Projects and groups are numbered separately, so one id can name a group and an unrelated
 * project: both are asked, and an id naming both is refused rather than taken as either.
 */
async function findNumericNamespaceType(
  id: string,
  resolvedPath?: (path: string) => void,
): Promise<'project' | 'group' | null> {
  // Both answers are needed whatever the other one is, so they are asked together.
  const probe = async (type: 'project' | 'group') => {
    let path: string | undefined;
    await verifyNamespaceType(id, type, (resolved) => {
      path = resolved;
    });
    return path === undefined ? [] : [{ type, path }];
  };
  const found = (await Promise.all([probe('group'), probe('project')])).flat();
  if (found.length > 1) {
    throw new Error(
      `'${id}' is the ID of both group '${found[0].path}' and project '${found[1].path}'; name the one you mean by its path`,
    );
  }
  const [match] = found;
  if (!match) return null;
  resolvedPath?.(match.path);
  return match.type;
}

/**
 * Detect namespace type by attempting to fetch from GitLab API, falling back to the path
 * shape when GitLab confirms neither type
 */
export async function detectNamespaceType(namespacePath: string): Promise<'project' | 'group'> {
  return (
    (await findNamespaceType(namespacePath)) ??
    (isLikelyProjectPath(namespacePath) ? 'project' : 'group')
  );
}

/**
 * Verify if a namespace exists as the specified type by making a lightweight API call.
 * A rejected sign-in (401, or 403 insufficient_scope) fails with GitLab's error, so the call
 * reaches the reauthorization challenge; other failures read as "not this type".
 * A successful response with an invalid canonical identity fails with namespace context.
 */
async function verifyNamespaceType(
  namespacePath: string,
  type: 'project' | 'group',
  resolvedPath?: (path: string) => void,
): Promise<boolean> {
  const entityType = type === 'project' ? 'projects' : 'groups';
  const apiUrl = `${getGitLabBaseUrl()}/api/v4/${entityType}/${encodeURIComponent(namespacePath)}`;
  let response: Response;
  try {
    response = await enhancedFetch(apiUrl);
  } catch {
    // Unreachable: the caller falls back or reports that GitLab could not confirm the path.
    return false;
  }
  if (response.ok) {
    if (resolvedPath) {
      resolvedPath(await canonicalNamespacePath(response, namespacePath, type));
    }
    return true;
  }
  if (response.status === 401) {
    throw new Error(`GitLab API error: 401 ${response.statusText}`);
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    // RFC 6750 section 3.1: the token lacks a scope, not access to this path.
    if (body.includes('insufficient_scope')) {
      throw new Error(`GitLab API error: 403 ${response.statusText} - insufficient_scope`);
    }
  }
  return false;
}

/** Numeric scope selections use the path from the already-fetched entity, never another lookup. */
async function canonicalNamespacePath(
  response: Response,
  input: string,
  type: 'project' | 'group',
): Promise<string> {
  if (!/^\d+$/.test(input)) return input;
  try {
    const entity = (await response.json()) as {
      full_path?: unknown;
      path_with_namespace?: unknown;
    };
    const path = type === 'group' ? entity.full_path : entity.path_with_namespace;
    if (typeof path !== 'string' || path.length === 0)
      throw new Error('GitLab did not return the canonical namespace path');
    return path;
  } catch (cause) {
    throw new Error(`Could not resolve canonical namespace path for ${type} '${input}'`, { cause });
  }
}

/**
 * Determine the appropriate entity type and path for GitLab API calls
 * Returns the entity type ('projects' or 'groups') and ensures proper encoding
 */
export async function resolveNamespaceForAPI(namespacePath: string): Promise<{
  entityType: 'projects' | 'groups';
  encodedPath: string;
}> {
  const namespaceType = await detectNamespaceType(namespacePath);
  return {
    entityType: namespaceType === 'project' ? 'projects' : 'groups',
    encodedPath: normalizeProjectId(namespacePath),
  };
}
