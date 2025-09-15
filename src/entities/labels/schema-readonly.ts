import { z } from 'zod';
import { flexibleBoolean } from '../utils';

// READ-ONLY LABEL OPERATION SCHEMAS

// Labels (read-only)
export const ListLabelsSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  with_counts: flexibleBoolean
    .optional()
    .describe('Whether or not to include issue and merge request counts'),
  include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
  search: z.string().optional().describe('Keyword to filter labels by'),
});

export const GetLabelSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  label_id: z.union([z.coerce.string(), z.string()]).describe('The ID or title of a group label'),
  include_ancestor_groups: flexibleBoolean.optional().describe('Include ancestor groups'),
});

// Export type definitions
export type ListLabelsOptions = z.infer<typeof ListLabelsSchema>;
export type GetLabelOptions = z.infer<typeof GetLabelSchema>;
