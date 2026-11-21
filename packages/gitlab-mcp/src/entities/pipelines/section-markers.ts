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

// https://gitlab.com/gitlab-org/gitlab lib/gitlab/ci/trace/stream.rb TIMESTAMP_HEADER_*:
// "<RFC3339 UTC, 6 fractional digits> <2 hex stream><E|O><+| >", 27 + 5 bytes. A '+' in
// the last byte continues the previous line (lib/gitlab/ci/ansi2json/converter.rb).
export const TIMESTAMP_BYTES = 27;
export const TIMESTAMP_HEADER_BYTES = 32;
const CONTINUATION = 0x2b;
const TIMESTAMP_DIGITS = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22, 23, 24, 25];
const isLowerHex = (byte: number) => isDigit(byte) || (byte >= 0x61 && byte <= 0x66);

/** Whether a runner timestamp header starts at `at`; the caller ensures 32 bytes are there. */
export function isTimestampHeader(src: Uint8Array, at: number): boolean {
  for (const offset of TIMESTAMP_DIGITS) if (!isDigit(src[at + offset])) return false;
  return (
    src[at + 4] === 0x2d &&
    src[at + 7] === 0x2d &&
    src[at + 10] === 0x54 &&
    src[at + 13] === 0x3a &&
    src[at + 16] === 0x3a &&
    src[at + 19] === 0x2e &&
    src[at + 26] === 0x5a &&
    src[at + 27] === 0x20 &&
    isLowerHex(src[at + 28]) &&
    isLowerHex(src[at + 29]) &&
    (src[at + 30] === 0x45 || src[at + 30] === 0x4f) &&
    (src[at + 31] === CONTINUATION || src[at + 31] === 0x20)
  );
}

/** Whether a source line carries a runner timestamp marking it a continuation. */
export function continuesLine(src: Uint8Array, begin: number, end: number): boolean {
  return (
    end - begin >= TIMESTAMP_HEADER_BYTES &&
    src[begin + TIMESTAMP_HEADER_BYTES - 1] === CONTINUATION &&
    isTimestampHeader(src, begin)
  );
}

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
export type MarkerEvent =
  | { line: number; kind: 'start'; stamp: number; name: string; options: string | null }
  | { line: number; kind: 'end'; stamp: number; name: string }
  | { line: number; kind: 'unread' };

/**
 * Kept text of a stored line, `[from, to)` as offsets after its timestamp header, that a
 * token GitLab reads across a clipped gap consumes; the renderer cannot see such a token.
 */
export interface HiddenSpan {
  line: number;
  from: number;
  to: number;
}

/** Markers one logical line may hold before the rest count as unread. */
export const MAX_LINE_MARKERS = 4096;
// Longest marker the stream can hold while its bytes arrive; any name a line keeps fits.
const HELD_BYTES = TRACE_LINE_BYTES;
// Lines one token may span before its bounds count as unread.
const MAX_TOKEN_LINES = 1024;
// A line's first bytes decide where its text starts: a byte order mark, then a timestamp.
const PROBE_BYTES = 3 + TIMESTAMP_HEADER_BYTES;

const TEXT = 0;
const AFTER_ESC = 1;
const IN_ESCAPE = 2;

/** A line a token in progress has passed: its text length and the part of it a line keeps. */
interface Extent {
  line: number;
  length: number;
  kept: number;
}

/** Where the bytes of a held marker candidate from `at` on came from. */
interface Segment {
  at: number;
  line: number;
  offset: number;
}

/**
 * Reads section markers from the whole trace as GitLab's log view does: every byte of every
 * line, past the 16 KiB a line keeps, with timestamped continuations joined after their
 * headers and state reset at any other line end. Escapes are tokens, so a marker an escape
 * swallows is none (raw scans find markers alone). This is the one source of section bounds.
 * Markers are queued with the physical line they start on; a token that crosses a clipped gap
 * reports the kept text it consumes, which the renderer cannot tell itself.
 */
