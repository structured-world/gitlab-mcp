import { z } from "zod";
import { requiredId } from "../utils";

// ============================================================================
// manage_milestone - CQRS Command Tool (discriminated union schema)
// Actions: create, update, delete, promote
//
// Uses z.discriminatedUnion() to define action-specific parameters.
// Benefits:
// - Each action has ONLY its relevant parameters (token savings)
// - TypeScript type narrowing in handlers
// - Filtering denied actions removes their exclusive parameters from schema
// - JSON Schema outputs oneOf which is flattened for AI clients at runtime
// ============================================================================

// --- Base fields shared by all actions ---
const namespaceField = z.string().describe("Namespace path (group or project)");
const milestoneIdField = requiredId
  .optional()
  .describe("Milestone ID (same as IID in GitLab URLs, e.g., '3' from /milestones/3)");
const milestoneIidField = z
  .string()
  .min(1)
  .optional()
  .describe("Milestone IID from URL (e.g., '3' from /milestones/3). Alternative to milestone_id.");

// Refinement to require either milestone_id or iid
const requireMilestoneIdentifier = (
  data: { milestone_id?: string; iid?: string },
  ctx: z.RefinementCtx
) => {
  if (data.milestone_id === undefined && data.iid === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either 'milestone_id' or 'iid' must be provided",
      path: ["milestone_id"],
    });
  }
};

// --- Create action: creates a new milestone ---
const CreateMilestoneSchema = z.object({
  action: z.literal("create"),
  namespace: namespaceField,
  title: z.string().describe("The title of the milestone"),
  description: z.string().optional().describe("The description of the milestone"),
  due_date: z.string().optional().describe("The due date of the milestone (YYYY-MM-DD)"),
  start_date: z.string().optional().describe("The start date of the milestone (YYYY-MM-DD)"),
});

// --- Update action: modifies an existing milestone ---
const UpdateMilestoneSchema = z.object({
  action: z.literal("update"),
  namespace: namespaceField,
  milestone_id: milestoneIdField,
  iid: milestoneIidField,
  title: z.string().optional().describe("The new title of the milestone"),
  description: z.string().optional().describe("The new description of the milestone"),
  due_date: z.string().optional().describe("The due date of the milestone (YYYY-MM-DD)"),
  start_date: z.string().optional().describe("The start date of the milestone (YYYY-MM-DD)"),
  state_event: z
    .string()
    .transform(val => val.toLowerCase())
    .pipe(z.enum(["close", "activate"]))
    .optional()
    .describe("State event to apply: 'close' or 'activate'"),
});

// --- Delete action: removes a milestone ---
const DeleteMilestoneSchema = z.object({
  action: z.literal("delete"),
  namespace: namespaceField,
  milestone_id: milestoneIdField,
  iid: milestoneIidField,
});

// --- Promote action: elevates project milestone to group level ---
const PromoteMilestoneSchema = z.object({
  action: z.literal("promote"),
  namespace: namespaceField,
  milestone_id: milestoneIdField,
  iid: milestoneIidField,
});

// --- Discriminated union combining all actions ---
// Base union for type narrowing
const ManageMilestoneBaseSchema = z.discriminatedUnion("action", [
  CreateMilestoneSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  PromoteMilestoneSchema,
]);

// Add validation for actions that require milestone identifier
export const ManageMilestoneSchema = ManageMilestoneBaseSchema.superRefine((data, ctx) => {
  // Actions that require milestone_id or iid
  const actionsRequiringMilestone = ["update", "delete", "promote"];

  if (actionsRequiringMilestone.includes(data.action)) {
    const dataWithIds = data as { milestone_id?: string; iid?: string };
    requireMilestoneIdentifier(dataWithIds, ctx);
  }
});

// ============================================================================
// Type exports
// ============================================================================

export type ManageMilestoneInput = z.infer<typeof ManageMilestoneSchema>;
