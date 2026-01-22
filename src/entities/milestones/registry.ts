import * as z from "zod";
import { BrowseMilestonesSchema } from "./schema-readonly";
import { ManageMilestoneSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { resolveNamespaceForAPI } from "../../utils/namespace";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
// assertDefined no longer needed - discriminated union provides type safety
import { isActionDenied } from "../../config";

/**
 * Milestones tools registry - 2 CQRS tools replacing 9 individual tools
 *
 * browse_milestones (Query): list, get, issues, merge_requests, burndown
 * manage_milestone (Command): create, update, delete, promote
 */
export const milestonesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_milestones - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_milestones",
    {
      name: "browse_milestones",
      description:
        'BROWSE milestones. Actions: "list" shows milestones with filtering, "get" retrieves single milestone, "issues" lists issues in milestone, "merge_requests" lists MRs in milestone, "burndown" gets burndown chart data.',
      inputSchema: z.toJSONSchema(BrowseMilestonesSchema),
      gate: { envVar: "USE_MILESTONE", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseMilestonesSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_milestones", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_milestones tool`);
        }

        const { entityType, encodedPath } = await resolveNamespaceForAPI(input.namespace);

        switch (input.action) {
          case "list": {
            const { action: _action, namespace: _namespace, ...rest } = input;
            const query = toQuery(rest, []);

            return gitlab.get(`${entityType}/${encodedPath}/milestones`, { query });
          }

          case "get": {
            // TypeScript knows: input has milestone_id or iid (at least one required by schema)
            // Prefer iid if both are provided, fallback to milestone_id
            const milestoneIdentifier = input.iid ?? input.milestone_id;
            return gitlab.get(`${entityType}/${encodedPath}/milestones/${milestoneIdentifier}`);
          }

          case "issues": {
            // TypeScript knows: input has milestone_id or iid (at least one required), per_page, page (optional)
            const { action: _action, namespace: _namespace, milestone_id, iid, ...rest } = input;
            const milestoneIdentifier = iid ?? milestone_id;
            const query = toQuery(rest, []);

            return gitlab.get(
              `${entityType}/${encodedPath}/milestones/${milestoneIdentifier}/issues`,
              {
                query,
              }
            );
          }

          case "merge_requests": {
            // TypeScript knows: input has milestone_id or iid (at least one required), per_page, page (optional)
            const { action: _action, namespace: _namespace, milestone_id, iid, ...rest } = input;
            const milestoneIdentifier = iid ?? milestone_id;
            const query = toQuery(rest, []);

            return gitlab.get(
              `${entityType}/${encodedPath}/milestones/${milestoneIdentifier}/merge_requests`,
              { query }
            );
          }

          case "burndown": {
            // TypeScript knows: input has milestone_id or iid (at least one required), per_page, page (optional)
            const { action: _action, namespace: _namespace, milestone_id, iid, ...rest } = input;
            const milestoneIdentifier = iid ?? milestone_id;
            const query = toQuery(rest, []);

            return gitlab.get(
              `${entityType}/${encodedPath}/milestones/${milestoneIdentifier}/burndown_events`,
              { query }
            );
          }

          /* istanbul ignore next -- unreachable with Zod validation */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_milestone - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_milestone",
    {
      name: "manage_milestone",
      description:
        'MANAGE milestones. Actions: "create" creates new milestone, "update" modifies existing milestone, "delete" removes milestone, "promote" elevates project milestone to group level.',
      inputSchema: z.toJSONSchema(ManageMilestoneSchema),
      gate: { envVar: "USE_MILESTONE", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageMilestoneSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_milestone", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_milestone tool`);
        }

        const { entityType, encodedPath } = await resolveNamespaceForAPI(input.namespace);

        switch (input.action) {
          case "create": {
            // TypeScript knows: input has title (required), description, due_date, start_date (optional)
            const { action: _action, namespace: _namespace, ...body } = input;

            return gitlab.post(`${entityType}/${encodedPath}/milestones`, {
              body,
              contentType: "json",
            });
          }

          case "update": {
            // TypeScript knows: input has milestone_id or iid (at least one required), title, description, etc. (optional)
            const { action: _action, namespace: _namespace, milestone_id, iid, ...body } = input;
            const milestoneIdentifier = iid ?? milestone_id;

            return gitlab.put(`${entityType}/${encodedPath}/milestones/${milestoneIdentifier}`, {
              body,
              contentType: "json",
            });
          }

          case "delete": {
            // TypeScript knows: input has milestone_id or iid (at least one required)
            const milestoneIdentifier = input.iid ?? input.milestone_id;
            await gitlab.delete(`${entityType}/${encodedPath}/milestones/${milestoneIdentifier}`);
            return { deleted: true };
          }

          case "promote": {
            // TypeScript knows: input has milestone_id or iid (at least one required by schema)
            if (entityType !== "projects") {
              throw new Error("Milestone promotion is only available for projects, not groups");
            }

            // Schema validation guarantees at least one identifier is present
            const milestoneIdentifier = input.iid ?? input.milestone_id;
            return gitlab.post(`projects/${encodedPath}/milestones/${milestoneIdentifier}/promote`);
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
 */
export function getMilestonesReadOnlyToolNames(): string[] {
  return ["browse_milestones"];
}

/**
 * Get all tool definitions from the registry
 */
export function getMilestonesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(milestonesToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredMilestonesTools(
  readOnlyMode: boolean = false
): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getMilestonesReadOnlyToolNames();
    return Array.from(milestonesToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getMilestonesToolDefinitions();
}
