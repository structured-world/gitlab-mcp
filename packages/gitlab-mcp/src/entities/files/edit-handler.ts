import * as z from 'zod';
import { gitlab } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { parseGitLabApiError } from '../../utils/error-handler';
import {
  applyEdits,
  EDIT_MAX_FILE_BYTES,
  EditError,
  EditTooLargeError,
  isLfsPointer,
  type TextEdit,
} from './edit';
import { FileTooLargeError, readRepositoryFile } from './read';

/** The edit action's arguments, as the tool schema validated them. */
export interface EditFileInput {
  project_id: string;
  file_path: string;
  branch: string;
  commit_message: string;
  edits: TextEdit[];
  expected_last_commit_id?: string;
  dry_run?: boolean;
  start_branch?: string;
  author_email?: string;
  author_name?: string;
}

/** GitLab refuses a file update whose last commit moved since this one (Files::MultiService). */
const FILE_CHANGED = 'The file has changed since you started editing it';

const CommitSchema = z.looseObject({ id: z.string() });
const CommitListSchema = z.array(z.looseObject({ id: z.string() }));

/** A refusal of the edit, phrased for the caller. */
function refuse(reason: string): Error {
  return new Error(`manage_files edit: ${reason}`);
}

function conflict(current: string): Error {
  return refuse(
    `the file changed since it was read; its last_commit_id is now ${current}. Read it again with browse_files content and redo the edit`,
  );
}

/** The file read for the edit, or why it cannot be edited in place. */
async function readEditable(input: EditFileInput, ref: string) {
  let read;
  try {
    read = await readRepositoryFile(input.project_id, input.file_path, ref, EDIT_MAX_FILE_BYTES);
  } catch (error) {
    if (error instanceof FileTooLargeError)
      throw refuse(`${error.message}; replace the file with action single`);
    const parsed = error instanceof Error ? parseGitLabApiError(error.message) : null;
    if (parsed?.status === 404 && /file not found/i.test(parsed.message))
      throw refuse(
        `${input.file_path} is not a file at ${ref}; edit changes existing files, create one with action single`,
      );
    throw error;
  }
  let text: string;
  try {
    // Encoding Standard, TextDecoder: fatal mode rejects malformed UTF-8, and ignoreBOM keeps
    // a byte order mark in the text so writing it back leaves the file's bytes as they were.
    // https://encoding.spec.whatwg.org/#interface-textdecoder
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(read.bytes);
  } catch {
    throw refuse('the file is not valid UTF-8 text; replace it with action single');
  }
  if (isLfsPointer(text))
    throw refuse('the file is stored in Git LFS; edit cannot change LFS objects');
  if (read.last_commit_id === null)
    throw refuse(
      'GitLab did not report the last commit of the file, so a conflict cannot be detected',
    );
  return { text, blob_id: read.blob_id, last_commit_id: read.last_commit_id };
}

/**
 * Whether the caller's version is the one just read. A different commit id still names it
 * when the file did not change between the two (GitLab compares the last commit of the path
 * at each); an id GitLab does not know is refused, as GitLab itself would skip the check.
 */
async function assertExpectedVersion(input: EditFileInput, current: string): Promise<void> {
  const expected = input.expected_last_commit_id;
  if (expected === undefined || expected === current) return;
  let last: string | undefined = undefined;
  try {
    const commits = CommitListSchema.safeParse(
      await gitlab.get(`projects/${normalizeProjectId(input.project_id)}/repository/commits`, {
        query: { ref_name: expected, path: input.file_path, per_page: 1 },
      }),
    );
    last = commits.success ? commits.data[0]?.id : undefined;
  } catch (error) {
    // GitLab answers an unknown ref with 404 (or 400 for a malformed one); anything else is
    // a failure of the lookup itself, not evidence about the file.
    const status = error instanceof Error ? parseGitLabApiError(error.message)?.status : undefined;
    if (status !== 404 && status !== 400) throw error;
  }
  if (last !== current) throw conflict(current);
}

/**
 * Edit an existing text file by replacing exact fragments, committed with the last commit the
 * file was read at, so GitLab refuses the write if the file changed between read and write.
 */
export async function editRepositoryFile(input: EditFileInput) {
  const ref = input.start_branch ?? input.branch;
  const file = await readEditable(input, ref);
  await assertExpectedVersion(input, file.last_commit_id);

  let edited;
  try {
    edited = applyEdits(input.file_path, file.text, input.edits);
  } catch (error) {
    if (error instanceof EditError) throw refuse(`${error.message}; nothing was committed`);
    if (error instanceof EditTooLargeError)
      throw refuse(`${error.message}; replace it with action single`);
    throw error;
  }

  const summary = {
    file_path: input.file_path,
    branch: input.branch,
    replacements: edited.replacements,
    diff: edited.diff,
    ...(edited.diff_truncated && { diff_truncated: true }),
  };
  if (input.dry_run)
    return {
      ...summary,
      dry_run: true,
      blob_id: file.blob_id,
      last_commit_id: file.last_commit_id,
    };

  let response: unknown;
  try {
    response = await gitlab.post(
      `projects/${normalizeProjectId(input.project_id)}/repository/commits`,
      {
        body: {
          branch: input.branch,
          commit_message: input.commit_message,
          ...(input.start_branch && { start_branch: input.start_branch }),
          ...(input.author_email && { author_email: input.author_email }),
          ...(input.author_name && { author_name: input.author_name }),
          stats: false,
          actions: [
            {
              action: 'update',
              file_path: input.file_path,
              content: edited.text,
              encoding: 'text',
              // The version read above, never the caller's: GitLab skips the check for an id
              // it does not know, so only a known id makes the write conditional.
              last_commit_id: file.last_commit_id,
            },
          ],
        },
        contentType: 'json',
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes(FILE_CHANGED))
      throw refuse(
        'the file changed between reading and writing it, and GitLab refused the update. Read it again with browse_files content and redo the edit',
      );
    throw error;
  }
  const commit = CommitSchema.safeParse(response);
  if (!commit.success) throw new Error('GitLab API error: unexpected commit response');
  // The commit changed the file, so it is the file's new last commit.
  return { ...summary, commit_id: commit.data.id, last_commit_id: commit.data.id };
}
