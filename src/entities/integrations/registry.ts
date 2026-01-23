import * as z from "zod";
import { BrowseIntegrationsSchema } from "./schema-readonly";
import { ManageIntegrationSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { getEffectiveProjectId, isActionDenied } from "../../config";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";

/**
 * Integrations tools registry - 2 CQRS tools for managing GitLab project integrations
 * Uses discriminated union schemas for type-safe action handling.
 *
 * browse_integrations (Query): list, get
 * manage_integration (Command): update, disable
 */
export const integrationsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_integrations - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_integrations",
    {
      name: "browse_integrations",
      description:
        'BROWSE project integrations. Actions: "list" shows all active integrations (Slack, Jira, Discord, Teams, Jenkins, etc.), "get" retrieves settings for a specific integration by type slug.',
      inputSchema: z.toJSONSchema(BrowseIntegrationsSchema, {}),
      gate: { envVar: "USE_INTEGRATIONS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseIntegrationsSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_integrations", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_integrations tool`);
        }

        const projectId = getEffectiveProjectId(input.project_id);

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has project_id, per_page, page
            const query = toQuery(
              {
                per_page: input.per_page,
                page: input.page,
              },
              []
            );
            return gitlab.get(`projects/${encodeURIComponent(projectId)}/integrations`, { query });
          }

          case "get": {
            // TypeScript knows: input has project_id, integration
            return gitlab.get(
              `projects/${encodeURIComponent(projectId)}/integrations/${input.integration}`
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_integration - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_integration",
    {
      name: "manage_integration",
      description:
        'MANAGE project integrations. Actions: "update" modifies or enables integration with specific config, "disable" removes integration. Supports 50+ integrations: Slack, Jira, Discord, Teams, Jenkins, etc. Note: gitlab-slack-application cannot be created via API - requires OAuth install from UI.',
      inputSchema: z.toJSONSchema(ManageIntegrationSchema, {}),
      gate: { envVar: "USE_INTEGRATIONS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageIntegrationSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_integration", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_integration tool`);
        }

        const projectId = getEffectiveProjectId(input.project_id);
        const integrationSlug = input.integration;

        switch (input.action) {
          case "update": {
            // TypeScript knows: input has project_id, integration (required), plus event fields and config (optional)
            const {
              action: _action,
              project_id: _project_id,
              integration: _integration,
              ...body
            } = input;

            // Flatten config object if provided
            let finalBody = { ...body };
            if (body.config) {
              const { config, ...rest } = body;
              finalBody = { ...rest, ...config };
            }

            return gitlab.put(
              `projects/${encodeURIComponent(projectId)}/integrations/${integrationSlug}`,
              {
                body: finalBody,
                contentType: "json",
              }
            );
          }

          case "disable": {
            // TypeScript knows: input has project_id, integration (required)
            await gitlab.delete(
              `projects/${encodeURIComponent(projectId)}/integrations/${integrationSlug}`
            );
            return { deleted: true };
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
 * Get read-only tool names from the registry.
 * Only browse_integrations is read-only. manage_integration is purely write operations.
 */
export function getIntegrationsReadOnlyToolNames(): string[] {
  return ["browse_integrations"];
}

/**
 * Get all tool definitions from the registry
 */
export function getIntegrationsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(integrationsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredIntegrationsTools(
  readOnlyMode: boolean = false
): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getIntegrationsReadOnlyToolNames();
    return Array.from(integrationsToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getIntegrationsToolDefinitions();
}
