import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  MergeMergeRequestSchema,
  CreateOrUpdateFileSchema,
  CreateRepositorySchema,
  PushFilesSchema,
  CreateMergeRequestSchema,
  ForkRepositorySchema,
  CreateBranchSchema,
  UpdateMergeRequestSchema,
  CreateNoteSchema,
  CreateMergeRequestThreadSchema,
  UpdateMergeRequestNoteSchema,
  CreateMergeRequestNoteSchema,
  CreateDraftNoteSchema,
  UpdateDraftNoteSchema,
  DeleteDraftNoteSchema,
  PublishDraftNoteSchema,
  BulkPublishDraftNotesSchema,
  // Removed unused issue-related imports - migrated to Work Items GraphQL
  CreateLabelSchema,
  UpdateLabelSchema,
  DeleteLabelSchema,
  MarkdownUploadSchema,
} from './schema';
import { ToolDefinition } from '../../types';

export const coreWriteTools: ToolDefinition[] = [
  {
    name: 'merge_merge_request',
    description: 'Merge a merge request in a GitLab project',
    inputSchema: zodToJsonSchema(MergeMergeRequestSchema),
  },
  {
    name: 'create_or_update_file',
    description: 'Create or update a single file in a GitLab project',
    inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
  },
  {
    name: 'create_repository',
    description: 'Create a new GitLab project',
    inputSchema: zodToJsonSchema(CreateRepositorySchema),
  },
  {
    name: 'push_files',
    description: 'Push multiple files to a GitLab project in a single commit',
    inputSchema: zodToJsonSchema(PushFilesSchema),
  },
  // NOTE: create_issue has been removed - use create_work_item instead (Work Items GraphQL API)
  {
    name: 'create_merge_request',
    description: 'Create a new merge request in a GitLab project',
    inputSchema: zodToJsonSchema(CreateMergeRequestSchema),
  },
  {
    name: 'fork_repository',
    description: 'Fork a GitLab project to your account or specified namespace',
    inputSchema: zodToJsonSchema(ForkRepositorySchema),
  },
  {
    name: 'create_branch',
    description: 'Create a new branch in a GitLab project',
    inputSchema: zodToJsonSchema(CreateBranchSchema),
  },
  {
    name: 'update_merge_request',
    description: 'Update a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(UpdateMergeRequestSchema),
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
  // DEPRECATED: Issue REST write endpoints removed - use Work Items GraphQL instead
  // update_issue_note → use update_work_item with NOTES widget
  // create_issue_note → use update_work_item with NOTES widget
  // update_issue → use update_work_item
  // delete_issue → use delete_work_item
  // create_issue_link → use update_work_item with LINKED_ITEMS widget
  // delete_issue_link → use update_work_item with LINKED_ITEMS widget
  {
    name: 'create_label',
    description: 'Create a new label in a project',
    inputSchema: zodToJsonSchema(CreateLabelSchema),
  },
  {
    name: 'update_label',
    description: 'Update an existing label in a project',
    inputSchema: zodToJsonSchema(UpdateLabelSchema),
  },
  {
    name: 'delete_label',
    description: 'Delete a label from a project',
    inputSchema: zodToJsonSchema(DeleteLabelSchema),
  },
  {
    name: 'upload_markdown',
    description: 'Upload a file to a GitLab project for use in markdown content',
    inputSchema: zodToJsonSchema(MarkdownUploadSchema),
  },
];
