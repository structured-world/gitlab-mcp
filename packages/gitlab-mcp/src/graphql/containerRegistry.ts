import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * GraphQL documents for the Container Registry.
 *
 * Verified against a live GitLab 19.x instance via schema introspection:
 * - Queries: `project.containerRepositories`, `containerRepository(id)` with a
 *   `tags(name, sort, first, after)` connection.
 * - Mutations: `destroyContainerRepository(input:{id})`,
 *   `destroyContainerRepositoryTags(input:{id, tagNames})`.
 *
 * GitLab has no native regex/keep_n/older_than bulk-delete mutation, so bulk
 * cleanup is composed in the handler: list tags, filter, then
 * destroyContainerRepositoryTags with the resolved names.
 */

// --- Shared GraphQL fragments of fields we surface ---
// The `containerRepositories` connection yields `ContainerRepository` nodes,
// which expose fewer fields than the `ContainerRepositoryDetails` returned by the
// single-repository query (e.g., lastPublishedAt/size are Details-only).
const REPOSITORY_LIST_FIELDS = `
  id
  name
  path
  location
  status
  tagsCount
  createdAt
  updatedAt
`;
const REPOSITORY_DETAIL_FIELDS = `
  ${REPOSITORY_LIST_FIELDS}
  lastPublishedAt
`;

const TAG_FIELDS = `
  name
  path
  location
  digest
  revision
  shortRevision
  totalSize
  createdAt
  publishedAt
  mediaType
`;

export interface ContainerRepositoryNode {
  id: string;
  name: string | null;
  path: string;
  location: string;
  status: string | null;
  tagsCount: number;
  createdAt: string;
  updatedAt: string;
  // Details-only (single-repository query); absent in list results.
  lastPublishedAt?: string | null;
}

export interface ContainerTagNode {
  name: string;
  path: string;
  location: string;
  digest: string | null;
  revision: string | null;
  shortRevision: string | null;
  totalSize: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  mediaType: string | null;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

// --- Query: list a project's container repositories ---
export interface ListRepositoriesResult {
  project: {
    containerRepositories: {
      nodes: ContainerRepositoryNode[];
      pageInfo: PageInfo;
    };
  } | null;
}
export interface ListRepositoriesVars {
  fullPath: string;
  name?: string | null;
  first?: number | null;
  after?: string | null;
}
export const LIST_CONTAINER_REPOSITORIES: TypedDocumentNode<
  ListRepositoriesResult,
  ListRepositoriesVars
> = gql`
  query ListContainerRepositories($fullPath: ID!, $name: String, $first: Int, $after: String) {
    project(fullPath: $fullPath) {
      containerRepositories(name: $name, first: $first, after: $after) {
        nodes {
          ${REPOSITORY_LIST_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// --- Query: a single container repository ---
export interface GetRepositoryResult {
  containerRepository: ContainerRepositoryNode | null;
}
export interface GetRepositoryVars {
  id: string;
}
export const GET_CONTAINER_REPOSITORY: TypedDocumentNode<GetRepositoryResult, GetRepositoryVars> =
  gql`
    query GetContainerRepository($id: ContainerRepositoryID!) {
      containerRepository(id: $id) {
        ${REPOSITORY_DETAIL_FIELDS}
      }
    }
  `;

// --- Query: tags of a container repository ---
export interface ListTagsResult {
  containerRepository: {
    id: string;
    tags: {
      nodes: ContainerTagNode[];
      pageInfo: PageInfo;
    };
  } | null;
}
export interface ListTagsVars {
  id: string;
  name?: string | null;
  first?: number | null;
  after?: string | null;
}
export const LIST_CONTAINER_REPOSITORY_TAGS: TypedDocumentNode<ListTagsResult, ListTagsVars> = gql`
  query ListContainerRepositoryTags(
    $id: ContainerRepositoryID!
    $name: String
    $first: Int
    $after: String
  ) {
    containerRepository(id: $id) {
      id
      tags(name: $name, first: $first, after: $after) {
        nodes {
          ${TAG_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// --- Mutation: delete a repository ---
export interface DestroyRepositoryResult {
  destroyContainerRepository: {
    containerRepository: { id: string; status: string | null } | null;
    errors: string[];
  } | null;
}
export interface DestroyRepositoryVars {
  id: string;
}
export const DESTROY_CONTAINER_REPOSITORY: TypedDocumentNode<
  DestroyRepositoryResult,
  DestroyRepositoryVars
> = gql`
  mutation DestroyContainerRepository($id: ContainerRepositoryID!) {
    destroyContainerRepository(input: { id: $id }) {
      containerRepository {
        id
        status
      }
      errors
    }
  }
`;

// --- Mutation: delete tags by explicit name list ---
export interface DestroyTagsResult {
  destroyContainerRepositoryTags: {
    deletedTagNames: string[];
    errors: string[];
  } | null;
}
export interface DestroyTagsVars {
  id: string;
  tagNames: string[];
}
export const DESTROY_CONTAINER_REPOSITORY_TAGS: TypedDocumentNode<
  DestroyTagsResult,
  DestroyTagsVars
> = gql`
  mutation DestroyContainerRepositoryTags($id: ContainerRepositoryID!, $tagNames: [String!]!) {
    destroyContainerRepositoryTags(input: { id: $id, tagNames: $tagNames }) {
      deletedTagNames
      errors
    }
  }
`;
