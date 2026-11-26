import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * Conflict status and conflicting files of one merge request.
 *
 * `conflictStatus` and `conflictFiles` exist since GitLab 19.4 (experiment); both are absent
 * at v19.3.0-ee:
 * https://gitlab.com/gitlab-org/gitlab/-/blob/v19.4.0-ee/app/graphql/types/merge_request_type.rb
 * `conflictFiles` is null unless the merge request cannot be merged and the current user can
 * push to its source branch; `content` is null for binary and non-UTF-8 files.
 */
export const MERGE_REQUEST_CONFLICTS: TypedDocumentNode<
  MergeRequestConflictsResult,
  { fullPath: string; iid: string }
> = gql`
  query mergeRequestConflicts($fullPath: ID!, $iid: String!) {
    project(fullPath: $fullPath) {
      mergeRequest(iid: $iid) {
        iid
        state
        webUrl
        sourceBranch
        targetBranch
        sourceProjectId
        targetProjectId
        conflicts
        conflictStatus
        conflictFiles {
          ourPath
          theirPath
          content
        }
      }
    }
  }
`;

export type ConflictStatus =
  'HAS_CONFLICTS' | 'NO_CONFLICTS' | 'UNCHECKED' | 'BRANCH_MISSING' | 'NO_PUSH_ACCESS';

export interface ConflictFile {
  ourPath: string | null;
  theirPath: string | null;
  content: string | null;
}

export interface MergeRequestConflicts {
  iid: string;
  state: string;
  webUrl: string | null;
  sourceBranch: string;
  targetBranch: string;
  sourceProjectId: number | null;
  targetProjectId: number;
  conflicts: boolean;
  conflictStatus: ConflictStatus | null;
  conflictFiles: ConflictFile[] | null;
}

export interface MergeRequestConflictsResult {
  project: { mergeRequest: MergeRequestConflicts | null } | null;
}
