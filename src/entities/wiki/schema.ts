import { z } from "zod";

// Write-only wiki operation schemas
export const CreateWikiPageSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  title: z.string().describe("Title of the wiki page"),
  content: z.string().describe("Content of the wiki page"),
  format: z.string().optional().describe("Content format, e.g., markdown, rdoc"),
});

export const UpdateWikiPageSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  slug: z.string().describe("URL-encoded slug of the wiki page"),
  title: z.string().optional().describe("New title of the wiki page"),
  content: z.string().optional().describe("New content of the wiki page"),
  format: z.string().optional().describe("Content format, e.g., markdown, rdoc"),
});

export const DeleteWikiPageSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
  slug: z.string().describe("URL-encoded slug of the wiki page"),
});

// Type exports
export type CreateWikiPageOptions = z.infer<typeof CreateWikiPageSchema>;
export type UpdateWikiPageOptions = z.infer<typeof UpdateWikiPageSchema>;
export type DeleteWikiPageOptions = z.infer<typeof DeleteWikiPageSchema>;
