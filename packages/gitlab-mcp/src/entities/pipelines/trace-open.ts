import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { enhancedFetch } from '../../utils/fetch';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';

/** Request a job trace as a byte stream; a GitLab error never yields a partial body. */
export async function openTrace(
  projectId: string,
  jobId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const apiUrl = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(projectId)}/jobs/${encodeApiSegment(jobId)}/trace`;
  const response = await enhancedFetch(apiUrl);
  if (!response.ok) {
    const error = new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    try {
      await response.body?.cancel();
    } catch (cause) {
      error.cause = cause;
    }
    throw error;
  }
  return response.body;
}
