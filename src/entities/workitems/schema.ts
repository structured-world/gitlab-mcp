import { z } from "zod";
import { WorkItemIdSchema, WorkItemTypeEnumSchema, WorkItemStateSchema } from "./schema-readonly";

// Write operation schemas
export const CreateWorkItemSchema = z.object({
  group_path: z.string().describe("Group path where to create the work item"),
  title: z.string().describe("Title of the work item"),
  work_item_type: WorkItemTypeEnumSchema,
  description: z.string().optional().describe("Description of the work item"),
  assignee_ids: z.array(z.string()).optional().describe("Array of assignee user IDs"),
  label_ids: z.array(z.string()).optional().describe("Array of label IDs"),
  milestone_id: z.string().optional().describe("Milestone ID"),
});

export const UpdateWorkItemSchema = z.object({
  id: WorkItemIdSchema,
  title: z.string().optional().describe("New title for the work item"),
  description: z.string().optional().describe("New description for the work item"),
  state: WorkItemStateSchema.optional().describe("New state for the work item"),
  assignee_ids: z.array(z.string()).optional().describe("Array of assignee user IDs"),
  label_ids: z.array(z.string()).optional().describe("Array of label IDs"),
  milestone_id: z.string().optional().describe("Milestone ID"),
});

export const DeleteWorkItemSchema = z.object({
  id: WorkItemIdSchema,
});

// Type exports
export type CreateWorkItemOptions = z.infer<typeof CreateWorkItemSchema>;
export type UpdateWorkItemOptions = z.infer<typeof UpdateWorkItemSchema>;
export type DeleteWorkItemOptions = z.infer<typeof DeleteWorkItemSchema>;
