import { performance } from 'node:perf_hooks';
import type { MessagePort } from 'node:worker_threads';
import { compilePatterns, type PatternMatcher } from '../../utils/re2-compile';
import { PatternError } from '../../utils/re2-pattern';
import { decodeFragment, TRACE_LINE_BYTES } from './trace';

/**
 * Common failure output of compilers, test runners, interpreters and the runner itself.
 * Each part stays specific enough to keep green logs quiet, and spells out its casings
 * instead of (?i) alternations: every part then has a required literal, so the joined
 * pattern gets a literal prefilter and most lines are rejected without an automaton.
 */
const FAILURE_PRESET: readonly string[] = [
  String.raw`\b(?:ERROR|FATAL|CRITICAL|FAIL|FAILED|FAILURE)\b`,
  String.raw`(?i:\berror)(?:\[[A-Z]*[0-9]+\])?:`,
  String.raw`\berror (?:TS|CS|C)[0-9]+\b`,
  String.raw`\bERR!`,
  String.raw`\b(?:panic|Panic|PANIC)(?:ked)?\b`,
  String.raw`^Traceback \(most recent call last\)`,
  String.raw`\b[A-Z][A-Za-z0-9]*(?:Exception|Error)\b`,
  String.raw`\b(?:exit|Exit|EXIT)(?:ed)?(?: with)? (?:code|status):? [1-9][0-9]*`,
  String.raw`\b(?:[Aa]ssertion|[Aa]ssert) failed\b`,
  String.raw`(?:[Ss]egmentation fault|core dumped|[Oo]ut of memory|OUT OF MEMORY|OOMKilled)`,
  String.raw`\bundefined reference to\b`,
  String.raw`\bmake(?:\[[0-9]+\])?: \*\*\*`,
];
const FAILURE_PATTERN = FAILURE_PRESET.map((part) => `(?:${part})`).join('|');

export interface LineGrepOptions {
  /** Caller RE2 patterns, at most `MAX_PATTERNS`. */
  patterns: readonly string[];
  /** Server-defined pattern group matched after the caller patterns. */
  preset?: 'failures';
  before: number;
  after: number;
  maxMatches: number;
  /** Select lines matching no pattern. */
  invert: boolean;
  /** First line considered for a match; earlier lines can only appear as context. */
  startLine: number;
  /** Apply GitLab trace rendering (timestamps, CR, ANSI, section markers) before matching. */
  normalize: boolean;
  /** Processing time after which the scan stops at a line boundary. */
  budgetMs: number;
}

export interface GrepMatch {
  line: number;
  /** Indexes of the matched patterns; the preset, when used, is `preset_index`. */
  patterns: readonly number[];
}

/** Consecutive source lines around one or more matches, like `grep -C`. */
export interface GrepHunk {
  start_line: number;
  lines: string[];
  matches: GrepMatch[];
  /** Runner timestamps per line, present only when the trace carries them. */
  timestamps?: Array<string | null>;
  /** Lines whose text lost bytes to the 16 KiB per-line limit. */
  clipped?: Array<{ line: number; omitted_bytes: number }>;
}

export type GrepTruncation = 'max_matches' | 'budget' | 'worker_timeout';

export interface LineGrepResult {
  hunks: GrepHunk[];
  match_count: number;
  /** False when the scan stopped before EOF, so more matches may exist. */
  match_count_complete: boolean;
  scanned_lines: number;
  total_lines: number | null;
  truncated: GrepTruncation | null;
  /** Pass as `start_line` to continue; every remaining match is reported exactly once. */
  resume_from: number | null;
  preset_index?: number;
}

/** State after one chunk: hunks closed since the previous report and a safe continuation. */
export interface LineGrepProgress {
  hunks: GrepHunk[];
  match_count: number;
  scanned_lines: number;
  safe_resume: number;
  exhausted: boolean;
}

