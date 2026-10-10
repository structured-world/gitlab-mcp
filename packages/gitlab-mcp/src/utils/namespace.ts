import { enhancedFetch } from './fetch';
import { getGitLabBaseUrl } from './gitlab-base-url';

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
 */
export async function findNamespaceType(
  namespacePath: string,
): Promise<'project' | 'group' | null> {
  const order: Array<'project' | 'group'> = isLikelyProjectPath(namespacePath)
    ? ['project', 'group']
    : ['group', 'project'];
  for (const type of order) {
    if (await verifyNamespaceType(namespacePath, type)) return type;
  }
  return null;
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
 * Verify if a namespace exists as the specified type by making a lightweight API call
 */
async function verifyNamespaceType(
  namespacePath: string,
  type: 'project' | 'group',
): Promise<boolean> {
  try {
    const entityType = type === 'project' ? 'projects' : 'groups';
    const apiUrl = `${getGitLabBaseUrl()}/api/v4/${entityType}/${encodeURIComponent(namespacePath)}`;

    const response = await enhancedFetch(apiUrl);

    return response.ok;
  } catch {
    // If API call fails, return false
    return false;
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
    encodedPath: encodeURIComponent(namespacePath),
  };
}
