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

// A newline byte never occurs inside a multibyte UTF-8 character, so lines are found on the
// bytes without decoding the whole file.

/** Offset just past the line that starts at byte `at`: after its `\n`, or the end of the file. */
function lineEnd(bytes: Buffer, at: number): number {
  const newline = bytes.indexOf(NEWLINE, at);
  return newline === -1 ? bytes.length : newline + 1;
}

/** Skip up to `count` lines from the start; `lines` is fewer than `count` when the file ends first. */
function skipLines(bytes: Buffer, count: number): { at: number; lines: number } {
  let at = 0;
  let lines = 0;
  while (lines < count && at < bytes.length) {
    at = lineEnd(bytes, at);
    lines++;
  }
  return { at, lines };
}

/** Number of lines from byte `from` to the end of the file. */
function countLines(bytes: Buffer, from: number): number {
  let lines = 0;
  for (let at = from; at < bytes.length; at = lineEnd(bytes, at)) lines++;
  return lines;
}

interface Taken {
  /** Offset just past the selected text. */
  lastByte: number;
  lastLine: number;
  /** Offset of the first line not yet counted. */
  rest: number;
  cut: boolean;
}

/**
 * Take whole lines from `firstLine` (starting at byte `from`) up to `lastWanted` while they fit
 * the byte cap; a first line longer than the cap is cut to it on a character boundary.
 */
function takeLines(bytes: Buffer, from: number, firstLine: number, lastWanted: number): Taken {
  let at = from;
  let line = firstLine - 1;
  while (at < bytes.length && line < lastWanted) {
    const next = lineEnd(bytes, at);
    if (next - from > RANGE_MAX_BYTES) {
      if (line >= firstLine) break;
      const lastByte = charStart(bytes, from + RANGE_MAX_BYTES);
      return { lastByte, lastLine: firstLine, rest: next, cut: true };
    }
    line++;
    at = next;
  }
  return { lastByte: at, lastLine: line, rest: at, cut: false };
}

/**
 * Select lines `start`..`end` (1-based, inclusive; `end` omitted reads to the end of the file)
 * of a file's bytes, as Git stores them: a line ends after `\n`, so `\r\n` stays in the text, and
 * a last line without a newline gets none. The selection is cut at the line and byte caps.
 */
export function selectLines(bytes: Buffer, start: number, end?: number): LineSelection {
  if (!isUtf8(bytes)) throw new NotTextError();
  const skipped = skipLines(bytes, start - 1);
  if (skipped.at >= bytes.length) {
    const total = skipped.lines;
    return { content: '', start_line: start, end_line: null, total_lines: total, next_line: null };
  }

  const lastWanted = Math.min(end ?? Number.POSITIVE_INFINITY, start + RANGE_MAX_LINES - 1);
  const taken = takeLines(bytes, skipped.at, start, lastWanted);
  const total = taken.lastLine + countLines(bytes, taken.rest);
  // A whole read drops a leading byte order mark, so line 1 does too.
  const hasBom = skipped.at === 0 && bytes.subarray(0, BOM.length).equals(BOM);
  const from = hasBom ? BOM.length : skipped.at;
  const requestedLast = Math.min(end ?? total, total);
  return {
    content: bytes.toString('utf8', from, taken.lastByte),
    start_line: start,
    end_line: taken.lastLine,
    total_lines: total,
    next_line: taken.lastLine < total ? taken.lastLine + 1 : null,
    ...((taken.cut || taken.lastLine < requestedLast) && { truncated: true }),
    ...(taken.cut && { line_cut: true }),
  };
}
