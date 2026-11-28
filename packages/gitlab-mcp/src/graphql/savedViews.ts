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

/**
 * Fields of a saved view newer than GitLab 18.9, the first release with saved views.
 * A query selects each only when the instance's schema confirms it: without a schema
 * an unknown field would fail the whole query on 18.9.
 */
export interface SavedViewExtras {
  /** `isPrivate` replaces `private` (18.10); `private` alone is read otherwise. */
  isPrivate: boolean;
  updatedAt: boolean;
  author: boolean;
  /** Types carry whether GitLab's list offers them by default (18.10). */
  filterableTypes: boolean;
}

const savedViewFields = (extras: SavedViewExtras): string =>
  [
    'id',
    'name',
    'description',
    // Deprecated in 18.10; dropped by the schema adaptation once an instance removes it.
    'private @optional',
    extras.isPrivate && 'isPrivate',
    'subscribed',
    'sort',
    'shareUrl',
    extras.updatedAt && 'updatedAt',
    extras.author && 'author { username }',
  ]
    .filter(Boolean)
    .join('\n');

const extrasKey = (extras: SavedViewExtras): string =>
  (Object.keys(extras) as Array<keyof SavedViewExtras>).filter((key) => extras[key]).join(',');

type ListSavedViewsVars = {
  namespacePath: string;
  search?: string;
  subscribedOnly?: boolean;
  first: number;
  after?: string;
};
type ListSavedViewsResult = {
  namespace: { savedViews: SavedViewConnection<SavedViewNode> | null } | null;
};

const listQueries = new Map<string, TypedDocumentNode<ListSavedViewsResult, ListSavedViewsVars>>();

/** The saved views of a namespace, with the view fields the instance has. */
export function listSavedViewsQuery(
  extras: SavedViewExtras,
): TypedDocumentNode<ListSavedViewsResult, ListSavedViewsVars> {
  const key = extrasKey(extras);
  let query = listQueries.get(key);
  if (!query) {
    query = gql(`
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
              ${savedViewFields(extras)}
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `);
    listQueries.set(key, query);
  }
  return query;
}

/** Work item types with whether GitLab's list offers each by default (GitLab 18.10+). */
export interface FilterableTypes {
  nodes: Array<{ id: string; isFilterableListView?: boolean }>;
}

type GetSavedViewResult = {
  namespace: {
    /** `Group` for a group; a project's descendants are not a thing to keep to a scope. */
    __typename?: string;
    savedViews: SavedViewConnection<SavedViewDetail> | null;
    workItemTypes?: FilterableTypes | null;
  } | null;
};
type GetSavedViewVars = { namespacePath: string; id: string };

const getQueries = new Map<string, TypedDocumentNode<GetSavedViewResult, GetSavedViewVars>>();

/**
 * One saved view with its filters, which GitLab resolves for one view per request. The
 * namespace's types come along where GitLab says which its list offers, so the list's
 * default types need no second request when the view lists that namespace.
 */
export function getSavedViewQuery(
  extras: SavedViewExtras,
): TypedDocumentNode<GetSavedViewResult, GetSavedViewVars> {
  const key = extrasKey(extras);
  let query = getQueries.get(key);
  if (!query) {
    const types = extras.filterableTypes
      ? 'workItemTypes { nodes { id isFilterableListView } }'
      : '';
    query = gql(`
      query GetSavedView($namespacePath: ID!, $id: WorkItemsSavedViewsSavedViewID!) {
        namespace(fullPath: $namespacePath) {
          __typename
          ${types}
          savedViews(id: $id, first: 1) {
            nodes {
              ${savedViewFields(extras)}
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
    `);
    getQueries.set(key, query);
  }
  return query;
}

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
