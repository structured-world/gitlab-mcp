import { TRACE_LINE_BYTES } from './trace';

export const ESC = 0x1b;
export const SECTION_PREFIX = Buffer.from('section_', 'latin1');
const SECTION_START = Buffer.from('start', 'latin1');
const SECTION_END = Buffer.from('end', 'latin1');
const SECTION_SUFFIX = Buffer.from('\r\x1b[0K', 'latin1');

/** Returned by a token parser whose input ended before the token was decided. */
export const NEEDS_MORE = -2;

export const isDigit = (byte: number) => byte >= 0x30 && byte <= 0x39;
const isWord = (byte: number) =>
  isDigit(byte) ||
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  byte === 0x5f;
const isNameByte = (byte: number) => isWord(byte) || byte === 0x2e || byte === 0x2d;

/** 1 when `prefix` is at `at`, 0 when it is not, NEEDS_MORE when the input ends inside it. */
function prefixAt(src: Uint8Array, at: number, end: number, prefix: Uint8Array): number {
  const length = Math.min(prefix.length, end - at);
  for (let index = 0; index < length; index++) if (src[at + index] !== prefix[index]) return 0;
  return length === prefix.length ? 1 : NEEDS_MORE;
}

/** End of the run of `\w` bytes at `at`. */
function wordEnd(src: Uint8Array, at: number, end: number): number {
  while (at < end && isWord(src[at])) at++;
  return at;
}

/** End of a section options block `[\w+=\w+(, ?\w+=\w+)*]` starting at `[`, -1 or NEEDS_MORE. */
function sectionOptionsEnd(src: Uint8Array, start: number, end: number): number {
  let at = start + 1;
  for (;;) {
    const keyEnd = wordEnd(src, at, end);
    if (keyEnd >= end) return NEEDS_MORE;
    if (keyEnd === at || src[keyEnd] !== 0x3d) return -1;
    at = wordEnd(src, keyEnd + 1, end);
    if (at >= end) return NEEDS_MORE;
    if (at === keyEnd + 1) return -1;
    if (src[at] === 0x5d) return at + 1;
    if (src[at] !== 0x2c) return -1;
    if (at + 1 >= end) return NEEDS_MORE;
    at += src[at + 1] === 0x20 ? 2 : 1;
  }
}

/**
 * Parts of the marker sectionMarkerEnd last accepted, as offsets into its input: valid until
 * those bytes are moved.
 */
export const parsedMarker = {
  isStart: false,
  stamp: 0,
  stampEnd: 0,
  name: 0,
  nameEnd: 0,
  options: -1,
  optionsEnd: -1,
};

/**
 * End of a GitLab section marker at `start`; -1 when there is none, NEEDS_MORE when the input
 * ends before that is decided. Grammar from Gitlab::Regex build_trace_section_regex:
 * section_(start|end):\d+:[A-Za-z0-9_.-]+(\[\w+=\w+(, ?\w+=\w+)*\])?\r\e\[0K.
 */
