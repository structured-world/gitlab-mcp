import { z } from 'zod';

// WRITE LABEL OPERATION SCHEMAS

// Label operations (write)
export const CreateLabelSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    name: z.string().describe('The name of the label'),
    color: z
      .string()
      .describe(
        "The color of the label given in 6-digit hex notation with leading '#' sign (e.g. #FFAABB) or one of the CSS color names",
      ),
    description: z.string().optional().describe('The description of the label'),
    priority: z
      .number()
      .optional()
      .describe(
        'The priority of the label. Must be greater or equal than zero or null to remove the priority',
      ),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

export const UpdateLabelSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    label_id: z.union([z.coerce.string(), z.string()]).describe('The ID or title of a group label'),
    new_name: z.string().optional().describe('The new name of the label'),
    color: z
      .string()
      .optional()
      .describe(
        "The color of the label given in 6-digit hex notation with leading '#' sign (e.g. #FFAABB) or one of the CSS color names",
      ),
    description: z.string().optional().describe('The description of the label'),
    priority: z
      .number()
      .optional()
      .describe(
        'The priority of the label. Must be greater or equal than zero or null to remove the priority',
      ),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

export const DeleteLabelSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    label_id: z.union([z.coerce.string(), z.string()]).describe('The ID or title of a group label'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Export type definitions
export type CreateLabelOptions = z.infer<typeof CreateLabelSchema>;
export type UpdateLabelOptions = z.infer<typeof UpdateLabelSchema>;
export type DeleteLabelOptions = z.infer<typeof DeleteLabelSchema>;
