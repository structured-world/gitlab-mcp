import { z } from 'zod';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { findDiffLines, parseDiffFiles, type DiffFile } from '../diff-lines';
import { instanceAtLeast } from '../instance-version';
import { flattenPositionToFormFields } from './position-fields';
import type { ManageMrDiscussionInput } from './schema';

type ReviewInput = Extract<ManageMrDiscussionInput, { action: 'review' }>;
type ReviewComment = ReviewInput['comments'][number];

/** First GitLab whose draft notes take a diff position (lib/api/draft_notes.rb, v16.3.0-ee). */
export const DRAFT_POSITION_MIN_VERSION = '16.3';

/**
 * published: visible on the merge request. draft: still the reviewer's unpublished draft
 * (draft_note_id), to publish or delete with manage_draft_notes. failed: GitLab refused it,
 * nothing was created. unknown: the request may or may not have taken effect.
 * not_attempted: an earlier write did not succeed.
 */
type WriteStatus = 'published' | 'draft' | 'failed' | 'unknown' | 'not_attempted';

interface WriteResult {
  status: WriteStatus;
  draft_note_id?: number;
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

/**
 * review: one submitted review, a single notification. separate: drafts published one by
 * one, because the reviewer had other pending drafts a submitted review would publish too.
 * threads: comments posted directly, on an instance whose drafts take no diff position.
 */
type PublishedAs = 'review' | 'separate' | 'threads';

export interface ReviewResult {
  merge_request_iid: string;
  head_sha: string;
  published_as: PublishedAs;
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
const DraftSchema = z.looseObject({
  id: z.number(),
  position: z.looseObject({ head_sha: z.string().nullish() }).nullish(),
});
const DraftsSchema = z.array(z.looseObject({ id: z.number() }));

/**
 * The regions GitLab's quick-action extractor skips: ``` blocks closed by a line of exactly
 * three backticks, inline code, HTML blocks and >>> quotes (lib/gitlab/quick_actions/extractor.rb).
 */
const SKIPPED_BY_GITLAB =
  /^```[\s\S]+?\n```$|`[\s\S]+?`|^<[^>]+?>\n[\s\S]+?\n<\/[^>]+?>$|^>>>[\s\S]+?\n>>>$/gm;

/**
 * Whether GitLab would run part of `text` as a quick action (/approve, /merge): a line
 * starting with "/" outside the skipped regions, after GitLab deletes carriage returns.
 * A verdict must be an explicit call, never prose in a review.
 */
function runsQuickAction(text: string): boolean {
  // A skipped region becomes a space, so text after it does not move to a line start.
  return /^\/\w/m.test(text.replace(/\r/g, '').replace(SKIPPED_BY_GITLAB, ' '));
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
function positionedBody(
  plan: Plan,
  index: number,
  textField: 'body' | 'note',
): Record<string, unknown> {
  const anchor = plan.anchors[index];
  const body: Record<string, unknown> = { [textField]: plan.bodies[index] };
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
  publishedAs: PublishedAs,
  results: readonly WriteResult[],
  summary: WriteResult | null,
): ReviewResult {
  const complete =
    results.every((result) => result.status === 'published') &&
    (summary === null || summary.status === 'published');
  const result: ReviewResult = {
    merge_request_iid: plan.input.merge_request_iid,
    head_sha: plan.version.head_commit_sha,
    published_as: publishedAs,
    complete,
    comments: commentResults(plan, results),
    summary,
  };
  if (!complete) {
    result.note =
      'Partly published, nothing was rolled back. A draft is still yours to publish or delete with ' +
      'manage_draft_notes; resend failed or not_attempted ones; for one marked unknown, check the ' +
      'merge request discussions and drafts first, since it may already be there.';
  }
  return result;
}

/**
 * Posts each comment as a diff thread, then the summary, stopping at the first write that
 * does not succeed. Used where drafts take no position, so GitLab notifies per comment.
 */
async function postThreads(plan: Plan): Promise<ReviewResult> {
  const results: WriteResult[] = plan.input.comments.map(() => ({ status: 'not_attempted' }));
  let stopped = false;
  for (let index = 0; index < results.length; index++) {
    try {
      const created = DiscussionSchema.safeParse(
        await gitlab.post(`${mrPath(plan.input)}/discussions`, {
          body: positionedBody(plan, index, 'body'),
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
  return finish(plan, 'threads', results, summary);
}

/** Deletes the drafts the review created, returning those that could not be deleted. */
async function withdrawDrafts(plan: Plan, ids: readonly number[]): Promise<number[]> {
  const left: number[] = [];
  for (const id of ids) {
    try {
      await gitlab.delete(`${mrPath(plan.input)}/draft_notes/${encodeApiSegment(String(id))}`);
    } catch {
      left.push(id);
    }
  }
  return left;
}

interface Staged {
  comments: number[];
  summary: number | null;
}

/**
 * Creates one draft per comment and one for the summary, none of them visible to others.
 * Null when GitLab dropped a position (an instance older than reported): the drafts are
 * withdrawn and the comments go out as threads instead. A failed write withdraws them too.
 */
async function stageDrafts(plan: Plan): Promise<Staged | null> {
  const created: number[] = [];
  const stage = async (body: Record<string, unknown>, step: string) => {
    try {
      const parsed = DraftSchema.safeParse(
        await gitlab.post(`${mrPath(plan.input)}/draft_notes`, { body, contentType: 'form' }),
      );
      if (!parsed.success) throw new Error('GitLab returned an unexpected draft note');
      created.push(parsed.data.id);
      return parsed.data;
    } catch (error: unknown) {
      const { status, error: message } = failure(error);
      const left = await withdrawDrafts(plan, created);
      const notes = [`${step}: ${message}`];
      if (status === 'unknown') notes.push(`a draft for ${step} may exist; check your drafts`);
      if (left.length > 0) notes.push(`drafts left unpublished: ${left.join(', ')}`);
      return refuse(notes);
    }
  };

  const comments: number[] = [];
  for (let index = 0; index < plan.input.comments.length; index++) {
    const draft = await stage(positionedBody(plan, index, 'note'), `comments[${index}]`);
    // GitLab ignores a parameter it does not know: a draft without the position would be
    // published as a general comment, so its absence sends the review out as threads.
    if (draft.position?.head_sha !== plan.version.head_commit_sha) {
      const left = await withdrawDrafts(plan, created);
      if (left.length > 0) {
        refuse([
          `GitLab dropped the diff position of a draft; drafts left unpublished: ${left.join(', ')}`,
        ]);
      }
      return null;
    }
    comments.push(draft.id);
  }
  const summary =
    plan.input.summary === undefined
      ? null
      : (await stage({ note: plan.input.summary }, 'summary')).id;
  return { comments, summary };
}

/** The reviewer's pending draft IDs, or null when GitLab did not list them. */
async function pendingDrafts(plan: Plan): Promise<Set<number> | null> {
  try {
    const drafts = DraftsSchema.safeParse(await gitlab.get(`${mrPath(plan.input)}/draft_notes`));
    return drafts.success ? new Set(drafts.data.map((draft) => draft.id)) : null;
  } catch {
    return null;
  }
}

/**
 * Publishes the staged drafts. Without other pending drafts they go out as one review, a
 * single notification; otherwise one by one, since a submitted review would publish the
 * reviewer's other drafts too. After a failure, the drafts still pending tell which ones
 * were published.
 */
async function publishDrafts(plan: Plan, staged: Staged): Promise<ReviewResult> {
  const ours = staged.summary === null ? staged.comments : [...staged.comments, staged.summary];
  const before = await pendingDrafts(plan);
  // Unlisted drafts are treated as foreign ones: a review must never publish what is not its own.
  const alone = before !== null && [...before].every((id) => ours.includes(id));

  // One outcome per draft, in the order of `ours`.
  let outcomes: WriteResult[] = ours.map(() => ({ status: 'draft' }));
  let failed = false;
  if (alone) {
    try {
      await gitlab.post(`${mrPath(plan.input)}/draft_notes/bulk_publish`);
      outcomes = ours.map(() => ({ status: 'published' }));
    } catch (error: unknown) {
      outcomes = ours.map(() => ({ status: 'unknown', error: errorText(error) }));
      failed = true;
    }
  } else {
    for (const [at, id] of ours.entries()) {
      try {
        await gitlab.put(
          `${mrPath(plan.input)}/draft_notes/${encodeApiSegment(String(id))}/publish`,
        );
        outcomes[at] = { status: 'published' };
      } catch (error: unknown) {
        outcomes[at] = { status: 'unknown', error: errorText(error) };
        failed = true;
        break;
      }
    }
  }

  if (failed) {
    const after = await pendingDrafts(plan);
    if (after !== null) {
      outcomes = outcomes.map(({ error }, at): WriteResult => {
        if (!after.has(ours[at])) return { status: 'published' };
        return error === undefined ? { status: 'draft' } : { status: 'draft', error };
      });
    }
  }
  const results = outcomes.map((result, at) =>
    result.status === 'published' ? result : { ...result, draft_note_id: ours[at] },
  );
  return finish(
    plan,
    alone ? 'review' : 'separate',
    results.slice(0, staged.comments.length),
    staged.summary === null ? null : results[staged.comments.length],
  );
}

/**
 * Posts several diff comments and an optional summary note on one merge request. Every
 * comment is checked against the merge request's latest diff version, which must still be
 * at `head_sha`, before anything is written; a push while the review is written is not
 * caught, and its comments stay on the version that was reviewed. Where drafts take a diff
 * position the comments are staged as drafts and published as one review when the reviewer
 * has no other pending drafts, else one by one; older instances get them as threads. The
 * publication is not transactional: the result says what happened to each write.
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

  const plan: Plan = { version, anchors, bodies, input };
  if (instanceAtLeast(DRAFT_POSITION_MIN_VERSION)) {
    const staged = await stageDrafts(plan);
    if (staged !== null) return publishDrafts(plan, staged);
  }
  return postThreads(plan);
}