export function sectionMarkerEnd(src: Uint8Array, start: number, end: number): number {
  const prefix = prefixAt(src, start, end, SECTION_PREFIX);
  if (prefix !== 1) return prefix === 0 ? -1 : NEEDS_MORE;
  let at = start + SECTION_PREFIX.length;
  let isStart = true;
  const opens = prefixAt(src, at, end, SECTION_START);
  if (opens === 1) at += SECTION_START.length;
  else {
    const closes = prefixAt(src, at, end, SECTION_END);
    if (closes !== 1) return opens === NEEDS_MORE || closes === NEEDS_MORE ? NEEDS_MORE : -1;
    at += SECTION_END.length;
    isStart = false;
  }
  if (at >= end) return NEEDS_MORE;
  if (src[at++] !== 0x3a) return -1;
  const digits = at;
  while (at < end && isDigit(src[at])) at++;
  if (at >= end) return NEEDS_MORE;
  if (at === digits || src[at] !== 0x3a) return -1;
  const digitsEnd = at++;
  const name = at;
  while (at < end && isNameByte(src[at])) at++;
  if (at >= end) return NEEDS_MORE;
  if (at === name) return -1;
  const nameEnd = at;
  let options = -1;
  if (src[at] === 0x5b) {
    options = at;
    at = sectionOptionsEnd(src, at, end);
    if (at < 0) return at;
  }
  const suffix = prefixAt(src, at, end, SECTION_SUFFIX);
  if (suffix !== 1) return suffix === 0 ? -1 : NEEDS_MORE;
  parsedMarker.isStart = isStart;
  parsedMarker.stamp = digits;
  parsedMarker.stampEnd = digitsEnd;
  parsedMarker.name = name;
  parsedMarker.nameEnd = nameEnd;
  parsedMarker.options = options;
  parsedMarker.optionsEnd = options === -1 ? -1 : at;
  return at + SECTION_SUFFIX.length;
}

/**
 * End of the escape sequence at `start` per GitLab's ansi2json token `\e([@-_])(.*?)([@-~])`;
 * -1 when the ESC starts none and is text, NEEDS_MORE when the input ends inside it.
 */
function escapeEnd(src: Uint8Array, start: number, end: number): number {
  if (start + 1 >= end) return NEEDS_MORE;
  if (src[start + 1] < 0x40 || src[start + 1] > 0x5f) return -1;
  let at = start + 2;
  while (at < end && (src[at] < 0x40 || src[at] > 0x7e)) at++;
  return at >= end ? NEEDS_MORE : at + 1;
}

/** A section marker, or a point where markers could not be read, on physical line `line`. */
export type TailEvent =
  | { line: number; kind: 'start'; stamp: number; name: string; options: string | null }
  | { line: number; kind: 'end'; stamp: number; name: string }
  | { line: number; kind: 'unread' };

/** Events one logical line's dropped tails may queue before the rest count as unread. */
export const MAX_TAIL_EVENTS = 256;
// Longest marker a tail can hold while its bytes arrive; any name a line keeps fits.
const HELD_BYTES = TRACE_LINE_BYTES;

// Escape state at the scan point of a dropped tail.
const TEXT = 0;
const AFTER_ESC = 1;
const IN_ESCAPE = 2;

/**
 * Finds the section markers in the bytes a stored line drops past its 16 KiB limit, which
 * GitLab still applies. Escapes and markers are tokenized as the renderer does, from the
 * line's kept bytes on, so a token crossing the limit or a chunk boundary is still one token.
 * Each marker is queued with its physical line, for the scanner to apply in log order.
 */
export class MarkerTail {
  readonly events: TailEvent[] = [];
  private line = 0;
  private escape = TEXT;
  private held: Buffer | undefined;
  private heldLength = 0;
  // A line whose markers are past the queue's room only reports that once.
  private unread = false;

  /** Starts the tail of line `line` after its kept bytes `src[start, end)`. */
  begin(line: number, src: Buffer, start: number, end: number): void {
    this.line = line;
    this.escape = TEXT;
    this.heldLength = 0;
    this.unread = false;
    // The renderer applies the markers the kept bytes hold; only their final state counts.
    this.scan(src, start, end, false);
  }

  /** Scans the next dropped bytes `src[from, to)` of the line. */
  feed(src: Buffer, from: number, to: number): void {
    let at = from;
    while (this.heldLength > 0 && at < to) {
      const held = this.held as Buffer;
      const added = src.copy(
        held,
        this.heldLength,
        at,
        Math.min(to, at + HELD_BYTES - this.heldLength),
      );
      const size = this.heldLength + added;
      const end = sectionMarkerEnd(held, 0, size);
      if (end >= 0) {
        this.record(held);
        at += end - this.heldLength;
        this.heldLength = 0;
      } else if (end === NEEDS_MORE) {
        if (size < HELD_BYTES) {
          this.heldLength = size;
          return;
        }
        // Longer than any name a kept line can carry: GitLab would still read it.
        this.markUnread();
        this.heldLength = 0;
        at += added;
      } else {
        // Not a marker: its first byte is text, and the bytes after it are scanned again.
        const again = Buffer.from(held.subarray(1, this.heldLength));
        this.heldLength = 0;
        this.scan(again, 0, again.length, true);
      }
    }
    if (at < to) this.scan(src, at, to, true);
  }

