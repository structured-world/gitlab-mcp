import { ConnectionManager } from '../../services/ConnectionManager';
import { getGitLabApiUrlFromContext } from '../../oauth/token-context';
import { projectInCallScope } from '../../configuration/call-scope';
import { withTargetPaths } from '../../configuration/scope-ids';
import { canonicalProjectPath, encodeApiSegment } from '../../utils/api-path';
import { gitlab } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { graphqlSupports } from '../instance-version';
import {
  MERGE_REQUEST_CONFLICTS,
  type ConflictFile,
  type MergeRequestConflicts,
} from '../../graphql/mergeRequestConflicts';

/** First release whose GraphQL schema has `conflictStatus` and `conflictFiles`. */
export const CONFLICTS_MIN_VERSION = '19.4';

/** Text of all returned conflict regions together, so one call stays readable. */
export const CONFLICT_OUTPUT_BUDGET = 64 * 1024;
/** A longer line is cut; minified files would otherwise spend the budget on one line. */
export const CONFLICT_MAX_LINE = 2000;

export type ConflictReadStatus =
  | 'has_conflicts'
  | 'no_conflicts'
  | 'unchecked'
  | 'branch_missing'
  | 'no_push_access'
  | 'files_unavailable'
  | 'source_outside_scope';

const REASONS: Record<ConflictReadStatus, string> = {
  has_conflicts: 'GitLab reports conflicts and returned the conflicting files.',
  no_conflicts: 'GitLab reports that the merge request can be merged without conflicts.',
  unchecked:
    'GitLab has not checked mergeability yet, so conflicts are unknown. A check was requested; GitLab runs it only for users who can update the merge request. Read again shortly.',
  branch_missing:
    'The source or target branch is missing, or the merge request diff is incomplete.',
  no_push_access:
    'GitLab returns conflict files only to users who can push to the source branch; the current user cannot.',
  files_unavailable:
    'GitLab reports conflicts but could not return the files, for example because they are binary or a side of the conflict is missing.',
  source_outside_scope:
    'The source branch belongs to a project outside the allowed scope, so its file contents are not returned.',
};

export interface ConflictHunk {
  /** Line of the first returned line in the file content GitLab sent, counted from 1. */
  start_line: number;
  lines: string[];
  /** The region was cut at the output budget; later lines of it are not returned. */
  truncated?: true;
}

export interface ConflictFileView {
  our_path: string | null;
  their_path: string | null;
  /** Conflict regions found by GitLab's markers; 0 for a file that has none. */
  conflict_count: number;
  hunks: ConflictHunk[];
  /** Regions not returned because the output budget was spent. */
  hunks_omitted: number;
  /** GitLab returned no text: binary or non-UTF-8 content. */
  content_unavailable?: true;
  /** Lines cut at the line length limit. */
  long_lines_cut?: number;
}

export interface ConflictReadResult {
  merge_request_iid: string;
  state: string;
  web_url: string | null;
  source_branch: string;
  target_branch: string;
  /** GitLab's own flag that the merge request cannot be merged because of conflicts. */
  has_conflicts: boolean;
  status: ConflictReadStatus;
  reason: string;
  files_total?: number;
  files?: ConflictFileView[];
  /** Some regions or files were left out; each file says how many. */
  truncated?: boolean;
}

interface ConflictReadInput {
  project_id: string;
  merge_request_iid: string;
  file_path?: string;
  context_lines?: number;
}

/** Path of the project for GraphQL, which addresses projects by path only. */
async function projectPath(projectId: string): Promise<string> {
  if (!/^\d+$/.test(projectId)) return canonicalProjectPath(projectId);
  const resolved = String((await withTargetPaths({ project_id: projectId })).project_id);
  if (/^\d+$/.test(resolved)) throw new Error(`Project "${projectId}" not found or not accessible`);
  return resolved;
}

/** Read the conflict status and conflicting files of a merge request as GitLab computes them. */
export async function readMergeRequestConflicts(
  input: ConflictReadInput,
): Promise<ConflictReadResult> {
  // The fields are experiments: the schema, not only the release, decides whether they exist.
  if (
    !graphqlSupports('MergeRequest', 'conflictStatus') ||
    !graphqlSupports('MergeRequest', 'conflictFiles')
  ) {
    throw new Error(
      `Reading merge request conflicts requires GitLab ${CONFLICTS_MIN_VERSION}+ (MergeRequest.conflictStatus and conflictFiles are not in this instance's schema)`,
    );
  }

  const client = ConnectionManager.getInstance().getClient(getGitLabApiUrlFromContext());
  const fullPath = await projectPath(input.project_id);
  const result = await client.request(MERGE_REQUEST_CONFLICTS, {
    fullPath,
    iid: input.merge_request_iid,
  });
  const mr = result.project?.mergeRequest;
  if (!mr) {
    throw new Error(
      `Merge request !${input.merge_request_iid} not found or not accessible in project "${input.project_id}"`,
    );
  }

  const base = {
    merge_request_iid: mr.iid,
    state: mr.state,
    web_url: mr.webUrl,
    source_branch: mr.sourceBranch,
    target_branch: mr.targetBranch,
    has_conflicts: mr.conflicts,
  };
  const status = await statusOf(mr, input);
  if (status !== 'has_conflicts' || !mr.conflictFiles) {
    return { ...base, status, reason: REASONS[status] };
  }

  const files = input.file_path
    ? mr.conflictFiles.filter(
        (file) => file.ourPath === input.file_path || file.theirPath === input.file_path,
      )
    : mr.conflictFiles;
  const views = viewFiles(files, input.context_lines ?? 3);
  return {
    ...base,
    status,
    reason: REASONS[status],
    files_total: mr.conflictFiles.length,
    files: views,
    truncated: views.some((view) => view.hunks_omitted > 0 || view.hunks.some((h) => h.truncated)),
  };
}

