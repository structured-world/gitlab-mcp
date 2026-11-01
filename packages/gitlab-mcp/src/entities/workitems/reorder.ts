import { gql } from 'graphql-tag';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ConnectionManager } from '../../services/ConnectionManager';
import { getGitLabApiUrlFromContext } from '../../oauth/token-context';
import {
  cleanWorkItemResponse,
  extractSimpleId,
  toGid,
  type GitLabWorkItem,
} from '../../utils/idConversion';
import type { GraphQLClient } from '../../graphql/client';
import type { ReorderWorkItemInput } from './schema';

interface Boards {
  nodes: Array<{ id: string } | null>;
}
interface Project {
  id: string;
  fullPath: string;
  boards?: Boards | null;
  group: { fullPath: string } | null;
}
interface Item {
  id: string;
  iid: string;
  project: Project | null;
}
interface Context {
  target: Item | null;
  before?: Item | null;
  after?: Item | null;
}
type Variables = { id: string; beforeId?: string; afterId?: string };

// Only constant aliases enter these documents. Compile each bounded shape once, not per call.
function contextQuery(
  neighbours: readonly ('before' | 'after')[],
): TypedDocumentNode<Context, Variables> {
  const definitions = neighbours.map((name) => `$${name}Id: WorkItemID!`).join(', ');
  const fields = neighbours
    .map(
      (name) => `${name}: workItem(id: $${name}Id) {
    id iid project { id fullPath group { fullPath } }
  }`,
    )
    .join('\n');
  return gql`query ReorderWorkItemContext($id: WorkItemID!, ${definitions}) {
    target: workItem(id: $id) {
      id iid project { id fullPath boards(first: 1) { nodes { id } } group { fullPath } }
    }
    ${fields}
  }`;
}
const BEFORE = contextQuery(['before']);
const AFTER = contextQuery(['after']);
const BETWEEN = contextQuery(['before', 'after']);

const GROUP_BOARD: TypedDocumentNode<
  {
    group: { boards: Boards | null; parent: { fullPath: string } | null } | null;
  },
  { path: string }
> = gql`
  query ReorderGroupBoard($path: ID!) {
    group(fullPath: $path) {
      boards(first: 1) {
        nodes {
          id
        }
      }
      parent {
        fullPath
      }
    }
  }
`;

const MOVE: TypedDocumentNode<
  {
    issueMoveList: { issue: GitLabWorkItem | null; errors: string[] } | null;
  },
  { input: Record<string, string> }
> = gql`
  mutation ReorderIssueCard($input: IssueMoveListInput!) {
    issueMoveList(input: $input) {
      issue {
        id
        iid
        title
        state
        webUrl
        relativePosition
      }
      errors
    }
  }
`;

function projectOf(item: Item | null | undefined): Project {
  if (!item?.project) throw new Error('Issue is unavailable or is not a project work item');
  return item.project;
}

/** GitLab 16.0 Issue.relative_positioning_parent_projects: root group, or one personal project. */
function positioningScope(project: Project): string {
  return project.group ? project.fullPath.slice(0, project.fullPath.indexOf('/')) : project.id;
}

function checkNeighbour(item: Item | null | undefined, scope: string): void {
  if (positioningScope(projectOf(item)) !== scope)
    throw new Error('Neighbour is outside the issue manual-ordering namespace');
}

async function findBoard(client: GraphQLClient, project: Project): Promise<string> {
  const own = project.boards?.nodes[0];
  if (own) return own.id;
  let path = project.group?.fullPath;
  // Bound traversals even if an inconsistent upstream response contains a parent cycle.
  for (let requests = 0; path !== undefined && requests < 100; requests++) {
    const { group } = await client.request(GROUP_BOARD, { path });
    if (!group) throw new Error('Board discovery could not read the issue namespace');
    const board = group.boards?.nodes[0];
    if (board) return board.id;
    path = group.parent?.fullPath;
  }
  throw new Error('No accessible issue board found within the board discovery limit');
}

/** Reordering is issue-relative, shared by boards; an accessible related board supplies context. */
export async function reorderWorkItem(input: ReorderWorkItemInput): Promise<GitLabWorkItem> {
  const client = ConnectionManager.getInstance().getClient(getGitLabApiUrlFromContext());
  const variables: Variables = { id: toGid(input.id, 'WorkItem') };
  if (input.beforeId !== undefined) variables.beforeId = toGid(input.beforeId, 'WorkItem');
  if (input.afterId !== undefined) variables.afterId = toGid(input.afterId, 'WorkItem');
  const document =
    input.beforeId === undefined ? AFTER : input.afterId === undefined ? BEFORE : BETWEEN;
  const context = await client.request(document, variables);
  if (!context.target) throw new Error('Issue is unavailable');
  const project = projectOf(context.target);
  const scope = positioningScope(project);
  if (input.beforeId !== undefined) checkNeighbour(context.before, scope);
  if (input.afterId !== undefined) checkNeighbour(context.after, scope);
  const mutation: Record<string, string> = {
    boardId: await findBoard(client, project),
    projectPath: project.fullPath,
    iid: context.target.iid,
  };
  // GitLab's moveAfterId names the issue AFTER the moved card, not the card to move after.
  // v16.0.0-ee/app/services/boards/base_item_move_service.rb:105-110.
  if (input.beforeId !== undefined) mutation.moveAfterId = extractSimpleId(input.beforeId);
  if (input.afterId !== undefined) mutation.moveBeforeId = extractSimpleId(input.afterId);
  const response = await client.request(MOVE, { input: mutation });
  if (response.issueMoveList?.errors.length)
    throw new Error(`GitLab GraphQL errors: ${response.issueMoveList.errors.join(', ')}`);
  if (!response.issueMoveList?.issue) throw new Error('Issue reorder failed: no issue returned');
  return cleanWorkItemResponse(response.issueMoveList.issue);
}
