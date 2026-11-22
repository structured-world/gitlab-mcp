import { grepStream } from './line-grep-worker';
import type { LineGrepResult } from './line-grep';
import { TRACE_PAGE_BYTES } from './trace';
import { LOG_GREP_BUDGET_MS } from './pipeline-grep';
import { ARTIFACT_MAX_OFFSET } from './artifact-path';
import { ArtifactReadError, assertTextResponse, readRange } from './artifact-window';
import {
  artifactFailure,
  artifactFileUrl,
  artifactResponse,
  assertDownloadStatus,
  discardUnreadBody,
  type ArtifactTarget,
} from './artifact';
import type { BrowsePipelinesInput } from './schema-readonly';

/** Source bytes one search covers: the same reach as artifact_file's largest byte_offset. */
export const ARTIFACT_GREP_MAX_BYTES = ARTIFACT_MAX_OFFSET;

type ArtifactGrepInput = Extract<BrowsePipelinesInput, { action: 'artifact_grep' }>;

export type ArtifactGrepResult = ArtifactTarget & LineGrepResult;

/**
 * Search one artifact file as raw text lines. The file is requested once through the same
 * path as artifact_file and streamed through a search worker; binary or non-UTF-8 content
 * is refused as artifact_file refuses it.
 */
export async function grepArtifactFile(input: ArtifactGrepInput): Promise<ArtifactGrepResult> {
  const target: ArtifactTarget = {
    project_id: input.project_id,
    job_id: input.job_id,
    artifact_path: input.artifact_path,
  };
  // Assigned inside the open callback, which runs only once the patterns compiled.
  const download: { response?: Response } = {};
  try {
    const result = await grepStream(
      {
        patterns: input.patterns,
        before: input.before,
        after: input.after,
        maxMatches: input.max_matches,
        invert: input.invert ?? false,
        startLine: input.start_line ?? 0,
        normalize: false,
        budgetMs: LOG_GREP_BUDGET_MS,
        outputBytes: TRACE_PAGE_BYTES,
        byteOffsets: true,
        maxBytes: ARTIFACT_GREP_MAX_BYTES,
        requireText: true,
      },
      async () => {
        // One byte past the limit shows whether the file continues beyond it.
        const { response, external } = await artifactResponse(
          artifactFileUrl(target),
          0,
          ARTIFACT_GREP_MAX_BYTES,
        );
        download.response = response;
        assertDownloadStatus(response, external, target, 'artifact_grep');
        assertTextResponse(response);
        if (response.status === 416) return emptyFile(response);
        if (response.status !== 206) return response.body;
        const length = assertLeadingRange(response.headers.get('content-range'));
        return response.body && exactLength(response.body, length);
      },
    );
    return { ...target, ...result };
  } catch (error) {
    if (download.response && error instanceof ArtifactReadError)
      await discardUnreadBody(download.response);
    throw await artifactFailure(error, target, 'artifact_grep');
  } finally {
    if (download.response) await discardUnreadBody(download.response);
  }
}

/**
 * A range starting at byte 0 is unsatisfiable only for an empty file.
 * RFC 9110 section 14.4: a 416 Content-Range reports the representation's size.
 */
function emptyFile(response: Response): ReadableStream<Uint8Array> | null {
  const size = response.headers.get('content-range')?.match(/^bytes \*\/(\d+)$/i)?.[1];
  if (size !== '0')
    throw new ArtifactReadError(
      'invalid_range',
      'Artifact server returned an invalid unsatisfied Content-Range',
    );
  return new Response(new Uint8Array(0)).body;
}

/**
 * The partial response must start the file and reach as far as was asked or the file goes,
 * since bytes a shorter answer leaves out would go unsearched. RFC 9110 section 15.3.7
 * lets a server send less than the requested range; with an unknown total (`/*`) only the
 * full range shows how far the file goes. Returns the announced body length.
 */
export function assertLeadingRange(value: string | null): number {
  const { length, total } = readRange(value, 0, ARTIFACT_GREP_MAX_BYTES - 3);
  const requested = ARTIFACT_GREP_MAX_BYTES + 1;
  if (length < (total === null ? requested : Math.min(total, requested)))
    throw new ArtifactReadError(
      'invalid_range',
      'Artifact server returned less of the file than requested',
    );
  return length;
}

/**
 * The body must carry exactly the bytes its Content-Range announces (RFC 9110 section 14.4);
 * a body ending early would otherwise report a complete search of bytes never received.
 */
function exactLength(body: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > length)
          throw new ArtifactReadError('invalid_range', 'Artifact response exceeds Content-Range');
        controller.enqueue(chunk);
      },
      flush() {
        if (received < length)
          throw new ArtifactReadError(
            'invalid_range',
            'Artifact response is shorter than Content-Range',
          );
      },
    }),
  );
}