// https://gitlab.com/gitlab-org/gitlab lib/gitlab/ci/trace/stream.rb TIMESTAMP_HEADER_*:
// "<RFC3339 UTC, 6 fractional digits> <2 hex stream><E|O><+| >", 27 + 5 bytes.
const TIMESTAMP_BYTES = 27;
const TIMESTAMP_HEADER_BYTES = 32;
const BUDGET_CHECK_LINES = 256;
const NO_PATTERNS: readonly number[] = Object.freeze([]);
const ESC = 0x1b;
const CR = 0x0d;
const SECTION_PREFIX = Buffer.from('section_', 'latin1');
const SECTION_START = Buffer.from('start', 'latin1');
const SECTION_END = Buffer.from('end', 'latin1');
const SECTION_SUFFIX = Buffer.from('\r\x1b[0K', 'latin1');

const isDigit = (byte: number) => byte >= 0x30 && byte <= 0x39;
const isWord = (byte: number) =>
  isDigit(byte) ||
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  byte === 0x5f;

function startsWith(src: Uint8Array, at: number, end: number, prefix: Uint8Array): boolean {
  if (end - at < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++)
    if (src[at + index] !== prefix[index]) return false;
  return true;
}

const TIMESTAMP_DIGITS = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22, 23, 24, 25];
const isLowerHex = (byte: number) => isDigit(byte) || (byte >= 0x61 && byte <= 0x66);

function isTimestampHeader(src: Uint8Array, at: number): boolean {
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
    (src[at + 31] === 0x2b || src[at + 31] === 0x20)
  );
}

/** Mirrors GitLab's ansi2json escape scanner: an unterminated sequence drops the rest. */
function skipEscape(src: Uint8Array, start: number, end: number): number {
  let at = start + 1;
  if (at >= end) return end;
  const indicator = src[at];
  if (indicator < 0x40 || indicator > 0x5f) return at;
  at++;
  while (at < end && src[at] >= 0x30 && src[at] <= 0x3f) at++;
  while (at < end && src[at] >= 0x20 && src[at] <= 0x2f) at++;
  if (at >= end || src[at] < 0x40 || src[at] > 0x7e) return end;
  return at + 1;
}

/**
 * End of a GitLab section marker at `start`, or -1. Grammar from Gitlab::Regex
 * build_trace_section_regex: section_(start|end):\d+:[A-Za-z0-9_.-]+
 * (\[\w+=\w+(, ?\w+=\w+)*\])?\r\e\[0K
 */
function sectionMarkerEnd(src: Uint8Array, start: number, end: number): number {
  if (!startsWith(src, start, end, SECTION_PREFIX)) return -1;
  let at = start + SECTION_PREFIX.length;
  if (startsWith(src, at, end, SECTION_START)) at += SECTION_START.length;
  else if (startsWith(src, at, end, SECTION_END)) at += SECTION_END.length;
  else return -1;
  if (src[at++] !== 0x3a) return -1;
  const digits = at;
  while (at < end && isDigit(src[at])) at++;
  if (at === digits || src[at++] !== 0x3a) return -1;
  const name = at;
  while (at < end && (isWord(src[at]) || src[at] === 0x2e || src[at] === 0x2d)) at++;
  if (at === name) return -1;
  if (src[at] === 0x5b) {
    at++;
    for (;;) {
      const key = at;
      while (at < end && isWord(src[at])) at++;
      if (at === key || src[at++] !== 0x3d) return -1;
      const value = at;
      while (at < end && isWord(src[at])) at++;
      if (at === value) return -1;
      if (src[at] === 0x5d) {
        at++;
        break;
      }
      if (src[at++] !== 0x2c) return -1;
      if (src[at] === 0x20) at++;
    }
  }
  return startsWith(src, at, end, SECTION_SUFFIX) ? at + SECTION_SUFFIX.length : -1;
}

/**
 * Render one source line as GitLab's job log view shows it: a trailing `\r*` ends the
 * line, any other CR clears the text before it, escapes and section markers vanish.
 * Plain runs between those are found and copied natively rather than byte by byte.
 */
