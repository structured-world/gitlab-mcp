import { z } from 'zod';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';

/**
 * How long to keep asking for the diff of a freshly created merge request. It bounds the
 * polling, not a request already in flight: an answer that arrives past it and shows a
 * ready diff is used, since discarding it would refuse a pipeline GitLab can now create.
 */
export const DIFF_WAIT_MS = 30_000;
const DIFF_POLL_MS = 500;

// changes_count is null until the diff exists and a string ("0" included) afterwards.
const MergeRequestDiffStateSchema = z.object({ changes_count: z.string().nullable() });

// The fields the caller is promised; everything else GitLab returns is kept as is.
const CreatedPipelineSchema = z.looseObject({
  id: z.number(),
  status: z.string(),
  ref: z.string(),
  web_url: z.string(),
});

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
  const create = async (): Promise<unknown> => {
    const created = CreatedPipelineSchema.safeParse(await gitlab.post(`${mergeRequest}/pipelines`));
    if (!created.success) {
      throw new Error(
        `GitLab accepted the request for merge request !${mergeRequestIid} but did not return a pipeline; one may have been created, check browse_pipelines before another attempt`,
      );
    }
    return created.data;
  };
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

    const deadline = Date.now() + DIFF_WAIT_MS;
    for (;;) {
      const state = MergeRequestDiffStateSchema.safeParse(await gitlab.get(mergeRequest));
      if (!state.success) {
        throw refusal(
          error,
          'GitLab returned an unexpected merge request while waiting for its diff',
        );
      }
      if (state.data.changes_count !== null) break;
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
