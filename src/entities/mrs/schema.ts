import { z } from 'zod';
import { flexibleBoolean } from '../utils';
import { ProjectParamsSchema } from '../shared';

// WRITE MERGE REQUEST OPERATION SCHEMAS

// Merge request thread position schema - used for diff notes
export const MergeRequestThreadPositionCreateSchema = z.object({
  base_sha: z.string().describe('Base commit SHA in the source branch').optional(),
  start_sha: z.string().describe('SHA referencing commit in target branch').optional(),
  head_sha: z.string().describe('SHA referencing HEAD of this merge request').optional(),
  position_type: z.enum(['text', 'image']).optional().describe('Type of the position reference'),
  old_path: z.string().optional().describe('Old path of the file'),
  new_path: z.string().optional().describe('New path of the file'),
  old_line: z.number().optional().describe('Old line number'),
  new_line: z.number().optional().describe('New line number'),
  line_range: z
    .object({
      start: z.object({
        line_code: z.string(),
        type: z.enum(['new', 'old']).optional(),
        old_line: z.number().optional(),
        new_line: z.number().optional(),
      }),
      end: z.object({
        line_code: z.string(),
        type: z.enum(['new', 'old']).optional(),
        old_line: z.number().optional(),
        new_line: z.number().optional(),
      }),
    })
    .optional()
    .describe('Line range for multi-line comments'),
  width: z.number().optional().describe('Width of the image (for image type)'),
  height: z.number().optional().describe('Height of the image (for image type)'),
  x: z.number().optional().describe('X coordinate (for image type)'),
  y: z.number().optional().describe('Y coordinate (for image type)'),
});

// Merge request operations (write)
const MergeRequestOptionsSchema = {
  source_branch: z.string().min(1).describe('Source branch'),
  target_branch: z.string().min(1).describe('Target branch'),
  title: z.string().min(1).describe('Title of MR'),
  assignee_id: z.number().optional().describe('Assignee user ID'),
  assignee_ids: z.array(z.number()).optional().describe('Array of assignee user IDs'),
  reviewer_ids: z.array(z.number()).optional().describe('Array of reviewer user IDs'),
  description: z.string().optional().describe('Description of MR'),
  target_project_id: z.coerce.string().optional().describe('Target project ID'),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Labels for MR'),
  milestone_id: z.number().optional().describe('Milestone ID'),
  remove_source_branch: flexibleBoolean
    .optional()
    .describe('Remove source branch when MR is merged'),
  allow_collaboration: flexibleBoolean
    .optional()
    .describe('Allow commits from members who can merge to the target branch'),
  allow_maintainer_to_push: flexibleBoolean
    .optional()
    .describe('Allow maintainer to push to the source branch'),
  squash: flexibleBoolean.optional().describe('Squash commits into a single commit when merging'),
};

export const CreateMergeRequestOptionsSchema = z.object(MergeRequestOptionsSchema);
export const CreateMergeRequestSchema = ProjectParamsSchema.extend(MergeRequestOptionsSchema);

export const UpdateMergeRequestSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  target_branch: z.string().optional().describe('Target branch'),
  title: z.string().optional().describe('Title of MR'),
  assignee_id: z.number().optional().describe('Assignee user ID'),
  assignee_ids: z.array(z.number()).optional().describe('Array of assignee user IDs'),
  reviewer_ids: z.array(z.number()).optional().describe('Array of reviewer user IDs'),
  description: z.string().optional().describe('Description of MR'),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Labels for MR'),
  add_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Labels to add to MR'),
  remove_labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Labels to remove from MR'),
  state_event: z.enum(['close', 'reopen']).optional().describe('State event for MR'),
  remove_source_branch: flexibleBoolean
    .optional()
    .describe('Remove source branch when MR is merged'),
  squash: flexibleBoolean.optional().describe('Squash commits into a single commit when merging'),
  discussion_locked: flexibleBoolean.optional().describe('Lock discussion thread'),
  allow_collaboration: flexibleBoolean
    .optional()
    .describe('Allow commits from members who can merge to the target branch'),
  allow_maintainer_to_push: flexibleBoolean
    .optional()
    .describe('Allow maintainer to push to the source branch'),
  milestone_id: z.number().optional().describe('Milestone ID'),
});