export class MarkerStream {
  readonly events: MarkerEvent[] = [];
  readonly hidden: HiddenSpan[] = [];
  private readonly normalize: boolean;
  private line = 0;
  private readonly probe = Buffer.allocUnsafe(PROBE_BYTES);
  private probeLength = 0;
  private probing = true;
  // A line ended; whether the next one continues it is not known yet.
  private boundary = false;
  private endedLine = 0;
  private endedLength = 0;
  // Text bytes of the current line read so far, and how many of them the line keeps.
  private length = 0;
  private kept = TRACE_LINE_BYTES;
  private readonly extents: Extent[] = [];
  private escape = TEXT;
  private tokenLine = 0;
  private tokenOffset = 0;
  private held: Buffer | undefined;
  private heldLength = 0;
  private segments: Segment[] = [];
  private markers = 0;
  private unread = false;

  constructor(normalize: boolean) {
    this.normalize = normalize;
  }

  /** Reads the next bytes of the trace. */
  push(src: Buffer): void {
    let from = 0;
    while (from < src.length) {
      const newline = src.indexOf(10, from);
      const to = newline === -1 ? src.length : newline;
      this.piece(src, from, to);
      if (newline === -1) return;
      this.endLine();
      from = newline + 1;
    }
  }

  /** Ends the trace: whatever is still open at its last byte ends with it. */
  end(): void {
    if (this.probing) this.decide();
    this.closeLogical(this.line);
  }

  private piece(src: Buffer, from: number, to: number): void {
    let at = from;
    if (this.probing) {
      const taken = src.copy(
        this.probe,
        this.probeLength,
        at,
        Math.min(to, at + PROBE_BYTES - this.probeLength),
      );
      this.probeLength += taken;
      at += taken;
      if (this.probeLength < PROBE_BYTES) return;
      this.decide();
    }
    if (at < to) this.scan(src, at, to);
  }

  private endLine(): void {
    if (this.probing) this.decide();
    if (this.active()) {
      if (this.extents.length >= MAX_TOKEN_LINES) this.dropToken();
      else this.extents.push({ line: this.line, length: this.length, kept: this.kept });
    } else this.extents.length = 0;
    this.boundary = true;
    this.endedLine = this.line;
    this.endedLength = this.length;
    this.line++;
    this.probing = true;
    this.probeLength = 0;
    this.length = 0;
  }

  /** Decides where the line's text starts and whether it continues the previous line. */
  private decide(): void {
    let start = 0;
    let continues = false;
    if (this.normalize) {
      // Response.text() drops only the initial UTF-8 BOM, as the stored lines do.
      const probe = this.probe;
      if (this.line === 0 && this.probeLength >= 3 && probe[0] === 0xef)
        if (probe[1] === 0xbb && probe[2] === 0xbf) start = 3;
      if (this.probeLength - start >= TIMESTAMP_HEADER_BYTES && isTimestampHeader(probe, start)) {
        start += TIMESTAMP_HEADER_BYTES;
        continues = this.line > 0 && probe[start - 1] === CONTINUATION;
      }
    }
    if (this.boundary) {
      this.boundary = false;
      // GitLab joins a continuation to the line before it; any other line end ends tokens.
      if (!continues) this.closeLogical(this.endedLine, this.endedLength);
    }
    this.probing = false;
    this.kept = TRACE_LINE_BYTES - start;
    this.length = 0;
    if (start < this.probeLength) this.scan(this.probe, start, this.probeLength);
  }

  private active(): boolean {
    return this.heldLength > 0 || this.escape !== TEXT;
  }

  /**
   * Ends the logical line at `line` (its text `length` bytes long when it already ended): a
   * held candidate is text, so what follows its first byte is read again, and an open escape
   * runs to the line end, as GitLab's `\e(?:[@-_].*?)?$` takes it.
   */
  private closeLogical(line: number, length = this.length): void {
    while (this.active()) {
      if (this.heldLength > 0) this.reject();
      else {
        this.escape = TEXT;
        this.finishToken(this.tokenLine, this.tokenOffset, line, length);
      }
    }
    this.extents.length = 0;
    this.markers = 0;
    this.unread = false;
  }

