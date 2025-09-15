/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ListProjectsSchema,
  SearchRepositoriesSchema,
  ListNamespacesSchema,
  GetUsersSchema,
  GetProjectSchema,
  GetFileContentsSchema,
  GetMergeRequestSchema,
  GetMergeRequestDiffsSchema,
  ListMergeRequestDiffsSchema,
  GetBranchDiffsSchema,
  ListMergeRequestDiscussionsSchema,
  GetDraftNoteSchema,
  ListDraftNotesSchema,
  ListMergeRequestsSchema,
  GetLabelSchema,
  ListLabelsSchema,
  GetNamespaceSchema,
  VerifyNamespaceSchema,
  ListProjectMembersSchema,
  ListGroupProjectsSchema,
  GetRepositoryTreeSchema,
  ListCommitsSchema,
  GetCommitSchema,
  GetCommitDiffSchema,
  ListEventsSchema,
  GetProjectEventsSchema,
  ListGroupIterationsSchema,
  DownloadAttachmentSchema,
} from './schema-readonly';
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
  CreateLabelSchema,
  UpdateLabelSchema,
  DeleteLabelSchema,
  MarkdownUploadSchema,
} from './schema';

/**
 * Handler for list_projects tool - REAL GitLab API call
 */
export async function handleListProjects(args: unknown): Promise<unknown> {
  const options = ListProjectsSchema.parse(args);

  // Build query parameters
  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  // Make REAL GitLab API call
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const projects = await response.json();
  return projects;
}

/**
 * Handler for search_repositories tool - REAL GitLab API call
 */
export async function handleSearchRepositories(args: unknown): Promise<unknown> {
  const options = SearchRepositoriesSchema.parse(args);

  // Build query parameters
  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  // Make REAL GitLab API call to search projects
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const projects = await response.json();
  return projects;
}

/**
 * Handler for list_namespaces tool - REAL GitLab API call
 */
export async function handleListNamespaces(args: unknown): Promise<unknown> {
  const options = ListNamespacesSchema.parse(args);

  // Build query parameters
  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  // Make REAL GitLab API call
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const namespaces = await response.json();
  return namespaces;
}

/**
 * Handler for get_users tool - REAL GitLab API call
 */
export async function handleGetUsers(args: unknown): Promise<unknown> {
  const options = GetUsersSchema.parse(args);

  // Build query parameters
  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  // Make REAL GitLab API call
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/users?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const users = await response.json();
  return users;
}

/**
 * Handler for get_project tool - REAL GitLab API call
 */
export async function handleGetProject(args: unknown): Promise<unknown> {
  const options = GetProjectSchema.parse(args);

  // Get project ID from options
  const projectId = options.id;
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  // Make REAL GitLab API call
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(projectId)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const project = await response.json();
  return project;
}

/**
 * Handler for get_file_contents tool - REAL GitLab API call
 */
