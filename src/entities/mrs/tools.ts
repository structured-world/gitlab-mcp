import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateMergeRequestSchema,
  UpdateMergeRequestSchema,
  MergeMergeRequestSchema,
  CreateNoteSchema,
  CreateMergeRequestThreadSchema,
  UpdateMergeRequestNoteSchema,
  CreateMergeRequestNoteSchema,
  CreateDraftNoteSchema,
  UpdateDraftNoteSchema,
  DeleteDraftNoteSchema,
  PublishDraftNoteSchema,
  BulkPublishDraftNotesSchema,
} from './schema';
import { ToolDefinition } from '../../types';

export const mrsWriteTools: ToolDefinition[] = [
  {
    name: 'create_merge_request',
    description: 'Create a new merge request in a GitLab project',
    inputSchema: zodToJsonSchema(CreateMergeRequestSchema),
  },
  {
    name: 'update_merge_request',
    description: 'Update a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(UpdateMergeRequestSchema),
  },
  {
    name: 'merge_merge_request',
    description: 'Merge a merge request in a GitLab project',
    inputSchema: zodToJsonSchema(MergeMergeRequestSchema),
  },
  {
    name: 'create_note',
    description: 'Create a new note (comment) to an issue or merge request',
    inputSchema: zodToJsonSchema(CreateNoteSchema),
  },
  {
    name: 'create_merge_request_thread',
    description: 'Create a new thread on a merge request',
    inputSchema: zodToJsonSchema(CreateMergeRequestThreadSchema),
  },
  {
    name: 'update_merge_request_note',
    description: 'Modify an existing merge request thread note',
    inputSchema: zodToJsonSchema(UpdateMergeRequestNoteSchema),
  },
  {
    name: 'create_merge_request_note',
    description: 'Add a new note to an existing merge request thread',
    inputSchema: zodToJsonSchema(CreateMergeRequestNoteSchema),
  },
  {
    name: 'create_draft_note',
    description: 'Create a draft note for a merge request',
    inputSchema: zodToJsonSchema(CreateDraftNoteSchema),
  },
  {
    name: 'update_draft_note',
    description: 'Update an existing draft note',
    inputSchema: zodToJsonSchema(UpdateDraftNoteSchema),
  },
  {
    name: 'delete_draft_note',
    description: 'Delete a draft note',
    inputSchema: zodToJsonSchema(DeleteDraftNoteSchema),
  },
  {
    name: 'publish_draft_note',
    description: 'Publish a single draft note',
    inputSchema: zodToJsonSchema(PublishDraftNoteSchema),
  },
  {
    name: 'bulk_publish_draft_notes',
    description: 'Publish all draft notes for a merge request',
    inputSchema: zodToJsonSchema(BulkPublishDraftNotesSchema),
  },
];
