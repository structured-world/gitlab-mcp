import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';

/** How long a freshly created merge request may take to get its diff. */
export const DIFF_WAIT_MS = 30_000;
const DIFF_POLL_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a pipeline for a merge request (source `merge_request_event`).
 *
 * GitLab picks where it runs: in the merge request's project on the merge request ref
 * when the caller may run pipelines there, otherwise in the source project on the source
 * branch (a fork MR). The returned pipeline carries the ref and project it actually got.
 *
 * GitLab builds a merge request's diff in the background after creating it and answers
 * 405 until then, exactly as for a merge request with no commits. A 405 means no pipeline
 * was created, so the call waits for the diff and asks once more. Any other failure, and
 * an unknown outcome such as a timeout, is never repeated: that could start a second pipeline.
 */
export async function createMergeRequestPipeline(
  projectId: string,
  mergeRequestIid: string,
): Promise<unknown> {
  const mergeRequest = `projects/${normalizeProjectId(projectId)}/merge_requests/${encodeApiSegment(mergeRequestIid)}`;
  const create = (): Promise<unknown> => gitlab.post(`${mergeRequest}/pipelines`);
  const isRefusal = (error: unknown): error is GitLabApiError =>
    error instanceof GitLabApiError && error.status === 405;
  const refusal = (error: GitLabApiError, reason: string): GitLabApiError =>
    new GitLabApiError(
      error.status,
      error.details,
      `${error.message} - GitLab cannot create a pipeline for merge request !${mergeRequestIid}: ${reason}`,
      error.retryAfterSeconds,
    );

  try {
    return await create();
  } catch (error) {
    if (!isRefusal(error)) throw error;

    // changes_count is null until the diff exists and a string ("0" included) afterwards.
    const deadline = Date.now() + DIFF_WAIT_MS;
    for (;;) {
      const { changes_count } = await gitlab.get<{ changes_count: string | null }>(mergeRequest);
      if (changes_count !== null) break;
      if (Date.now() + DIFF_POLL_MS > deadline) {
        throw refusal(
          error,
          `its diff is still being prepared after ${DIFF_WAIT_MS / 1000} s; try again later`,
        );
      }
      await sleep(DIFF_POLL_MS);
    }

    try {
      return await create();
    } catch (secondError) {
      if (!isRefusal(secondError)) throw secondError;
      throw refusal(secondError, 'it has no commits to build');
    }
  }
}
