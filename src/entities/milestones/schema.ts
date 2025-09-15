import { z } from 'zod';

// Write-only milestone operation schemas
// Schema for creating a new milestone
export const CreateProjectMilestoneSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    title: z.string().describe('The title of the milestone'),
    description: z.string().optional().describe('The description of the milestone'),
    due_date: z.string().optional().describe('The due date of the milestone (YYYY-MM-DD)'),
    start_date: z.string().optional().describe('The start date of the milestone (YYYY-MM-DD)'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Schema for editing a milestone
export const EditProjectMilestoneSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    milestone_id: z.coerce.string().describe('The ID of a project or group milestone'),
    title: z.string().optional().describe('The title of the milestone'),
    description: z.string().optional().describe('The description of the milestone'),
    due_date: z.string().optional().describe('The due date of the milestone (YYYY-MM-DD)'),
    start_date: z.string().optional().describe('The start date of the milestone (YYYY-MM-DD)'),
    state_event: z
      .enum(['close', 'activate'])
      .optional()
      .describe('The state event of the milestone'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Schema for deleting a milestone
export const DeleteProjectMilestoneSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    milestone_id: z.coerce.string().describe('The ID of a project or group milestone'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Schema for promoting a project milestone to a group milestone
export const PromoteProjectMilestoneSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    milestone_id: z.coerce.string().describe('The ID of a project or group milestone'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Type exports
export type CreateProjectMilestoneOptions = z.infer<typeof CreateProjectMilestoneSchema>;
export type EditProjectMilestoneOptions = z.infer<typeof EditProjectMilestoneSchema>;
export type DeleteProjectMilestoneOptions = z.infer<typeof DeleteProjectMilestoneSchema>;
export type PromoteProjectMilestoneOptions = z.infer<typeof PromoteProjectMilestoneSchema>;
