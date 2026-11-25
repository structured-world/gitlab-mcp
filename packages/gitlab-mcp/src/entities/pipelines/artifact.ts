import { enhancedFetch, GitLabTimeoutError } from '../../utils/fetch';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { parseRetryAfterSeconds } from '../../utils/retry-after';
import { BODY_TIMEOUT_MS } from '../../config';
import { StructuredToolError, type ArtifactReadRefusal } from '../../utils/error-handler';
import { currentMcpAbortSignal } from '../../mcp-server-context';
import { assertInstanceAtLeast } from '../instance-version';
import { assertDefined } from '../utils';
import { encodeArtifactPath, ARTIFACT_MAX_BYTES, ARTIFACT_MAX_OFFSET } from './artifact-path';
import { readArtifactWindow, ArtifactReadError } from './artifact-window';
import { reportBytes, reportRangeReadable, REPORT_TYPE_MIN_VERSION } from './artifact-report';
import { NotTextError } from './text-scan';

interface ArtifactJob {
  project_id: string;
  job_id: string;
}

/** One file inside a job's artifacts archive, or a report the job uploaded as its own file. */
export type ArtifactTarget =
  (ArtifactJob & { artifact_path: string }) | (ArtifactJob & { report_type: string });

interface ArtifactSelector extends ArtifactJob {
  artifact_path?: string;
  report_type?: string;
}

interface ArtifactInput extends ArtifactSelector {
  byte_offset: number;
  byte_limit: number;
}

export type ArtifactAction = 'artifact_file' | 'artifact_grep';

/** The file a call names; the schema guarantees exactly one of the two selectors. */
export function artifactTarget(input: ArtifactSelector): ArtifactTarget {
  const { project_id, job_id, artifact_path, report_type } = input;
  if (report_type !== undefined) {
    // An older release ignores the report type and would answer with the whole archive.
    assertInstanceAtLeast(REPORT_TYPE_MIN_VERSION, 'Reading a report artifact by report_type');
    return { project_id, job_id, report_type };
  }
  assertDefined(artifact_path, 'artifact_path');
  return { project_id, job_id, artifact_path };
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

/** GitLab's job page, the base of every browser link; never a signed storage URL. */
function jobPage(jobUrl: string): URL {
  let view: URL;
  try {
    view = new URL(jobUrl);
  } catch {
    throw new Error('GitLab returned an invalid artifact-view URL');
  }
  if (!['http:', 'https:'].includes(view.protocol) || view.username || view.password) {
    throw new Error('GitLab returned an invalid artifact-view URL');
  }
  view.search = '';
  view.hash = '';
  return view;
}

/** The browser link of one file in the artifacts archive. */
export function artifactViewUrl(jobUrl: string, encodedPath: string): string {
  const view = jobPage(jobUrl);
  view.pathname += `/artifacts/file/${encodedPath}`;
  return view.toString();
}

/** The browser download of a report artifact. */
export function reportViewUrl(jobUrl: string, reportType: string): string {
  const view = jobPage(jobUrl);
  view.pathname += '/artifacts/download';
  view.searchParams.set('file_type', reportType);
  return view.toString();
}

/** The download URL of the file on the configured GitLab; a caller never supplies an origin. */
export function artifactFileUrl(target: ArtifactTarget): string {
  const project = normalizeProjectId(target.project_id);
  const job = encodeApiSegment(target.job_id);
  const artifacts = `${getGitLabBaseUrl()}/api/v4/projects/${project}/jobs/${job}/artifacts`;
  if ('report_type' in target) {
    return `${artifacts}?file_type=${encodeURIComponent(target.report_type)}`;
  }
  return `${artifacts}/${encodeArtifactPath(target.artifact_path)}`;
}

/**
 * Request the file, or only `bytes=first-last` of it, following GitLab's redirects to
 * object storage without forwarding credentials there.
 */
export async function artifactResponse(
  url: string,
  range?: readonly [first: number, last: number],
) {
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
        ...(range && { Range: `bytes=${range[0]}-${range[1]}` }),
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

/**
 * The report's own bytes from a download that started at its first byte, as a response the
 * window reader takes. The download's headers describe the stored file, not the report.
 */
export async function reportResponse(response: Response): Promise<Response> {
  if (!response.body) throw new Error('Artifact response has no readable body');
  return new Response(await reportBytes(response.body));
}

/** Read only the requested artifact file, retaining bytes for one UTF-8 window. */
export async function readArtifactFile(input: ArtifactInput) {
  const { byte_offset, byte_limit } = input;
  const target = artifactTarget(input);
  // A report is read from its first byte and decoded, unless its stored bytes are the
  // report itself; an archive entry is always a byte range of the entry.
  const whole = 'report_type' in target && !reportRangeReadable(target.report_type, byte_offset);
  const { response, external } = await artifactResponse(
    artifactFileUrl(target),
    whole ? undefined : [byte_offset, byte_offset + byte_limit + 3],
  );
  // The decoded report holds the download's reader, so it is the one to release.
  let source = response;
  try {
    assertDownloadStatus(response, external, target, 'artifact_file');
    if (whole) source = await reportResponse(response);
    return { ...target, ...(await readArtifactWindow(source, byte_offset, byte_limit)) };
  } catch (error) {
    if (error instanceof ArtifactReadError) await discardUnreadBody(source);
    throw await artifactFailure(error, target, 'artifact_file');
  } finally {
    await discardUnreadBody(source);
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
    viewUrl =
      'report_type' in target
        ? reportViewUrl(metadata.web_url, target.report_type)
        : artifactViewUrl(metadata.web_url, encodeArtifactPath(target.artifact_path));
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
  // GitLab answers alike for a job it hides and a report the job does not have.
  const missingReport =
    response.status === 404 && 'report_type' in target
      ? ` - no ${target.report_type} report artifact for job ${target.job_id}: the job did not upload one, it expired, or the job is not accessible`
      : '';
  throw new GitLabApiError(
    response.status,
    '',
    `GitLab API error: ${response.status} ${response.statusText}${missingReport}`,
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
    ...target,
    max_window_bytes: ARTIFACT_MAX_BYTES,
    max_prefix_bytes: ARTIFACT_MAX_OFFSET,
    ...details,
  });
}
