/* eslint-disable @typescript-eslint/no-unsafe-return */
import * as z from "zod";
import { BrowseIterationsSchema } from "./schema-readonly";
import { enhancedFetch } from "../../utils/fetch";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Iterations tools registry - 1 CQRS tool
 *
 * browse_iterations (Query): list and get iterations for agile sprint planning
 */
export const iterationsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  [
    "browse_iterations",
    {
      name: "browse_iterations",
      description:
        "View group iterations for agile sprint planning. Actions: list (filter by state: current, upcoming, closed), get (retrieve specific iteration details). Related: browse_work_items for items in an iteration.",
      inputSchema: z.toJSONSchema(BrowseIterationsSchema),
      handler: async (args: unknown) => {
        const input = BrowseIterationsSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_iterations", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_iterations tool`);
        }

        switch (input.action) {
          case "list": {
            const { group_id } = input;

            const queryParams = new URLSearchParams();
            if (input.state) queryParams.set("state", input.state);
            if (input.search) queryParams.set("search", input.search);
            if (input.include_ancestors !== undefined)
              queryParams.set("include_ancestors", String(input.include_ancestors));
            if (input.per_page) queryParams.set("per_page", String(input.per_page));
            if (input.page) queryParams.set("page", String(input.page));

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/iterations?${queryParams}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          case "get": {
            const { group_id, iteration_id } = input;

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/iterations/${encodeURIComponent(iteration_id)}`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

export function getIterationsReadOnlyToolNames(): string[] {
  return ["browse_iterations"];
}

export function getIterationsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(iterationsToolRegistry.values());
}

export function getFilteredIterationsTools(
  readOnlyMode: boolean = false
): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getIterationsReadOnlyToolNames();
    return Array.from(iterationsToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getIterationsToolDefinitions();
}
