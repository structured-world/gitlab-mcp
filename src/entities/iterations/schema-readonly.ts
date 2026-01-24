import { z } from "zod";
import { requiredId, paginationFields } from "../utils";
import { flexibleBoolean } from "../utils";

// ============================================================================
// browse_iterations - CQRS Query Tool (discriminated union schema)
// Actions: list, get
// Uses z.discriminatedUnion() for type-safe action handling.
// ============================================================================

// --- Shared fields ---
const groupIdField = requiredId.describe("Group ID or URL-encoded path.");

// --- Action: list ---
const ListIterationsSchema = z.object({
  action: z.literal("list").describe("List iterations for a group"),
  group_id: groupIdField,
  state: z
    .enum(["opened", "upcoming", "current", "closed", "all"])
    .optional()
    .describe("Filter by iteration state."),
  search: z.string().optional().describe("Search iterations by title."),
  include_ancestors: flexibleBoolean.optional().describe("Include iterations from parent groups."),
  ...paginationFields(),
});

// --- Action: get ---
const GetIterationSchema = z.object({
  action: z.literal("get").describe("Get a specific iteration by ID"),
  group_id: groupIdField,
  iteration_id: requiredId.describe("Iteration ID."),
});

// --- Discriminated union combining all actions ---
export const BrowseIterationsSchema = z.discriminatedUnion("action", [
  ListIterationsSchema,
  GetIterationSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseIterationsInput = z.infer<typeof BrowseIterationsSchema>;
