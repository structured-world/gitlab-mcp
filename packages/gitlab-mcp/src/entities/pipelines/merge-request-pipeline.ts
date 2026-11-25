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

type Attempt = { pipeline: unknown } | { refused: GitLabApiError };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The 405 with the reason GitLab does not give: the bare status reads like a wrong verb. */
function refusal(error: GitLabApiError, mergeRequestIid: string, reason: string): GitLabApiError {
  return new GitLabApiError(
    error.status,
    error.details,
    `${error.message} - GitLab cannot create a pipeline for merge request !${mergeRequestIid}: ${reason}`,
    error.retryAfterSeconds,
  );
}

/** One creation request. A 405 is returned, not thrown: it is the only answer worth a second try. */
async function tryCreate(pipelinesPath: string, mergeRequestIid: string): Promise<Attempt> {
  let answer: unknown;
  try {
    answer = await gitlab.post(pipelinesPath);
  } catch (error) {
    if (error instanceof GitLabApiError && error.status === 405) return { refused: error };
    throw error;
  }
  const created = CreatedPipelineSchema.safeParse(answer);
  if (!created.success) {
    throw new Error(
      `GitLab accepted the request for merge request !${mergeRequestIid} but did not return a pipeline; one may have been created, check browse_pipelines before another attempt`,
    );
  }
  return { pipeline: created.data };
}

/** Resolve once the merge request has a diff; throw when it does not get one in time. */
async function waitForDiff(
  mergeRequest: string,
  mergeRequestIid: string,
  refused: GitLabApiError,
): Promise<void> {
  const deadline = Date.now() + DIFF_WAIT_MS;
  for (;;) {
    const state = MergeRequestDiffStateSchema.safeParse(await gitlab.get(mergeRequest));
    if (!state.success) {
      throw refusal(
        refused,
        mergeRequestIid,
        'GitLab returned an unexpected merge request while waiting for its diff',
      );
    }
    if (state.data.changes_count !== null) return;
    if (Date.now() + DIFF_POLL_MS > deadline) {
      throw refusal(
        refused,
        mergeRequestIid,
        `its diff is still being prepared after ${DIFF_WAIT_MS / 1000} s; try again later`,
      );
    }
    // Each poll depends on the time passed since the previous one, so they cannot run together.
    await sleep(DIFF_POLL_MS);
  }
}

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

  const pipelines = `${mergeRequest}/pipelines`;

  const first = await tryCreate(pipelines, mergeRequestIid);
  if ('pipeline' in first) return first.pipeline;

  await waitForDiff(mergeRequest, mergeRequestIid, first.refused);

  const second = await tryCreate(pipelines, mergeRequestIid);
  if ('pipeline' in second) return second.pipeline;
  throw refusal(second.refused, mergeRequestIid, 'it has no commits to build');
}
