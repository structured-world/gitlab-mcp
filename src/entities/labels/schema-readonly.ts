import { z } from 'zod';
import { flexibleBoolean } from '../utils';

// READ-ONLY LABEL OPERATION SCHEMAS

// Labels (read-only)
export const ListLabelsSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    with_counts: flexibleBoolean
      .optional()
      .describe('Whether or not to include issue and merge request counts'),
    include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
    search: z.string().optional().describe('Keyword to filter labels by'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

export const GetLabelSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    label_id: z.union([z.coerce.string(), z.string()]).describe('The ID or title of a group label'),
    include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Export type definitions
export type ListLabelsOptions = z.infer<typeof ListLabelsSchema>;
export type GetLabelOptions = z.infer<typeof GetLabelSchema>;
