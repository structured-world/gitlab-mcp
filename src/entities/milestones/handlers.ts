/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ListProjectMilestonesSchema,
  GetProjectMilestoneSchema,
  GetMilestoneIssuesSchema,
  GetMilestoneMergeRequestsSchema,
  GetMilestoneBurndownEventsSchema,
} from './schema-readonly';
import {
  CreateProjectMilestoneSchema,
  EditProjectMilestoneSchema,
  DeleteProjectMilestoneSchema,
  PromoteProjectMilestoneSchema,
} from './schema';

/**
 * Handler for list_milestones tool - REAL GitLab API call
 */
export async function handleListMilestones(args: unknown): Promise<unknown> {
  const options = ListProjectMilestonesSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'project_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const milestones = await response.json();
  return milestones;
}

/**
 * Handler for get_milestone tool - REAL GitLab API call
 */
export async function handleGetMilestone(args: unknown): Promise<unknown> {
  const options = GetProjectMilestoneSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const milestone = await response.json();
  return milestone;
}

/**
 * Handler for get_milestone_issue tool - REAL GitLab API call
 */
export async function handleGetMilestoneIssue(args: unknown): Promise<unknown> {
  const options = GetMilestoneIssuesSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'project_id' && key !== 'milestone_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}/issues?${queryParams}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const issues = await response.json();
  return issues;
}

/**
 * Handler for get_milestone_merge_requests tool - REAL GitLab API call
 */
export async function handleGetMilestoneMergeRequests(args: unknown): Promise<unknown> {
  const options = GetMilestoneMergeRequestsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'project_id' && key !== 'milestone_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}/merge_requests?${queryParams}`;
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
 * Handler for get_milestone_burndown_events tool - REAL GitLab API call
 */
export async function handleGetMilestoneBurndownEvents(args: unknown): Promise<unknown> {
  const options = GetMilestoneBurndownEventsSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}/burndown_events`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const burndownEvents = await response.json();
  return burndownEvents;
}

/**
 * Handler for create_milestone tool - REAL GitLab API call
 */
export async function handleCreateMilestone(args: unknown): Promise<unknown> {
  const options = CreateProjectMilestoneSchema.parse(args);

  const body = new URLSearchParams();
  body.set('title', options.title);
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.due_date) {
    body.set('due_date', options.due_date);
  }
  if (options.start_date) {
    body.set('start_date', options.start_date);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones`;
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

  const milestone = await response.json();
  return milestone;
}

/**
 * Handler for edit_milestone tool - REAL GitLab API call
 */
export async function handleEditMilestone(args: unknown): Promise<unknown> {
  const options = EditProjectMilestoneSchema.parse(args);

  const body = new URLSearchParams();
  if (options.title) {
    body.set('title', options.title);
  }
  if (options.description !== undefined) {
    body.set('description', options.description);
  }
  if (options.due_date !== undefined) {
    body.set('due_date', options.due_date || '');
  }
  if (options.start_date !== undefined) {
    body.set('start_date', options.start_date || '');
  }
  if (options.state_event) {
    body.set('state_event', options.state_event);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}`;
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

  const milestone = await response.json();
  return milestone;
}

/**
 * Handler for delete_milestone tool - REAL GitLab API call
 */
export async function handleDeleteMilestone(args: unknown): Promise<unknown> {
  const options = DeleteProjectMilestoneSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}`;
  const response = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  // DELETE operations typically return 204 No Content
  if (response.status === 204) {
    return { success: true, message: 'Milestone deleted successfully' };
  }

  const result = await response.json();
  return result;
}

/**
 * Handler for promote_milestone tool - REAL GitLab API call
 */
export async function handlePromoteMilestone(args: unknown): Promise<unknown> {
  const options = PromoteProjectMilestoneSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/milestones/${options.milestone_id}/promote`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const milestone = await response.json();
  return milestone;
}
