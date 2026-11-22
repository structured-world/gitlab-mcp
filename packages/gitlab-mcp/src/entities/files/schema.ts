import { z } from 'zod';
import { flexibleBoolean, requiredId } from '../utils';
import { EDIT_MAX_EDITS } from './edit';

// ============================================================================
// manage_files - CQRS Command Tool (discriminated union schema)
// Actions: single, batch, edit, upload
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe('Project ID or URL-encoded path');

// --- Helper schema for batch file actions ---
const BatchFileActionSchema = z.object({
  file_path: z.string().describe('Path to the file'),
  content: z.string().describe('File content'),
  encoding: z.enum(['text', 'base64']).optional().describe('Content encoding'),
  execute_filemode: flexibleBoolean.optional().describe('Set executable permission'),
});

// --- Action: single ---
const SingleActionSchema = z.object({
  action: z.literal('single').describe('Create or update a single file'),
  project_id: projectIdField,
  file_path: z.string().describe('Path to the file'),
  content: z.string().describe('File content (text or base64 encoded)'),
  commit_message: z.string().describe('Commit message'),
  branch: z.string().describe('Target branch name'),
  overwrite: flexibleBoolean
    .optional()
    .describe(
      'If true, automatically update existing file or create new one (requires pre-check via GET request). If false or omitted, only create new file (fails if file exists). Use true when unsure if file exists. Note: Non-404 errors (403, 500, etc.) during pre-check will fail the operation.',
    ),
  start_branch: z.string().optional().describe('Base branch to start from'),
  encoding: z.enum(['text', 'base64']).optional().describe('Content encoding (default: text)'),
  author_email: z.string().optional().describe('Commit author email'),
  author_name: z.string().optional().describe('Commit author name'),
  last_commit_id: z.string().optional().describe('Last known commit ID for conflict detection'),
  execute_filemode: flexibleBoolean.optional().describe('Set executable permission'),
});

// --- Action: batch ---
const BatchActionSchema = z.object({
  action: z.literal('batch').describe('Commit multiple files atomically'),
  project_id: projectIdField,
  branch: z.string().describe('Target branch name'),
  commit_message: z.string().describe('Commit message'),
  files: z.array(BatchFileActionSchema).min(1).describe('Files to commit (at least one required)'),
  overwrite: flexibleBoolean
    .optional()
    .describe(
      'If true, automatically detect which files exist and update them, create others (requires pre-check for each file via GET requests). If false or omitted, only create new files (fails if any file exists). Use true when batch includes mix of new and existing files. Note: Non-404 errors during any pre-check will fail the entire batch.',
    ),
  start_branch: z.string().optional().describe('Base branch to start from'),
  author_email: z.string().optional().describe('Commit author email'),
  author_name: z.string().optional().describe('Commit author name'),
});

// --- Action: edit ---
const TextEditSchema = z.object({
  old_text: z
    .string()
    .min(1)
    .describe(
      'Exact text to replace, matched byte for byte (whitespace, indentation and line endings included)',
    ),
  new_text: z.string().describe('Replacement text'),
  replace_all: flexibleBoolean
    .optional()
    .describe('Replace every occurrence; without it old_text must occur exactly once'),
});

const EditActionSchema = z.object({
  action: z
    .literal('edit')
    .describe(
      'Edit an existing text file in place by replacing exact fragments; returns the unified diff and the new last_commit_id',
    ),
  project_id: projectIdField,
  file_path: z.string().describe('Path to the existing file'),
  branch: z.string().describe('Target branch name'),
  commit_message: z.string().describe('Commit message'),
  edits: z
    .array(TextEditSchema)
    .min(1)
    .max(EDIT_MAX_EDITS)
    .describe(
      `1 to ${EDIT_MAX_EDITS} replacements, each located in the original file; overlapping edits are refused`,
    ),
  expected_last_commit_id: z
    .string()
    .optional()
    .describe(
      'last_commit_id the file was read at (browse_files content returns it); the edit is refused if the file changed since',
    ),
  dry_run: flexibleBoolean.optional().describe('Return the diff without committing'),
  start_branch: z.string().optional().describe('Base branch to start from'),
  author_email: z.string().optional().describe('Commit author email'),
  author_name: z.string().optional().describe('Commit author name'),
});

// --- Action: upload ---
const UploadActionSchema = z.object({
  action: z.literal('upload').describe('Upload a file as markdown attachment'),
  project_id: projectIdField,
  file: z.string().describe('Base64 encoded file content'),
  filename: z.string().describe('Name of the file'),
});

// --- Discriminated union combining all actions ---
export const ManageFilesSchema = z.discriminatedUnion('action', [
  SingleActionSchema,
  BatchActionSchema,
  EditActionSchema,
  UploadActionSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type ManageFilesInput = z.infer<typeof ManageFilesSchema>;
