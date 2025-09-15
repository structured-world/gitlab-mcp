import { z } from 'zod';
import { PaginationOptionsSchema } from '../shared';
import { flexibleBoolean } from '../utils';

// Read-only wiki operation schemas
export const ListWikiPagesSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    with_content: flexibleBoolean.optional().describe('Include content of the wiki pages'),
  })
  .merge(PaginationOptionsSchema)
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

export const GetWikiPageSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    slug: z.string().describe('URL-encoded slug of the wiki page'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Define wiki response schemas
export const GitLabWikiPageSchema = z.object({
  title: z.string(),
  slug: z.string(),
  format: z.string(),
  content: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// Type exports
export type ListWikiPagesOptions = z.infer<typeof ListWikiPagesSchema>;
export type GetWikiPageOptions = z.infer<typeof GetWikiPageSchema>;
export type GitLabWikiPage = z.infer<typeof GitLabWikiPageSchema>;
