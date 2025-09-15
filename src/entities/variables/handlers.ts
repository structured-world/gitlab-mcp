/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ListVariablesSchema, GetVariableSchema } from './schema-readonly';
import { CreateVariableSchema, UpdateVariableSchema, DeleteVariableSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';

/**
 * Handler for list_variables tool - REAL GitLab API call
 */
export async function handleListVariables(args: unknown): Promise<unknown> {
  const options = ListVariablesSchema.parse(args);
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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const variables = await response.json();
  return variables;
}

/**
 * Handler for get_variable tool - REAL GitLab API call
 */
export async function handleGetVariable(args: unknown): Promise<unknown> {
  const options = GetVariableSchema.parse(args);
  const { project_id, group_id, key } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  let apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}`;

  // Add filter query parameters if provided
  if (options.filter?.environment_scope) {
    const queryParams = new URLSearchParams();
    queryParams.set('filter[environment_scope]', options.filter.environment_scope);
    apiUrl += `?${queryParams}`;
  }

  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const variable = await response.json();
  return variable;
}

/**
 * Handler for create_variable tool - REAL GitLab API call
 */
export async function handleCreateVariable(args: unknown): Promise<unknown> {
  const options = CreateVariableSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && key !== 'project_id' && key !== 'group_id') {
      body.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables`;
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

  const variable = await response.json();
  return variable;
}

/**
 * Handler for update_variable tool - REAL GitLab API call
 */
export async function handleUpdateVariable(args: unknown): Promise<unknown> {
  const options = UpdateVariableSchema.parse(args);
  const { project_id, group_id, key } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const body = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (
      value !== undefined &&
      key !== 'project_id' &&
      key !== 'group_id' &&
      key !== 'key' &&
      key !== 'filter'
    ) {
      body.set(key, String(value));
    }
  });

  // Handle filter parameters
  if (options.filter?.environment_scope) {
    body.set('filter[environment_scope]', options.filter.environment_scope);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}`;
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

  const variable = await response.json();
  return variable;
}

/**
 * Handler for delete_variable tool - REAL GitLab API call
 */
export async function handleDeleteVariable(args: unknown): Promise<unknown> {
  const options = DeleteVariableSchema.parse(args);
  const { project_id, group_id, key } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  let apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/variables/${encodeURIComponent(key)}`;

  // Add filter query parameters if provided
  if (options.filter?.environment_scope) {
    const queryParams = new URLSearchParams();
    queryParams.set('filter[environment_scope]', options.filter.environment_scope);
    apiUrl += `?${queryParams}`;
  }

  const response = await enhancedFetch(apiUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  // DELETE endpoints typically return 204 No Content on success
  if (response.status === 204) {
    return { success: true, message: 'Variable deleted successfully' };
  }

  const result = await response.json();
  return result;
}