  /** Reads text bytes `src[from, to)` of the current line. */
  private scan(src: Buffer, from: number, to: number): void {
    const base = this.length - from;
    let at = from;
    while (at !== -1) {
      if (this.heldLength > 0) at = this.extend(src, at, to, base, this.line);
      else if (this.escape !== TEXT) at = this.resumeEscape(src, at, to, base, this.line);
      else {
        this.tokens(src, at, to, base, this.line);
        at = -1;
      }
    }
    this.length += to - from;
  }

  /**
   * Finds escapes and markers in `src[at, to)` of line `line`, whose text offsets are
   * `base + index`; a token cut off by `to` is left in progress.
   */
  private tokens(src: Buffer, from: number, to: number, base: number, line: number): void {
    let at = from;
    const view = src.subarray(0, to);
    let esc = this.normalize ? view.indexOf(ESC, at) : -1;
    let section = view.indexOf(SECTION_PREFIX, at);
    for (;;) {
      if (esc !== -1 && esc < at) esc = view.indexOf(ESC, at);
      if (section !== -1 && section < at) section = view.indexOf(SECTION_PREFIX, at);
      if (esc === -1 && section === -1) break;
      if (esc !== -1 && (section === -1 || esc < section)) {
        const end = escapeEnd(src, esc, to);
        if (end === NEEDS_MORE) {
          this.escape = esc === to - 1 ? AFTER_ESC : IN_ESCAPE;
          this.tokenLine = line;
          this.tokenOffset = base + esc;
          return;
        }
        if (end !== -1) this.finishToken(line, base + esc, line, base + end);
        at = end === -1 ? esc + 1 : end;
        continue;
      }
      const end = sectionMarkerEnd(src, section, to);
      if (end === NEEDS_MORE) {
        this.hold(src, section, to, base, line);
        return;
      }
      if (end >= 0) this.accept(src, line, base + section, line, base + end);
      at = end >= 0 ? end : section + 1;
    }
    // A marker prefix cut off by the end of these bytes.
    for (let start = Math.max(at, to - SECTION_PREFIX.length + 1); start < to; start++) {
      if (sectionMarkerEnd(src, start, to) === NEEDS_MORE) {
        this.hold(src, start, to, base, line);
        return;
      }
    }
  }

  /** Finishes an escape sequence earlier bytes left open; -1 when it is still open. */
  private resumeEscape(src: Buffer, from: number, to: number, base: number, line: number): number {
    let at = from;
    if (this.escape === AFTER_ESC) {
      if (at === to) return -1;
      // An ESC that starts no sequence is text, and the byte after it is read normally.
      if (src[at] < 0x40 || src[at] > 0x5f) {
        this.escape = TEXT;
        return at;
      }
      this.escape = IN_ESCAPE;
      at++;
    }
    while (at < to && (src[at] < 0x40 || src[at] > 0x7e)) at++;
    if (at === to) return -1;
    this.escape = TEXT;
    this.finishToken(this.tokenLine, this.tokenOffset, line, base + at + 1);
    return at + 1;
  }

  private hold(src: Buffer, from: number, to: number, base: number, line: number): void {
    this.held ??= Buffer.allocUnsafe(HELD_BYTES);
    this.heldLength = src.copy(this.held, 0, from, to);
    this.segments = [{ at: 0, line, offset: base + from }];
    this.tokenLine = line;
    this.tokenOffset = base + from;
  }

