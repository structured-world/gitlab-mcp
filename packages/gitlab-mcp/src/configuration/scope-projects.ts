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
 * How GitLab matches the text: a listing (`ProjectsFinder` search) against the project's own
 * path and name, ignoring terms under three characters; a search of projects
 * (`Gitlab::SearchResults#projects`) against its full path and full name, with every term.
 */
export type ProjectTextMatch = 'listing' | 'search';

/** Gitlab::SQL::Pattern::MIN_CHARS_FOR_PARTIAL_MATCHING */
const MIN_PARTIAL_TERM = 3;
/** Gitlab::SQL::Pattern::REGEX_QUOTED_TERM */
const QUOTED_TERM = /(?<=^| )"[^"]+"(?= |$)/g;

/** Gitlab::SQL::Pattern.split_query_to_search_terms: words, then quoted phrases. */
function searchTerms(query: string): string[] {
  const quoted: string[] = [];
  const rest = query.replace(QUOTED_TERM, (term) => {
    quoted.push(term.slice(1, -1));
    return '';
  });
  return [...rest.split(' ').filter(Boolean), ...quoted];
}

/**
 * Gitlab::SQL::Pattern#fuzzy_arel_match on one field: every kept term appears in it, case
 * aside; with no term kept, the field equals the whole query.
 */
function matchesField(value: unknown, query: string, terms: string[]): boolean {
  if (typeof value !== 'string') return false;
  const field = value.toLowerCase();
  return terms.length > 0 ? terms.every((term) => field.includes(term)) : field === query;
}

/**
 * Whether a project answers a listing or search: not archived, and one of its fields matches
 * the search as GitLab matches it (the terms all in the same field).
 */
export function matchesScopeProject(
  project: unknown,
  search: unknown,
  match: ProjectTextMatch,
): boolean {
  if (project === undefined) return false;
  const fields = project as Args;
  if (fields.archived === true) return false;
  const query = typeof search === 'string' ? search.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  if (!query) return true;
  const minLength = match === 'listing' ? MIN_PARTIAL_TERM : 0;
  const terms = searchTerms(query).filter((term) => term.length >= minLength);
  const values =
    match === 'listing'
      ? [fields.path, fields.name, fields.description]
      : [fields.path_with_namespace, fields.name_with_namespace, fields.description];
  return values.some((value) => matchesField(value, query, terms));
}

/** A project read in full, in the simple representation a listing or search answers with. */
export function simpleProject(project: unknown): unknown {
  return Object.fromEntries(
    Object.entries(project as Record<string, unknown>).filter(([key]) =>
      SIMPLE_PROJECT_FIELDS.has(key),
    ),
  );
}
