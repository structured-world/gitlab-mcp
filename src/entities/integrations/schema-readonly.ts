import { z } from "zod";
import { paginationFields } from "../utils";
import { IntegrationTypeSchema } from "./schema";

// ============================================================================
// browse_integrations - CQRS Query Tool (discriminated union schema)
// Actions: list, get
//
// Uses z.discriminatedUnion() on "action" for type-safe action handling.
// - action="list": List all active integrations for a project
// - action="get": Retrieve settings for a specific integration
// ============================================================================

// --- Shared fields ---
const projectIdField = z.string().describe("Project ID or URL-encoded path");

// --- Action: list ---
const ListIntegrationsSchema = z.object({
  action: z.literal("list").describe("List all active integrations for a project"),
  project_id: projectIdField,
  ...paginationFields(),
});

// --- Action: get ---
const GetIntegrationSchema = z.object({
  action: z.literal("get").describe("Get integration settings (read-only)"),
  project_id: projectIdField,
  integration: IntegrationTypeSchema.describe(
    "Integration type slug (e.g., slack, jira, discord). Note: gitlab-slack-application cannot be created via API - it requires OAuth installation from GitLab UI."
  ),
});

// --- Discriminated union combining all actions ---
export const BrowseIntegrationsSchema = z.discriminatedUnion("action", [
  ListIntegrationsSchema,
  GetIntegrationSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseIntegrationsInput = z.infer<typeof BrowseIntegrationsSchema>;
