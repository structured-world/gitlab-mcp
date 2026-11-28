import { z } from 'zod';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { findDiffLines, parseDiffFiles, type DiffFile } from '../diff-lines';
import { flattenPositionToFormFields } from './position-fields';
import type { ManageMrDiscussionInput } from './schema';

type ReviewInput = Extract<ManageMrDiscussionInput, { action: 'review' }>;
type ReviewComment = ReviewInput['comments'][number];

/**
 * posted: GitLab created it. failed: GitLab refused it, nothing was created. unknown: the
 * request may or may not have created it. not_attempted: an earlier write did not succeed.
 */
type WriteStatus = 'posted' | 'failed' | 'unknown' | 'not_attempted';

interface CommentResult {
  index: number;
  status: WriteStatus;
  path: string;
  old_line: number | null;
  new_line: number | null;
  discussion_id?: string;
  note_id?: number;
  error?: string;
}

interface SummaryResult {
  status: WriteStatus;
  note_id?: number;
  error?: string;
}

export interface ReviewResult {
  merge_request_iid: string;
  head_sha: string;
  complete: boolean;
  comments: CommentResult[];
  summary: SummaryResult | null;
  note?: string;
}

const VersionSchema = z.object({
  id: z.number(),
  head_commit_sha: z.string(),
  base_commit_sha: z.string(),
  start_commit_sha: z.string(),
});
const VersionsSchema = z.array(VersionSchema);
const VersionDiffsSchema = z.object({ diffs: z.unknown() });
const DiscussionSchema = z.looseObject({
  id: z.string(),
  notes: z.array(z.looseObject({ id: z.number() })).optional(),
});
const NoteSchema = z.looseObject({ id: z.number() });

/**
 * GitLab runs a line that starts with "/" outside code as a quick action (/approve, /merge),
 * so review text could act on the MR. A verdict must be an explicit call, not prose.
 */
const QUICK_ACTION = /^\/\w/m;

interface Anchor {
  old_path: string;
  new_path: string;
  old_line: number | null;
  new_line: number | null;
}

/** The diff file a comment names, or why it names none. */
function fileFor(files: readonly DiffFile[], comment: ReviewComment): DiffFile | string {
  const { path, old_line, new_line } = comment;
  const candidates = files.filter((file) => file.new_path === path || file.old_path === path);
  if (candidates.length === 0) return `${path} is not in the merge request diff`;
  if (candidates.length === 1) return candidates[0];
  // One path can be the old side of a rename and the new side of another file; the side
  // the comment names tells them apart. GitLab gives a new file its path as old_path too,
  // and a deleted file as new_path, though neither has lines on that side.
  const onSide = candidates.filter(
    (file) =>
      (new_line === undefined || (file.new_path === path && file.deleted_file !== true)) &&
      (old_line === undefined || (file.old_path === path && file.new_file !== true)),
  );
  return onSide.length === 1 ? onSide[0] : `${path} names more than one file in the diff`;
}

/** Comment errors that need no diff: a missing line, quick actions in the text. */
function textErrors(input: ReviewInput): string[] {
  const errors: string[] = [];
  input.comments.forEach((comment, index) => {
    if (comment.old_line === undefined && comment.new_line === undefined) {
      errors.push(`comments[${index}]: give new_line, old_line or both`);
    }
    if (QUICK_ACTION.test(comment.body)) {
      errors.push(`comments[${index}]: a line starting with "/" would run as a quick action`);
    }
  });
  if (input.summary !== undefined && QUICK_ACTION.test(input.summary)) {
    errors.push('summary: a line starting with "/" would run as a quick action');
  }
  return errors;
}

/** Anchors every comment to a line of the diff, or lists each comment that has none. */
function anchorComments(files: readonly DiffFile[], comments: readonly ReviewComment[]) {
  // Indexed by comment, so the errors read in comment order whatever file they belong to.
  const problems: string[] = [];
  const anchors: Anchor[] = new Array<Anchor>(comments.length);
  const byFile = new Map<DiffFile, number[]>();
  comments.forEach((comment, index) => {
    const file = fileFor(files, comment);
    if (typeof file === 'string') {
      problems[index] = file;
      return;
    }
    const indexes = byFile.get(file);
    if (indexes) indexes.push(index);
    else byFile.set(file, [index]);
  });
  for (const [file, indexes] of byFile) {
    const lookup = findDiffLines(
      file,
      indexes.map((index) => comments[index]),
    );
    indexes.forEach((index, at) => {
      const comment = comments[index];
      if ('unavailable' in lookup) {
        problems[index] = `GitLab shows no diff lines for ${comment.path} (${lookup.unavailable})`;
        return;
      }
      const line = lookup.lines[at];
      if (line === null) {
        const named = [
          comment.old_line !== undefined ? `old_line ${comment.old_line}` : null,
          comment.new_line !== undefined ? `new_line ${comment.new_line}` : null,
        ].filter((part) => part !== null);
        problems[index] = `${named.join(' and ')} of ${comment.path} is not a diff line`;
        return;
      }
      if (comment.suggestion !== undefined && line.new_line === null) {
        problems[index] =
          'a suggestion replaces a line of the new version, and this line is removed';
        return;
      }
      anchors[index] = {
        old_path: file.old_path,
        new_path: file.new_path,
        old_line: line.old_line,
        new_line: line.new_line,
      };
    });
  }
  const errors = problems.flatMap((problem, index) =>
    problem === undefined ? [] : [`comments[${index}]: ${problem}`],
  );
  return { errors, anchors };
}

