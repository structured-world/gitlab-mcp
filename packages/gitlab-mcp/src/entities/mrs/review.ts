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
 * published: GitLab created it. failed: GitLab refused it, nothing was created. unknown: the
 * request may or may not have created it. not_attempted: an earlier write did not succeed.
 */
type WriteStatus = 'published' | 'failed' | 'unknown' | 'not_attempted';

interface WriteResult {
  status: WriteStatus;
  discussion_id?: string;
  note_id?: number;
  error?: string;
}

interface CommentResult extends WriteResult {
  index: number;
  path: string;
  old_line: number | null;
  new_line: number | null;
}

export interface ReviewResult {
  merge_request_iid: string;
  head_sha: string;
  complete: boolean;
  comments: CommentResult[];
  summary: WriteResult | null;
  note?: string;
}

const VersionSchema = z.object({
  id: z.number(),
  head_commit_sha: z.string(),
  base_commit_sha: z.string(),
  start_commit_sha: z.string(),
});
type Version = z.infer<typeof VersionSchema>;
const VersionsSchema = z.array(VersionSchema);
const VersionDiffsSchema = z.object({ diffs: z.unknown() });
const DiscussionSchema = z.looseObject({
  id: z.string(),
  notes: z.array(z.looseObject({ id: z.number() })).optional(),
});
const NoteSchema = z.looseObject({ id: z.number() });

/** A line opening a ``` fence: exactly three backticks at its start, no backtick after them. */
const FENCE_OPEN = /^```[^`]*$/;
/** Any line that can end a fence for a Markdown reader. */
const FENCE_CLOSE = /^ {0,3}`{3,}[ \t]*$/;
/**
 * Text before a fence that can change whether it opens: a backtick, or a line starting with
 * `~` (a tilde fence), `<` (HTML) or `>` (a quote) that either reader may extend over it.
 */
const SHIFTS_REGIONS = /`|^ {0,3}[~<>]/m;

/**
 * Whether GitLab could run part of `text` as a quick action (/approve, /merge): a line
 * starting with "/" after GitLab deletes carriage returns. GitLab reads commands with
 * regexes on older releases and with a Markdown parser on newer ones
 * (lib/gitlab/quick_actions/extractor.rb), so only lines both skip are exempt: inside a
 * fence of three backticks closed by a line of exactly three, with nothing before it that
 * could change whether the fence opens for either reader. Anything else is refused,
 * which can refuse a harmless path; a verdict must be an explicit call, never prose.
 */
function runsQuickAction(text: string): boolean {
  const lines = text.replace(/\r/g, '').split('\n');
  let since = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_OPEN.test(lines[i]) && !SHIFTS_REGIONS.test(lines.slice(since, i).join('\n'))) {
      let close = i + 1;
      while (close < lines.length && !FENCE_CLOSE.test(lines[close])) close++;
      if (lines[close] === '```') {
        i = close;
        since = close + 1;
        continue;
      }
    }
    if (/^\/\w/.test(lines[i])) return true;
  }
  return false;
}

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