// Merge operations (write)
export const MergeMergeRequestSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  merge_commit_message: z.string().optional().describe('Custom merge commit message'),
  squash_commit_message: z.string().optional().describe('Custom squash commit message'),
  should_remove_source_branch: flexibleBoolean
    .optional()
    .describe('Remove source branch after merge'),
  merge_when_pipeline_succeeds: flexibleBoolean.optional().describe('Merge when pipeline succeeds'),
  sha: z.string().optional().describe('SHA of the head commit'),
  squash: flexibleBoolean.optional().describe('Squash commits when merging'),
});

// Note operations (write)
export const CreateNoteSchema = z.object({
  project_id: z.coerce.string().describe('Project ID or URL-encoded path'),
  noteable_type: z.enum(['issue', 'merge_request']).describe('Type of noteable object'),
  noteable_id: z.coerce.string().describe('ID of the noteable object'),
  body: z.string().describe('The content of a note'),
  created_at: z.string().optional().describe('Date time string, ISO 8601 formatted'),
  confidential: flexibleBoolean.optional().describe('Confidential note flag'),
});

// Merge request thread operations (write)
export const CreateMergeRequestThreadSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  body: z.string().describe('The content of the thread'),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    'Position when creating a diff note',
  ),
  commit_id: z.string().optional().describe('SHA referencing commit to start discussion on'),
});

// Merge request note operations (write)
export const UpdateMergeRequestNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  note_id: z.coerce.string().describe('The ID of the note'),
  body: z.string().describe('The content of a note'),
});

export const CreateMergeRequestNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  discussion_id: z.string().describe('The ID of a discussion'),
  body: z.string().describe('The content of a note'),
  created_at: z.string().optional().describe('Date time string, ISO 8601 formatted'),
});

// Draft note operations (write)
export const CreateDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  note: z.string().describe('The content of a note'),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    'Position when creating a diff note',
  ),
  in_reply_to_discussion_id: z.string().optional().describe('The ID of a discussion to reply to'),
  commit_id: z.string().optional().describe('SHA referencing commit to start discussion on'),
});

export const UpdateDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  draft_note_id: z.coerce.string().describe('The ID of the draft note'),
  note: z.string().describe('The content of a note'),
  position: MergeRequestThreadPositionCreateSchema.optional().describe(
    'Position when creating a diff note',
  ),
});

export const DeleteDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  draft_note_id: z.coerce.string().describe('The ID of the draft note'),
});

// Draft note publishing operations (write)
export const PublishDraftNoteSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
  draft_note_id: z.coerce.string().describe('The ID of the draft note'),
});

export const BulkPublishDraftNotesSchema = ProjectParamsSchema.extend({
  merge_request_iid: z.coerce.string().describe('The internal ID of the merge request'),
});

// Export type definitions
export type CreateMergeRequestOptions = z.infer<typeof CreateMergeRequestSchema>;
export type UpdateMergeRequestOptions = z.infer<typeof UpdateMergeRequestSchema>;
export type MergeMergeRequestOptions = z.infer<typeof MergeMergeRequestSchema>;
export type CreateNoteOptions = z.infer<typeof CreateNoteSchema>;
export type MergeRequestThreadPositionCreate = z.infer<
  typeof MergeRequestThreadPositionCreateSchema
>;
export type CreateMergeRequestThreadOptions = z.infer<typeof CreateMergeRequestThreadSchema>;
export type UpdateMergeRequestNoteOptions = z.infer<typeof UpdateMergeRequestNoteSchema>;
export type CreateMergeRequestNoteOptions = z.infer<typeof CreateMergeRequestNoteSchema>;
export type CreateDraftNoteOptions = z.infer<typeof CreateDraftNoteSchema>;
export type UpdateDraftNoteOptions = z.infer<typeof UpdateDraftNoteSchema>;
export type DeleteDraftNoteOptions = z.infer<typeof DeleteDraftNoteSchema>;
export type PublishDraftNoteOptions = z.infer<typeof PublishDraftNoteSchema>;
export type BulkPublishDraftNotesOptions = z.infer<typeof BulkPublishDraftNotesSchema>;
