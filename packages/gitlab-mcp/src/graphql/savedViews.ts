import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { WORK_ITEM_LIST_CONNECTION, type WorkItem } from './workItems';

/** A saved work item view as listed; newer fields are absent on older instances. */
export interface SavedViewNode {
  id: string;
  name: string;
  description: string | null;
  /** `private` until GitLab 18.10, `isPrivate` after. */
  private?: boolean;
  isPrivate?: boolean;
  subscribed: boolean;
  sort: string | null;
  shareUrl: string;
  updatedAt?: string;
  author?: { username: string } | null;
}

/** A saved view read on its own, with the filters GitLab resolves only one view at a time. */
export interface SavedViewDetail extends SavedViewNode {
  /** Arguments of `workItems`, as GitLab stores them (enum values in their stored form). */
  filters: Record<string, unknown> | null;
  filterWarnings: Array<{ field: string; message: string }> | null;
  displaySettings: Record<string, unknown> | null;
}

interface SavedViewConnection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const SAVED_VIEW_FIELDS = `
  id
  name
  description
  private @optional
  isPrivate @optional
  subscribed
  sort
  shareUrl
  updatedAt @optional
  author @optional {
    username
  }
`;

export const LIST_SAVED_VIEWS: TypedDocumentNode<
  { namespace: { savedViews: SavedViewConnection<SavedViewNode> | null } | null },
  {
    namespacePath: string;
    search?: string;
    subscribedOnly?: boolean;
    first: number;
    after?: string;
  }
> = gql`
  query ListSavedViews(
    $namespacePath: ID!
    $search: String
    $subscribedOnly: Boolean
    $first: Int
    $after: String
  ) {
    namespace(fullPath: $namespacePath) {
      savedViews(search: $search, subscribedOnly: $subscribedOnly, first: $first, after: $after) {
        nodes {
          ${SAVED_VIEW_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/** Work item types with whether GitLab's list offers each by default (GitLab 18.10+). */
export interface FilterableTypes {
  nodes: Array<{ id: string; isFilterableListView?: boolean }>;
}

// GitLab resolves filters and filterWarnings for one saved view per request. The
// namespace's types come along, so the list's default types need no second request
// when the view lists that namespace.
export const GET_SAVED_VIEW: TypedDocumentNode<
  {
    namespace: {
      savedViews: SavedViewConnection<SavedViewDetail> | null;
      workItemTypes?: FilterableTypes | null;
    } | null;
  },
  { namespacePath: string; id: string }
> = gql`
  query GetSavedView($namespacePath: ID!, $id: WorkItemsSavedViewsSavedViewID!) {
    namespace(fullPath: $namespacePath) {
      workItemTypes @optional {
        nodes {
          id
          isFilterableListView @optional
        }
      }
      savedViews(id: $id, first: 1) {
        nodes {
          ${SAVED_VIEW_FIELDS}
          filters
          filterWarnings {
            field
            message
          }
          displaySettings
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/** The types GitLab's list offers in a group a view scopes to. */
export const GET_FILTERABLE_WORK_ITEM_TYPES: TypedDocumentNode<
  { namespace: { workItemTypes: FilterableTypes | null } | null },
  { namespacePath: string }
> = gql`
  query GetFilterableWorkItemTypes($namespacePath: ID!) {
    namespace(fullPath: $namespacePath) {
      workItemTypes {
        nodes {
          id
          isFilterableListView
        }
      }
    }
  }
`;

/**
 * Arguments of `Namespace.workItems` a saved view can set, with their variable types
 * (GitLab GraphQL reference, 19.6). Whether the instance has each one is checked
 * against its schema before it is sent.
 */
export const SAVED_VIEW_ARG_TYPES: Readonly<Record<string, string>> = {
  assigneeUsernames: '[String!]',
  assigneeWildcardId: 'AssigneeWildcardId',
  authorUsername: 'String',
  closedAfter: 'Time',
  closedBefore: 'Time',
  confidential: 'Boolean',
  createdAfter: 'Time',
  createdBefore: 'Time',
  crmContactId: 'String',
  crmOrganizationId: 'String',
  customField: '[WorkItemWidgetCustomFieldFilterInputType!]',
  dueAfter: 'Time',
  dueBefore: 'Time',
  excludeGroupWorkItems: 'Boolean',
  excludeProjects: 'Boolean',
  healthStatusFilter: 'HealthStatusFilter',
  hierarchyFilters: 'HierarchyFilterInput',
  iid: 'String',
  in: '[IssuableSearchableField!]',
  includeDescendantWorkItems: 'Boolean',
  includeDescendants: 'Boolean',
  iterationCadenceId: '[IterationsCadenceID!]',
  iterationId: '[ID]',
  iterationWildcardId: 'IterationWildcardId',
  labelName: '[String!]',
  milestoneTitle: '[String!]',
  milestoneWildcardId: 'MilestoneWildcardId',
  myReactionEmoji: 'String',
  not: 'NegatedWorkItemFilterInput',
  or: 'UnionedWorkItemFilterInput',
  relativeDateFilters: 'WorkItemRelativeDateFiltersInput',
  releaseTag: '[String!]',
  releaseTagWildcardId: 'ReleaseTagWildcardId',
  search: 'String',
  sort: 'WorkItemSort',
  state: 'IssuableState',
  status: 'WorkItemWidgetStatusFilterInput',
  subscribed: 'SubscriptionStatus',
  types: '[IssueType!]',
  updatedAfter: 'Time',
  updatedBefore: 'Time',
  weight: 'String',
  weightWildcardId: 'WeightWildcardId',
  workItemTypeIds: '[WorkItemsTypeID!]',
};

interface SavedViewItemsResult {
  namespace: {
    workItems: {
      nodes: WorkItem[];
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    } | null;
  } | null;
}

const itemQueries = new Map<
  string,
  TypedDocumentNode<SavedViewItemsResult, Record<string, unknown>>
>();

/**
 * Listing query carrying exactly the given `workItems` arguments, one document per
 * combination so the schema adaptation cached per document is reused.
 */
export function savedViewItemsQuery(
  args: readonly string[],
): TypedDocumentNode<SavedViewItemsResult, Record<string, unknown>> {
  const used = Object.keys(SAVED_VIEW_ARG_TYPES).filter((name) => args.includes(name));
  const key = used.join(',');
  let query = itemQueries.get(key);
  if (!query) {
    const variables = used.map((name) => ` $${name}: ${SAVED_VIEW_ARG_TYPES[name]}`).join('');
    const passed = used.map((name) => `, ${name}: $${name}`).join('');
    query = gql(`
      query SavedViewWorkItems($namespacePath: ID! $first: Int $after: String${variables}) {
        namespace(fullPath: $namespacePath) {
          workItems(first: $first, after: $after${passed}) {
            ${WORK_ITEM_LIST_CONNECTION}
          }
        }
      }
    `);
    itemQueries.set(key, query);
  }
  return query;
}
