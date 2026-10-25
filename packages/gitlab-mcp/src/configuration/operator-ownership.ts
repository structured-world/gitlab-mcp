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
    if (typeof projectId !== 'string' || !allowed.has(extractSimpleId(projectId))) {
      throw new Error(`${field} is not owned by a project permitted by GITLAB_ALLOWED_PROJECT_IDS`);
    }
  };

  if (tool === 'browse_work_items' || tool === 'manage_work_item') {
    const ids = new Set<string>();
    const add = (value: unknown): void => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new Error('Invalid work item ID');
      const id = toGid(String(value), 'WorkItem');
      if (!ids.has(id) && ids.size >= MAX_METADATA_REQUESTS)
        throw new Error('Too many work item ownership checks in one call');
      ids.add(id);
    };
    // Namespace + IID wins over a global ID, just as in the work item handler.
    if (!(tool === 'browse_work_items' && args.namespace !== undefined && args.iid !== undefined))
      add(args.id);
    for (const field of ['targetId', 'parentId']) add(args[field]);
    if (Array.isArray(args.childrenIds)) for (const id of args.childrenIds) add(id);
    for (const id of ids) await owned(WORK_ITEM_OWNER, 'workItem', id);
    if (args.action === 'delete_timelog') {
      const id = extractSimpleId(String(args.timelogId));
      let found = false;
      for (const projectId of allowed) {
        let after: string | null = null;
        for (;;) {
          const answer = await query(PROJECT_TIMELOGS, {
            projectId: toGid(projectId, 'Project'),
            after,
          });
          const connection = answer.timelogs as {
            nodes?: Array<{ id: string }>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          } | null;
          if (
            !Array.isArray(connection?.nodes) ||
            connection.nodes.length > 100 ||
            typeof connection.pageInfo?.hasNextPage !== 'boolean'
          )
            throw new Error('GitLab did not return verifiable timelog ownership');
          found = connection.nodes.some((entry) => extractSimpleId(entry.id) === id);
          if (found || !connection.pageInfo.hasNextPage) break;
          if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)
            throw new Error('GitLab returned an invalid timelog ownership cursor');
          after = connection.pageInfo.endCursor;
        }
        if (found) break;
      }
      if (!found)
        throw new Error(
          'Timelog is not owned by a project permitted by GITLAB_ALLOWED_PROJECT_IDS',
        );
    }
  }
  if (
    (tool === 'browse_registry' || tool === 'manage_registry') &&
    args.repository_id !== undefined
  ) {
    await owned(
      REPOSITORY_OWNER,
      'containerRepository',
      `gid://gitlab/ContainerRepository/${extractSimpleId(String(args.repository_id))}`,
    );
  }
  if (
    (tool === 'browse_vulnerabilities' || tool === 'manage_vulnerability') &&
    args.vulnerability_id !== undefined
  ) {
    await owned(
      VULNERABILITY_OWNER,
      'vulnerability',
      `gid://gitlab/Vulnerability/${extractSimpleId(String(args.vulnerability_id))}`,
    );
  }
  if (tool === 'manage_todos' && args.id !== undefined) {
    await owned(TODO_OWNER, 'todo', `gid://gitlab/Todo/${extractSimpleId(String(args.id))}`);
  }
  if (
    tool === 'manage_mr_discussion' &&
    (args.action === 'apply_suggestion' || args.action === 'apply_suggestions')
  ) {
    const ids = args.action === 'apply_suggestion' ? [args.suggestion_id] : args.suggestion_ids;
    if (!Array.isArray(ids) || ids.length > MAX_METADATA_REQUESTS)
      throw new Error('Too many suggestion ownership checks in one call');
    const wanted = new Set(ids.map(String));
    for (let page = 1; wanted.size > 0; page++) {
      budget();
      const notes = await gitlab.get<Array<{ suggestions?: Array<{ id: number }> }>>(
        `projects/${normalizeProjectId(String(args.project_id))}/merge_requests/${encodeApiSegment(String(args.merge_request_iid))}/notes`,
        { query: { per_page: 20, page } },
      );
      if (expired()) throw new Error('Tool call expired during suggestion ownership verification');
      if (!Array.isArray(notes) || notes.length > 20)
        throw new Error('GitLab did not return verifiable suggestion ownership');
      for (const note of notes) {
        if (note.suggestions && note.suggestions.length > MAX_METADATA_REQUESTS)
          throw new Error('Too many suggestions in ownership metadata');
        for (const suggestion of note.suggestions ?? []) wanted.delete(String(suggestion.id));
      }
      if (notes.length < 20) break;
    }
    if (wanted.size > 0)
      throw new Error(
        'GitLab did not confirm that every suggestion belongs to the permitted merge request',
      );
  }
}
