import { z } from 'zod';
import { flexibleBoolean, requiredId, paginationFields } from '../utils';
import { RANGE_MAX_BYTES, RANGE_MAX_LINES } from './line-range';

// ============================================================================
// Response schemas for GitLab file API responses
// ============================================================================

export const GitLabFileContentSchema = z.object({
  file_name: z.string(),
  file_path: z.string(),
  size: z.number(),
  encoding: z.string(),
  content_sha256: z.string().optional(),
  ref: z.string().optional(),
  blob_id: z.string(),
  commit_id: z.string(),
  last_commit_id: z.string(),
  content: z.string().optional(),
});

export const GitLabDirectoryContentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tree', 'blob']),
  path: z.string(),
  mode: z.string(),
});

export const GitLabContentSchema = z.union([GitLabFileContentSchema, GitLabDirectoryContentSchema]);

export const GitLabCreateUpdateFileResponseSchema = z.object({
  file_path: z.string(),
  branch: z.string(),
});

export const GitLabTreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tree', 'blob']),
  path: z.string(),
  mode: z.string(),
});

// ============================================================================
// browse_files - CQRS Query Tool (discriminated union schema)
// Actions: tree, content
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe('Project ID or URL-encoded path');
const refField = z.string().optional().describe('Branch, tag, or commit SHA');

// --- Action: tree ---
const TreeActionSchema = z.object({
  action: z.literal('tree').describe('List files and folders in a directory'),
  project_id: projectIdField,
  ref: refField,
  path: z.string().optional().describe('Directory path to list'),
  recursive: flexibleBoolean.optional().describe('Include nested directories'),
  ...paginationFields(),
});

// --- Action: content ---
const lineField = (role: string) => z.number().int().min(1).optional().describe(role);

const ContentActionSchema = z
  .object({
    action: z
      .literal('content')
      .describe(
        'Read file contents as UTF-8 text or base64 binary, with encoding, byte size and the file version (last_commit_id, blob_id, content_sha256); start_line/end_line read only a line range of a text file',
      ),
    project_id: projectIdField,
    ref: refField,
    file_path: z.string().describe('Path to the file to read'),
    start_line: lineField(
      `First line to read (1-based); with end_line or alone, reads only that range of a UTF-8 text file. At most ${RANGE_MAX_LINES} lines and ${RANGE_MAX_BYTES / 1024} KiB are returned per call; continue from next_line`,
    ),
    end_line: lineField(
      'Last line to read (1-based, inclusive, not before start_line); alone it reads from line 1',
    ),
  })
  // Kept out of the JSON Schema: the flat mode merges action branches into one object.
  .superRefine((input, context) => {
    if (
      input.start_line !== undefined &&
      input.end_line !== undefined &&
      input.start_line > input.end_line
    )
      context.addIssue({
        code: 'custom',
        path: ['end_line'],
        message: 'end_line must not be before start_line',
      });
  });

// --- Action: download_attachment ---
const DownloadAttachmentActionSchema = z.object({
  action: z.literal('download_attachment').describe('Download a file attachment from issues/MRs'),
  project_id: projectIdField,
  secret: z.string().describe('Security token from the attachment URL.'),
  filename: z.string().describe('Original filename of the attachment.'),
});

// --- Discriminated union combining all actions ---
export const BrowseFilesSchema = z.discriminatedUnion('action', [
  TreeActionSchema,
  ContentActionSchema,
  DownloadAttachmentActionSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type GitLabFileContent = z.infer<typeof GitLabFileContentSchema>;
export type GitLabDirectoryContent = z.infer<typeof GitLabDirectoryContentSchema>;
export type GitLabContent = z.infer<typeof GitLabContentSchema>;
export type GitLabCreateUpdateFileResponse = z.infer<typeof GitLabCreateUpdateFileResponseSchema>;
export type GitLabTree = z.infer<typeof GitLabTreeSchema>;
export type BrowseFilesInput = z.infer<typeof BrowseFilesSchema>;
