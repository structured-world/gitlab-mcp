import { Readable, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { ArtifactReadError } from './artifact-window';

/** First GitLab release whose artifacts download takes a report type (`file_type`). */
export const REPORT_TYPE_MIN_VERSION = '19.4';

/**
 * Report artifacts GitLab stores as their own file and serves by type. `lsif` is left out:
 * it is a zip, never text.
 */
export const REPORT_TYPES = [
  'junit',
  'cobertura',
  'jacoco',
  'codequality',
  'sast',
  'secret_detection',
  'dependency_scanning',
  'container_scanning',
  'cluster_image_scanning',
  'dast',
  'api_fuzzing',
  'sarif',
  'license_scanning',
  'cyclonedx',
  'accessibility',
  'performance',
  'browser_performance',
  'load_performance',
  'metrics',
  'dotenv',
  'requirements',
  'requirements_v2',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/**
 * Types GitLab stores uncompressed, so a byte range of the stored file is a byte range of the
 * report and a window past the start can be requested directly. Every other type is read
 * from its first byte, which is the only way into a gzip file. A type listed here that a
 * later GitLab compresses reads as binary past offset 0 and is refused, never returned.
 */
const STORED_UNCOMPRESSED: ReadonlySet<string> = new Set<ReportType>([
  'codequality',
  'sast',
  'secret_detection',
  'dependency_scanning',
  'container_scanning',
  'cluster_image_scanning',
  'dast',
  'api_fuzzing',
  'sarif',
  'license_scanning',
  'accessibility',
  'performance',
  'browser_performance',
  'load_performance',
  'requirements',
  'requirements_v2',
]);

/** Whether a window starting at `offset` can be requested as a byte range of the stored file. */
export function reportRangeReadable(reportType: string, offset: number): boolean {
  return offset > 0 && STORED_UNCOMPRESSED.has(reportType);
}

/**
 * The report's own bytes from a download that starts at its first byte: gzip is inflated
 * as it is read, anything else passes through. The format is taken from the content, since
 * object storage answers with its own headers. Nothing is inflated ahead of the reader, so
 * a small download cannot expand past what the caller's limits let it read.
 */
export async function reportBytes(
  body: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  // A format signature can arrive split across chunks.
  while (size < 4 && !ended) {
    const { value, done } = await reader.read();
    if (done) ended = true;
    else if (value.byteLength > 0) {
      head.push(value);
      size += value.byteLength;
    }
  }
  const first = head.length === 1 ? head[0] : Buffer.concat(head);
  // A report is never a zip: this is the artifacts archive, from an instance that ignored
  // the report type.
  if (first[0] === 0x50 && first[1] === 0x4b && first[2] === 0x03 && first[3] === 0x04) {
    await reader.cancel();
    throw new ArtifactReadError(
      'report_type_unsupported',
      `GitLab returned the artifacts archive instead of the report; reading a report by type requires GitLab ${REPORT_TYPE_MIN_VERSION}+`,
    );
  }
  const stored = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (first.byteLength > 0) controller.enqueue(first);
        if (ended) controller.close();
      },
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    },
    { highWaterMark: 0 },
  );
  // RFC 1952 section 2.3.1: a gzip member starts with the bytes 1f 8b.
  return first[0] === 0x1f && first[1] === 0x8b
    ? inflated(stored, (reason) => reader.cancel(reason))
    : stored;
}

/**
 * Inflate gzip members one after another, as the runner writes one per collected file.
 * `stop` ends the download when the reader abandons the report.
 */
function inflated(
  stored: ReadableStream<Uint8Array>,
  stop: (reason: unknown) => Promise<void>,
): ReadableStream<Uint8Array> {
  const gunzip = createGunzip();
  // The failure reaches the reader through the iterator below.
  pipeline(Readable.fromWeb(stored as never), gunzip, () => undefined);
  const chunks = gunzip[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await chunks.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(
            isZlibError(error)
              ? new ArtifactReadError(
                  'invalid_compression',
                  'Report artifact is not valid gzip data',
                )
              : error,
          );
        }
      },
      cancel(reason) {
        gunzip.destroy();
        // Stopped here, not left to the pipeline's teardown, so it is done when cancel returns.
        return stop(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/** zlib reports damaged or truncated input with a `Z_*` code (Z_DATA_ERROR, Z_BUF_ERROR). */
function isZlibError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return typeof error.code === 'string' && error.code.startsWith('Z_');
}
