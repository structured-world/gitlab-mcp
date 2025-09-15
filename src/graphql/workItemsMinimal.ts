import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

export interface MinimalWorkItem {
  id: string;
  iid: string;
  title: string;
  state: string;
  workItemType: {
    id: string;
    name: string;
  };
}

export const GET_WORK_ITEMS_MINIMAL: TypedDocumentNode<
  { group: { workItems: { nodes: MinimalWorkItem[] } } },
  { groupPath: string; first?: number; after?: string }
> = gql`
  query GetWorkItems($groupPath: ID!, $first: Int, $after: String) {
    group(fullPath: $groupPath) {
      workItems(first: $first, after: $after) {
        nodes {
          id
          iid
          title
          state
          workItemType {
            id
            name
          }
        }
      }
    }
  }
`;
