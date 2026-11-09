import { gql } from 'graphql-tag';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { GraphQLClient } from '../../graphql/client';
import { extractSimpleId, toGid } from '../../utils/idConversion';
import { graphqlSupports } from '../instance-version';
import type { BrowseWorkItemsInput } from './schema-readonly';

type Input = Extract<BrowseWorkItemsInput, { action: 'list_discussions' }>;

interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface Note {
  id: string;
  body: string;
  system: boolean;
  internal: boolean | null;
  createdAt: string;
  author: { username: string };
}

interface Discussion {
  id: string;
  notes: Connection<Note>;
}

interface Item {
  id: string;
  widgets: Array<{ type: string; discussions?: Connection<Discussion> | null }>;
}

interface PageVariables {
  first: number;
  after?: string;
  notesFirst: number;
  notesAfter?: string;
}

type IidVariables = PageVariables & { namespacePath: string; iid: string };
type CollectionResult = { container: { items: { nodes: Item[] } | null } | null };

// GitLab 16.0 exposes discussions with ALL_NOTES, including synthetic activity.
const PAGE_VARIABLES = '$first: Int!, $after: String, $notesFirst: Int!, $notesAfter: String';
const FIELDS = `
  id
  widgets {
    type
    ... on WorkItemWidgetNotes {
      discussions(first: $first, after: $after, filter: ALL_NOTES) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          notes(first: $notesFirst, after: $notesAfter) {
            pageInfo { hasNextPage endCursor }
            nodes { id body system internal createdAt author { username } }
          }
        }
      }
    }
  }
`;

const BY_ID: TypedDocumentNode<{ item: Item | null }, PageVariables & { id: string }> = gql`
  query WorkItemDiscussionsById($id: WorkItemID!, ${PAGE_VARIABLES}) {
    item: workItem(id: $id) { ${FIELDS} }
  }
`;

const BY_NAMESPACE: TypedDocumentNode<{ container: { item: Item | null } | null }, IidVariables> =
  gql`
  query WorkItemDiscussionsByIid($namespacePath: ID!, $iid: String!, ${PAGE_VARIABLES}) {
    container: namespace(fullPath: $namespacePath) {
      item: workItem(iid: $iid) { ${FIELDS} }
    }
  }
`;

/** Build the IID lookup for schemas without Namespace.workItem. */
function collectionQuery(
  kind: 'project' | 'group',
): TypedDocumentNode<CollectionResult, IidVariables> {
  return gql`
    query WorkItemDiscussionsByCollection($namespacePath: ID!, $iid: String!, ${PAGE_VARIABLES}) {
      container: ${kind}(fullPath: $namespacePath) {
        items: workItems(iid: $iid, first: 1) {
          nodes { ${FIELDS} }
        }
      }
    }
  `;
}

const BY_PROJECT = collectionQuery('project');
const BY_GROUP = collectionQuery('group');
const RESPONSE_BYTES = 4 * 1024 * 1024;

/** Query only the discussion projection using the instance's supported lookup. */
async function readItem(client: GraphQLClient, input: Input): Promise<Item | null> {
  const {
    namespace,
    iid,
    id,
    first,
    after,
    notes_first: notesFirst,
    notes_after: notesAfter,
  } = input;
  const page = { first, after, notesFirst, notesAfter };
  if (namespace !== undefined && iid !== undefined) {
    const vars = { ...page, namespacePath: namespace, iid };
    if (graphqlSupports('Namespace', 'workItem')) {
      const { container } = await client.request(BY_NAMESPACE, vars, undefined, RESPONSE_BYTES);
      return container?.item ?? null;
    }
    const project = await client.request(BY_PROJECT, vars, undefined, RESPONSE_BYTES);
    if (project.container) return project.container.items?.nodes[0] ?? null;
    if (!graphqlSupports('Group', 'workItems')) return null;
    const group = await client.request(BY_GROUP, vars, undefined, RESPONSE_BYTES);
    return group.container?.items?.nodes[0] ?? null;
  }
  // The schema requires one complete lookup and gives namespace + IID priority.
  if (id === undefined) throw new Error('Work item ID is required');
  const result = await client.request(
    BY_ID,
    { ...page, id: toGid(id, 'WorkItem') },
    undefined,
    RESPONSE_BYTES,
  );
  return result.item;
}

/** Return a bounded page and verify thread identity when resuming its notes. */
export async function listWorkItemDiscussions(client: GraphQLClient, input: Input) {
  if (!graphqlSupports('WorkItemWidgetNotes', 'discussions')) {
    throw new Error('This GitLab instance does not expose work item discussions');
  }
  const item = await readItem(client, input);
  if (!item) throw new Error('Work item not found or not accessible');
  const widget = item.widgets.find((entry) => entry.type === 'NOTES');
  if (!widget) throw new Error('This work item does not have a notes widget');
  const page = widget.discussions;
  if (!page) throw new Error('GitLab did not return discussions for this work item');
  if (input.discussion_id !== undefined && page.nodes[0]?.id !== input.discussion_id) {
    throw new Error(
      'The discussion page changed; find the discussion again before continuing its notes',
    );
  }
  return {
    workItemId: extractSimpleId(item.id),
    discussions: page.nodes,
    hasMore: page.pageInfo.hasNextPage,
    endCursor: page.pageInfo.endCursor,
  };
}