  /**
   * Extends the held candidate with `src[from, to)` of line `line`; returns where reading
   * goes on, or -1 when all of it went into the candidate.
   */
  private extend(src: Buffer, from: number, to: number, base: number, line: number): number {
    const held = this.held as Buffer;
    const old = this.heldLength;
    const added = src.copy(held, old, from, Math.min(to, from + HELD_BYTES - old));
    if (added > 0 && this.segments[this.segments.length - 1].line !== line)
      this.segments.push({ at: old, line, offset: base + from });
    const size = old + added;
    const end = sectionMarkerEnd(held, 0, size);
    if (end >= 0) {
      this.heldLength = 0;
      const used = end - old;
      this.accept(held, this.tokenLine, this.tokenOffset, line, base + from + used);
      return from + used;
    }
    if (end === NEEDS_MORE) {
      if (size < HELD_BYTES) {
        this.heldLength = size;
        return -1;
      }
      // Longer than any name a kept line can carry: GitLab would still read it.
      this.markUnread(this.tokenLine);
      this.heldLength = 0;
      return from + added;
    }
    this.heldLength = old;
    this.reject();
    return from;
  }

  /** The held candidate is no marker: its first byte is text and the rest is read again. */
  private reject(): void {
    const again = Buffer.from((this.held as Buffer).subarray(1, this.heldLength));
    const segments = this.segments;
    this.heldLength = 0;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const from = Math.max(0, segment.at - 1);
      const to = index + 1 < segments.length ? segments[index + 1].at - 1 : again.length;
      const base = segment.offset - segment.at + 1;
      let at = from;
      while (at !== -1 && at < to) {
        if (this.heldLength > 0) at = this.extend(again, at, to, base, segment.line);
        else if (this.escape !== TEXT) at = this.resumeEscape(again, at, to, base, segment.line);
        else {
          this.tokens(again, at, to, base, segment.line);
          at = -1;
        }
      }
    }
  }

  private accept(
    src: Buffer,
    startLine: number,
    startOffset: number,
    endLine: number,
    endOffset: number,
  ): void {
    if (!this.unread) {
      if (this.markers < MAX_LINE_MARKERS) {
        this.markers++;
        this.events.push(this.parsed(src, startLine));
      } else this.markUnread(startLine);
    }
    this.finishToken(startLine, startOffset, endLine, endOffset);
  }

  /** Reports the kept text a finished token consumes when the renderer cannot see the token. */
  private finishToken(
    startLine: number,
    startOffset: number,
    endLine: number,
    endOffset: number,
  ): void {
    if (!this.normalize) return;
    if (startLine === endLine && endOffset <= this.keptOf(endLine)) return;
    let visible = startOffset < this.keptOf(startLine) && endOffset <= this.keptOf(endLine);
    for (let line = startLine; visible && line < endLine; line++)
      visible = this.lengthOf(line) <= this.keptOf(line);
    if (visible) return;
    for (let line = startLine; line <= endLine; line++) {
      const from = line === startLine ? startOffset : 0;
      const to = Math.min(line === endLine ? endOffset : this.lengthOf(line), this.keptOf(line));
      if (from < to) this.hidden.push({ line, from, to });
    }
  }

  private extent(line: number): Extent | undefined {
    return this.extents.find((extent) => extent.line === line);
  }

  private keptOf(line: number): number {
    return line === this.line ? this.kept : (this.extent(line)?.kept ?? TRACE_LINE_BYTES);
  }

  private lengthOf(line: number): number {
    return this.extent(line)?.length ?? 0;
  }

  /** A token spanning more lines than are followed: its end cannot be placed. */
  private dropToken(): void {
    this.markUnread(this.tokenLine);
    this.heldLength = 0;
    this.escape = TEXT;
    this.extents.length = 0;
  }

  /** The event of the marker sectionMarkerEnd just accepted in `src`. */
  private parsed(src: Buffer, line: number): MarkerEvent {
    const stamp = Number(src.toString('latin1', parsedMarker.stamp, parsedMarker.stampEnd));
    const name = src.toString('latin1', parsedMarker.name, parsedMarker.nameEnd);
    if (!parsedMarker.isStart) return { line, kind: 'end', stamp, name };
    const options =
      parsedMarker.options === -1
        ? null
        : src.toString('latin1', parsedMarker.options, parsedMarker.optionsEnd);
    return { line, kind: 'start', stamp, name, options };
  }

  private markUnread(line: number): void {
    if (this.unread) return;
    this.unread = true;
    this.events.push({ line, kind: 'unread' });
  }
}