function renderTraceLine(src: Buffer, begin: number, end: number, out: Buffer): number {
  const line = src.subarray(begin, end);
  const size = line.length;
  let esc = line.indexOf(ESC);
  let cr = line.indexOf(CR);
  let section = line.indexOf(SECTION_PREFIX);
  let length = 0;
  let at = 0;
  for (;;) {
    // A position behind the cursor is stale; -1 means none remain and needs no search.
    if (esc !== -1 && esc < at) esc = line.indexOf(ESC, at);
    if (cr !== -1 && cr < at) cr = line.indexOf(CR, at);
    if (section !== -1 && section < at) section = line.indexOf(SECTION_PREFIX, at);
    let next = size;
    if (esc !== -1 && esc < next) next = esc;
    if (cr !== -1 && cr < next) next = cr;
    if (section !== -1 && section < next) next = section;
    if (next > at) length += line.copy(out, length, at, next);
    if (next === size) return length;
    at = next;
    if (at === esc) {
      at = skipEscape(line, at, size);
    } else if (at === cr) {
      let after = at + 1;
      while (after < size && line[after] === CR) after++;
      if (after === size) return length;
      length = 0;
      at = after;
    } else {
      const marker = sectionMarkerEnd(line, at, size);
      if (marker === -1) out[length++] = line[at++];
      else at = marker;
    }
  }
}

/**
 * Streaming line search with `grep -C` hunks. Memory is bounded by the context ring
 * (before + 1 lines of 16 KiB) and the reported hunks, whatever the source size.
 */
export class LineGrepScanner {
  private readonly matcher: PatternMatcher;
  private readonly presetIndex: number | undefined;
  private readonly before: number;
  private readonly after: number;
  private readonly maxMatches: number;
  private readonly invert: boolean;
  private readonly startLine: number;
  private readonly firstKept: number;
  private readonly normalize: boolean;
  private readonly budgetMs: number;
  private readonly ringSize: number;
  private readonly ring: Array<Buffer | undefined>;
  private readonly ringLength: Int32Array;
  private readonly ringOmitted: Float64Array;
  private readonly ringStamp: Buffer;
  private readonly ringHasStamp: Uint8Array;
  private readonly carry = Buffer.allocUnsafe(TRACE_LINE_BYTES);
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  private carryLength = 0;
  private lineBytes = 0;
  private line = 0;
  private outbox: GrepHunk[] = [];
  private pending: GrepHunk | null = null;
  private lastEmitted = -1;
  private afterRemaining = 0;
  private recorded = 0;
  private lastRecorded = -1;
  private matchCount = 0;
  private exhaustedAt: number | null = null;
  private elapsedMs = 0;
  private sliceStart = 0;
  private sinceCheck = 0;

  constructor(options: LineGrepOptions) {
    this.matcher = compilePatterns(options.patterns, options.preset ? [FAILURE_PATTERN] : []);
    this.presetIndex = options.preset ? options.patterns.length : undefined;
    this.before = options.before;
    this.after = options.after;
    this.maxMatches = options.maxMatches;
    this.invert = options.invert;
    this.startLine = options.startLine;
    this.firstKept = Math.max(0, options.startLine - options.before);
    this.normalize = options.normalize;
    this.budgetMs = options.budgetMs;
    this.ringSize = options.before + 1;
    this.ring = new Array<Buffer | undefined>(this.ringSize);
    this.ringLength = new Int32Array(this.ringSize);
    this.ringOmitted = new Float64Array(this.ringSize);
    this.ringStamp = Buffer.allocUnsafe(this.ringSize * TIMESTAMP_BYTES);
    this.ringHasStamp = new Uint8Array(this.ringSize);
  }

  get exhausted(): boolean {
    return this.exhaustedAt !== null;
  }