  /** Ends the line: a marker still cut off could only continue in a joined fragment. */
  finish(): void {
    if (this.heldLength > 0) this.markUnread();
    this.heldLength = 0;
  }

  private scan(src: Buffer, from: number, to: number, record: boolean): void {
    let at = this.resumeEscape(src, from, to);
    if (at === -1) return;
    const view = src.subarray(0, to);
    let esc = view.indexOf(ESC, at);
    let section = view.indexOf(SECTION_PREFIX, at);
    for (;;) {
      if (esc !== -1 && esc < at) esc = view.indexOf(ESC, at);
      if (section !== -1 && section < at) section = view.indexOf(SECTION_PREFIX, at);
      if (esc === -1 && section === -1) break;
      if (esc !== -1 && (section === -1 || esc < section)) {
        const end = escapeEnd(src, esc, to);
        if (end === NEEDS_MORE) {
          this.escape = esc === to - 1 ? AFTER_ESC : IN_ESCAPE;
          return;
        }
        at = end === -1 ? esc + 1 : end;
        continue;
      }
      const end = sectionMarkerEnd(src, section, to);
      if (end === NEEDS_MORE) {
        this.hold(src, section, to);
        return;
      }
      if (end >= 0 && record) this.record(src);
      at = end >= 0 ? end : section + 1;
    }
    // A marker prefix cut off by the end of these bytes.
    for (let start = Math.max(at, to - SECTION_PREFIX.length + 1); start < to; start++) {
      if (sectionMarkerEnd(src, start, to) === NEEDS_MORE) {
        this.hold(src, start, to);
        return;
      }
    }
  }

  /** Finishes an escape sequence the previous bytes left open; -1 when it is still open. */
  private resumeEscape(src: Buffer, from: number, to: number): number {
    let at = from;
    if (this.escape === AFTER_ESC && at < to) {
      // An ESC that starts no sequence is text, and the byte after it is scanned normally.
      if (src[at] >= 0x40 && src[at] <= 0x5f) {
        this.escape = IN_ESCAPE;
        at++;
      } else this.escape = TEXT;
    }
    if (this.escape === IN_ESCAPE) {
      while (at < to && (src[at] < 0x40 || src[at] > 0x7e)) at++;
      if (at === to) return -1;
      this.escape = TEXT;
      at++;
    }
    return this.escape === AFTER_ESC ? -1 : at;
  }

  private hold(src: Buffer, from: number, to: number): void {
    this.held ??= Buffer.allocUnsafe(HELD_BYTES);
    this.heldLength = src.copy(this.held, 0, from, to);
  }

  private record(src: Buffer): void {
    if (this.unread) return;
    if (this.events.length >= MAX_TAIL_EVENTS) {
      this.markUnread();
      return;
    }
    const stamp = Number(src.toString('latin1', parsedMarker.stamp, parsedMarker.stampEnd));
    const name = src.toString('latin1', parsedMarker.name, parsedMarker.nameEnd);
    if (!parsedMarker.isStart) {
      this.events.push({ line: this.line, kind: 'end', stamp, name });
      return;
    }
    const options =
      parsedMarker.options === -1
        ? null
        : src.toString('latin1', parsedMarker.options, parsedMarker.optionsEnd);
    this.events.push({ line: this.line, kind: 'start', stamp, name, options });
  }

  private markUnread(): void {
    if (this.unread) return;
    this.unread = true;
    this.events.push({ line: this.line, kind: 'unread' });
  }
}
