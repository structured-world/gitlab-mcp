import * as z from "zod";
import { BrowseSearchSchema } from "./schema-readonly";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";
import { gitlab, paths, toQuery } from "../../utils/gitlab-api";

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
    "browse_search",
    {
      name: "browse_search",
      description:
        'SEARCH GitLab resources. Actions: "global" searches entire instance, "project" searches within a project, "group" searches within a group. Scopes: projects, issues, merge_requests, milestones, users, groups, blobs (code), commits, wiki_blobs, notes.',
      inputSchema: z.toJSONSchema(BrowseSearchSchema),
      gate: { envVar: "USE_SEARCH", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseSearchSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_search", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_search tool`);
        }

        switch (input.action) {
          case "global": {
            // TypeScript knows: input has scope, search, and optional filters
            const { scope, ...params } = input;

            // Build query params excluding action (not an API parameter)
            const query = toQuery(params, ["action"]);

            // Global search endpoint
            const results = await gitlab.get<unknown[]>("search", {
              query: { ...query, scope },
            });

            return {
              scope,
              count: results.length,
              results,
            };
          }

          case "project": {
            // TypeScript knows: input has project_id, scope, search, and optional filters
            const { project_id, scope, ref, ...params } = input;

            // Build query params excluding action (project_id, scope, ref are already destructured)
            const query = toQuery(params, ["action"]);

            // Project-scoped search endpoint
            const results = await gitlab.get<unknown[]>(`${paths.project(project_id)}/search`, {
              query: { ...query, scope, ...(ref && { ref }) },
            });

            return {
              project_id,
              scope,
              count: results.length,
              results,
            };
          }

          case "group": {
            // TypeScript knows: input has group_id, scope, search, and optional filters
            const { group_id, scope, ...params } = input;

            // Build query params excluding action (group_id, scope are already destructured)
            const query = toQuery(params, ["action"]);

            // Group-scoped search endpoint
            const results = await gitlab.get<unknown[]>(`${paths.group(group_id)}/search`, {
              query: { ...query, scope },
            });

            return {
              group_id,
              scope,
              count: results.length,
              results,
            };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
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
  return ["browse_search"];
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
