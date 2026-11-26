import { isUtf8 } from 'node:buffer';

/** Most lines one ranged read returns; a longer range is cut and continues from `next_line`. */
export const RANGE_MAX_LINES = 2000;
/** Most bytes of file text one ranged read returns, counted as stored (UTF-8). */
export const RANGE_MAX_BYTES = 64 * 1024;

const NEWLINE = 0x0a;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** A ranged read of a file that is not UTF-8 text, which has no lines to select. */
export class NotTextError extends Error {
  constructor() {
    super('the file is not valid UTF-8 text, so it has no lines to select; read it whole');
    this.name = 'NotTextError';
  }
}

export interface LineSelection {
  /** The selected lines as stored, each with its own line ending. */
  content: string;
  /** Line number of the first selected line, counted from 1. */
  start_line: number;
  /** Line number of the last selected line; null when nothing was selected. */
  end_line: number | null;
  total_lines: number;
  /** Line to read next; null when the selection reached the end of the file. */
  next_line: number | null;
  /** The selection stopped before the requested end at the line or byte cap. */
  truncated?: true;
  /** The only selected line is longer than the byte cap and was cut to it. */
  line_cut?: true;
}

/** Start of the UTF-8 character that contains byte `index`. */
function charStart(bytes: Buffer, index: number): number {
  let at = index;
  while (at > 0 && (bytes[at] & 0xc0) === 0x80) at--;
  return at;
}

/**
 * Select lines `start`..`end` (1-based, inclusive; `end` omitted reads to the end of the file)
 * of a file's bytes, as Git stores them: a line ends after `\n`, so `\r\n` stays in the text, and
 * a last line without a newline gets none. The selection is cut at the line and byte caps.
 */
export function selectLines(bytes: Buffer, start: number, end?: number): LineSelection {
  if (!isUtf8(bytes)) throw new NotTextError();
  const lastWanted = Math.min(end ?? Number.POSITIVE_INFINITY, start + RANGE_MAX_LINES - 1);
  let firstByte = -1;
  let lastByte = -1;
  let lastLine = 0;
  let stopped = false;
  let cut = false;
  let line = 0;
  // A newline byte never occurs inside a multibyte UTF-8 character, so lines are found on the
  // bytes without decoding the whole file.
  for (let at = 0; at < bytes.length;) {
    const newline = bytes.indexOf(NEWLINE, at);
    const next = newline === -1 ? bytes.length : newline + 1;
    line++;
    if (line === start) firstByte = at;
    if (!stopped && line >= start && line <= lastWanted) {
      if (next - firstByte <= RANGE_MAX_BYTES) {
        lastByte = next;
        lastLine = line;
      } else {
        if (lastLine === 0) {
          lastByte = charStart(bytes, firstByte + RANGE_MAX_BYTES);
          lastLine = line;
          cut = true;
        }
        stopped = true;
      }
    }
    at = next;
  }

  const total = line;
  if (lastLine === 0)
    return { content: '', start_line: start, end_line: null, total_lines: total, next_line: null };
  let from = firstByte;
  // A whole read drops a leading byte order mark, so line 1 does too.
  if (from === 0 && bytes.subarray(0, BOM.length).equals(BOM)) from = BOM.length;
  const content = bytes.toString('utf8', from, lastByte);
  const requestedLast = Math.min(end ?? total, total);
  return {
    content,
    start_line: start,
    end_line: lastLine,
    total_lines: total,
    next_line: lastLine < total ? lastLine + 1 : null,
    ...((cut || lastLine < requestedLast) && { truncated: true }),
    ...(cut && { line_cut: true }),
  };
}