  /** Consume source bytes; the view is not retained after the call returns. */
  push(chunk: Uint8Array): void {
    if (this.exhaustedAt !== null) return;
    this.sliceStart = performance.now();
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline === -1 ? bytes.length : newline;
      const length = end - offset;
      if (this.line >= this.firstKept) {
        if (newline !== -1 && this.lineBytes === 0) {
          // The whole line is inside this chunk: render it without the carry copy.
          if (!this.finishLine(bytes, offset, offset + Math.min(length, TRACE_LINE_BYTES), length))
            break;
          offset = newline + 1;
          continue;
        }
        const keep = Math.min(length, TRACE_LINE_BYTES - this.carryLength);
        if (keep > 0) {
          bytes.copy(this.carry, this.carryLength, offset, offset + keep);
          this.carryLength += keep;
        }
      }
      this.lineBytes += length;
      if (newline === -1) break;
      if (!this.finishLine(this.carry, 0, this.carryLength, this.lineBytes)) break;
      offset = newline + 1;
    }
    this.elapsedMs += performance.now() - this.sliceStart;
  }

  /** Hunks closed since the previous call, with a continuation that loses none of them. */
  progress(): LineGrepProgress {
    const hunks = this.outbox;
    this.outbox = [];
    return {
      hunks,
      match_count: this.matchCount,
      scanned_lines: this.line,
      safe_resume: this.safeResume(),
      exhausted: this.exhaustedAt !== null,
    };
  }

  /** Close the final line (String.split semantics) and report the hunks not yet taken. */
  finish(): LineGrepResult {
    if (this.exhaustedAt === null) {
      this.sliceStart = performance.now();
      this.finishLine(this.carry, 0, this.carryLength, this.lineBytes);
    }
    this.closePending();
    const exhausted = this.exhaustedAt !== null;
    let truncated: GrepTruncation | null = null;
    let resume: number | null = null;
    if (this.matchCount > this.recorded) {
      truncated = 'max_matches';
      resume = this.lastRecorded + 1;
    } else if (exhausted) {
      truncated = 'budget';
      resume = this.exhaustedAt;
    }
    const hunks = this.outbox;
    this.outbox = [];
    return {
      hunks,
      match_count: this.matchCount,
      match_count_complete: !exhausted,
      scanned_lines: this.line,
      total_lines: exhausted ? null : this.line,
      truncated,
      resume_from: resume,
      ...(this.presetIndex !== undefined ? { preset_index: this.presetIndex } : {}),
    };
  }

  private safeResume(): number {
    if (this.pending) return this.pending.matches[0].line;
    if (this.matchCount > this.recorded) return this.lastRecorded + 1;
    return this.exhaustedAt ?? this.line;
  }

  /** Returns false when the budget stops the scan before this line. */
  private finishLine(src: Buffer, begin: number, end: number, sourceBytes: number): boolean {
    if (++this.sinceCheck >= BUDGET_CHECK_LINES) {
      this.sinceCheck = 0;
      if (this.elapsedMs + performance.now() - this.sliceStart > this.budgetMs) {
        this.exhaustedAt = this.line;
        return false;
      }
    }
    const number = this.line++;
    this.carryLength = 0;
    this.lineBytes = 0;
    if (number < this.firstKept) return true;
    const slot = number % this.ringSize;
    this.store(slot, number, src, begin, end, sourceBytes - (end - begin));
    if (number < this.startLine) return true;
    const text = (this.ring[slot] as Buffer).subarray(0, this.ringLength[slot]);
    const hits = this.matcher.match(text);
    if (this.invert) this.place(number, slot, hits.length === 0, NO_PATTERNS);
    else this.place(number, slot, hits.length > 0, hits);
    return true;
  }

  private store(
    slot: number,
    number: number,
    src: Buffer,
    begin: number,
    end: number,
    omitted: number,
  ): void {
    const out = (this.ring[slot] ??= Buffer.allocUnsafe(TRACE_LINE_BYTES));
    let from = begin;
    // Response.text() drops only the initial UTF-8 BOM; `logs` shows the same text.
    if (number === 0 && end - from >= 3 && src[from] === 0xef) {
      if (src[from + 1] === 0xbb && src[from + 2] === 0xbf) from += 3;
    }
    this.ringHasStamp[slot] = 0;
    if (!this.normalize) {
      src.copy(out, 0, from, end);
      this.ringLength[slot] = end - from;
    } else {
      if (end - from >= TIMESTAMP_HEADER_BYTES && isTimestampHeader(src, from)) {
        src.copy(this.ringStamp, slot * TIMESTAMP_BYTES, from, from + TIMESTAMP_BYTES);
        this.ringHasStamp[slot] = 1;
        from += TIMESTAMP_HEADER_BYTES;
      }
      this.ringLength[slot] = renderTraceLine(src, from, end, out);
    }
    this.ringOmitted[slot] = omitted;
  }

  /**
   * A hunk stays open after its context while a later match could still touch it, so
   * overlapping and adjacent windows form one hunk as with grep -C.
   */
  private place(number: number, slot: number, isMatch: boolean, hits: readonly number[]): void {
    if (isMatch) {
      this.matchCount++;
      if (this.recorded < this.maxMatches) {
        this.recorded++;
        this.lastRecorded = number;
        const hunk = (this.pending ??= {
          start_line: Math.max(this.lastEmitted + 1, number - this.before),
          lines: [],
          matches: [],
        });
        // Lines skipped since the hunk's tail are at most `before` back, so still in the ring.
        for (let line = Math.max(this.lastEmitted + 1, hunk.start_line); line < number; line++)
          this.emit(hunk, line, line % this.ringSize);
        this.emit(hunk, number, slot);
        hunk.matches.push({ line: number, patterns: hits });
        this.afterRemaining = this.after;
        return;
      }
    }
    if (this.pending === null) return;
    if (this.afterRemaining > 0) {
      this.emit(this.pending, number, slot);
      this.afterRemaining--;
    } else if (number - this.lastEmitted > this.before) {
      this.closePending();
    }
  }

  private emit(hunk: GrepHunk, number: number, slot: number): void {
    const omitted = this.ringOmitted[slot];
    const decoded = decodeFragment(
      (this.ring[slot] as Buffer).subarray(0, this.ringLength[slot]),
      false,
      omitted > 0,
      this.decoder,
    );
    hunk.lines.push(decoded.text);
    if (this.ringHasStamp[slot]) {
      hunk.timestamps ??= new Array<string | null>(hunk.lines.length - 1).fill(null);
      const at = slot * TIMESTAMP_BYTES;
      hunk.timestamps.push(this.ringStamp.toString('latin1', at, at + TIMESTAMP_BYTES));
    } else {
      hunk.timestamps?.push(null);
    }
    const lost = omitted + decoded.skippedSuffix;
    if (lost > 0) (hunk.clipped ??= []).push({ line: number, omitted_bytes: lost });
    this.lastEmitted = number;
  }

  private closePending(): void {
    if (this.pending === null) return;
    this.outbox.push(this.pending);
    this.pending = null;
    this.afterRemaining = 0;
  }
}

