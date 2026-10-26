import * as z from 'zod';
import {
  BrowseProjectsSchema,
  BrowseNamespacesSchema,
  type BrowseProjectsOptions,
  type BrowseNamespacesOptions,
} from './schema-readonly';
import {
  ManageProjectSchema,
  ManageNamespaceSchema,
  type ManageProjectOptions,
  type ManageNamespaceOptions,
} from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { cleanGidsFromObject } from '../../utils/idConversion';
import { assertActionAllowed } from '../utils';
import { assertInstanceAtLeast, currentInstance, instanceAtLeast } from '../instance-version';
import { GROUP_DUO_SETTINGS, PROJECT_DUO_SETTINGS, withUnappliedSettings } from './duo-settings';

type ProjectSearch = Extract<BrowseProjectsOptions, { action: 'search' }>;
type ProjectList = Extract<BrowseProjectsOptions, { action: 'list' }>;
type NamespaceList = Extract<BrowseNamespacesOptions, { action: 'list' }>;
type ProjectCreate = Extract<ManageProjectOptions, { action: 'create' }>;
type GroupCreate = Extract<ManageNamespaceOptions, { action: 'create' }>;
/** Fields stay in wire order; true preserves false, zero and empty-string values. */
type ParameterField<T> = readonly [key: keyof T, keepFalsy: boolean];

const PROJECT_SEARCH_FIELDS = [
  ['with_programming_language', false],
  ['visibility', false],
  ['order_by', false],
  ['sort', false],
  ['per_page', false],
  ['page', false],
] as const satisfies readonly ParameterField<ProjectSearch>[];
const PROJECT_LIST_FIELDS = [
  ['visibility', false],
  ['archived', true],
  ['owned', true],
  ['starred', true],
  ['membership', true],
  ['search', false],
  ['simple', true],
  ['order_by', false],
  ['sort', false],
  ['per_page', false],
  ['page', false],
  ['include_subgroups', true],
  ['with_shared', true],
  ['with_programming_language', false],
  ['marked_for_deletion_on', false],
] as const satisfies readonly ParameterField<ProjectList>[];
const NAMESPACE_LIST_FIELDS = [
  ['search', false],
  ['owned_only', true],
  ['top_level_only', true],
  ['with_statistics', true],
  ['min_access_level', true],
  ['per_page', false],
  ['page', false],
] as const satisfies readonly ParameterField<NamespaceList>[];
const PROJECT_CREATE_FIELDS = [
  ['issues_enabled', true],
  ['merge_requests_enabled', true],
  ['jobs_enabled', true],
  ['wiki_enabled', true],
  ['snippets_enabled', true],
  ['lfs_enabled', true],
  ['request_access_enabled', true],
  ['only_allow_merge_if_pipeline_succeeds', true],
  ['only_allow_merge_if_all_discussions_are_resolved', true],
] as const satisfies readonly ParameterField<ProjectCreate>[];
const GROUP_CREATE_FIELDS = [
  ['description', false],
  ['visibility', false],
  ['parent_id', true],
  ['lfs_enabled', true],
  ['request_access_enabled', true],
  ['default_branch_protection', true],
  ['avatar', false],
  ['membership_lock', true],
  ['wiki_access_level', true],
] as const satisfies readonly ParameterField<GroupCreate>[];

function appendParameters<T>(
  params: URLSearchParams,
  input: T,
  fields: readonly ParameterField<T>[],
): void {
  for (const [key, keepFalsy] of fields) {
    const value = input[key];
    if (value === undefined || (!keepFalsy && !value)) continue;
    params.set(String(key), String(value));
  }
}

function assertSuccessful(response: Response): void {
  if (!response.ok) throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
}

async function entityJson(url: string, options?: RequestInit): Promise<unknown> {
  const response = options ? await enhancedFetch(url, options) : await enhancedFetch(url);
  assertSuccessful(response);
  const data: unknown = await response.json();
  return data;
}

function entityUrl(kind: 'projects' | 'groups', id: string): string {
  return `${getGitLabBaseUrl()}/api/v4/${kind}/${normalizeProjectId(id)}`;
}

function formRequest(method: 'POST' | 'PUT', body: URLSearchParams): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

function updateBody(
  params: Record<string, string | number | boolean | undefined>,
): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

function projectSearchParams(input: ProjectSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (input.q) {
    let search = input.q;
    const topics = search.match(/topic:(\w+)/g);
    if (topics) {
      params.set('topic', topics.map((topic) => topic.replace('topic:', '')).join(','));
      search = search.replace(/topic:\w+/g, '').trim();
    }
    if (search) params.set('search', search);
  }
  appendParameters(params, input, PROJECT_SEARCH_FIELDS);
  params.set('active', 'true');
  return params;
}

