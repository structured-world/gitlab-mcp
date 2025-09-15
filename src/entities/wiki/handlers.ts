/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ListWikiPagesSchema, GetWikiPageSchema } from './schema-readonly';
import { CreateWikiPageSchema, UpdateWikiPageSchema, DeleteWikiPageSchema } from './schema';
import { enhancedFetch } from '../../utils/fetch';

/**
 * Handler for list_wiki_pages tool - REAL GitLab API call
 */
export async function handleListWikiPages(args: unknown): Promise<unknown> {
  const options = ListWikiPagesSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const queryParams = new URLSearchParams();
  if (options.with_content !== undefined) {
    queryParams.set('with_content', String(options.with_content));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis?${queryParams}`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const wikiPages = await response.json();
  return wikiPages;
}

/**
 * Handler for get_wiki_page tool - REAL GitLab API call
 */
export async function handleGetWikiPage(args: unknown): Promise<unknown> {
  const options = GetWikiPageSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(options.slug)}`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const wikiPage = await response.json();
  return wikiPage;
}

/**
 * Handler for create_wiki_page tool - REAL GitLab API call
 */
export async function handleCreateWikiPage(args: unknown): Promise<unknown> {
  const options = CreateWikiPageSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const body = new URLSearchParams();
  body.set('title', options.title);
  body.set('content', options.content);
  if (options.format) {
    body.set('format', options.format);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis`;
  const response = await enhancedFetch(apiUrl, {
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

  const wikiPage = await response.json();
  return wikiPage;
}

/**
 * Handler for update_wiki_page tool - REAL GitLab API call
 */
export async function handleUpdateWikiPage(args: unknown): Promise<unknown> {
  const options = UpdateWikiPageSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const body = new URLSearchParams();
  if (options.title) {
    body.set('title', options.title);
  }
  if (options.content) {
    body.set('content', options.content);
  }
  if (options.format) {
    body.set('format', options.format);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(options.slug)}`;
  const response = await enhancedFetch(apiUrl, {
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

  const wikiPage = await response.json();
  return wikiPage;
}

/**
 * Handler for delete_wiki_page tool - REAL GitLab API call
 */
export async function handleDeleteWikiPage(args: unknown): Promise<unknown> {
  const options = DeleteWikiPageSchema.parse(args);
  const { project_id, group_id } = options;

  // Determine entity type and ID
  const isProject = !!project_id;
  const entityType = isProject ? 'projects' : 'groups';
  const entityId = (isProject ? project_id : group_id) as string;

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/${entityType}/${encodeURIComponent(entityId)}/wikis/${encodeURIComponent(options.slug)}`;
  const response = await enhancedFetch(apiUrl, {
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
    return { success: true, message: 'Wiki page deleted successfully' };
  }

  const result = await response.json();
  return result;
}
