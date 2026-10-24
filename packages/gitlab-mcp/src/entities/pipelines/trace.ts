// Bounds apply to source bytes. Decoding and the final response need bounded
// additional storage; neither retains a reference to a network chunk.
export const TRACE_PAGE_BYTES = 1024 * 1024;
export const TRACE_LINE_BYTES = 16 * 1024;

interface Line {
  begin: number;
  end: number;
  bytes: number;
}

interface ClippedLine {
  line: number;
  omittedPrefixBytes: number;
  omittedSuffixBytes: number;
}

export interface TracePage {
  lines: string[];
  totalLines: number;
  startLine: number;
  truncation?: {
    reason: 'byte_limits';
    maxLineBytes: number;
    maxPageBytes: number;
    lines: ClippedLine[];
  };
}

/** Decode a source interval without inventing characters at clipped UTF-8 edges. */
function decodeFragment(bytes: Buffer, prefixClipped: boolean, suffixClipped: boolean) {
  let begin = 0;
  let end = bytes.length;
  if (prefixClipped) {
    while (begin < end && (bytes[begin] & 0xc0) === 0x80) begin++;
  }
  if (suffixClipped && end > begin) {
    let lead = end - 1;
    while (lead > begin && (bytes[lead] & 0xc0) === 0x80) lead--;
    const byte = bytes[lead];
    const width =
      byte >= 0xc2 && byte <= 0xdf
        ? 2
        : byte >= 0xe0 && byte <= 0xef
          ? 3
          : byte >= 0xf0 && byte <= 0xf4
            ? 4
            : 1;
    if (end - lead < width) end = lead;
  }
  return {
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(begin, end)),
    skippedPrefix: begin,
    skippedSuffix: bytes.length - end,
  };
}

/**
 * Scan through EOF for exact line totals. A byte ring bounds retained content,
 * and a line ring bounds bookkeeping even for an arbitrarily large negative start.
 */
export async function readTracePage(
  body: ReadableStream<Uint8Array> | null,
  perPage: number,
  start?: number,
): Promise<TracePage> {
  if (!body) throw new Error('GitLab trace response has no readable body');
  const tail = start === undefined || start < 0;
  const capacity = start !== undefined && start < 0 ? Math.min(perPage, -start) : perPage;
  const storage = Buffer.allocUnsafe(TRACE_PAGE_BYTES);
  const records: Line[] = new Array(capacity);
  let written = 0;
  let lineNumber = 0;
  let lineBegin = 0;
  let lineBytes = 0;
  let captured = 0;

  function selected() {
    return tail || (lineNumber >= start! && lineNumber - start! < perPage);
  }

  function finishLine() {
    if (selected()) {
      const slot = tail ? lineNumber % capacity : lineNumber - start!;
      // Reuse the line ring's entries instead of allocating for every source line.
      const record = records[slot];
      if (record) {
        record.begin = lineBegin;
        record.end = written;
        record.bytes = lineBytes;
      } else records[slot] = { begin: lineBegin, end: written, bytes: lineBytes };
    }
    lineNumber++;
    lineBegin = written;
    lineBytes = 0;
    captured = 0;
  }

  const reader = body.getReader();
  let completed = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // A view only: never copy an entire transport chunk, including a huge one.
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        const length = end - offset;
        if (selected()) {
          let keep = Math.min(length, TRACE_LINE_BYTES - captured);
          if (!tail) keep = Math.min(keep, TRACE_PAGE_BYTES - written);
          const at = written % TRACE_PAGE_BYTES;
          const first = Math.min(keep, TRACE_PAGE_BYTES - at);
          chunk.copy(storage, at, offset, offset + first);
          if (first < keep) chunk.copy(storage, 0, offset + first, offset + keep);
          written += keep;
          captured += keep;
        }
        lineBytes += length;
        if (newline !== -1) finishLine();
        offset = end + 1;
      }
    }
    // String.split('\n') counts one line for empty input and one after a final LF.
    finishLine();
    completed = true;
  } finally {
    try {
      if (!completed) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }

  const startLine = tail ? Math.max(0, lineNumber - capacity) : start!;
  const count = Math.max(0, Math.min(perPage, lineNumber - startLine));
  const lines: string[] = [];
  const clipped: ClippedLine[] = [];
  const earliest = tail ? Math.max(0, written - TRACE_PAGE_BYTES) : 0;
  for (let index = 0; index < count; index++) {
    const number = startLine + index;
    const record = records[tail ? number % capacity : index];
    const begin = Math.min(record.end, Math.max(record.begin, earliest));
    const length = record.end - begin;
    const at = begin % TRACE_PAGE_BYTES;
    const bytes =
      at + length <= TRACE_PAGE_BYTES
        ? storage.subarray(at, at + length)
        : Buffer.concat([
            storage.subarray(at),
            storage.subarray(0, length - (TRACE_PAGE_BYTES - at)),
          ]);
    const prefix = begin - record.begin;
    const suffix = record.bytes - (record.end - record.begin);
    const decoded = decodeFragment(bytes, prefix > 0, suffix > 0);
    // Response.text() removes just the initial UTF-8 BOM, not BOMs in later lines.
    lines.push(number === 0 && prefix === 0 ? decoded.text.replace(/^\uFEFF/, '') : decoded.text);
    const omittedPrefixBytes = prefix + decoded.skippedPrefix;
    const omittedSuffixBytes = suffix + decoded.skippedSuffix;
    if (omittedPrefixBytes || omittedSuffixBytes) {
      clipped.push({ line: number, omittedPrefixBytes, omittedSuffixBytes });
    }
  }
  return {
    lines,
    totalLines: lineNumber,
    startLine,
    ...(clipped.length
      ? {
          truncation: {
            reason: 'byte_limits' as const,
            maxLineBytes: TRACE_LINE_BYTES,
            maxPageBytes: TRACE_PAGE_BYTES,
            lines: clipped,
          },
        }
      : {}),
  };
}