export type GrepRequest =
  | { type: 'start'; options: LineGrepOptions }
  | { type: 'chunk'; buffer: ArrayBuffer; offset: number; length: number }
  | { type: 'end' }
  | { type: 'reset' };

export type GrepReply =
  | { type: 'ready' }
  | { type: 'invalid'; message: string }
  | { type: 'progress'; progress: LineGrepProgress; buffer: ArrayBuffer }
  | { type: 'done'; result: LineGrepResult }
  | { type: 'failed'; message: string };

export type GrepPort = Pick<MessagePort, 'on' | 'postMessage'>;

/** Worker entry: one request at a time, and no state survives `end` or `reset`. */
export function serveLineGrep(port: GrepPort): void {
  let scanner: LineGrepScanner | null = null;
  const active = (): LineGrepScanner => {
    if (!scanner) throw new Error('Log search received data before start');
    return scanner;
  };
  port.on('message', (request: GrepRequest) => {
    try {
      switch (request.type) {
        case 'start':
          scanner = null;
          scanner = new LineGrepScanner(request.options);
          port.postMessage({ type: 'ready' } satisfies GrepReply);
          return;
        case 'chunk': {
          const current = active();
          current.push(new Uint8Array(request.buffer, request.offset, request.length));
          const reply: GrepReply = {
            type: 'progress',
            progress: current.progress(),
            buffer: request.buffer,
          };
          // Hand the transport buffer back so the reader can fill it again.
          port.postMessage(reply, [request.buffer]);
          return;
        }
        case 'end': {
          const current = active();
          scanner = null;
          port.postMessage({ type: 'done', result: current.finish() } satisfies GrepReply);
          return;
        }
        case 'reset':
          scanner = null;
          port.postMessage({ type: 'ready' } satisfies GrepReply);
          return;
      }
    } catch (error) {
      scanner = null;
      const message = error instanceof Error ? error.message : String(error);
      port.postMessage(
        (error instanceof PatternError
          ? { type: 'invalid', message }
          : { type: 'failed', message }) satisfies GrepReply,
      );
    }
  });
}
