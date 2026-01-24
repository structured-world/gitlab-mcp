import { z } from "zod";
import {
  WorkItemIdSchema,
  WorkItemTypeEnumSchema,
  WorkItemStateEventSchema,
} from "./schema-readonly";

// ============================================================================
// manage_work_item - CQRS Command Tool (discriminated union schema)
// Actions: create, update, delete, add_link, remove_link
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

/**
 * CRITICAL: GitLab Work Items Hierarchy Rules for MCP Agents
 *
 * Work items in GitLab have STRICT level restrictions that CANNOT be violated:
 *
 * GROUP LEVEL ONLY (use group path in namespace):
 * - Epic work items - ONLY exist at group level, NEVER at project level
 * - Use namespace like "my-group" or "parent-group/sub-group"
 *
 * PROJECT LEVEL ONLY (use project path in namespace):
 * - Issue work items - ONLY exist at project level, NEVER at group level
 * - Task work items - ONLY exist at project level, NEVER at group level
 * - Bug work items - ONLY exist at project level, NEVER at group level
 * - Use namespace like "group/project" or "group/subgroup/project"
 *
 * FORBIDDEN PATTERNS (will always fail):
 * - Creating Epic with project namespace
 * - Creating Issue/Task/Bug with group namespace
 *
 * EXAMPLES:
 * Epic: namespace="my-group", workItemType="EPIC"
 * Issue: namespace="my-group/my-project", workItemType="ISSUE"
 * Task: namespace="my-group/my-project", workItemType="TASK"
 * Epic: namespace="my-group/my-project" (WRONG - will fail)
 * Issue: namespace="my-group" (WRONG - will fail)
 */

// --- Shared fields ---
const workItemIdField = WorkItemIdSchema.describe(
  "Work item ID - use numeric ID from list results (e.g., '5953')"
);

// --- Link type enum (matches GitLab GraphQL API values directly) ---
// No aliases for legacy IS_BLOCKED_BY/RELATES_TO — those were broken (#177)
const LinkTypeSchema = z
  .enum(["BLOCKS", "BLOCKED_BY", "RELATED"])
  .describe(
    "Relationship type: BLOCKS (this blocks target), BLOCKED_BY (this is blocked by target), RELATED (general relationship)"
  );

// --- Date validation pattern ---
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

