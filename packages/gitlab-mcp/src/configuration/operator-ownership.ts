import { gql } from 'graphql-tag';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ConnectionManager } from '../services/ConnectionManager';
import { getGitLabApiUrlFromContext } from '../oauth/token-context';
import { extractSimpleId, toGid } from '../utils/idConversion';
import { gitlab } from '../utils/gitlab-api';
import { normalizeProjectId } from '../utils/projectIdentifier';
import { encodeApiSegment } from '../utils/api-path';
import type { EffectivePolicy } from './policy';

type Metadata = Record<string, unknown>;
type Query = TypedDocumentNode<Metadata, Record<string, unknown>>;
export type ReadOwnership = (query: Query, variables: Record<string, unknown>) => Promise<Metadata>;

// These roots and project.id exist at v16.0.0-ee: types/query_type.rb,
// types/{work_item,container_repository,todo}_type.rb and ee/types/vulnerability_type.rb.
const WORK_ITEM_OWNER: Query = gql`
  query OperatorWorkItemOwner($id: WorkItemID!) {
    workItem(id: $id) {
      project {
        id
      }
    }
  }
`;
const REPOSITORY_OWNER: Query = gql`
  query OperatorRepositoryOwner($id: ContainerRepositoryID!) {
    containerRepository(id: $id) {
      project {
        id
      }
    }
  }
`;
const VULNERABILITY_OWNER: Query = gql`
  query OperatorVulnerabilityOwner($id: VulnerabilityID!) {
    vulnerability(id: $id) {
      project {
        id
      }
    }
  }
`;
const TODO_OWNER: Query = gql`
  query OperatorTodoOwner($id: TodoID!) {
    todo(id: $id) {
      project {
        id
      }
    }
  }
`;
// TimelogResolver at v16.0.0-ee filters projectId before pagination.
const PROJECT_TIMELOGS: Query = gql`
  query OperatorProjectTimelogs($projectId: ProjectID!, $after: String) {
    timelogs(projectId: $projectId, first: 100, after: $after) {
      nodes {
        id
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

/** Ownership verification has a fixed work ceiling and never commits a partial verification. */
const MAX_METADATA_REQUESTS = 100;

type Args = Record<string, unknown>;
interface OwnershipCheck {
  allowed: ReadonlySet<string>;
  expired: () => boolean;
  budget: () => void;
  query: ReadOwnership;
  owned: (document: Query, field: string, id: string) => Promise<void>;
}

function scalarId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new TypeError('Invalid resource ID');
  return String(value);
}

function createCheck(
  allowed: ReadonlySet<string>,
  expired: () => boolean,
  read?: ReadOwnership,
): OwnershipCheck {
  let requests = 0;
  const budget = (): void => {
    if (expired()) throw new Error('Tool call expired during project ownership verification');
    if (requests >= MAX_METADATA_REQUESTS)
      throw new Error('Project ownership verification exceeded its metadata request limit');
    requests++;
  };
  const query: ReadOwnership = async (document, variables) => {
    budget();
    const result = read
      ? await read(document, variables)
      : await ConnectionManager.getInstance()
          .getClient(getGitLabApiUrlFromContext())
          .request(document, variables);
    if (expired()) throw new Error('Tool call expired during project ownership verification');
    return result;
  };
  const owned = async (document: Query, field: string, id: string): Promise<void> => {
    const answer = await query(document, { id });
    const row = answer[field] as { project?: { id?: unknown } | null } | null | undefined;
    const projectId = row?.project?.id;
    if (typeof projectId !== 'string' || !allowed.has(extractSimpleId(projectId)))
      throw new Error(`${field} is not owned by a project permitted by GITLAB_ALLOWED_PROJECT_IDS`);
  };
  return { allowed, expired, budget, query, owned };
}

function addWorkItemId(ids: Set<string>, value: unknown): void {
  if (value === undefined || value === null) return;
  const id = toGid(scalarId(value), 'WorkItem');
  if (!ids.has(id) && ids.size >= MAX_METADATA_REQUESTS)
    throw new Error('Too many work item ownership checks in one call');
  ids.add(id);
}

function workItemIds(tool: string, args: Args): Set<string> {
  const ids = new Set<string>();
  // Namespace + IID wins over a global ID, just as in the work item handler.
  if (!(tool === 'browse_work_items' && args.namespace !== undefined && args.iid !== undefined))
    addWorkItemId(ids, args.id);
  for (const field of ['targetId', 'parentId']) addWorkItemId(ids, args[field]);
  if (Array.isArray(args.childrenIds)) for (const id of args.childrenIds) addWorkItemId(ids, id);
  return ids;
}

interface TimelogPage {
  nodes: Array<{ id: string }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

async function timelogPage(
  check: OwnershipCheck,
  projectId: string,
  after: string | null,
): Promise<TimelogPage> {
  const answer = await check.query(PROJECT_TIMELOGS, {
    projectId: toGid(projectId, 'Project'),
    after,
  });
  const connection = answer.timelogs as TimelogPage | null;
  if (
    !Array.isArray(connection?.nodes) ||
    connection.nodes.length > 100 ||
    typeof connection.pageInfo?.hasNextPage !== 'boolean'
  )
    throw new Error('GitLab did not return verifiable timelog ownership');
  return connection;
}

function timelogCursor(page: TimelogPage, previous: string | null): string | null {
  if (!page.pageInfo.hasNextPage) return null;
  const cursor = page.pageInfo.endCursor;
  if (!cursor || cursor === previous)
    throw new Error('GitLab returned an invalid timelog ownership cursor');
  return cursor;
}

async function checkTimelog(args: Args, check: OwnershipCheck): Promise<void> {
  const id = extractSimpleId(scalarId(args.timelogId));
  for (const projectId of check.allowed) {
    let after: string | null = null;
    for (;;) {
      const page = await timelogPage(check, projectId, after);
      if (page.nodes.some((entry) => extractSimpleId(entry.id) === id)) return;
      after = timelogCursor(page, after);
      if (after === null) break;
    }
  }
  throw new Error('Timelog is not owned by a project permitted by GITLAB_ALLOWED_PROJECT_IDS');
}

async function checkWorkItems(tool: string, args: Args, check: OwnershipCheck): Promise<void> {
  const ids = workItemIds(tool, args);
  const { owned } = check;
  // Verify serially so the first denied owner prevents requests for later relationship targets.
  for (const id of ids) await owned(WORK_ITEM_OWNER, 'workItem', id);
  if (args.action === 'delete_timelog') await checkTimelog(args, check);
}

type SuggestionNote = { suggestions?: Array<{ id: number }> };
function keepSuggestions(notes: SuggestionNote[], wanted: Set<string>): void {
  if (!Array.isArray(notes) || notes.length > 20)
    throw new Error('GitLab did not return verifiable suggestion ownership');
  for (const note of notes) {
    if (note.suggestions && note.suggestions.length > MAX_METADATA_REQUESTS)
      throw new Error('Too many suggestions in ownership metadata');
    for (const suggestion of note.suggestions ?? []) wanted.delete(String(suggestion.id));
  }
}

async function checkSuggestions(args: Args, check: OwnershipCheck): Promise<void> {
  const ids = args.action === 'apply_suggestion' ? [args.suggestion_id] : args.suggestion_ids;
  if (!Array.isArray(ids) || ids.length > MAX_METADATA_REQUESTS)
    throw new Error('Too many suggestion ownership checks in one call');
  const wanted = new Set(ids.map(scalarId));
  let page = 1;
  while (wanted.size > 0) {
    check.budget();
    const result = await gitlab.getPage<SuggestionNote>(
      `projects/${normalizeProjectId(scalarId(args.project_id))}/merge_requests/${encodeApiSegment(scalarId(args.merge_request_iid))}/notes`,
      { query: { per_page: 20, page } },
    );
    if (check.expired())
      throw new Error('Tool call expired during suggestion ownership verification');
    keepSuggestions(result.items, wanted);
    if (result.nextPage === null) break;
    if (result.nextPage <= page)
      throw new Error('GitLab returned an invalid suggestion ownership cursor');
    page = result.nextPage;
  }
  if (wanted.size > 0)
    throw new Error(
      'GitLab did not confirm that every suggestion belongs to the permitted merge request',
    );
}

/** Check real owners of global IDs; a supplied project hint is not ownership evidence. */
export async function assertOperatorOwnership(
  tool: string,
  args: Record<string, unknown>,
  policy: EffectivePolicy,
  expired: () => boolean,
  read?: ReadOwnership,
): Promise<void> {
  const allowed = policy.operatorProjectIds;
  if (!allowed) return;
  const check = createCheck(allowed, expired, read);
  switch (tool) {
    case 'browse_work_items':
    case 'manage_work_item':
      return checkWorkItems(tool, args, check);
    case 'browse_registry':
    case 'manage_registry':
      if (args.repository_id !== undefined)
        await check.owned(
          REPOSITORY_OWNER,
          'containerRepository',
          `gid://gitlab/ContainerRepository/${extractSimpleId(scalarId(args.repository_id))}`,
        );
      return;
    case 'browse_vulnerabilities':
    case 'manage_vulnerability':
      if (args.vulnerability_id !== undefined)
        await check.owned(
          VULNERABILITY_OWNER,
          'vulnerability',
          `gid://gitlab/Vulnerability/${extractSimpleId(scalarId(args.vulnerability_id))}`,
        );
      return;
    case 'manage_todos':
      if (args.id !== undefined)
        await check.owned(
          TODO_OWNER,
          'todo',
          `gid://gitlab/Todo/${extractSimpleId(scalarId(args.id))}`,
        );
      return;
    case 'manage_mr_discussion':
      if (args.action === 'apply_suggestion' || args.action === 'apply_suggestions')
        await checkSuggestions(args, check);
  }
}
