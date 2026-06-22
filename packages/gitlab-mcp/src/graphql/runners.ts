import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * GraphQL documents for CI Runners.
 *
 * Verified against a live GitLab 19.x instance via schema introspection:
 * - Queries: `runners` (admin, instance-wide), `currentUser.runners`,
 *   `group/project(fullPath).runners`, `runner(id)` with a `jobs(statuses)` connection.
 * - Mutations: `runnerCreate` (returns ephemeralAuthenticationToken), `runnerUpdate`
 *   (description/tagList/paused/... — also powers pause/resume), `runnerDelete`.
 *
 * GitLab has no per-runner authentication-token reset mutation in GraphQL
 * (only the legacy group/project registration-token reset), so that one action
 * uses the REST endpoint in the handler.
 */

const RUNNER_FIELDS = `
  id
  description
  runnerType
  status
  paused
  locked
  runUntagged
  tagList
  accessLevel
  maximumTimeout
  jobExecutionStatus
  jobCount
  contactedAt
  createdAt
`;

export interface RunnerNode {
  id: string;
  description: string | null;
  runnerType: string;
  status: string | null;
  paused: boolean;
  locked: boolean;
  runUntagged: boolean;
  tagList: string[] | null;
  accessLevel: string | null;
  maximumTimeout: number | null;
  jobExecutionStatus: string | null;
  jobCount: number | null;
  contactedAt: string | null;
  createdAt: string | null;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
interface RunnerConnection {
  nodes: RunnerNode[];
  pageInfo: PageInfo;
}

// Shared list filters (subset of the runners connection args we expose).
export interface RunnerListVars {
  type?: string | null;
  status?: string | null;
  paused?: boolean | null;
  tagList?: string[] | null;
  search?: string | null;
  first?: number | null;
  after?: string | null;
}

const LIST_ARG_DECLS = `
  $type: CiRunnerType
  $status: CiRunnerStatus
  $paused: Boolean
  $tagList: [String!]
  $search: String
  $first: Int
  $after: String
`;
const LIST_ARG_USE = `
  type: $type
  status: $status
  paused: $paused
  tagList: $tagList
  search: $search
  first: $first
  after: $after
`;

// --- Query: instance-wide runners (admin) ---
export interface ListRunnersResult {
  runners: RunnerConnection | null;
}
export const LIST_RUNNERS: TypedDocumentNode<ListRunnersResult, RunnerListVars> = gql`
  query ListRunners(${LIST_ARG_DECLS}) {
    runners(${LIST_ARG_USE}) {
      nodes { ${RUNNER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// --- Query: current user's runners ---
export interface ListOwnedRunnersResult {
  currentUser: { runners: RunnerConnection | null } | null;
}
export const LIST_OWNED_RUNNERS: TypedDocumentNode<ListOwnedRunnersResult, RunnerListVars> = gql`
  query ListOwnedRunners(${LIST_ARG_DECLS}) {
    currentUser {
      runners(${LIST_ARG_USE}) {
        nodes { ${RUNNER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// --- Query: group runners ---
export interface ListGroupRunnersResult {
  group: { runners: RunnerConnection | null } | null;
}
export interface ListNamespaceRunnersVars extends RunnerListVars {
  fullPath: string;
}
export const LIST_GROUP_RUNNERS: TypedDocumentNode<
  ListGroupRunnersResult,
  ListNamespaceRunnersVars
> = gql`
  query ListGroupRunners($fullPath: ID!, ${LIST_ARG_DECLS}) {
    group(fullPath: $fullPath) {
      runners(${LIST_ARG_USE}) {
        nodes { ${RUNNER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// --- Query: project runners ---
export interface ListProjectRunnersResult {
  project: { runners: RunnerConnection | null } | null;
}
export const LIST_PROJECT_RUNNERS: TypedDocumentNode<
  ListProjectRunnersResult,
  ListNamespaceRunnersVars
> = gql`
  query ListProjectRunners($fullPath: ID!, ${LIST_ARG_DECLS}) {
    project(fullPath: $fullPath) {
      runners(${LIST_ARG_USE}) {
        nodes { ${RUNNER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// --- Query: a single runner ---
export interface GetRunnerResult {
  runner: RunnerNode | null;
}
export interface GetRunnerVars {
  id: string;
}
export const GET_RUNNER: TypedDocumentNode<GetRunnerResult, GetRunnerVars> = gql`
  query GetRunner($id: CiRunnerID!) {
    runner(id: $id) { ${RUNNER_FIELDS} }
  }
`;

// --- Query: jobs run by a runner ---
export interface RunnerJobNode {
  id: string;
  name: string | null;
  status: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  webPath: string | null;
}
export interface ListRunnerJobsResult {
  runner: {
    id: string;
    jobs: { nodes: RunnerJobNode[]; pageInfo: PageInfo } | null;
  } | null;
}
export interface ListRunnerJobsVars {
  id: string;
  statuses?: string[] | null;
  first?: number | null;
  after?: string | null;
}
export const LIST_RUNNER_JOBS: TypedDocumentNode<ListRunnerJobsResult, ListRunnerJobsVars> = gql`
  query ListRunnerJobs($id: CiRunnerID!, $statuses: [CiJobStatus!], $first: Int, $after: String) {
    runner(id: $id) {
      id
      jobs(statuses: $statuses, first: $first, after: $after) {
        nodes {
          id
          name
          status
          createdAt
          finishedAt
          duration
          webPath
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// --- Lookups: resolve a group/project full path to its global ID ---
// runnerCreate needs the namespace global ID, but callers pass the human path.
export interface ResolveGroupResult {
  group: { id: string } | null;
}
export interface ResolveProjectResult {
  project: { id: string } | null;
}
export interface ResolvePathVars {
  fullPath: string;
}
export const RESOLVE_GROUP_ID: TypedDocumentNode<ResolveGroupResult, ResolvePathVars> = gql`
  query ResolveGroupId($fullPath: ID!) {
    group(fullPath: $fullPath) {
      id
    }
  }
`;
export const RESOLVE_PROJECT_ID: TypedDocumentNode<ResolveProjectResult, ResolvePathVars> = gql`
  query ResolveProjectId($fullPath: ID!) {
    project(fullPath: $fullPath) {
      id
    }
  }
`;

// --- Mutation: create a runner (returns ephemeral auth token) ---
export interface RunnerCreateResult {
  runnerCreate: {
    runner: (RunnerNode & { ephemeralAuthenticationToken: string | null }) | null;
    errors: string[];
  } | null;
}
export interface RunnerCreateVars {
  input: {
    runnerType: string;
    groupId?: string | null;
    projectId?: string | null;
    description?: string | null;
    paused?: boolean | null;
    locked?: boolean | null;
    runUntagged?: boolean | null;
    tagList?: string[] | null;
    accessLevel?: string | null;
    maximumTimeout?: number | null;
    maintenanceNote?: string | null;
  };
}
export const RUNNER_CREATE: TypedDocumentNode<RunnerCreateResult, RunnerCreateVars> = gql`
  mutation RunnerCreate($input: RunnerCreateInput!) {
    runnerCreate(input: $input) {
      runner {
        ${RUNNER_FIELDS}
        ephemeralAuthenticationToken
      }
      errors
    }
  }
`;

// --- Mutation: update a runner (also powers pause/resume via `paused`) ---
export interface RunnerUpdateResult {
  runnerUpdate: { runner: RunnerNode | null; errors: string[] } | null;
}
export interface RunnerUpdateVars {
  input: {
    id: string;
    description?: string | null;
    paused?: boolean | null;
    locked?: boolean | null;
    runUntagged?: boolean | null;
    tagList?: string[] | null;
    accessLevel?: string | null;
    maximumTimeout?: number | null;
    maintenanceNote?: string | null;
  };
}
export const RUNNER_UPDATE: TypedDocumentNode<RunnerUpdateResult, RunnerUpdateVars> = gql`
  mutation RunnerUpdate($input: RunnerUpdateInput!) {
    runnerUpdate(input: $input) {
      runner { ${RUNNER_FIELDS} }
      errors
    }
  }
`;

// --- Mutation: delete a runner ---
export interface RunnerDeleteResult {
  runnerDelete: { errors: string[] } | null;
}
export interface RunnerDeleteVars {
  input: { id: string };
}
export const RUNNER_DELETE: TypedDocumentNode<RunnerDeleteResult, RunnerDeleteVars> = gql`
  mutation RunnerDelete($input: RunnerDeleteInput!) {
    runnerDelete(input: $input) {
      errors
    }
  }
`;
