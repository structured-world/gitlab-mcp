/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ListProjectsSchema,
  SearchRepositoriesSchema,
  ListNamespacesSchema,
  GetUsersSchema,
  GetProjectSchema,
  ListGroupProjectsSchema,
  GetNamespaceSchema,
  VerifyNamespaceSchema,
  ListProjectMembersSchema,
  ListCommitsSchema,
  GetCommitSchema,
  GetCommitDiffSchema,
  ListEventsSchema,
  GetProjectEventsSchema,
  ListGroupIterationsSchema,
  DownloadAttachmentSchema,
} from './schema-readonly';
import { CreateRepositorySchema, ForkRepositorySchema, CreateBranchSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';

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
  const response = await enhancedFetch(apiUrl, {
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
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for get_users tool - REAL GitLab API call
 */
export async function handleGetUsers(args: unknown): Promise<unknown> {
  const options = GetUsersSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/users?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
  const { project_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for list_namespaces tool - REAL GitLab API call
 */
export async function handleListNamespaces(args: unknown): Promise<unknown> {
  const options = ListNamespacesSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for get_namespace tool - REAL GitLab API call
 */
export async function handleGetNamespace(args: unknown): Promise<unknown> {
  const options = GetNamespaceSchema.parse(args);
  const { namespace_id } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace_id)}`;
  const response = await enhancedFetch(apiUrl, {
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
  const { namespace } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/namespaces/${encodeURIComponent(namespace)}`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  return {
    exists: response.ok,
    namespace,
    status: response.status,
  };
}

/**
 * Handler for list_project_members tool - REAL GitLab API call
 */
export async function handleListProjectMembers(args: unknown): Promise<unknown> {
  const options = ListProjectMembersSchema.parse(args);
  const { project_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/members?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for list_group_projects tool - REAL GitLab API call
 */
export async function handleListGroupProjects(args: unknown): Promise<unknown> {
  const options = ListGroupProjectsSchema.parse(args);
  const { group_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'group_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/projects?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for list_commits tool - REAL GitLab API call
 */
export async function handleListCommits(args: unknown): Promise<unknown> {
  const options = ListCommitsSchema.parse(args);
  const { project_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
  const { project_id, commit_sha } = options;

  const queryParams = new URLSearchParams();
  if (options.stats !== undefined) {
    queryParams.set('stats', String(options.stats));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(commit_sha)}?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for get_commit_diff tool - REAL GitLab API call
 */
export async function handleGetCommitDiff(args: unknown): Promise<unknown> {
  const options = GetCommitDiffSchema.parse(args);
  const { project_id, commit_sha } = options;

  const queryParams = new URLSearchParams();
  if (options.unidiff !== undefined) {
    queryParams.set('unidiff', String(options.unidiff));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/repository/commits/${encodeURIComponent(commit_sha)}/diff?${queryParams}`;
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
}

/**
 * Handler for list_group_iterations tool - REAL GitLab API call
 */
export async function handleListGroupIterations(args: unknown): Promise<unknown> {
  const options = ListGroupIterationsSchema.parse(args);
  const { group_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'group_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(group_id)}/iterations?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
  const { project_id, secret, filename } = options;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/uploads/${encodeURIComponent(secret)}/${encodeURIComponent(filename)}`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const attachment = await response.arrayBuffer();
  return {
    filename,
    content: Buffer.from(attachment).toString('base64'),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/**
 * Handler for list_events tool - REAL GitLab API call
 */
export async function handleListEvents(args: unknown): Promise<unknown> {
  const options = ListEventsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/events?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
  const { project_id } = options;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/events?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
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
 * Handler for create_repository tool - REAL GitLab API call
 */
export async function handleCreateRepository(args: unknown): Promise<unknown> {
  const options = CreateRepositorySchema.parse(args);

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        body.set(key, value.join(','));
      } else {
        body.set(key, String(value));
      }
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects`;
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

  const project = await response.json();
  return project;
}

/**
 * Handler for fork_repository tool - REAL GitLab API call
 */
export async function handleForkRepository(args: unknown): Promise<unknown> {
  const options = ForkRepositorySchema.parse(args);

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id') {
      body.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/fork`;
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

  const branch = await response.json();
  return branch;
}
