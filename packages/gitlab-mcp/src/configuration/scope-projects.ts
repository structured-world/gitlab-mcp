/**
 * Projects a scope names by path, read one by one where GitLab offers no listing of them:
 * project listings and project searches answered from the scope's own projects.
 */

import { parseGitLabApiError } from '../utils/error-handler';
import type { RunTool } from './scoped-execution';

type Args = Record<string, unknown>;

/** GitLab's simple project representation (BasicProjectDetails), returned unless simple=false. */
const SIMPLE_PROJECT_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'description',
  'name',
  'name_with_namespace',
  'path',
  'path_with_namespace',
  'created_at',
  'default_branch',
  'tag_list',
  'topics',
  'ssh_url_to_repo',
  'http_url_to_repo',
  'web_url',
  'readme_url',
  'forks_count',
  'license_url',
  'license',
  'avatar_url',
  'star_count',
  'last_activity_at',
  'visibility',
  'namespace',
  'custom_attributes',
  'repository_storage',
]);

/** One project of the scope, or undefined when GitLab has no such project (404). */
export function readScopeProject(run: RunTool, project_id: string): Promise<unknown> {
  return run('browse_projects', { action: 'get', project_id }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (parseGitLabApiError(message)?.status === 404) return undefined;
    throw error;
  });
}

/**
 * Whether a project answers a listing or search: not archived, and its name, path or
 * description holds the lowercased search.
 */
export function matchesScopeProject(project: unknown, search: string): boolean {
  if (project === undefined) return false;
  const { name, path_with_namespace, description, archived } = project as Args;
  if (archived === true) return false;
  if (!search) return true;
  return [name, path_with_namespace, description].some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(search),
  );
}

/** A project read in full, in the simple representation a listing or search answers with. */
export function simpleProject(project: unknown): unknown {
  return Object.fromEntries(
    Object.entries(project as Record<string, unknown>).filter(([key]) =>
      SIMPLE_PROJECT_FIELDS.has(key),
    ),
  );
}
