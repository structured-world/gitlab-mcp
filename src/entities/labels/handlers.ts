/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ListLabelsSchema, GetLabelSchema } from './schema-readonly';
import { CreateLabelSchema, UpdateLabelSchema, DeleteLabelSchema } from './schema';

/**
 * Handler for list_labels tool - REAL GitLab API call
 */
export async function handleListLabels(args: unknown): Promise<unknown> {
  const options = ListLabelsSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id' && key !== 'group_id') {
      queryParams.set(key, String(value));
    }
  });
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels?${queryParams}`;
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
  const { project_id, group_id, label_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(label_id)}`;
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
 * Handler for create_label tool - REAL GitLab API call
 */
export async function handleCreateLabel(args: unknown): Promise<unknown> {
  const options = CreateLabelSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const body = new URLSearchParams();
  body.set('name', options.name);
  body.set('color', options.color);
  if (options.description) {
    body.set('description', options.description);
  }
  if (options.priority !== undefined) {
    body.set('priority', String(options.priority));
  }
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels`;
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
  const label = await response.json();
  return label;
}

/**
 * Handler for update_label tool - REAL GitLab API call
 */
export async function handleUpdateLabel(args: unknown): Promise<unknown> {
  const options = UpdateLabelSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

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
  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(options.label_id)}`;
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
  const label = await response.json();
  return label;
}

/**
 * Handler for delete_label tool - REAL GitLab API call
 */
export async function handleDeleteLabel(args: unknown): Promise<unknown> {
  const options = DeleteLabelSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/labels/${encodeURIComponent(options.label_id)}`;
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
