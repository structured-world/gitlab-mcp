import * as z from "zod";
import { BrowseWebhooksSchema } from "./schema-readonly";
import { ManageWebhookSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Webhooks tools registry - 2 CQRS tools (discriminated union schema)
 *
 * browse_webhooks (Query): list, get
 * manage_webhook (Command): create, update, delete, test
 */
export const webhooksToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_webhooks - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_webhooks",
    {
      name: "browse_webhooks",
      description:
        'BROWSE webhooks. Actions: "list" shows all webhooks configured for a project or group with pagination, "get" retrieves single webhook details by ID. Use to discover existing integrations, audit webhook configurations, debug delivery issues, or understand event subscriptions.',
      inputSchema: z.toJSONSchema(BrowseWebhooksSchema),
      gate: { envVar: "USE_WEBHOOKS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = BrowseWebhooksSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_webhooks", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_webhooks tool`);
        }

        // Helper to determine base API path from scope
        const getBasePath = (scope: "project" | "group", projectId?: string, groupId?: string) => {
          if (scope === "project" && projectId) {
            return `projects/${encodeURIComponent(projectId)}/hooks`;
          } else if (scope === "group" && groupId) {
            return `groups/${encodeURIComponent(groupId)}/hooks`;
          }
          throw new Error("Invalid scope or missing project/group ID");
        };

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has scope, projectId/groupId, per_page, page
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);
            const {
              action: _action,
              scope: _scope,
              projectId: _pid,
              groupId: _gid,
              ...queryParams
            } = input;
            return gitlab.get(basePath, {
              query: toQuery(queryParams, []),
            });
          }

          case "get": {
            // TypeScript knows: input has scope, projectId/groupId, hookId
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);
            return gitlab.get(`${basePath}/${input.hookId}`);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_webhook - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_webhook",
    {
      name: "manage_webhook",
      description:
        "Manage webhooks with full CRUD operations plus testing. Actions: 'create' (add new webhook with URL and event types), 'update' (modify URL, events, or settings), 'delete' (remove webhook), 'test' (trigger test delivery for specific event type). Use for setting up CI/CD automation, configuring notifications, integrating external systems, or managing event subscriptions.",
      inputSchema: z.toJSONSchema(ManageWebhookSchema),
      gate: { envVar: "USE_WEBHOOKS", defaultValue: true },
      handler: async (args: unknown) => {
        const input = ManageWebhookSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_webhook", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_webhook tool`);
        }

        // Determine base path from scope and IDs
        const getBasePath = (scope: "project" | "group", projectId?: string, groupId?: string) => {
          if (scope === "project" && projectId) {
            return `projects/${encodeURIComponent(projectId)}/hooks`;
          } else if (scope === "group" && groupId) {
            return `groups/${encodeURIComponent(groupId)}/hooks`;
          }
          throw new Error("Invalid scope or missing project/group ID");
        };

        // Helper to filter webhook data for API requests
        const buildRequestBody = (data: Record<string, unknown>): Record<string, unknown> => {
          const body: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data)) {
            if (
              value !== undefined &&
              !["action", "scope", "projectId", "groupId", "hookId", "trigger"].includes(key)
            ) {
              body[key] = value;
            }
          }
          return body;
        };

        switch (input.action) {
          case "create": {
            // TypeScript knows: input has url (required), scope, projectId/groupId, event fields
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);

            return gitlab.post(basePath, {
              body: buildRequestBody(input),
              contentType: "json",
            });
          }

          case "update": {
            // TypeScript knows: input has hookId (required), scope, projectId/groupId, optional fields
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);

            return gitlab.put(`${basePath}/${input.hookId}`, {
              body: buildRequestBody(input),
              contentType: "json",
            });
          }

          case "delete": {
            // TypeScript knows: input has hookId (required), scope, projectId/groupId
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);

            await gitlab.delete(`${basePath}/${input.hookId}`);
            return { success: true, message: "Webhook deleted successfully" };
          }

          case "test": {
            // TypeScript knows: input has hookId (required), trigger (required), scope, projectId/groupId
            const basePath = getBasePath(input.scope, input.projectId, input.groupId);

            return gitlab.post(`${basePath}/${input.hookId}/test/${input.trigger}`, {
              contentType: "json",
            });
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
 * Only browse_webhooks is read-only. manage_webhook is purely write operations.
 */
export function getWebhooksReadOnlyToolNames(): string[] {
  return ["browse_webhooks"];
}

/**
 * Get all tool definitions from the registry
 */
export function getWebhooksToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(webhooksToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredWebhooksTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getWebhooksReadOnlyToolNames();
    return Array.from(webhooksToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getWebhooksToolDefinitions();
}
