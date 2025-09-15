/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

/**
 * Handler for get_branch_diffs tool - REAL GitLab API call
 */
export async function handleGetBranchDiffs(args: unknown): Promise<unknown> {
  const options = GetBranchDiffsSchema.parse(args);
  const { project_id, from, to, straight } = options;

  const queryParams = new URLSearchParams();
  if (straight !== undefined) {
    queryParams.set('straight', String(straight));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const diff = await response.json();
  return diff;
}

/**
 * Handler for get_merge_request tool - REAL GitLab API call
 */
export async function handleGetMergeRequest(args: unknown): Promise<unknown> {
  const options = GetMergeRequestSchema.parse(args);
  const { project_id, merge_request_iid } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const mergeRequest = await response.json();
  return mergeRequest;
}

/**
 * Handler for list_merge_requests tool - REAL GitLab API call
 */
export async function handleListMergeRequests(args: unknown): Promise<unknown> {
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

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const mergeRequests = await response.json();
  return mergeRequests;
}

/**
 * Handler for get_merge_request_diffs tool - REAL GitLab API call
 */
export async function handleGetMergeRequestDiffs(args: unknown): Promise<unknown> {
  const options = GetMergeRequestDiffsSchema.parse(args);
  const { project_id, merge_request_iid, page, per_page } = options;

  const queryParams = new URLSearchParams();
  if (page !== undefined) {
    queryParams.set('page', String(page));
  }
  if (per_page !== undefined) {
    queryParams.set('per_page', String(per_page));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/diffs?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const diffs = await response.json();
  return diffs;
}

/**
 * Handler for list_merge_request_diffs tool - REAL GitLab API call
 */
export async function handleListMergeRequestDiffs(args: unknown): Promise<unknown> {
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
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const diffs = await response.json();
  return diffs;
}

/**
 * Handler for mr_discussions tool - REAL GitLab API call
 */
export async function handleListMergeRequestDiscussions(args: unknown): Promise<unknown> {
  const options = ListMergeRequestDiscussionsSchema.parse(args);
  const { project_id, merge_request_iid } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/discussions?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const discussions = await response.json();
  return discussions;
}

/**
 * Handler for get_draft_note tool - REAL GitLab API call
 */
export async function handleGetDraftNote(args: unknown): Promise<unknown> {
  const options = GetDraftNoteSchema.parse(args);
  const { project_id, merge_request_iid, draft_note_id } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/draft_notes/${draft_note_id}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const draftNote = await response.json();
  return draftNote;
}

/**
 * Handler for list_draft_notes tool - REAL GitLab API call
 */
export async function handleListDraftNotes(args: unknown): Promise<unknown> {
  const options = ListDraftNotesSchema.parse(args);
  const { project_id, merge_request_iid } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/merge_requests/${merge_request_iid}/draft_notes`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const draftNotes = await response.json();
  return draftNotes;
}

/**
 * Handler for create_merge_request tool - REAL GitLab API call
 */
export async function handleCreateMergeRequest(args: unknown): Promise<unknown> {
  const options = CreateMergeRequestSchema.parse(args);

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      if (Array.isArray(value)) {
        body.set(key, value.join(','));
      } else {
        body.set(key, String(value));
      }
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for update_merge_request tool - REAL GitLab API call
 */
export async function handleUpdateMergeRequest(args: unknown): Promise<unknown> {
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
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for merge_merge_request tool - REAL GitLab API call
 */
export async function handleMergeMergeRequest(args: unknown): Promise<unknown> {
  const options = MergeMergeRequestSchema.parse(args);

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
      body.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/merge`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for create_note tool - REAL GitLab API call
 */
export async function handleCreateNote(args: unknown): Promise<unknown> {
  const options = CreateNoteSchema.parse(args);

  const body = new URLSearchParams();
  body.set('body', options.body);
  if (options.created_at) {
    body.set('created_at', options.created_at);
  }
  if (options.confidential !== undefined) {
    body.set('confidential', String(options.confidential));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/notes`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for create_merge_request_thread tool - REAL GitLab API call
 */
export async function handleCreateMergeRequestThread(args: unknown): Promise<unknown> {
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
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for update_merge_request_note tool - REAL GitLab API call
 */
export async function handleUpdateMergeRequestNote(args: unknown): Promise<unknown> {
  const options = UpdateMergeRequestNoteSchema.parse(args);

  const body = new URLSearchParams();
  body.set('body', options.body);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/notes/${options.note_id}`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for create_merge_request_note tool - REAL GitLab API call
 */
export async function handleCreateMergeRequestNote(args: unknown): Promise<unknown> {
  const options = CreateMergeRequestNoteSchema.parse(args);

  const body = new URLSearchParams();
  body.set('body', options.body);
  if (options.created_at) {
    body.set('created_at', options.created_at);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/notes`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for create_draft_note tool - REAL GitLab API call
 */
export async function handleCreateDraftNote(args: unknown): Promise<unknown> {
  const options = CreateDraftNoteSchema.parse(args);

  const body = new URLSearchParams();
  body.set('note', options.note);
  if (options.position) {
    body.set('position', JSON.stringify(options.position));
  }
  if (options.in_reply_to_discussion_id) {
    body.set('in_reply_to_discussion_id', options.in_reply_to_discussion_id);
  }
  if (options.commit_id) {
    body.set('commit_id', options.commit_id);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for update_draft_note tool - REAL GitLab API call
 */
export async function handleUpdateDraftNote(args: unknown): Promise<unknown> {
  const options = UpdateDraftNoteSchema.parse(args);

  const body = new URLSearchParams();
  body.set('note', options.note);
  if (options.position) {
    body.set('position', JSON.stringify(options.position));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for delete_draft_note tool - REAL GitLab API call
 */
export async function handleDeleteDraftNote(args: unknown): Promise<unknown> {
  const options = DeleteDraftNoteSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
  const response = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  return { deleted: true };
}

/**
 * Handler for publish_draft_note tool - REAL GitLab API call
 */
export async function handlePublishDraftNote(args: unknown): Promise<unknown> {
  const options = PublishDraftNoteSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}/publish`;
  const response = await fetch(apiUrl, {
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
}

/**
 * Handler for bulk_publish_draft_notes tool - REAL GitLab API call
 */
export async function handleBulkPublishDraftNotes(args: unknown): Promise<unknown> {
  const options = BulkPublishDraftNotesSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/bulk_publish`;
  const response = await fetch(apiUrl, {
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
}
