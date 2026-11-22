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
import { NotTextError } from './text-scan';

/** One file inside a job's artifacts archive. */
export interface ArtifactTarget {
  project_id: string;
  job_id: string;
  artifact_path: string;
}

interface ArtifactInput extends ArtifactTarget {
  byte_offset: number;
  byte_limit: number;
}

export type ArtifactAction = 'artifact_file' | 'artifact_grep';

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

/** The download URL of the file on the configured GitLab; a caller never supplies an origin. */
export function artifactFileUrl(target: ArtifactTarget): string {
  const encodedPath = encodeArtifactPath(target.artifact_path);
  const project = normalizeProjectId(target.project_id);
  const job = encodeApiSegment(target.job_id);
  return `${getGitLabBaseUrl()}/api/v4/projects/${project}/jobs/${job}/artifacts/${encodedPath}`;
}

/**
 * Request `bytes=first-last` of the file, following GitLab's redirects to object storage
 * without forwarding credentials there.
 */
export async function artifactResponse(url: string, first: number, last: number) {
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
        Range: `bytes=${first}-${last}`,
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, external };
    const location = response.headers.get('location');
    // Each redirect depends on this response; finish cancellation before following its Location.
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
  const { response, external } = await artifactResponse(
    artifactFileUrl(input),
    byte_offset,
    byte_offset + byte_limit + 3,
  );
  try {
    assertDownloadStatus(response, external, input, 'artifact_file');
    return {
      project_id,
      job_id,
      artifact_path,
      ...(await readArtifactWindow(response, byte_offset, byte_limit)),
    };
  } catch (error) {
    if (error instanceof ArtifactReadError) await discardUnreadBody(response);
    throw await artifactFailure(error, input, 'artifact_file');
  } finally {
    await discardUnreadBody(response);
  }
}

/**
 * The error a failed artifact read surfaces: a body timeout keeps its structured type, and a
 * refused read becomes a typed refusal, with a browser link when the content is not text.
 */
export async function artifactFailure(
  error: unknown,
  target: ArtifactTarget,
  action: ArtifactAction,
): Promise<unknown> {
  if (error instanceof Error && 'code' in error && error.code === 'UND_ERR_BODY_TIMEOUT') {
    return new GitLabTimeoutError('body', BODY_TIMEOUT_MS, error);
  }
  if (!(error instanceof ArtifactReadError) && !(error instanceof NotTextError)) return error;
  let viewUrl: string | undefined;
  if (error.reason === 'not_text') {
    // Resolve a canonical browser link only for the refusal, not for every successful read.
    const project = normalizeProjectId(target.project_id);
    const job = encodeApiSegment(target.job_id);
    const metadata = await gitlab.get<{ web_url: string }>(`projects/${project}/jobs/${job}`);
    viewUrl = artifactViewUrl(metadata.web_url, encodeArtifactPath(target.artifact_path));
  }
  return refusal(target, action, error.reason, error.message, {
    ...(viewUrl !== undefined && { artifact_view_url: viewUrl }),
  });
}

export async function discardUnreadBody(response: Response): Promise<void> {
  if (!response.bodyUsed && !response.body?.locked) await response.body?.cancel();
}

/** A failed download status: GitLab's keeps its API error, object storage's is a refusal. */
export function assertDownloadStatus(
  response: Response,
  external: boolean,
  target: ArtifactTarget,
  action: ArtifactAction,
): void {
  if (response.ok || response.status === 416) return;
  if (external) {
    throw refusal(
      target,
      action,
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
  target: ArtifactTarget,
  action: ArtifactAction,
  reason: string,
  message: string,
  details: Pick<ArtifactReadRefusal, 'artifact_view_url' | 'http_status'>,
): StructuredToolError {
  return new StructuredToolError({
    error_code: 'ARTIFACT_READ_REFUSED',
    reason,
    message,
    tool: 'browse_pipelines',
    action,
    project_id: target.project_id,
    job_id: target.job_id,
    artifact_path: target.artifact_path,
    max_window_bytes: ARTIFACT_MAX_BYTES,
    max_prefix_bytes: ARTIFACT_MAX_OFFSET,
    ...details,
  });
}