async function statusOf(
  mr: MergeRequestConflicts,
  input: ConflictReadInput,
): Promise<ConflictReadStatus> {
  switch (mr.conflictStatus) {
    case 'NO_CONFLICTS':
      return 'no_conflicts';
    case 'BRANCH_MISSING':
      return 'branch_missing';
    case 'NO_PUSH_ACCESS':
      return 'no_push_access';
    case 'HAS_CONFLICTS':
      if (!mr.conflictFiles) return 'files_unavailable';
      // A fork's files belong to its own project, which the call's scope must allow too.
      if (mr.sourceProjectId !== mr.targetProjectId) {
        const allowed =
          mr.sourceProjectId !== null && (await projectInCallScope(String(mr.sourceProjectId)));
        if (!allowed) return 'source_outside_scope';
      }
      return 'has_conflicts';
    default:
      // GraphQL reads never start the mergeability check; the REST read of the merge request
      // does (lib/api/entities/merge_request_basic.rb, merge_status).
      await gitlab.get(
        `projects/${normalizeProjectId(input.project_id)}/merge_requests/${encodeApiSegment(input.merge_request_iid)}`,
      );
      return 'unchecked';
  }
}

/** Conflict regions of each file within one shared output budget. */
function viewFiles(files: ConflictFile[], context: number): ConflictFileView[] {
  let budget = CONFLICT_OUTPUT_BUDGET;
  return files.map((file) => {
    const view: ConflictFileView = {
      our_path: file.ourPath,
      their_path: file.theirPath,
      conflict_count: 0,
      hunks: [],
      hunks_omitted: 0,
    };
    if (file.content === null) {
      view.content_unavailable = true;
      return view;
    }
    const lines = file.content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const blocks = conflictBlocks(lines, file);
    view.conflict_count = blocks.length;
    // A file without markers (a tree conflict) is shown from its start.
    let ranges: [number, number][] = [];
    if (blocks.length > 0) ranges = mergeRanges(blocks, context, lines.length);
    else if (lines.length > 0) ranges = [[0, lines.length - 1]];
    let cut = 0;
    for (const [first, last] of ranges) {
      if (budget <= 0) {
        view.hunks_omitted++;
        continue;
      }
      const hunk: ConflictHunk = { start_line: first + 1, lines: [] };
      for (let index = first; index <= last; index++) {
        let line = lines[index];
        if (line.length > CONFLICT_MAX_LINE) {
          line = line.slice(0, CONFLICT_MAX_LINE);
          cut++;
        }
        if (line.length + 1 > budget) {
          hunk.truncated = true;
          budget = 0;
          break;
        }
        budget -= line.length + 1;
        hunk.lines.push(line);
      }
      view.hunks.push(hunk);
    }
    if (cut > 0) view.long_lines_cut = cut;
    return view;
  });
}

/**
 * Line ranges of the conflict regions, from GitLab's start marker to its end marker. The
 * markers name the two paths (lib/gitlab/git/conflict/parser.rb); a side without a path is
 * matched by the marker alone. An unterminated region runs to the end of the file.
 */
function conflictBlocks(lines: string[], file: ConflictFile): [number, number][] {
  const isStart = (line: string): boolean =>
    file.ourPath ? line === `<<<<<<< ${file.ourPath}` : line.startsWith('<<<<<<< ');
  const isEnd = (line: string): boolean =>
    file.theirPath ? line === `>>>>>>> ${file.theirPath}` : line.startsWith('>>>>>>> ');
  const blocks: [number, number][] = [];
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    if (start === -1 && isStart(lines[index])) start = index;
    else if (start !== -1 && isEnd(lines[index])) {
      blocks.push([start, index]);
      start = -1;
    }
  }
  if (start !== -1) blocks.push([start, lines.length - 1]);
  return blocks;
}

/** Widen each region by `context` lines and join regions whose context touches. */
function mergeRanges(
  blocks: [number, number][],
  context: number,
  total: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  for (const [start, end] of blocks) {
    const first = Math.max(0, start - context);
    const last = Math.min(total - 1, end + context);
    const previous = ranges.at(-1);
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else ranges.push([first, last]);
  }
  return ranges;
}
