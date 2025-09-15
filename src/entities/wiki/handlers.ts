/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ListWikiPagesSchema, GetWikiPageSchema } from './schema-readonly';
import { CreateWikiPageSchema, UpdateWikiPageSchema, DeleteWikiPageSchema } from './schema';

/**
 * Handler for list_wiki_pages tool - REAL GitLab API call
 */
export async function handleListWikiPages(args: unknown): Promise<unknown> {
  const options = ListWikiPagesSchema.parse(args);

  const queryParams = new URLSearchParams();
  if (options.with_content !== undefined) {
    queryParams.set('with_content', String(options.with_content));
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/wikis?${queryParams}`;
  const response = await fetch(apiUrl, {
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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/wikis/${encodeURIComponent(options.slug)}`;
  const response = await fetch(apiUrl, {
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

  const body = new URLSearchParams();
  body.set('title', options.title);
  body.set('content', options.content);
  if (options.format) {
    body.set('format', options.format);
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/wikis`;
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

  const wikiPage = await response.json();
  return wikiPage;
}

/**
 * Handler for update_wiki_page tool - REAL GitLab API call
 */
export async function handleUpdateWikiPage(args: unknown): Promise<unknown> {
  const options = UpdateWikiPageSchema.parse(args);

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

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/wikis/${encodeURIComponent(options.slug)}`;
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

  const wikiPage = await response.json();
  return wikiPage;
}

/**
 * Handler for delete_wiki_page tool - REAL GitLab API call
 */
export async function handleDeleteWikiPage(args: unknown): Promise<unknown> {
  const options = DeleteWikiPageSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/wikis/${encodeURIComponent(options.slug)}`;
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
    return { success: true, message: 'Wiki page deleted successfully' };
  }

  const result = await response.json();
  return result;
}
