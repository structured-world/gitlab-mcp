import { enhancedFetch } from '../../utils/fetch';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';

/** The version of a file GitLab reports with its raw content (`lib/api/files.rb`, blob_data). */
export interface FileVersion {
  /** The last commit that changed the file at the ref read. */
  last_commit_id: string | null;
  blob_id: string | null;
  content_sha256: string | null;
}

/** A file read from a ref: its bytes, as GitLab stores them, and its version. */
export interface RepositoryFile extends FileVersion {
  bytes: Buffer;
  content_type: string;
}

/** A file larger than the caller allows; nothing past its headers was read. */
export class FileTooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`the file is ${size} bytes, over the ${limit}-byte limit`);
    this.name = 'FileTooLargeError';
  }
}

function header(response: Response, name: string): string | null {
  const value = response.headers.get(name);
  return value === null || value === '' ? null : value;
}

/**
 * Read a file's raw bytes at `ref` (the default branch when omitted or empty, as GitLab
 * rejects a blank ref) with the version GitLab
 * sends in its `X-Gitlab-*` headers. With `maxBytes`, a larger file is refused from its
 * reported size before its body is read.
 */
export async function readRepositoryFile(
  projectId: string,
  filePath: string,
  ref: string | undefined,
  maxBytes?: number,
): Promise<RepositoryFile> {
  const query = ref ? `?${new URLSearchParams({ ref }).toString()}` : '';
  const url = `${getGitLabBaseUrl()}/api/v4/projects/${normalizeProjectId(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw${query}`;
  const response = await enhancedFetch(url);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `GitLab API error: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`,
    );
  }
  if (maxBytes !== undefined) {
    const reported = Number(
      header(response, 'x-gitlab-size') ?? header(response, 'content-length'),
    );
    if (Number.isFinite(reported) && reported > maxBytes) {
      await response.body?.cancel();
      throw new FileTooLargeError(reported, maxBytes);
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  // A size header can be absent; the body read is then held to the limit itself.
  if (maxBytes !== undefined && bytes.byteLength > maxBytes)
    throw new FileTooLargeError(bytes.byteLength, maxBytes);
  return {
    bytes,
    content_type: header(response, 'content-type') ?? 'text/plain',
    last_commit_id: header(response, 'x-gitlab-last-commit-id'),
    blob_id: header(response, 'x-gitlab-blob-id'),
    content_sha256: header(response, 'x-gitlab-content-sha256'),
  };
}