export async function handleGetFileContents(args: unknown): Promise<unknown> {
  const options = GetFileContentsSchema.parse(args);

  const { project_id, file_path, ref = 'main' } = options;
  const encodedFilePath = encodeURIComponent(file_path);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/files/${encodedFilePath}`;
  const queryParams = new URLSearchParams();
  queryParams.set('ref', ref);

  const response = await fetch(`${apiUrl}?${queryParams}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const file = await response.json();
  return file;
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
 * Handler for list_labels tool - REAL GitLab API call
 */
export async function handleListLabels(args: unknown): Promise<unknown> {
  const options = ListLabelsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/labels?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const labels = await response.json();
  return labels;
}

/**
 * Handler for get_label tool - REAL GitLab API call
 */
export async function handleGetLabel(args: unknown): Promise<unknown> {
  const options = GetLabelSchema.parse(args);

  const { project_id, label_id } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/labels/${encodeURIComponent(label_id)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const label = await response.json();
  return label;
}

/**
 * Handler for get_namespace tool - REAL GitLab API call
 */
export async function handleGetNamespace(args: unknown): Promise<unknown> {
  const options = GetNamespaceSchema.parse(args);

  const { id } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(id)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const namespace = await response.json();
  return namespace;
}

/**
 * Handler for verify_namespace tool - REAL GitLab API call
 */
export async function handleVerifyNamespace(args: unknown): Promise<unknown> {
  const options = VerifyNamespaceSchema.parse(args);

  const { id } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(id)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  return {
    exists: response.ok,
    namespace: id,
    status: response.status,
  };
}

/**
 * Handler for list_project_members tool - REAL GitLab API call
 */
export async function handleListProjectMembers(args: unknown): Promise<unknown> {
  const options = ListProjectMembersSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/members?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const members = await response.json();
  return members;
}

/**
 * Handler for get_repository_tree tool - REAL GitLab API call
 */
export async function handleGetRepositoryTree(args: unknown): Promise<unknown> {
  const options = GetRepositoryTreeSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/tree?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const tree = await response.json();
  return tree;
}

/**
 * Handler for list_commits tool - REAL GitLab API call
 */
export async function handleListCommits(args: unknown): Promise<unknown> {
  const options = ListCommitsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/commits?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const commits = await response.json();
  return commits;
}

/**
 * Handler for get_commit tool - REAL GitLab API call
 */
export async function handleGetCommit(args: unknown): Promise<unknown> {
  const options = GetCommitSchema.parse(args);

  const { project_id, sha } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(sha)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const commit = await response.json();
  return commit;
}

/**
 * Handler for get_merge_request_diffs tool - REAL GitLab API call
 */
export async function handleGetMergeRequestDiffs(args: unknown): Promise<unknown> {
  const options = GetMergeRequestDiffsSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/diffs`;
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

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      key !== 'project_id' &&
      key !== 'merge_request_iid'
    ) {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/diffs?${queryParams}`;
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
 * Handler for get_branch_diffs tool - REAL GitLab API call
 */
export async function handleGetBranchDiffs(args: unknown): Promise<unknown> {
  const options = GetBranchDiffsSchema.parse(args);

  const queryParams = new URLSearchParams();
  queryParams.set('from', options.from);
  queryParams.set('to', options.to);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/compare?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const comparison = await response.json();
  return comparison;
}

/**
 * Handler for mr_discussions tool - REAL GitLab API call
 */
export async function handleMrDiscussions(args: unknown): Promise<unknown> {
  const options = ListMergeRequestDiscussionsSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/discussions`;
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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes`;
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
 * Handler for list_group_projects tool - REAL GitLab API call
 */
export async function handleListGroupProjects(args: unknown): Promise<unknown> {
  const options = ListGroupProjectsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'group_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(options.group_id)}/projects?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const projects = await response.json();
  return projects;
}

/**
 * Handler for get_commit_diff tool - REAL GitLab API call
 */
export async function handleGetCommitDiff(args: unknown): Promise<unknown> {
  const options = GetCommitDiffSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/commits/${encodeURIComponent(options.sha)}/diff`;
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
 * Handler for list_events tool - REAL GitLab API call
 */
export async function handleListEvents(args: unknown): Promise<unknown> {
  const options = ListEventsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/events?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const events = await response.json();
  return events;
}

/**
 * Handler for get_project_events tool - REAL GitLab API call
 */
export async function handleGetProjectEvents(args: unknown): Promise<unknown> {
  const options = GetProjectEventsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/events?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const events = await response.json();
  return events;
}

/**
 * Handler for list_group_iterations tool - REAL GitLab API call
 */
export async function handleListGroupIterations(args: unknown): Promise<unknown> {
  const options = ListGroupIterationsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'group_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(options.group_id)}/iterations?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const iterations = await response.json();
  return iterations;
}

/**
 * Handler for download_attachment tool - REAL GitLab API call
 */
export async function handleDownloadAttachment(args: unknown): Promise<unknown> {
  const options = DownloadAttachmentSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/uploads/${options.attachment_id}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  // For binary files, return as base64
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return {
    attachment_id: options.attachment_id,
    content_type: response.headers.get('content-type'),
    size: buffer.byteLength,
    data: base64,
  };
}

// WRITE OPERATIONS START HERE

/**
 * Handler for merge_merge_request tool - REAL GitLab API call
 */
export async function handleMergeMergeRequest(args: unknown): Promise<unknown> {
  const options = MergeMergeRequestSchema.parse(args);

  const body = new URLSearchParams();
  body.set('merge_commit_message', options.merge_commit_message ?? '');
  if (options.squash_commit_message) {
    body.set('squash_commit_message', options.squash_commit_message);
  }
  if (options.should_remove_source_branch !== undefined) {
    body.set('should_remove_source_branch', String(options.should_remove_source_branch));
  }
  if (options.merge_when_pipeline_succeeds !== undefined) {
    body.set('merge_when_pipeline_succeeds', String(options.merge_when_pipeline_succeeds));
  }
  if (options.sha) {
    body.set('sha', options.sha);
  }
  if (options.squash !== undefined) {
    body.set('squash', String(options.squash));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/merge`;
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const mergeRequest = await response.json();
  return mergeRequest;
}

/**
 * Handler for create_or_update_file tool - REAL GitLab API call
 */
export async function handleCreateOrUpdateFile(args: unknown): Promise<unknown> {
  const options = CreateOrUpdateFileSchema.parse(args);

  const body = new URLSearchParams();
  body.set('branch', options.branch);
  body.set('content', options.content);
  body.set('commit_message', options.commit_message);
  if (options.start_branch) {
    body.set('start_branch', options.start_branch);
  }
  if (options.encoding) {
    body.set('encoding', options.encoding);
  }
  if (options.author_email) {
    body.set('author_email', options.author_email);
  }
  if (options.author_name) {
    body.set('author_name', options.author_name);
  }
  if (options.last_commit_id) {
    body.set('last_commit_id', options.last_commit_id);
  }
  if (options.execute_filemode !== undefined) {
    body.set('execute_filemode', String(options.execute_filemode));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/files/${encodeURIComponent(options.file_path)}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const fileInfo = await response.json();
  return fileInfo;
}

/**
 * Handler for create_repository tool - REAL GitLab API call
 */
export async function handleCreateRepository(args: unknown): Promise<unknown> {
  const options = CreateRepositorySchema.parse(args);

  const body = new URLSearchParams();
  body.set('name', options.name);
  if (options.path) {
    body.set('path', options.path);
  }
  if (options.namespace_id) {
    body.set('namespace_id', options.namespace_id);
  }
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.issues_enabled !== undefined) {
    body.set('issues_enabled', String(options.issues_enabled));
  }
  if (options.merge_requests_enabled !== undefined) {
    body.set('merge_requests_enabled', String(options.merge_requests_enabled));
  }
  if (options.jobs_enabled !== undefined) {
    body.set('jobs_enabled', String(options.jobs_enabled));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const project = await response.json();
  return project;
}

/**
 * Handler for push_files tool - REAL GitLab API call
 */
export async function handlePushFiles(args: unknown): Promise<unknown> {
  const options = PushFilesSchema.parse(args);

  const body = {
    branch: options.branch,
    commit_message: options.commit_message,
    actions: options.files.map((file) => ({
      action: 'create',
      file_path: file.file_path,
      content: file.content,
      encoding: file.encoding ?? 'text',
      execute_filemode: file.execute_filemode ?? false,
    })),
    start_branch: options.start_branch,
    author_email: options.author_email,
    author_name: options.author_name,
  };

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/commits`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const commit = await response.json();
  return commit;
}

/**
 * Handler for create_merge_request tool - REAL GitLab API call
 */
export async function handleCreateMergeRequest(args: unknown): Promise<unknown> {
  const options = CreateMergeRequestSchema.parse(args);

  const body = new URLSearchParams();
  body.set('source_branch', options.source_branch);
  body.set('target_branch', options.target_branch);
  body.set('title', options.title);
  if (options.assignee_id) {
    body.set('assignee_id', String(options.assignee_id));
  }
  if (options.assignee_ids) {
    options.assignee_ids.forEach((id, index) => {
      body.set(`assignee_ids[${index}]`, String(id));
    });
  }
  if (options.reviewer_ids) {
    options.reviewer_ids.forEach((id, index) => {
      body.set(`reviewer_ids[${index}]`, String(id));
    });
  }
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.target_project_id) {
    body.set('target_project_id', options.target_project_id);
  }
  if (options.labels) {
    const labelString =
      typeof options.labels === 'string' ? options.labels : options.labels.join(',');
    body.set('labels', labelString);
  }
  if (options.milestone_id) {
    body.set('milestone_id', String(options.milestone_id));
  }
  if (options.remove_source_branch !== undefined) {
    body.set('remove_source_branch', String(options.remove_source_branch));
  }
  if (options.allow_collaboration !== undefined) {
    body.set('allow_collaboration', String(options.allow_collaboration));
  }
  if (options.allow_maintainer_to_push !== undefined) {
    body.set('allow_maintainer_to_push', String(options.allow_maintainer_to_push));
  }
  if (options.squash !== undefined) {
    body.set('squash', String(options.squash));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const mergeRequest = await response.json();
  return mergeRequest;
}

/**
 * Handler for fork_repository tool - REAL GitLab API call
 */
export async function handleForkRepository(args: unknown): Promise<unknown> {
  const options = ForkRepositorySchema.parse(args);

  const body = new URLSearchParams();
  if (options.namespace) {
    body.set('namespace', options.namespace);
  }
  if (options.namespace_id) {
    body.set('namespace_id', String(options.namespace_id));
  }
  if (options.namespace_path) {
    body.set('namespace_path', options.namespace_path);
  }
  if (options.path) {
    body.set('path', options.path);
  }
  if (options.name) {
    body.set('name', options.name);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/fork`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const fork = await response.json();
  return fork;
}

/**
 * Handler for create_branch tool - REAL GitLab API call
 */
export async function handleCreateBranch(args: unknown): Promise<unknown> {
  const options = CreateBranchSchema.parse(args);

  const body = new URLSearchParams();
  body.set('branch', options.branch);
  body.set('ref', options.ref);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/repository/branches`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const branch = await response.json();
  return branch;
}

/**
 * Handler for update_merge_request tool - REAL GitLab API call
 */
export async function handleUpdateMergeRequest(args: unknown): Promise<unknown> {
  const options = UpdateMergeRequestSchema.parse(args);

  const body = new URLSearchParams();
  if (options.title) {
    body.set('title', options.title);
  }
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.assignee_id) {
    body.set('assignee_id', String(options.assignee_id));
  }
  if (options.assignee_ids) {
    options.assignee_ids.forEach((id, index) => {
      body.set(`assignee_ids[${index}]`, String(id));
    });
  }
  if (options.reviewer_ids) {
    options.reviewer_ids.forEach((id, index) => {
      body.set(`reviewer_ids[${index}]`, String(id));
    });
  }
  if (options.milestone_id) {
    body.set('milestone_id', String(options.milestone_id));
  }
  if (options.labels) {
    const labelString =
      typeof options.labels === 'string' ? options.labels : options.labels.join(',');
    body.set('labels', labelString);
  }
  if (options.target_branch) {
    body.set('target_branch', options.target_branch);
  }
  if (options.state_event) {
    body.set('state_event', options.state_event);
  }
  if (options.remove_source_branch !== undefined) {
    body.set('remove_source_branch', String(options.remove_source_branch));
  }
  if (options.squash !== undefined) {
    body.set('squash', String(options.squash));
  }
  if (options.discussion_locked !== undefined) {
    body.set('discussion_locked', String(options.discussion_locked));
  }
  if (options.allow_collaboration !== undefined) {
    body.set('allow_collaboration', String(options.allow_collaboration));
  }
  if (options.allow_maintainer_to_push !== undefined) {
    body.set('allow_maintainer_to_push', String(options.allow_maintainer_to_push));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}`;
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const updatedMergeRequest = await response.json();
  return updatedMergeRequest;
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

  const noteType = options.merge_request_iid ? 'merge_requests' : 'issues';
  const noteId = options.merge_request_iid ?? options.issue_iid;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.id)}/${noteType}/${noteId}/notes`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
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
    if (options.position.position_type) {
      body.set('position[position_type]', options.position.position_type);
    }
    if (options.position.base_sha) {
      body.set('position[base_sha]', options.position.base_sha);
    }
    if (options.position.start_sha) {
      body.set('position[start_sha]', options.position.start_sha);
    }
    if (options.position.head_sha) {
      body.set('position[head_sha]', options.position.head_sha);
    }
    if (options.position.old_path) {
      body.set('position[old_path]', options.position.old_path);
    }
    if (options.position.new_path) {
      body.set('position[new_path]', options.position.new_path);
    }
    if (options.position.old_line !== undefined) {
      body.set('position[old_line]', String(options.position.old_line));
    }
    if (options.position.new_line !== undefined) {
      body.set('position[new_line]', String(options.position.new_line));
    }
    if (options.position.line_range) {
      if (options.position.line_range.start.line_code) {
        body.set(
          'position[line_range][start][line_code]',
          options.position.line_range.start.line_code,
        );
      }
      if (options.position.line_range.start.type) {
        body.set('position[line_range][start][type]', options.position.line_range.start.type);
      }
      if (options.position.line_range.start.old_line !== undefined) {
        body.set(
          'position[line_range][start][old_line]',
          String(options.position.line_range.start.old_line),
        );
      }
      if (options.position.line_range.start.new_line !== undefined) {
        body.set(
          'position[line_range][start][new_line]',
          String(options.position.line_range.start.new_line),
        );
      }
      if (options.position.line_range.end.line_code) {
        body.set('position[line_range][end][line_code]', options.position.line_range.end.line_code);
      }
      if (options.position.line_range.end.type) {
        body.set('position[line_range][end][type]', options.position.line_range.end.type);
      }
      if (options.position.line_range.end.old_line !== undefined) {
        body.set(
          'position[line_range][end][old_line]',
          String(options.position.line_range.end.old_line),
        );
      }
      if (options.position.line_range.end.new_line !== undefined) {
        body.set(
          'position[line_range][end][new_line]',
          String(options.position.line_range.end.new_line),
        );
      }
    }
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
    body: body,
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
    body: body,
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
    body: body,
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
  if (options.in_reply_to_discussion_id) {
    body.set('in_reply_to_discussion_id', options.in_reply_to_discussion_id);
  }
  if (options.commit_id) {
    body.set('commit_id', options.commit_id);
  }
  if (options.position) {
    if (options.position.position_type) {
      body.set('position[position_type]', options.position.position_type);
    }
    if (options.position.base_sha) {
      body.set('position[base_sha]', options.position.base_sha);
    }
    if (options.position.start_sha) {
      body.set('position[start_sha]', options.position.start_sha);
    }
    if (options.position.head_sha) {
      body.set('position[head_sha]', options.position.head_sha);
    }
    if (options.position.old_path) {
      body.set('position[old_path]', options.position.old_path);
    }
    if (options.position.new_path) {
      body.set('position[new_path]', options.position.new_path);
    }
    if (options.position.old_line !== undefined) {
      body.set('position[old_line]', String(options.position.old_line));
    }
    if (options.position.new_line !== undefined) {
      body.set('position[new_line]', String(options.position.new_line));
    }
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/merge_requests/${options.merge_request_iid}/draft_notes/${options.draft_note_id}`;
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
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

  const publishedNote = await response.json();
  return publishedNote;
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

/**
 * Handler for create_label tool - REAL GitLab API call
 */
export async function handleCreateLabel(args: unknown): Promise<unknown> {
  const options = CreateLabelSchema.parse(args);

  const body = new URLSearchParams();
  body.set('name', options.name);
  body.set('color', options.color);
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.priority !== undefined) {
    body.set('priority', String(options.priority));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/labels`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const label = await response.json();
  return label;
}

/**
 * Handler for update_label tool - REAL GitLab API call
 */
export async function handleUpdateLabel(args: unknown): Promise<unknown> {
  const options = UpdateLabelSchema.parse(args);

  const body = new URLSearchParams();
  if (options.new_name) {
    body.set('new_name', options.new_name);
  }
  if (options.color) {
    body.set('color', options.color);
  }
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.priority !== undefined) {
    body.set('priority', String(options.priority));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/labels/${encodeURIComponent(options.label_id)}`;
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const label = await response.json();
  return label;
}

/**
 * Handler for delete_label tool - REAL GitLab API call
 */
export async function handleDeleteLabel(args: unknown): Promise<unknown> {
  const options = DeleteLabelSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/labels/${encodeURIComponent(options.label_id)}`;
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
 * Handler for upload_markdown tool - REAL GitLab API call
 */
export async function handleUploadMarkdown(args: unknown): Promise<unknown> {
  const options = MarkdownUploadSchema.parse(args);

  const formData = new FormData();

  // Handle different file input types
  if (typeof options.file === 'string') {
    // Base64 encoded file
    const buffer = Buffer.from(options.file, 'base64');
    const blob = new Blob([buffer]);
    formData.append('file', blob, options.filename || 'file');
  } else if (Buffer.isBuffer?.(options.file)) {
    // Buffer input
    const blob = new Blob([options.file]);
    formData.append('file', blob, options.filename || 'file');
  } else {
    // Assume it's already a File or Blob
    formData.append('file', options.file, options.filename || 'file');
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/uploads`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const upload = await response.json();
  return upload;
}
