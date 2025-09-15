/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * MRS (Merge Requests) tools registry - unified registry containing all MR tools with their handlers
 */
export const mrsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'get_branch_diffs',
    {
      name: 'get_branch_diffs',
      description: 'Get the changes/diffs between two branches or commits in a GitLab project',
      inputSchema: zodToJsonSchema(GetBranchDiffsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetBranchDiffsSchema.parse(args);
        const { project_id, from, to, straight } = options;

        const queryParams = new URLSearchParams();
        if (straight !== undefined) {
          queryParams.set('straight', String(straight));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const diff = await response.json();
        return diff;
      },
    },
  ],
  [
    'get_merge_request',
    {
      name: 'get_merge_request',
      description:
        'Get details of a merge request (Either mergeRequestIid or branchName must be provided)',
      inputSchema: zodToJsonSchema(GetMergeRequestSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetMergeRequestSchema.parse(args);
        const { project_id, merge_request_iid, branch_name } = options;

        let apiUrl: string;

        if (merge_request_iid) {
          // Get specific MR by IID
          apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}`;
        } else if (branch_name) {
          // Search for MR by source branch
          apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests?source_branch=${encodeURIComponent(branch_name)}`;
        } else {
          throw new Error('Either merge_request_iid or branch_name must be provided');
        }

        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (branch_name) {
          // When searching by branch, return the first MR found
          if (Array.isArray(result) && result.length > 0) {
            return result[0];
          } else {
            throw new Error('No merge request found for branch');
          }
        }

        return result;
      },
    },
  ],
  [
    'list_merge_requests',
    {
      name: 'list_merge_requests',
      description: 'List merge requests in a GitLab project with filtering options',
      inputSchema: zodToJsonSchema(ListMergeRequestsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListMergeRequestsSchema.parse(args);

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        // Handle optional project_id - use global endpoint if not provided
        const apiUrl = options.project_id
          ? `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests?${queryParams}`
          : `${process.env.GITLAB_API_URL}/api/v4/merge_requests?${queryParams}`;

        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const mergeRequests = await response.json();
        return mergeRequests;
      },
    },
  ],
  [
    'get_merge_request_diffs',
    {
      name: 'get_merge_request_diffs',
      description:
        'Get the changes/diffs of a merge request (Either mergeRequestIid or branchName must be provided)',
      inputSchema: zodToJsonSchema(GetMergeRequestDiffsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetMergeRequestDiffsSchema.parse(args);
        const { project_id, merge_request_iid, page, per_page } = options;

        const queryParams = new URLSearchParams();
        if (page !== undefined) {
          queryParams.set('page', String(page));
        }
        if (per_page !== undefined) {
          queryParams.set('per_page', String(per_page));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/changes?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const diffs = await response.json();
        return diffs;
      },
    },
  ],
  [
    'list_merge_request_diffs',
    {
      name: 'list_merge_request_diffs',
      description:
        'List merge request diffs with pagination support (Either mergeRequestIid or branchName must be provided)',
      inputSchema: zodToJsonSchema(ListMergeRequestDiffsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListMergeRequestDiffsSchema.parse(args);
        const { project_id, merge_request_iid, page, per_page } = options;

        const queryParams = new URLSearchParams();
        if (page !== undefined) {
          queryParams.set('page', String(page));
        }
        if (per_page !== undefined) {
          queryParams.set('per_page', String(per_page));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/diffs?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const diffs = await response.json();
        return diffs;
      },
    },
  ],
  [
    'mr_discussions',
    {
      name: 'mr_discussions',
      description: 'List discussion items for a merge request',
      inputSchema: zodToJsonSchema(ListMergeRequestDiscussionsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListMergeRequestDiscussionsSchema.parse(args);
        const { project_id, merge_request_iid } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/discussions?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const discussions = await response.json();
        return discussions;
      },
    },
  ],
  [
    'get_draft_note',
    {
      name: 'get_draft_note',
      description: 'Get a single draft note from a merge request',
      inputSchema: zodToJsonSchema(GetDraftNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetDraftNoteSchema.parse(args);
        const { project_id, merge_request_iid, draft_note_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const draftNote = await response.json();
        return draftNote;
      },
    },
  ],
  [
    'list_draft_notes',
    {
      name: 'list_draft_notes',
      description: 'List draft notes for a merge request',
      inputSchema: zodToJsonSchema(ListDraftNotesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListDraftNotesSchema.parse(args);
        const { project_id, merge_request_iid } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/draft_notes?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const draftNotes = await response.json();
        return draftNotes;
      },
    },
  ],
  // Write tools
  [
    'create_merge_request',
    {
      name: 'create_merge_request',
      description: 'Create a new merge request in a GitLab project',
      inputSchema: zodToJsonSchema(CreateMergeRequestSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateMergeRequestSchema.parse(args);

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              body.set(key, value.join(','));
            } else {
              body.set(key, String(value));
            }
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const mergeRequest = await response.json();
        return mergeRequest;
      },
    },
  ],
  [
    'merge_merge_request',
    {
      name: 'merge_merge_request',
      description: 'Merge a merge request in a GitLab project',
      inputSchema: zodToJsonSchema(MergeMergeRequestSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = MergeMergeRequestSchema.parse(args);

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
            body.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/merge`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      },
    },
  ],
  [
    'create_note',
    {
      name: 'create_note',
      description: 'Create a new note (comment) to an issue or merge request',
      inputSchema: zodToJsonSchema(CreateNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateNoteSchema.parse(args);

        const body = new URLSearchParams();
        body.set('body', options.body);
        if (options.created_at) {
          body.set('created_at', options.created_at);
        }
        if (options.confidential !== undefined) {
          body.set('confidential', String(options.confidential));
        }

        const resourceType =
          options.noteable_type === 'merge_request' ? 'merge_requests' : 'issues';
        const resourceId = options.noteable_id;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/${resourceType}/${resourceId}/notes`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const note = await response.json();
        return note;
      },
    },
  ],
  [
    'create_draft_note',
    {
      name: 'create_draft_note',
      description: 'Create a draft note for a merge request',
      inputSchema: zodToJsonSchema(CreateDraftNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateDraftNoteSchema.parse(args);

        const body = new URLSearchParams();
        body.set('note', options.note);
        if (options.position) {
          body.set('position', JSON.stringify(options.position));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const draftNote = await response.json();
        return draftNote;
      },
    },
  ],
  [
    'publish_draft_note',
    {
      name: 'publish_draft_note',
      description: 'Publish a single draft note',
      inputSchema: zodToJsonSchema(PublishDraftNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = PublishDraftNoteSchema.parse(args);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}/publish`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      },
    },
  ],
  [
    'bulk_publish_draft_notes',
    {
      name: 'bulk_publish_draft_notes',
      description: 'Publish all draft notes for a merge request',
      inputSchema: zodToJsonSchema(BulkPublishDraftNotesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = BulkPublishDraftNotesSchema.parse(args);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/bulk_publish`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      },
    },
  ],
  [
    'update_merge_request',
    {
      name: 'update_merge_request',
      description: 'Update a merge request (Either mergeRequestIid or branchName must be provided)',
      inputSchema: zodToJsonSchema(UpdateMergeRequestSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateMergeRequestSchema.parse(args);

        const body = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
            if (Array.isArray(value)) {
              body.set(key, value.join(','));
            } else {
              body.set(key, String(value));
            }
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const mergeRequest = await response.json();
        return mergeRequest;
      },
    },
  ],
  [
    'create_merge_request_thread',
    {
      name: 'create_merge_request_thread',
      description: 'Create a new thread on a merge request',
      inputSchema: zodToJsonSchema(CreateMergeRequestThreadSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateMergeRequestThreadSchema.parse(args);

        const body = new URLSearchParams();
        body.set('body', options.body);
        if (options.position) {
          body.set('position', JSON.stringify(options.position));
        }
        if (options.commit_id) {
          body.set('commit_id', options.commit_id);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/discussions`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const discussion = await response.json();
        return discussion;
      },
    },
  ],
  [
    'update_merge_request_note',
    {
      name: 'update_merge_request_note',
      description: 'Modify an existing merge request thread note',
      inputSchema: zodToJsonSchema(UpdateMergeRequestNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateMergeRequestNoteSchema.parse(args);

        const body = new URLSearchParams();
        body.set('body', options.body);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/notes/${options.note_id}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const note = await response.json();
        return note;
      },
    },
  ],
  [
    'create_merge_request_note',
    {
      name: 'create_merge_request_note',
      description: 'Add a new note to an existing merge request thread',
      inputSchema: zodToJsonSchema(CreateMergeRequestNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateMergeRequestNoteSchema.parse(args);

        const body = new URLSearchParams();
        body.set('body', options.body);
        if (options.created_at) {
          body.set('created_at', options.created_at);
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/discussions/${options.discussion_id}/notes`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const note = await response.json();
        return note;
      },
    },
  ],
  [
    'update_draft_note',
    {
      name: 'update_draft_note',
      description: 'Update an existing draft note',
      inputSchema: zodToJsonSchema(UpdateDraftNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateDraftNoteSchema.parse(args);

        const body = new URLSearchParams();
        body.set('note', options.note);
        if (options.position) {
          body.set('position', JSON.stringify(options.position));
        }

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const draftNote = await response.json();
        return draftNote;
      },
    },
  ],
  [
    'delete_draft_note',
    {
      name: 'delete_draft_note',
      description: 'Delete a draft note',
      inputSchema: zodToJsonSchema(DeleteDraftNoteSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteDraftNoteSchema.parse(args);

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
        const response = await enhancedFetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        return { success: true, message: 'Draft note deleted successfully' };
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getMrsReadOnlyToolNames(): string[] {
  return [
    'get_branch_diffs',
    'get_merge_request',
    'get_merge_request_diffs',
    'list_merge_request_diffs',
    'mr_discussions',
    'get_draft_note',
    'list_draft_notes',
    'list_merge_requests',
  ];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getMrsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(mrsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredMrsTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getMrsReadOnlyToolNames();
    return Array.from(mrsToolRegistry.values()).filter((tool) => readOnlyNames.includes(tool.name));
  }
  return getMrsToolDefinitions();
}