/** The comment text, with the suggestion in a fence no backtick run inside it can close. */
function commentBody(comment: ReviewComment): string {
  if (comment.suggestion === undefined) return comment.body;
  const longest = Math.max(0, ...(comment.suggestion.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${comment.body}\n\n${fence}suggestion:-0+0\n${comment.suggestion}\n${fence}`;
}

/** A refused write created nothing; any other failure may have created the note. */
function failure(error: unknown): { status: 'failed' | 'unknown'; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  const refused = error instanceof GitLabApiError && error.status >= 400 && error.status < 500;
  return { status: refused ? 'failed' : 'unknown', error: message };
}

function refuse(errors: readonly string[]): never {
  throw new Error(`Review not posted, nothing was written:\n- ${errors.join('\n- ')}`);
}

/**
 * Posts several diff comments and an optional summary note on one merge request. Every
 * comment is checked against the diff at `head_sha` before anything is written, and the
 * review is refused when the merge request has moved past that head. The writes are not
 * transactional: they run in order and stop at the first one that does not succeed, and
 * the result names what each write did so a caller resends only what was not posted.
 */
export async function submitReview(input: ReviewInput): Promise<ReviewResult> {
  const preflight = textErrors(input);
  if (preflight.length > 0) refuse(preflight);

  const project = normalizeProjectId(input.project_id);
  const mrPath = `projects/${project}/merge_requests/${encodeApiSegment(input.merge_request_iid)}`;

  // Versions come newest first; the newest is the diff the merge request shows now.
  const versions = VersionsSchema.safeParse(
    await gitlab.get(`${mrPath}/versions`, { query: { per_page: 1 } }),
  );
  if (!versions.success)
    throw new Error('GitLab returned an unexpected merge request versions list');
  const latest = versions.data[0];
  if (latest === undefined) refuse(['the merge request has no diff yet']);
  if (latest.head_commit_sha.toLowerCase() !== input.head_sha.toLowerCase()) {
    refuse([
      `the merge request head is now ${latest.head_commit_sha}, not ${input.head_sha}; read the new diff and review it again`,
    ]);
  }

  const version = VersionDiffsSchema.safeParse(
    await gitlab.get(`${mrPath}/versions/${encodeApiSegment(String(latest.id))}`),
  );
  if (!version.success) throw new Error('GitLab returned an unexpected merge request version');
  const { errors, anchors } = anchorComments(parseDiffFiles(version.data.diffs), input.comments);
  if (errors.length > 0) refuse(errors);

  const results: CommentResult[] = input.comments.map((comment, index) => ({
    index,
    status: 'not_attempted',
    path: comment.path,
    old_line: anchors[index].old_line,
    new_line: anchors[index].new_line,
  }));
  let stopped = false;
  for (const [index, comment] of input.comments.entries()) {
    const anchor = anchors[index];
    const body: Record<string, unknown> = { body: commentBody(comment) };
    flattenPositionToFormFields(body, {
      position_type: 'text',
      base_sha: latest.base_commit_sha,
      start_sha: latest.start_commit_sha,
      head_sha: latest.head_commit_sha,
      old_path: anchor.old_path,
      new_path: anchor.new_path,
      old_line: anchor.old_line,
      new_line: anchor.new_line,
    });
    try {
      const created = DiscussionSchema.safeParse(
        await gitlab.post(`${mrPath}/discussions`, { body, contentType: 'form' }),
      );
      results[index].status = 'posted';
      if (created.success) {
        results[index].discussion_id = created.data.id;
        results[index].note_id = created.data.notes?.[0]?.id;
      }
    } catch (error: unknown) {
      Object.assign(results[index], failure(error));
      stopped = true;
      break;
    }
  }

  let summary: SummaryResult | null = null;
  if (input.summary !== undefined) {
    summary = { status: 'not_attempted' };
    if (!stopped) {
      try {
        const note = NoteSchema.safeParse(
          await gitlab.post(`${mrPath}/notes`, {
            body: { body: input.summary },
            contentType: 'form',
          }),
        );
        summary = { status: 'posted', ...(note.success ? { note_id: note.data.id } : {}) };
      } catch (error: unknown) {
        summary = failure(error);
      }
    }
  }

  const complete = !stopped && (summary === null || summary.status === 'posted');
  const result: ReviewResult = {
    merge_request_iid: input.merge_request_iid,
    head_sha: latest.head_commit_sha,
    complete,
    comments: results,
    summary,
  };
  if (!complete) {
    result.note =
      'Partly posted, nothing was rolled back. Resend only the writes marked failed or not_attempted; ' +
      'for one marked unknown, check the merge request discussions first, since it may already be there.';
  }
  return result;
}