/** The comment text, with the suggestion in a fence no backtick run inside it can close. */
function commentBody(comment: ReviewComment): string {
  if (comment.suggestion === undefined) return comment.body;
  // GitLab deletes carriage returns before reading the text, so runs are measured without them.
  const runs = comment.suggestion.replace(/\r/g, '').match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${comment.body}\n\n${fence}suggestion:-0+0\n${comment.suggestion}\n${fence}`;
}

/** Comment errors that need no diff: a missing line, text GitLab would run as a command. */
function textErrors(input: ReviewInput, bodies: readonly string[]): string[] {
  const errors: string[] = [];
  input.comments.forEach((comment, index) => {
    if (comment.old_line === undefined && comment.new_line === undefined) {
      errors.push(`comments[${index}]: give new_line, old_line or both`);
    }
    if (runsQuickAction(bodies[index])) {
      errors.push(`comments[${index}]: a line starting with "/" would run as a quick action`);
    }
  });
  if (input.summary !== undefined && runsQuickAction(input.summary)) {
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
  // flatMap skips the holes left by comments without a problem.
  const errors = problems.flatMap((problem, index) => [`comments[${index}]: ${problem}`]);
  return { errors, anchors };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A refused write created nothing; any other failure may have taken effect. */
function failure(error: unknown): { status: 'failed' | 'unknown'; error: string } {
  const refused = error instanceof GitLabApiError && error.status >= 400 && error.status < 500;
  return { status: refused ? 'failed' : 'unknown', error: errorText(error) };
}

function refuse(errors: readonly string[]): never {
  throw new Error(`Review not posted, nothing was published:\n- ${errors.join('\n- ')}`);
}

/** The REST path of the merge request under review, every segment encoded. */
function mrPath(input: ReviewInput): string {
  return `projects/${normalizeProjectId(input.project_id)}/merge_requests/${encodeApiSegment(input.merge_request_iid)}`;
}

interface Plan {
  version: Version;
  anchors: Anchor[];
  bodies: string[];
  input: ReviewInput;
}

/** The form fields that place a comment on its anchor in the reviewed version. */
function positionedBody(plan: Plan, index: number): Record<string, unknown> {
  const anchor = plan.anchors[index];
  const body: Record<string, unknown> = { body: plan.bodies[index] };
  flattenPositionToFormFields(body, {
    position_type: 'text',
    base_sha: plan.version.base_commit_sha,
    start_sha: plan.version.start_commit_sha,
    head_sha: plan.version.head_commit_sha,
    old_path: anchor.old_path,
    new_path: anchor.new_path,
    old_line: anchor.old_line,
    new_line: anchor.new_line,
  });
  return body;
}

function commentResults(plan: Plan, results: readonly WriteResult[]): CommentResult[] {
  return plan.input.comments.map((comment, index) => ({
    index,
    path: comment.path,
    old_line: plan.anchors[index].old_line,
    new_line: plan.anchors[index].new_line,
    ...results[index],
  }));
}

function finish(
  plan: Plan,
  results: readonly WriteResult[],
  summary: WriteResult | null,
): ReviewResult {
  const complete =
    results.every((result) => result.status === 'published') &&
    (summary === null || summary.status === 'published');
  const result: ReviewResult = {
    merge_request_iid: plan.input.merge_request_iid,
    head_sha: plan.version.head_commit_sha,
    complete,
    comments: commentResults(plan, results),
    summary,
  };
  if (!complete) {
    result.note =
      'Partly published, nothing was rolled back. Resend only the writes marked failed or ' +
      'not_attempted; for one marked unknown, check the merge request discussions first, since ' +
      'it may already be there.';
  }
  return result;
}

/**
 * Posts each comment as a diff thread, then the summary, stopping at the first write that
 * does not succeed. Each write is its own GitLab answer: a created thread comes back with
 * its IDs and a refused one as an error, and the reviewer's draft notes are never touched.
 * (Drafts would give one notification, but publishing them names no drafts, confirms no
 * note and returns no IDs, so the outcome of each comment could not be reported.)
 */
async function postThreads(plan: Plan): Promise<ReviewResult> {
  const results: WriteResult[] = plan.input.comments.map(() => ({ status: 'not_attempted' }));
  let stopped = false;
  for (let index = 0; index < results.length; index++) {
    try {
      const created = DiscussionSchema.safeParse(
        await gitlab.post(`${mrPath(plan.input)}/discussions`, {
          body: positionedBody(plan, index),
          contentType: 'form',
        }),
      );
      results[index] = { status: 'published' };
      if (created.success) {
        results[index].discussion_id = created.data.id;
        const noteId = created.data.notes?.[0]?.id;
        if (noteId !== undefined) results[index].note_id = noteId;
      }
    } catch (error: unknown) {
      results[index] = failure(error);
      stopped = true;
      break;
    }
  }

  let summary: WriteResult | null = null;
  if (plan.input.summary !== undefined) {
    summary = { status: 'not_attempted' };
    if (!stopped) {
      try {
        const note = NoteSchema.safeParse(
          await gitlab.post(`${mrPath(plan.input)}/notes`, {
            body: { body: plan.input.summary },
            contentType: 'form',
          }),
        );
        summary = { status: 'published', ...(note.success ? { note_id: note.data.id } : {}) };
      } catch (error: unknown) {
        summary = failure(error);
      }
    }
  }
  return finish(plan, results, summary);
}

/**
 * Posts several diff comments and an optional summary note on one merge request. Every
 * comment is checked against the merge request's latest diff version, which must still be
 * at `head_sha`, before anything is written; a push while the review is written is not
 * caught, and its comments stay on the version that was reviewed. The writes are not
 * transactional: the result says what happened to each one.
 */
export async function submitReview(input: ReviewInput): Promise<ReviewResult> {
  const bodies = input.comments.map(commentBody);
  const preflight = textErrors(input, bodies);
  if (preflight.length > 0) refuse(preflight);

  // Versions come newest first; the newest is the diff the merge request shows now.
  const versions = VersionsSchema.safeParse(
    await gitlab.get(`${mrPath(input)}/versions`, { query: { per_page: 1 } }),
  );
  if (!versions.success)
    throw new Error('GitLab returned an unexpected merge request versions list');
  const version = versions.data[0];
  if (version === undefined) refuse(['the merge request has no diff yet']);
  if (version.head_commit_sha.toLowerCase() !== input.head_sha.toLowerCase()) {
    refuse([
      `the merge request head is now ${version.head_commit_sha}, not ${input.head_sha}; read the new diff and review it again`,
    ]);
  }

  const diffs = VersionDiffsSchema.safeParse(
    await gitlab.get(`${mrPath(input)}/versions/${encodeApiSegment(String(version.id))}`),
  );
  if (!diffs.success) throw new Error('GitLab returned an unexpected merge request version');
  const { errors, anchors } = anchorComments(parseDiffFiles(diffs.data.diffs), input.comments);
  if (errors.length > 0) refuse(errors);

  return postThreads({ version, anchors, bodies, input });
}