/** Preserve native active filtering or its server-side archived emulation on older GitLab. */
function applyActiveFilter(params: URLSearchParams, active: boolean, since: string): void {
  if (instanceAtLeast(since)) {
    params.delete('archived');
    params.set('active', String(active));
  } else {
    params.delete('active');
    params.set('archived', String(!active));
  }
}

const PROJECT_LIST_DEFAULTS = [
  ['order_by', 'created_at'],
  ['sort', 'desc'],
  ['simple', 'true'],
  ['per_page', '20'],
] as const;

function projectListUrl(input: ProjectList): string {
  const params = new URLSearchParams();
  appendParameters(params, input, PROJECT_LIST_FIELDS);
  for (const [key, value] of PROJECT_LIST_DEFAULTS) {
    if (!params.has(key)) params.set(key, value);
  }
  if (input.group_id) {
    // Native active: 18.5 for /projects, 18.8 for /groups/:id/projects.
    if (input.active !== undefined) applyActiveFilter(params, input.active, '18.8');
    return `${entityUrl('groups', input.group_id)}/projects?${params}`;
  }
  if (input.include_deleted) {
    params.set('include_pending_delete', 'true');
  } else if (input.active !== undefined) {
    applyActiveFilter(params, input.active, '18.5');
  } else {
    params.set('active', 'true');
  }
  return `${getGitLabBaseUrl()}/api/v4/projects?${params}`;
}

export async function browseProjects(args: unknown): Promise<unknown> {
  const input = BrowseProjectsSchema.parse(args);
  assertActionAllowed('browse_projects', input.action);
  switch (input.action) {
    case 'search':
      return cleanGidsFromObject(
        await entityJson(`${getGitLabBaseUrl()}/api/v4/projects?${projectSearchParams(input)}`),
      );
    case 'list':
      return cleanGidsFromObject(await entityJson(projectListUrl(input)));
    case 'get': {
      const params = new URLSearchParams();
      if (input.statistics) params.set('statistics', 'true');
      if (input.license) params.set('license', 'true');
      return cleanGidsFromObject(
        await entityJson(`${entityUrl('projects', input.project_id)}?${params}`),
      );
    }
  }
}

export async function browseNamespaces(args: unknown): Promise<unknown> {
  const input = BrowseNamespacesSchema.parse(args);
  assertActionAllowed('browse_namespaces', input.action);
  if (input.action === 'list') {
    const params = new URLSearchParams();
    appendParameters(params, input, NAMESPACE_LIST_FIELDS);
    return cleanGidsFromObject(
      await entityJson(`${getGitLabBaseUrl()}/api/v4/namespaces?${params}`),
    );
  }
  const url = `${getGitLabBaseUrl()}/api/v4/namespaces/${encodeURIComponent(input.namespace_id)}`;
  if (input.action === 'get') return cleanGidsFromObject(await entityJson(url));
  const response = await enhancedFetch(url);
  const data: unknown = response.ok ? await response.json() : null;
  return {
    exists: response.ok,
    status: response.status,
    namespace: input.namespace_id,
    data,
  };
}

async function resolveNamespace(
  namespace: string | undefined,
): Promise<{ id: string; full_path: string } | null> {
  if (!namespace) return null;
  const response = await enhancedFetch(
    `${getGitLabBaseUrl()}/api/v4/namespaces/${encodeURIComponent(namespace)}`,
  );
  if (!response.ok) throw new Error(`Namespace '${namespace}' not found or not accessible`);
  return (await response.json()) as { id: string; full_path: string };
}

function projectCreateBody(
  input: ProjectCreate,
  namespaceId: string | undefined,
  generatedPath: string,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set('name', input.name);
  body.set('path', generatedPath);
  if (namespaceId) body.set('namespace_id', namespaceId);
  // initialize_with_readme is truthy-only and uses the literal "true", not String(value).
  if (input.description) body.set('description', input.description);
  if (input.visibility) body.set('visibility', input.visibility);
  if (input.initialize_with_readme) body.set('initialize_with_readme', 'true');
  appendParameters(body, input, PROJECT_CREATE_FIELDS);
  return body;
}

async function createProject(input: ProjectCreate): Promise<unknown> {
  const resolved = await resolveNamespace(input.namespace);
  const namespaceId = resolved ? String(resolved.id) : undefined;
  const projectPath = `${resolved ? resolved.full_path : 'current-user'}/${input.name}`;
  const existing = await enhancedFetch(
    `${getGitLabBaseUrl()}/api/v4/projects/${encodeURIComponent(projectPath)}`,
  );
  if (existing.ok) {
    const project = (await existing.json()) as { id: string };
    throw new Error(`Project '${projectPath}' already exists (ID: ${project.id}).`);
  }
  const generatedPath = input.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const body = projectCreateBody(input, namespaceId, generatedPath);
  const project = (await entityJson(
    `${getGitLabBaseUrl()}/api/v4/projects`,
    formRequest('POST', body),
  )) as Record<string, unknown>;
  return {
    ...project,
    validation: {
      namespace_resolved: input.namespace ? `${input.namespace} -> ${namespaceId}` : 'current-user',
      generated_path: generatedPath,
    },
  };
}

