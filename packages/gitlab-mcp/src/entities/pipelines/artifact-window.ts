import { ARTIFACT_MAX_BYTES, ARTIFACT_MAX_OFFSET } from './artifact-path';

export class ArtifactReadError extends Error {
  constructor(
    readonly reason:
      'not_text' | 'invalid_offset' | 'window_limit' | 'unsupported_encoding' | 'invalid_range',
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactReadError';
  }
}

export interface ArtifactWindow {
  text: string;
  byte_start: number;
  byte_end: number;
  next_byte_offset: number | null;
  total_bytes: number | null;
  complete: boolean;
  truncated: boolean;
  continuation_limit?: { reason: 'byte_offset_limit'; max_byte_offset: number };
}

/** Retain one window and four lookahead bytes, never the discarded prefix. */
export async function readArtifactWindow(
  response: Response,
  offset: number,
  limit: number,
): Promise<ArtifactWindow> {
  validateWindow(response, offset, limit);
  if (response.status === 416) return unsatisfiedWindow(response, offset);
  const { bytes, range, eof } = await readBoundedBody(response, offset, limit);
  const { text, end } = decodeWindow(bytes, limit, eof);
  let total: number | null = null;
  if (range) total = range.total;
  else if (eof) total = offset + bytes.length;
  const complete = range ? total !== null && offset + end === total : eof && end === bytes.length;
  const continuationLimited = !complete && offset + end > ARTIFACT_MAX_OFFSET;
  return {
    text,
    byte_start: offset,
    byte_end: offset + end,
    next_byte_offset: complete || continuationLimited ? null : offset + end,
    total_bytes: total,
    complete,
    truncated: !complete,
    ...(continuationLimited && {
      continuation_limit: {
        reason: 'byte_offset_limit' as const,
        max_byte_offset: ARTIFACT_MAX_OFFSET,
      },
    }),
  };
}

function unsatisfiedWindow(response: Response, offset: number): ArtifactWindow {
  // RFC 9110 section 14.4: a 416 Content-Range reports the selected representation's size.
  // https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4
  const match = response.headers.get('content-range')?.match(/^bytes \*\/(\d+)$/i);
  const total = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(total) || offset < total) {
    throw new ArtifactReadError(
      'invalid_range',
      'Artifact server returned an invalid unsatisfied Content-Range',
    );
  }
  if (offset > total) {
    throw new ArtifactReadError(
      'invalid_offset',
      'Artifact byte_offset is beyond the end of the file',
    );
  }
  return {
    text: '',
    byte_start: offset,
    byte_end: offset,
    next_byte_offset: null,
    total_bytes: total,
    complete: true,
    truncated: false,
  };
}

function validateWindow(response: Response, offset: number, limit: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > ARTIFACT_MAX_OFFSET ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > ARTIFACT_MAX_BYTES
  ) {
    throw new ArtifactReadError(
      'window_limit',
      'Artifact window exceeds the supported byte limits',
    );
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    throw new ArtifactReadError(
      'unsupported_encoding',
      'Artifact server returned an unsupported content encoding despite Accept-Encoding: identity',
    );
  }
  const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (
    (mime && /^(image|audio|video)\//.test(mime)) ||
    mime === 'application/pdf' ||
    mime === 'application/zip' ||
    mime === 'application/gzip'
  ) {
    throw new ArtifactReadError('not_text', 'Artifact is binary and cannot be returned as text');
  }
}

async function readBoundedBody(response: Response, offset: number, limit: number) {
  const range =
    response.status === 206
      ? readRange(response.headers.get('content-range'), offset, limit)
      : null;
  if (!response.body) throw new Error('Artifact response has no readable body');
  const reader = response.body.getReader();
  const storage = Buffer.allocUnsafe(limit + 4);
  let skipped = range ? 0 : offset;
  let count = 0;
  let consumed = 0;
  let eof = false;
  try {
    while (count < storage.length) {
      const { value, done } = await reader.read();
      if (done) {
        eof = true;
        break;
      }
      consumed += value.byteLength;
      if (range && consumed > range.length)
        throw new ArtifactReadError('invalid_range', 'Artifact response exceeds Content-Range');
      const skip = Math.min(skipped, value.byteLength);
      skipped -= skip;
      const keep = Math.min(value.byteLength - skip, storage.length - count);
      storage.set(value.subarray(skip, skip + keep), count);
      count += keep;
    }
    if (eof && range && consumed !== range.length)
      throw new ArtifactReadError(
        'invalid_range',
        'Artifact response is shorter than Content-Range',
      );
    if (skipped > 0)
      throw new ArtifactReadError(
        'invalid_offset',
        'Artifact byte_offset is beyond the end of the file',
      );
    return { bytes: storage.subarray(0, count), range, eof };
  } finally {
    try {
      if (!eof) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function decodeWindow(bytes: Uint8Array, limit: number, eof: boolean) {
  // Lookahead establishes continuation; only this window determines its text classification.
  for (let index = 0; index < Math.min(limit, bytes.length); index++) {
    const byte = bytes[index];
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13 && byte !== 27) {
      throw new ArtifactReadError('not_text', 'Artifact is binary and cannot be returned as text');
    }
  }
  if (bytes.length && (bytes[0] & 0xc0) === 0x80)
    throw new ArtifactReadError(
      'invalid_offset',
      'Artifact byte_offset must start on a UTF-8 character boundary',
    );
  const end = utf8End(bytes, Math.min(limit, bytes.length), eof);
  if (end === 0 && bytes.length > 0)
    throw new ArtifactReadError(
      'window_limit',
      'Artifact byte_limit is too small for the next UTF-8 character; request at least 4 bytes',
    );
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, end),
      ),
      end,
    };
  } catch {
    throw new ArtifactReadError('not_text', 'Artifact is not valid UTF-8 text');
  }
}

function utf8End(bytes: Uint8Array, end: number, eof: boolean): number {
  if (end === 0) return 0;
  let lead = end - 1;
  while (lead > 0 && (bytes[lead] & 0xc0) === 0x80) lead--;
  const byte = bytes[lead];
  const width = utf8Width(byte);
  if (end - lead < width && !(eof && end === bytes.length)) return lead;
  return end;
}

function utf8Width(byte: number): number {
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 1;
}

function readRange(value: string | null, offset: number, limit: number) {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match)
    throw new ArtifactReadError('invalid_range', 'Artifact server returned invalid Content-Range');
  const start = Number(match[1]),
    end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start !== offset ||
    end < start ||
    end > offset + limit + 3 ||
    (total !== null && (!Number.isSafeInteger(total) || total <= end))
  ) {
    throw new ArtifactReadError(
      'invalid_range',
      'Artifact server returned a mismatched Content-Range',
    );
  }
  return { length: end - start + 1, total };
}
