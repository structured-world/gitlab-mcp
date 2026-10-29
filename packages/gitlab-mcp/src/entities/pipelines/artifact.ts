import { enhancedFetch, GitLabTimeoutError } from '../../utils/fetch';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { parseRetryAfterSeconds } from '../../utils/retry-after';
import { BODY_TIMEOUT_MS } from '../../config';
import { StructuredToolError, type ArtifactReadRefusal } from '../../utils/error-handler';
import { currentMcpAbortSignal } from '../../mcp-server-context';
import { encodeArtifactPath, ARTIFACT_MAX_BYTES, ARTIFACT_MAX_OFFSET } from './artifact-path';
import { readArtifactWindow, ArtifactReadError } from './artifact-window';

interface ArtifactInput {
  project_id: string;
  job_id: string;
  artifact_path: string;
  byte_offset: number;
  byte_limit: number;
}

/** Validate a provider redirect before connecting, without retaining invalid signed URL data. */
export function resolveArtifactRedirect(target: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, target);
  } catch {
    throw new Error('Artifact server returned an invalid redirect URL');
  }
  if (
    !['http:', 'https:'].includes(next.protocol) ||
    next.username ||
    next.password ||
    next.hash ||
    (target.protocol === 'https:' && next.protocol !== 'https:')
  ) {
    throw new Error('Artifact server returned an unsafe redirect');
  }
  return next;
}

/** A browser link is derived from GitLab's job URL, not from a signed storage URL. */
export function artifactViewUrl(jobUrl: string, encodedPath: string): string {
  let view: URL;
  try {
    view = new URL(jobUrl);
  } catch {
    throw new Error('GitLab returned an invalid artifact-view URL');
  }
  if (!['http:', 'https:'].includes(view.protocol) || view.username || view.password) {
    throw new Error('GitLab returned an invalid artifact-view URL');
  }
  view.pathname += `/artifacts/file/${encodedPath}`;
  view.search = '';
  view.hash = '';
  return view.toString();
}

/** The configured GitLab supplies download locations; a caller never supplies an origin. */
async function artifactResponse(url: string, offset: number, limit: number) {
  let target = new URL(url);
  const origin = target.origin;
  let external = false;
  // Fetch's redirect limit: https://fetch.spec.whatwg.org/#http-redirect-fetch
  for (let redirects = 0; redirects <= 20; redirects++) {
    const response = await enhancedFetch(target.toString(), {
      rawBody: true,
      redirect: 'manual',
      skipAuth: external,
      redactQuery: true,
      signal: currentMcpAbortSignal(),
      rateLimitBaseUrl: external ? target.origin : getGitLabBaseUrl(),
      rateLimit: !external,
      headers: {
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Range: `bytes=${offset}-${offset + limit + 3}`,
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, external };
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Artifact redirect has no Location');
    const next = resolveArtifactRedirect(target, location);
    external ||= next.origin !== origin;
    target = next;
  }
  throw new Error('Artifact server exceeded the redirect limit');
}

/** Read only the requested artifact file, retaining bytes for one UTF-8 window. */
export async function readArtifactFile(input: ArtifactInput) {
  const { project_id, job_id, artifact_path, byte_offset, byte_limit } = input;
  const encodedPath = encodeArtifactPath(artifact_path);
  const project = normalizeProjectId(project_id);
  const job = encodeApiSegment(job_id);
  const url = `${getGitLabBaseUrl()}/api/v4/projects/${project}/jobs/${job}/artifacts/${encodedPath}`;
  const { response, external } = await artifactResponse(url, byte_offset, byte_limit);
  try {
    assertDownloadStatus(response, external, input);
    return {
      project_id,
      job_id,
      artifact_path,
      ...(await readArtifactWindow(response, byte_offset, byte_limit)),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'UND_ERR_BODY_TIMEOUT') {
      throw new GitLabTimeoutError('body', BODY_TIMEOUT_MS, error);
    }
    if (error instanceof ArtifactReadError) {
      let viewUrl: string | undefined;
      if (error.reason === 'not_text') {
        // Resolve a canonical browser link only for the refusal, not for every successful window.
        const metadata = await gitlab.get<{ web_url: string }>(`projects/${project}/jobs/${job}`);
        viewUrl = artifactViewUrl(metadata.web_url, encodedPath);
      }
      throw refusal(input, error.reason, error.message, {
        ...(viewUrl !== undefined && { artifact_view_url: viewUrl }),
      });
    }
    throw error;
  } finally {
    if (!response.bodyUsed && !response.body?.locked) await response.body?.cancel();
  }
}

function assertDownloadStatus(response: Response, external: boolean, input: ArtifactInput): void {
  if (response.ok || response.status === 416) return;
  if (external) {
    throw refusal(
      input,
      'storage_http_error',
      `Artifact storage returned HTTP ${response.status}`,
      { http_status: response.status },
    );
  }
  const wait =
    response.status === 429
      ? parseRetryAfterSeconds(response.headers.get('retry-after'), Date.now())
      : null;
  throw new GitLabApiError(
    response.status,
    '',
    `GitLab API error: ${response.status} ${response.statusText}`,
    wait === null ? undefined : Math.ceil(wait),
  );
}

function refusal(
  input: ArtifactInput,
  reason: string,
  message: string,
  details: Pick<ArtifactReadRefusal, 'artifact_view_url' | 'http_status'>,
): StructuredToolError {
  return new StructuredToolError({
    error_code: 'ARTIFACT_READ_REFUSED',
    reason,
    message,
    tool: 'browse_pipelines',
    action: 'artifact_file',
    project_id: input.project_id,
    job_id: input.job_id,
    artifact_path: input.artifact_path,
    max_window_bytes: ARTIFACT_MAX_BYTES,
    max_prefix_bytes: ARTIFACT_MAX_OFFSET,
    ...details,
  });
}
