/**
 * Project and group search for choosing a working scope in the settings panel. It reads
 * only what the account can already see in GitLab and returns paths and names, nothing
 * else of the projects.
 */

import { gitlab } from '../../utils/gitlab-api';

export const SCOPE_SEARCH_TOOL = 'find_scope_targets';

/** Results of one kind; projects and groups are listed together. */
const PER_KIND = 10;

export interface ScopeTarget {
  type: 'project' | 'group';
  /** Full path, as the scope setting takes it. */
  path: string;
  /** Display name with its namespace. */
  name: string;
}

export const SCOPE_SEARCH_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      minLength: 2,
      maxLength: 100,
      description: 'Part of a project or group name or path.',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

export const SCOPE_SEARCH_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['project', 'group'] },
          path: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['type', 'path', 'name'],
        additionalProperties: false,
      },
    },
  },
  required: ['targets'],
  additionalProperties: false,
};

interface GitLabProject {
  path_with_namespace: string;
  name_with_namespace: string;
}

interface GitLabGroup {
  full_path: string;
  full_name: string;
}

/** Projects the account is a member of and groups it can see, matching the query. */
export async function findScopeTargets(query: string): Promise<{ targets: ScopeTarget[] }> {
  const search = query.trim();
  if (search.length < 2 || search.length > 100) {
    throw new Error('Search for 2 to 100 characters');
  }
  const [projects, groups] = await Promise.all([
    gitlab.get<GitLabProject[]>('projects', {
      query: {
        search,
        membership: 'true',
        simple: 'true',
        per_page: String(PER_KIND),
        order_by: 'last_activity_at',
      },
    }),
    gitlab.get<GitLabGroup[]>('groups', {
      query: { search, per_page: String(PER_KIND) },
    }),
  ]);
  return {
    targets: [
      ...groups.map((g) => ({ type: 'group' as const, path: g.full_path, name: g.full_name })),
      ...projects.map((p) => ({
        type: 'project' as const,
        path: p.path_with_namespace,
        name: p.name_with_namespace,
      })),
    ],
  };
}