async function forkProject(
  input: Extract<ManageProjectOptions, { action: 'fork' }>,
): Promise<unknown> {
  const body = new URLSearchParams();
  if (input.namespace) body.set('namespace', input.namespace);
  if (input.namespace_path) body.set('namespace_path', input.namespace_path);
  if (input.fork_name) body.set('name', input.fork_name);
  if (input.fork_path) body.set('path', input.fork_path);
  return entityJson(`${entityUrl('projects', input.project_id)}/fork`, formRequest('POST', body));
}

async function updateProject(
  input: Extract<ManageProjectOptions, { action: 'update' }>,
): Promise<unknown> {
  const { project_id, action: _action, ...params } = input;
  const result = await entityJson(
    entityUrl('projects', project_id),
    formRequest('PUT', updateBody(params)),
  );
  return withUnappliedSettings(params, result, PROJECT_DUO_SETTINGS);
}

async function deleteEntity(kind: 'projects' | 'groups', id: string): Promise<unknown> {
  const response = await enhancedFetch(entityUrl(kind, id), { method: 'DELETE' });
  assertSuccessful(response);
  return { success: true, message: `${kind === 'projects' ? 'Project' : 'Group'} ${id} deleted` };
}

const RestoredEntitySchema = z
  .object({
    id: z.number().int().positive(),
    marked_for_deletion_on: z.string().nullable().optional(),
  })
  .passthrough();

async function restoreEntity(kind: 'projects' | 'groups', id: string): Promise<unknown> {
  const label = kind === 'projects' ? 'Project' : 'Group';
  // Delayed deletion became unconditional on Free in 18.0; Premium supports the whole floor.
  if (currentInstance()?.tier === 'free')
    assertInstanceAtLeast('18.0', `${label} restore on GitLab Free`);
  const restored = RestoredEntitySchema.safeParse(
    await entityJson(`${entityUrl(kind, id)}/restore`, { method: 'POST' }),
  );
  if (!restored.success)
    throw new Error(
      `GitLab API error: unexpected restore response shape (${restored.error.issues[0]?.message ?? 'invalid'})`,
    );
  return restored.data;
}

export async function manageProject(args: unknown): Promise<unknown> {
  const input = ManageProjectSchema.parse(args);
  assertActionAllowed('manage_project', input.action);
  switch (input.action) {
    case 'create':
      return createProject(input);
    case 'fork':
      return forkProject(input);
    case 'update':
      return updateProject(input);
    case 'delete':
      return deleteEntity('projects', input.project_id);
    case 'archive':
    case 'unarchive':
      return entityJson(`${entityUrl('projects', input.project_id)}/${input.action}`, {
        method: 'POST',
      });
    case 'transfer': {
      const body = new URLSearchParams();
      body.set('namespace', input.namespace);
      return entityJson(
        `${entityUrl('projects', input.project_id)}/transfer`,
        formRequest('PUT', body),
      );
    }
    case 'restore':
      return restoreEntity('projects', input.project_id);
  }
}

function groupCreateBody(input: GroupCreate): URLSearchParams {
  const body = new URLSearchParams();
  body.set('name', input.name);
  body.set('path', input.path);
  appendParameters(body, input, GROUP_CREATE_FIELDS);
  return body;
}

async function updateNamespace(
  input: Extract<ManageNamespaceOptions, { action: 'update' }>,
): Promise<unknown> {
  const { group_id, action: _action, ...params } = input;
  const result = await entityJson(
    entityUrl('groups', group_id),
    formRequest('PUT', updateBody(params)),
  );
  return withUnappliedSettings(params, result, GROUP_DUO_SETTINGS);
}

export async function manageNamespace(args: unknown): Promise<unknown> {
  const input = ManageNamespaceSchema.parse(args);
  assertActionAllowed('manage_namespace', input.action);
  switch (input.action) {
    case 'create':
      return entityJson(
        `${getGitLabBaseUrl()}/api/v4/groups`,
        formRequest('POST', groupCreateBody(input)),
      );
    case 'update':
      return updateNamespace(input);
    case 'delete':
      return deleteEntity('groups', input.group_id);
    case 'restore':
      return restoreEntity('groups', input.group_id);
  }
}
