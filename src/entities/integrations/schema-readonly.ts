import { z } from "zod";
import { paginationFields } from "../utils";

// ============================================================================
// list_integrations - Read-only tool for listing project integrations
// ============================================================================

export const ListIntegrationsSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded path"),
  ...paginationFields(),
});

// ============================================================================
// Type exports
// ============================================================================

export type ListIntegrationsInput = z.infer<typeof ListIntegrationsSchema>;
