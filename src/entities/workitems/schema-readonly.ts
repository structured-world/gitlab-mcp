import { z } from "zod";

// ============================================================================
// Base schemas for work items
// ============================================================================

export const WorkItemIdSchema = z
  .string()
  .min(1)
  .describe(
    "Work item ID - use numeric ID from list results (e.g., '5953'). " +
      "GID format also accepted and auto-normalized (e.g., 'gid://gitlab/WorkItem/5953')."
  );

export const WorkItemTypeEnumSchema = z
  .string()
  .transform(val => val.toUpperCase().replace(/\s+/g, "_"))
  .pipe(
    z.enum([
      "EPIC",
      "ISSUE",
      "TASK",
      "INCIDENT",
      "TEST_CASE",
      "REQUIREMENT",
      "OBJECTIVE",
      "KEY_RESULT",
    ])
  )
  .describe("Type of work item");

export const WorkItemStateSchema = z
  .string()
  .transform(val => val.toUpperCase())
  .pipe(z.enum(["OPEN", "CLOSED"]))
  .describe("State of work item");

export const WorkItemStateEventSchema = z
  .string()
  .transform(val => val.toUpperCase())
  .pipe(z.enum(["CLOSE", "REOPEN"]))
  .describe("State event for updating work item");

// ============================================================================
// browse_work_items - CQRS Query Tool (discriminated union schema)
// Actions: list, get
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const workItemIdField = WorkItemIdSchema.describe(
  "Work item ID to retrieve - use numeric ID from list results (e.g., '5953')"
);

const workItemIidField = z
  .string()
  .min(1)
  .describe("Internal ID from URL (e.g., '95' from /issues/95). Use with namespace parameter.");

const namespaceField = z
  .string()
  .describe("Namespace path containing the work item (e.g., 'group/project')");

// --- Action: list ---
const ListWorkItemsSchema = z.object({
  action: z.literal("list").describe("List work items with filtering"),
  namespace: z
    .string()
    .describe(
      "Namespace path (group or project). Groups return epics, projects return issues/tasks."
    ),
  types: z.array(WorkItemTypeEnumSchema).optional().describe("Filter by work item types"),
  state: z
    .array(WorkItemStateSchema)
    .optional()
    .default(["OPEN"])
    .describe(
      'Filter by work item state. Defaults to OPEN items only. Use ["OPEN", "CLOSED"] for all items.'
    ),
  first: z.number().optional().default(20).describe("Number of items to return"),
  after: z
    .string()
    .optional()
    .describe("Cursor for pagination (use endCursor from previous response)"),
  simple: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Return simplified structure with essential fields only. RECOMMENDED: Use default true for most cases."
    ),
});

// --- Action: get ---
// Supports two lookup methods:
// 1. By namespace + iid (preferred for URL-based lookups)
// 2. By global id (for items from list results)
const GetWorkItemSchema = z.object({
  action: z.literal("get").describe("Get single work item details"),
  // Lookup by namespace + IID (preferred for URL-based requests)
  namespace: namespaceField.optional(),
  iid: workItemIidField.optional(),
  // Lookup by global ID (backward compatible)
  id: workItemIdField.optional(),
});

// --- Discriminated union combining all actions ---
// Base union for type narrowing
const BrowseWorkItemsBaseSchema = z.discriminatedUnion("action", [
  ListWorkItemsSchema,
  GetWorkItemSchema,
]);

// Add validation for "get" action: must have either (namespace + iid) or (id)
export const BrowseWorkItemsSchema = BrowseWorkItemsBaseSchema.superRefine((data, ctx) => {
  if (data.action === "get") {
    const hasNamespaceIid = data.namespace !== undefined && data.iid !== undefined;
    const hasId = data.id !== undefined;

    if (!hasNamespaceIid && !hasId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Either 'id' (global ID) or both 'namespace' and 'iid' (from URL) must be provided",
        path: ["id"],
      });
    }
  }
});

// ============================================================================
// Type exports
// ============================================================================

export type BrowseWorkItemsInput = z.infer<typeof BrowseWorkItemsSchema>;
export type WorkItemTypeEnum = z.infer<typeof WorkItemTypeEnumSchema>;
export type WorkItemState = z.infer<typeof WorkItemStateSchema>;
