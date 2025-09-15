import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GetBranchDiffsSchema,
  GetMergeRequestSchema,
  GetMergeRequestDiffsSchema,
  ListMergeRequestDiffsSchema,
  ListMergeRequestDiscussionsSchema,
  GetDraftNoteSchema,
  ListDraftNotesSchema,
  ListMergeRequestsSchema,
} from './schema-readonly';
import { ToolDefinition } from '../../types';

export const mrsReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'get_branch_diffs',
    description: 'Get the changes/diffs between two branches or commits in a GitLab project',
    inputSchema: zodToJsonSchema(GetBranchDiffsSchema),
  },
  {
    name: 'get_merge_request',
    description:
      'Get details of a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(GetMergeRequestSchema),
  },
  {
    name: 'get_merge_request_diffs',
    description:
      'Get the changes/diffs of a merge request (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(GetMergeRequestDiffsSchema),
  },
  {
    name: 'list_merge_request_diffs',
    description:
      'List merge request diffs with pagination support (Either mergeRequestIid or branchName must be provided)',
    inputSchema: zodToJsonSchema(ListMergeRequestDiffsSchema),
  },
  {
    name: 'mr_discussions',
    description: 'List discussion items for a merge request',
    inputSchema: zodToJsonSchema(ListMergeRequestDiscussionsSchema),
  },
  {
    name: 'get_draft_note',
    description: 'Get a single draft note from a merge request',
    inputSchema: zodToJsonSchema(GetDraftNoteSchema),
  },
  {
    name: 'list_draft_notes',
    description: 'List draft notes for a merge request',
    inputSchema: zodToJsonSchema(ListDraftNotesSchema),
  },
  {
    name: 'list_merge_requests',
    description: 'List merge requests in a GitLab project with filtering options',
    inputSchema: zodToJsonSchema(ListMergeRequestsSchema),
  },
];

// Define which MR tools are read-only (list of tool names)
export const mrsReadOnlyTools = [
  'get_branch_diffs',
  'get_merge_request',
  'get_merge_request_diffs',
  'list_merge_request_diffs',
  'mr_discussions',
  'get_draft_note',
  'list_draft_notes',
  'list_merge_requests',
];