// --- Action: create ---
const CreateWorkItemSchema = z.object({
  action: z.literal("create").describe("Create a new work item"),
  namespace: z
    .string()
    .describe(
      'CRITICAL: Namespace path (group OR project). For Epics use GROUP path (e.g. "my-group"). For Issues/Tasks use PROJECT path (e.g. "my-group/my-project").'
    ),
  workItemType: WorkItemTypeEnumSchema.describe("Type of work item"),
  title: z.string().describe("Title of the work item"),
  description: z.string().optional().describe("Description of the work item"),
  assigneeIds: z.array(z.string()).optional().describe("Array of assignee user IDs"),
  labelIds: z.array(z.string()).optional().describe("Array of label IDs"),
  milestoneId: z.string().optional().describe("Milestone ID"),
  // Free tier: dates
  startDate: DateSchema.optional().describe("Start date in YYYY-MM-DD format"),
  dueDate: DateSchema.optional().describe("Due date in YYYY-MM-DD format"),
  // Free tier: hierarchy
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe("Parent work item ID to set hierarchy relationship"),
  childrenIds: z
    .array(z.string().min(1))
    .optional()
    .describe("Array of child work item IDs to add"),
  // Free tier: time tracking
  timeEstimate: z
    .string()
    .optional()
    .describe('Time estimate in human-readable format (e.g. "1h 30m", "2d")'),
  // Premium tier
  isFixed: z
    .boolean()
    .optional()
    .describe("Fixed dates - not inherited from children (Premium tier)"),
  weight: z.number().int().min(0).optional().describe("Story points / weight value (Premium tier)"),
  iterationId: z
    .string()
    .min(1)
    .optional()
    .describe("Iteration/sprint ID to assign (Premium tier)"),
  progressCurrentValue: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Current progress value 0-100 for OKR key results (Premium tier)"),
  // Ultimate tier
  healthStatus: z
    .enum(["onTrack", "needsAttention", "atRisk"])
    .optional()
    .describe("Health status indicator (Ultimate tier)"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be hex format like #FF5733")
    .optional()
    .describe("Custom hex color for epics (Ultimate tier)"),
});

// --- Action: update ---
const UpdateWorkItemSchema = z.object({
  action: z.literal("update").describe("Update an existing work item"),
  id: workItemIdField,
  title: z.string().optional().describe("Title of the work item"),
  description: z.string().optional().describe("Description of the work item"),
  assigneeIds: z.array(z.string()).optional().describe("Array of assignee user IDs"),
  labelIds: z.array(z.string()).optional().describe("Array of label IDs"),
  milestoneId: z.string().optional().describe("Milestone ID"),
  state: WorkItemStateEventSchema.optional().describe(
    "State event for the work item (CLOSE, REOPEN)"
  ),
  // Free tier: dates
  startDate: DateSchema.nullable()
    .optional()
    .describe("Start date in YYYY-MM-DD format (null to clear)"),
  dueDate: DateSchema.nullable()
    .optional()
    .describe("Due date in YYYY-MM-DD format (null to clear)"),
  // Free tier: hierarchy
  parentId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Parent work item ID (null to unlink parent)"),
  childrenIds: z
    .array(z.string().min(1))
    .optional()
    .describe("Array of child work item IDs to add"),
  // Free tier: time tracking
  timeEstimate: z
    .string()
    .optional()
    .describe('Time estimate in human-readable format (e.g. "1h 30m", "2d", "0h" to clear)'),
  timeSpent: z
    .string()
    .optional()
    .describe('Time spent to log as timelog entry (e.g. "2h", "1h 30m")'),
  timeSpentAt: z
    .string()
    .optional()
    .describe("When time was spent in ISO 8601 format (defaults to now)"),
  timeSpentSummary: z
    .string()
    .optional()
    .describe("Summary/description of work done for the timelog entry"),
  // Premium tier
  isFixed: z
    .boolean()
    .optional()
    .describe("Fixed dates - not inherited from children (Premium tier)"),
  weight: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Story points / weight value, null to clear (Premium tier)"),
  iterationId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Iteration/sprint ID, null to unassign (Premium tier)"),
  progressCurrentValue: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Current progress value 0-100 for OKR key results (Premium tier)"),
  // Ultimate tier
  healthStatus: z
    .enum(["onTrack", "needsAttention", "atRisk"])
    .nullable()
    .optional()
    .describe("Health status indicator, null to clear (Ultimate tier)"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be hex format like #FF5733")
    .optional()
    .describe("Custom hex color for epics (Ultimate tier)"),
});

// --- Action: delete ---
const DeleteWorkItemSchema = z.object({
  action: z.literal("delete").describe("Delete a work item"),
  id: workItemIdField,
});

// --- Action: add_link ---
const AddLinkSchema = z.object({
  action: z.literal("add_link").describe("Add a relationship link between two work items"),
  id: workItemIdField.describe("Source work item ID"),
  targetId: WorkItemIdSchema.describe("Target work item ID to link to"),
  linkType: LinkTypeSchema,
});

// --- Action: remove_link ---
const RemoveLinkSchema = z.object({
  action: z.literal("remove_link").describe("Remove a relationship link between two work items"),
  id: workItemIdField.describe("Source work item ID"),
  targetId: WorkItemIdSchema.describe("Target work item ID to unlink"),
  linkType: LinkTypeSchema,
});

// --- Discriminated union combining all actions ---
export const ManageWorkItemSchema = z.discriminatedUnion("action", [
  CreateWorkItemSchema,
  UpdateWorkItemSchema,
  DeleteWorkItemSchema,
  AddLinkSchema,
  RemoveLinkSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type ManageWorkItemInput = z.infer<typeof ManageWorkItemSchema>;
