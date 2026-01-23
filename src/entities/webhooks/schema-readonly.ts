import { z } from "zod";
import { requiredId, paginationFields } from "../utils";

// ============================================================================
// browse_webhooks - CQRS Query Tool (discriminated union schema)
// Actions: list, get
//
// Uses z.discriminatedUnion() on "action" for type-safe action handling.
// - action="list": List webhooks for a project or group (with pagination)
// - action="get": Retrieve details of a single webhook by ID
// ============================================================================

// --- Shared scope fields ---
const scopeField = z.enum(["project", "group"]).describe("Scope of webhook (project or group)");

// --- Action: list ---
const ListWebhooksSchema = z.object({
  action: z.literal("list").describe("List all webhooks for a project or group"),
  scope: scopeField,
  projectId: z.string().optional().describe("Project ID or path (required if scope=project)"),
  groupId: z.string().optional().describe("Group ID or path (required if scope=group)"),
  ...paginationFields(),
});

// --- Action: get ---
const GetWebhookSchema = z.object({
  action: z.literal("get").describe("Get webhook details by ID"),
  scope: scopeField,
  projectId: z.string().optional().describe("Project ID or path (required if scope=project)"),
  groupId: z.string().optional().describe("Group ID or path (required if scope=group)"),
  hookId: requiredId.describe("Webhook ID (required)"),
});

// --- Discriminated union combining all actions ---
export const BrowseWebhooksSchema = z.discriminatedUnion("action", [
  ListWebhooksSchema,
  GetWebhookSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseWebhooksInput = z.infer<typeof BrowseWebhooksSchema>;
