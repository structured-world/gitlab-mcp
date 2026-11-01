import { gql } from 'graphql-tag';
import type { DocumentNode } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ConnectionManager } from '../../services/ConnectionManager';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { graphqlSupports } from '../instance-version';
import { extractSimpleId } from '../../utils/idConversion';

export const DUO_RESPONSE_BYTES = 4 * 1024 * 1024;
export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
export interface Workflow {
  id: string;
  projectId: string | null;
  humanStatus: string;
  statusName?: string | null;
  status?: string | null;
  webUrl?: string | null;
  createdAt: string;
  workflowDefinition?: string | null;
  project?: { id: string; fullPath: string } | null;
  summary?: string | null;
  userPermissions?: { resumeDuoWorkflow?: boolean } | null;
}
export interface WorkflowPage {
  nodes: Workflow[];
  pageInfo: PageInfo;
}

const METADATA = `
    id projectId humanStatus createdAt
    statusName @optional
    status @optional
    webUrl @optional
    workflowDefinition @optional
    project @optional { id fullPath }
`;
const LIST = gql`
  query DuoSessionMetadata($first: Int!, $after: String) {
    duoWorkflowWorkflows(first: $first, after: $after) {
      nodes { ${METADATA} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const GET = gql`
  query DuoSessionMetadataById($id: AiDuoWorkflowsWorkflowID!) {
    duoWorkflowWorkflows(workflowId: $id, first: 1) {
      nodes { ${METADATA} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export function requestDuo<T>(
  document: TypedDocumentNode<T, Record<string, unknown>>,
  variables: Record<string, unknown> = {},
): Promise<T> {
  return ConnectionManager.getInstance()
    .getClient(getGitLabBaseUrl())
    .request(document, variables, undefined, DUO_RESPONSE_BYTES);
}

export const workflowGid = (id: string): string =>
  `gid://gitlab/Ai::DuoWorkflows::Workflow/${extractSimpleId(id)}`;

export async function workflowPage(first: number, after?: string): Promise<WorkflowPage> {
  const result = await requestDuo<{ duoWorkflowWorkflows: WorkflowPage }>(LIST, { first, after });
  return result.duoWorkflowWorkflows;
}

/** Older GraphQL connections have no workflowId argument; scan metadata with a fixed ceiling. */
export async function readWorkflow(id: string): Promise<Workflow> {
  const simple = extractSimpleId(id);
  if (graphqlSupports('Query', 'duoWorkflowWorkflows', 'workflowId')) {
    const result = await requestDuo<{ duoWorkflowWorkflows: WorkflowPage }>(GET, {
      id: workflowGid(id),
    });
    const workflow = result.duoWorkflowWorkflows.nodes.find(
      (row) => extractSimpleId(row.id) === simple,
    );
    if (!workflow) throw new Error('Duo session is unavailable to this account');
    return workflow;
  }
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await workflowPage(100, after);
    const workflow = result.nodes.find((row) => extractSimpleId(row.id) === simple);
    if (workflow) return workflow;
    if (!result.pageInfo.hasNextPage) throw new Error('Duo session is unavailable to this account');
    const next = result.pageInfo.endCursor;
    if (!next || next === after) throw new Error('GitLab did not advance Duo session pagination');
    after = next;
  }
  throw new Error('Duo session lookup reached its metadata limit; inspect the session in GitLab');
}

export interface Message {
  content: string | null;
  role: string | null;
  messageType: string | null;
}
export const DETAILS: DocumentNode = gql`
  query DuoSessionDetails($id: AiDuoWorkflowsWorkflowID!) {
    duoWorkflowWorkflows(workflowId: $id, first: 1) {
      nodes {
        ${METADATA}
        summary @optional
        userPermissions @optional { resumeDuoWorkflow @optional }
        latestCheckpoint @optional {
          lastDuoMessage @optional { content role messageType }
        }
        mergeRequestLinks(linkType: CREATED, first: 20) @optional {
          nodes { mergeRequest { id title webUrl } } pageInfo { hasNextPage }
        }
        workItemLinks(linkType: CREATED, first: 20) @optional {
          nodes { workItem { id title webUrl } } pageInfo { hasNextPage }
        }
        noteLinks(linkType: CREATED, first: 20) @optional {
          nodes { note { id url body } } pageInfo { hasNextPage }
        }
      }
    }
  }
`;
export const HISTORY: DocumentNode = gql`
  query DuoSessionLatestAnswer($id: AiDuoWorkflowsWorkflowID!) {
    duoWorkflowWorkflows(workflowId: $id, first: 1) {
      nodes {
        id
        projectId
        latestCheckpoint {
          duoMessages {
            content
            role
            messageType
          }
        }
      }
    }
  }
`;
