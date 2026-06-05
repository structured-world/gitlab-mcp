import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * GraphQL documents for Vulnerability Management (Ultimate).
 *
 * Verified against a live GitLab 19.x instance by executing each query/mutation:
 * - Queries: `project(fullPath).vulnerabilities`, `group(fullPath).vulnerabilities`,
 *   top-level `vulnerabilities(projectId: [ID!])` (instance-wide), `vulnerability(id)`.
 *   Connection filters: `state`, `severity`, `reportType`, `sort`.
 * - Mutations: `vulnerabilityDismiss` (id, comment, dismissalReason), `vulnerabilityConfirm`,
 *   `vulnerabilityResolve`, `vulnerabilityRevertToDetected` - each returns `{ vulnerability, errors }`.
 *
 * Vulnerabilities have a far richer GraphQL surface than REST (nested scanner /
 * location / identifiers, state timestamps), so the entity is GraphQL-first.
 */

const VULN_FIELDS = `
  id
  title
  description
  state
  severity
  reportType
  resolvedOnDefaultBranch
  detectedAt
  confirmedAt
  resolvedAt
  dismissedAt
  vulnerabilityPath
  webUrl
`;

export interface VulnerabilityNode {
  id: string;
  title: string | null;
  description: string | null;
  state: string | null;
  severity: string | null;
  reportType: string | null;
  resolvedOnDefaultBranch: boolean | null;
  detectedAt: string | null;
  confirmedAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  vulnerabilityPath: string | null;
  webUrl: string | null;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
interface VulnConnection {
  nodes: VulnerabilityNode[];
  pageInfo: PageInfo;
}

// Shared list filters exposed on the vulnerabilities connections.
export interface VulnListVars {
  state?: string[] | null;
  severity?: string[] | null;
  reportType?: string[] | null;
  sort?: string | null;
  first?: number | null;
  after?: string | null;
}

const LIST_ARG_DECLS = `
  $state: [VulnerabilityState!]
  $severity: [VulnerabilitySeverity!]
  $reportType: [VulnerabilityReportType!]
  $sort: VulnerabilitySort
  $first: Int
  $after: String
`;
const LIST_ARG_USE = `
  state: $state
  severity: $severity
  reportType: $reportType
  sort: $sort
  first: $first
  after: $after
`;

// --- Query: project vulnerabilities ---
export interface ListProjectVulnsResult {
  project: { vulnerabilities: VulnConnection | null } | null;
}
export interface ListNamespaceVulnsVars extends VulnListVars {
  fullPath: string;
}
export const LIST_PROJECT_VULNS: TypedDocumentNode<ListProjectVulnsResult, ListNamespaceVulnsVars> =
  gql`
  query ListProjectVulnerabilities($fullPath: ID!, ${LIST_ARG_DECLS}) {
    project(fullPath: $fullPath) {
      vulnerabilities(${LIST_ARG_USE}) {
        nodes { ${VULN_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// --- Query: group vulnerabilities ---
export interface ListGroupVulnsResult {
  group: { vulnerabilities: VulnConnection | null } | null;
}
export const LIST_GROUP_VULNS: TypedDocumentNode<ListGroupVulnsResult, ListNamespaceVulnsVars> =
  gql`
  query ListGroupVulnerabilities($fullPath: ID!, ${LIST_ARG_DECLS}) {
    group(fullPath: $fullPath) {
      vulnerabilities(${LIST_ARG_USE}) {
        nodes { ${VULN_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// --- Query: instance-wide vulnerabilities (optionally narrowed by project gids) ---
export interface ListInstanceVulnsResult {
  vulnerabilities: VulnConnection | null;
}
export interface ListInstanceVulnsVars extends VulnListVars {
  projectId?: string[] | null;
}
export const LIST_INSTANCE_VULNS: TypedDocumentNode<
  ListInstanceVulnsResult,
  ListInstanceVulnsVars
> = gql`
  query ListInstanceVulnerabilities($projectId: [ID!], ${LIST_ARG_DECLS}) {
    vulnerabilities(projectId: $projectId, ${LIST_ARG_USE}) {
      nodes { ${VULN_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// --- Query: a single vulnerability ---
export interface GetVulnResult {
  vulnerability: VulnerabilityNode | null;
}
export interface GetVulnVars {
  id: string;
}
export const GET_VULN: TypedDocumentNode<GetVulnResult, GetVulnVars> = gql`
  query GetVulnerability($id: VulnerabilityID!) {
    vulnerability(id: $id) { ${VULN_FIELDS} }
  }
`;

// --- Mutations: state transitions. Each returns { vulnerability, errors }. ---
interface VulnMutationPayload {
  vulnerability: VulnerabilityNode | null;
  errors: string[];
}

export interface DismissVulnResult {
  vulnerabilityDismiss: VulnMutationPayload | null;
}
export interface DismissVulnVars {
  id: string;
  comment?: string | null;
  dismissalReason?: string | null;
}
export const DISMISS_VULN: TypedDocumentNode<DismissVulnResult, DismissVulnVars> = gql`
  mutation DismissVulnerability(
    $id: VulnerabilityID!
    $comment: String
    $dismissalReason: VulnerabilityDismissalReason
  ) {
    vulnerabilityDismiss(input: { id: $id, comment: $comment, dismissalReason: $dismissalReason }) {
      vulnerability { ${VULN_FIELDS} }
      errors
    }
  }
`;

export interface ConfirmVulnResult {
  vulnerabilityConfirm: VulnMutationPayload | null;
}
export interface VulnIdVars {
  id: string;
}
export const CONFIRM_VULN: TypedDocumentNode<ConfirmVulnResult, VulnIdVars> = gql`
  mutation ConfirmVulnerability($id: VulnerabilityID!) {
    vulnerabilityConfirm(input: { id: $id }) {
      vulnerability { ${VULN_FIELDS} }
      errors
    }
  }
`;

export interface ResolveVulnResult {
  vulnerabilityResolve: VulnMutationPayload | null;
}
export const RESOLVE_VULN: TypedDocumentNode<ResolveVulnResult, VulnIdVars> = gql`
  mutation ResolveVulnerability($id: VulnerabilityID!) {
    vulnerabilityResolve(input: { id: $id }) {
      vulnerability { ${VULN_FIELDS} }
      errors
    }
  }
`;

export interface RevertVulnResult {
  vulnerabilityRevertToDetected: VulnMutationPayload | null;
}
export const REVERT_VULN: TypedDocumentNode<RevertVulnResult, VulnIdVars> = gql`
  mutation RevertVulnerabilityToDetected($id: VulnerabilityID!) {
    vulnerabilityRevertToDetected(input: { id: $id }) {
      vulnerability { ${VULN_FIELDS} }
      errors
    }
  }
`;
