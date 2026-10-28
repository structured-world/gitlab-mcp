import * as z from 'zod';
import { BrowseSearchSchema, type BrowseSearchInput } from './schema-readonly';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';
import { gitlab, GitLabApiError, paths, toQuery } from '../../utils/gitlab-api';
import { stripProjectSecrets } from '../core/project-response';
import { StructuredToolError } from '../../utils/error-handler';

const UNAVAILABLE_SCOPE_ERRORS = new Set([
  'scope does not have a valid value',
  'Scope not supported without Elasticsearch!',
  'Scope supported only with advanced search',
  'Scope supported only with advanced search or exact code search',
]);

/** Cross-project search availability depends on the configured search backend, not only tier. */
function throwSearchError(error: unknown, input: BrowseSearchInput): never {
  const { scope } = input;
  // GitLab 16.0 ee/lib/ee/api/search.rb:19-27; newer releases also allow exact code search.
  if (
    error instanceof GitLabApiError &&
    error.status === 400 &&
    input.action !== 'project' &&
    (scope === 'blobs' || scope === 'commits' || scope === 'notes' || scope === 'wiki_blobs') &&
    UNAVAILABLE_SCOPE_ERRORS.has(error.details)
  ) {
    const backend = scope === 'blobs' ? 'Advanced Search or exact code search' : 'Advanced Search';
    const suggestedFix = `Use browse_search with action 'project', project_id and scope '${scope}' to search within one project.`;
    throw new StructuredToolError({
      error_code: 'API_ERROR',
      tool: 'browse_search',
      action: input.action,
      http_status: error.status,
      message: `GitLab rejected ${input.action} scope '${scope}': ${backend} is unavailable for this search.`,
      suggested_fix: suggestedFix,
      gitlab_error: error.details,
    });
  }
  throw error;
}

/**
 * Search tools registry - 1 read-only CQRS tool
 *
 * browse_search (Query): global, project, group
 *
 * Search is read-only by design - no manage_search tool needed.
 */
export const searchToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_search - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    'browse_search',
    {
      name: 'browse_search',
      description:
        'Search across GitLab resources globally or within a scope. Actions: global (entire instance), project (within specific project), group (within specific group). Searchable: projects, issues, merge_requests, milestones, users, blobs (code), commits, wiki_blobs, notes.',
      inputSchema: z.toJSONSchema(BrowseSearchSchema),
      requirements: {
        default: { tier: 'free' },
        actions: {
          group: { tier: 'free', notes: 'Group-scoped search' },
        },
      },
      gate: { envVar: 'USE_SEARCH', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseSearchSchema.parse(args);

        assertActionAllowed('browse_search', input.action);

        try {
          switch (input.action) {
            case 'global': {
              // TypeScript knows: input has scope, search, and optional filters
              const { scope, ...params } = input;

              // Build query params excluding action (not an API parameter)
              const query = toQuery(params, ['action']);

              // Global search endpoint
              const results = await gitlab.get<unknown[]>('search', {
                query: { ...query, scope },
              });

              return {
                scope,
                count: results.length,
                results: scope === 'projects' ? stripProjectSecrets(results) : results,
              };
            }

            case 'project': {
              // TypeScript knows: input has project_id, scope, search, and optional filters
              const { project_id, scope, ref, ...params } = input;

              // Build query params excluding action (project_id, scope, ref are already destructured)
              const query = toQuery(params, ['action']);

              // Project-scoped search endpoint
              const results = await gitlab.get<unknown[]>(`${paths.project(project_id)}/search`, {
                query: { ...query, scope, ...(ref && { ref }) },
              });

              return {
                project_id,
                scope,
                count: results.length,
                results: scope === 'projects' ? stripProjectSecrets(results) : results,
              };
            }

            case 'group': {
              // TypeScript knows: input has group_id, scope, search, and optional filters
              const { group_id, scope, ...params } = input;

              // Build query params excluding action (group_id, scope are already destructured)
              const query = toQuery(params, ['action']);

              // Group-scoped search endpoint
              const results = await gitlab.get<unknown[]>(`${paths.group(group_id)}/search`, {
                query: { ...query, scope },
              });

              return {
                group_id,
                scope,
                count: results.length,
                results: scope === 'projects' ? stripProjectSecrets(results) : results,
              };
            }

            /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
            default:
              throw new Error(`Unknown action: ${(input as { action: string }).action}`);
          }
        } catch (error) {
          throwSearchError(error, input);
        }
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 * Search is entirely read-only, so all tools are read-only
 */
export function getSearchReadOnlyToolNames(): string[] {
  return ['browse_search'];
}

/**
 * Get all tool definitions from the registry
 */
export function getSearchToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(searchToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 * Since search is read-only, this always returns all tools
 */
export function getFilteredSearchTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  // Search is always read-only, so readOnlyMode doesn't affect filtering
  void readOnlyMode;
  return getSearchToolDefinitions();
}
