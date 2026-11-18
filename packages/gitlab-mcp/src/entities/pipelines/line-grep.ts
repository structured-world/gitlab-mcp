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
  '(?:[Ss]egmentation fault|core dumped|[Oo]ut of memory|OUT OF MEMORY|OOMKilled)',
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
  /** Text bytes the reported lines may hold; the scan stops before exceeding it. */
  outputBytes: number;
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

export type GrepTruncation = 'max_matches' | 'budget' | 'output_limit' | 'worker_timeout';

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
// "<RFC3339 UTC, 6 fractional digits> <2 hex stream><E|O><+| >", 27 + 5 bytes. A '+' in
// the last byte continues the previous line (lib/gitlab/ci/ansi2json/converter.rb).
const TIMESTAMP_BYTES = 27;
const TIMESTAMP_HEADER_BYTES = 32;
const CONTINUATION = 0x2b;
// Fragments one logical line may span before the scanner starts a new one.
const MAX_GROUP_LINES = 32;
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
    (src[at + 31] === CONTINUATION || src[at + 31] === 0x20)
  );
}

/** Whether a source line carries a runner timestamp marking it a continuation. */
function continuesLine(src: Uint8Array, begin: number, end: number): boolean {
  return (
    end - begin >= TIMESTAMP_HEADER_BYTES &&
    src[begin + TIMESTAMP_HEADER_BYTES - 1] === CONTINUATION &&
    isTimestampHeader(src, begin)
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

/** End of a section options block `[\w+=\w+(, ?\w+=\w+)*]` starting at `[`, or -1. */
function sectionOptionsEnd(src: Uint8Array, start: number, end: number): number {
  let at = start + 1;
  for (;;) {
    const key = at;
    while (at < end && isWord(src[at])) at++;
    if (at === key || src[at++] !== 0x3d) return -1;
    const value = at;
    while (at < end && isWord(src[at])) at++;
    if (at === value) return -1;
    if (src[at] === 0x5d) return at + 1;
    if (src[at++] !== 0x2c) return -1;
    if (src[at] === 0x20) at++;
  }
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
    at = sectionOptionsEnd(src, at, end);
    if (at === -1) return -1;
  }
  return startsWith(src, at, end, SECTION_SUFFIX) ? at + SECTION_SUFFIX.length : -1;
}

/** Whether the last renderTraceLine call met a lone CR, which clears the whole logical line. */
let renderCleared = false;

/**
 * Render one source line as GitLab's job log view shows it: a trailing `\r*` ends the
 * line, any other CR clears the text before it, escapes and section markers vanish.
 * Plain runs between those are found and copied natively rather than byte by byte.
 */
function renderTraceLine(src: Buffer, begin: number, end: number, out: Buffer): number {
  renderCleared = false;
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
      renderCleared = true;
      at = after;
    } else {
      const marker = sectionMarkerEnd(line, at, size);
      if (marker === -1) out[length++] = line[at++];
      else at = marker;
    }
  }
}

type StopReason = 'budget' | 'output';

/**
 * Streaming line search with `grep -C` hunks. Memory is bounded by the context ring
 * (at most before + 2 + MAX_GROUP_LINES lines of 16 KiB), a logical line buffer of
 * MAX_GROUP_LINES lines allocated only for traces with continuations, and `outputBytes`
 * of reported text, whatever the source size.
 *
 * A logical line is one physical line, or with runner timestamps, a line and the
 * fragments that continue it. Matching sees the logical text; every reported number is
 * a physical line, as `logs` counts them. A logical line is matched once the next one
 * starts, so placement runs one logical line behind the input.
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
  private readonly outputLimit: number;
  // Holds the before-context, the open logical line and the line just read. It starts at
  // one fragment per logical line and grows once if the trace has continuations, so a
  // trace without them keeps a small, cache-friendly working set.
  private ringSize: number;
  private ring: Array<Buffer | undefined>;
  private ringLength: Int32Array;
  private ringOmitted: Float64Array;
  private ringStamp: Buffer;
  private ringHasStamp: Uint8Array;
  private ringCleared: Uint8Array;
  private readonly carry = Buffer.allocUnsafe(TRACE_LINE_BYTES);
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  private carryLength = 0;
  private lineBytes = 0;
  private line = 0;
  // The logical line still collecting fragments.
  private groupOpen = false;
  private groupFirst = 0;
  private groupEnd = 0;
  private groupMatchable = false;
  private logical: Buffer | undefined;
  private logicalLength = -1;
  private outbox: GrepHunk[] = [];
  private pending: GrepHunk | null = null;
  private closedHunks = 0;
  private outputBytes = 0;
  private lastEmitted = -1;
  private afterRemaining = 0;
  private recorded = 0;
  private lastRecorded = -1;
  private matchCount = 0;
  // After the budget, the open hunk finishes its after-context without new matches.
  private draining = false;
  private stop: StopReason | null = null;
  private stopLine = 0;
  private outputResume = 0;
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
    this.outputLimit = options.outputBytes;
    // A logical line is placed with its before-context once the next line has arrived.
    this.ringSize = options.before + 2;
    this.ring = new Array<Buffer | undefined>(this.ringSize);
    this.ringLength = new Int32Array(this.ringSize);
    this.ringOmitted = new Float64Array(this.ringSize);
    this.ringStamp = Buffer.allocUnsafe(this.ringSize * TIMESTAMP_BYTES);
    this.ringHasStamp = new Uint8Array(this.ringSize);
    this.ringCleared = new Uint8Array(this.ringSize);
  }

  /** Re-index the held lines into a ring with room for the longest logical line. */
  private growRing(number: number): void {
    const size = this.before + 2 + MAX_GROUP_LINES;
    const ring = new Array<Buffer | undefined>(size);
    const length = new Int32Array(size);
    const omitted = new Float64Array(size);
    const stamp = Buffer.allocUnsafe(size * TIMESTAMP_BYTES);
    const hasStamp = new Uint8Array(size);
    const cleared = new Uint8Array(size);
    for (let line = Math.max(this.firstKept, number - this.ringSize + 1); line < number; line++) {
      const from = line % this.ringSize;
      const to = line % size;
      ring[to] = this.ring[from];
      length[to] = this.ringLength[from];
      omitted[to] = this.ringOmitted[from];
      this.ringStamp.copy(
        stamp,
        to * TIMESTAMP_BYTES,
        from * TIMESTAMP_BYTES,
        (from + 1) * TIMESTAMP_BYTES,
      );
      hasStamp[to] = this.ringHasStamp[from];
      cleared[to] = this.ringCleared[from];
    }
    this.ringSize = size;
    this.ring = ring;
    this.ringLength = length;
    this.ringOmitted = omitted;
    this.ringStamp = stamp;
    this.ringHasStamp = hasStamp;
    this.ringCleared = cleared;
  }

  get exhausted(): boolean {
    return this.stop !== null;
  }

  /** Consume source bytes; the view is not retained after the call returns. */
  push(chunk: Uint8Array): void {
    if (this.stop !== null) return;
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
      safe_resume: this.resumePoint(true),
      exhausted: this.stop !== null,
    };
  }

  /** Close the final line (String.split semantics) and report the hunks not yet taken. */
  finish(): LineGrepResult {
    if (this.stop === null) {
      this.sliceStart = performance.now();
      this.finishLine(this.carry, 0, this.carryLength, this.lineBytes);
    }
    if (this.stop === null) this.closeGroup();
    this.closePending();
    const stopped = this.stop !== null;
    let truncated: GrepTruncation | null = null;
    if (this.stop === 'output') truncated = 'output_limit';
    else if (this.stop === 'budget') truncated = 'budget';
    // Matches seen while finishing the after-context at EOF were held back by the budget.
    else if (this.matchCount > this.recorded) truncated = this.draining ? 'budget' : 'max_matches';
    const hunks = this.outbox;
    this.outbox = [];
    return {
      hunks,
      match_count: this.matchCount,
      match_count_complete: !stopped,
      scanned_lines: this.line,
      total_lines: stopped ? null : this.line,
      truncated,
      resume_from: truncated === null ? null : this.resumePoint(false),
      ...(this.presetIndex !== undefined ? { preset_index: this.presetIndex } : {}),
    };
  }

  /**
   * Where a continuation reports every match not yet delivered exactly once. With
   * `undelivered`, the open hunk counts as lost, as it is when a worker is killed.
   */
  private resumePoint(undelivered: boolean): number {
    let resume: number;
    if (this.stop === 'output') resume = this.outputResume;
    else if (undelivered && this.pending !== null) resume = this.pending.matches[0].line;
    else if (this.matchCount > this.recorded) resume = this.lastRecorded + 1;
    else resume = this.stop === null ? this.line : this.stopLine;
    // An unfinished logical line has not been matched yet.
    return this.groupOpen ? Math.min(resume, this.groupFirst) : resume;
  }

  private halt(reason: StopReason): void {
    this.stop ??= reason;
    this.stopLine = this.line;
  }

  /** Returns false once the scan has stopped; the stopping line is left unprocessed. */
  private finishLine(src: Buffer, begin: number, end: number, sourceBytes: number): boolean {
    // Lines up to start_line are skipped or kept as context; only searching spends the
    // budget, so every continuation advances past the line it started from.
    if (!this.draining && this.line > this.startLine && ++this.sinceCheck >= BUDGET_CHECK_LINES) {
      this.sinceCheck = 0;
      if (this.elapsedMs + performance.now() - this.sliceStart > this.budgetMs) {
        if (this.pending === null || this.afterRemaining === 0) {
          this.halt('budget');
          return false;
        }
        this.draining = true;
      }
    }
    const number = this.line++;
    this.carryLength = 0;
    this.lineBytes = 0;
    if (number < this.firstKept) return true;
    // Grow before storing, so the new fragment cannot overwrite a line still to be placed.
    if (this.groupOpen && this.ringSize < this.before + 2 + MAX_GROUP_LINES) {
      if (this.normalize && continuesLine(src, begin, end)) this.growRing(number);
    }
    const slot = number % this.ringSize;
    const continued = this.store(slot, number, src, begin, end, sourceBytes - (end - begin));
    if (continued && this.groupOpen && number - this.groupFirst < MAX_GROUP_LINES) {
      this.extendGroup(number, slot);
    } else {
      this.closeGroup();
      // Placing the previous logical line stopped the scan: this line was never placed.
      if (this.stop !== null) {
        this.stopLine = number;
        return false;
      }
      // A fragment whose first part was never read is context, never a match.
      this.openGroup(number, !continued);
    }
    // Raw lines stand alone, so each is placed as soon as it is read.
    if (!this.normalize) this.closeGroup();
    return this.stop === null;
  }

  /** Stores the rendered line; returns whether a runner timestamp marks it a continuation. */
  private store(
    slot: number,
    number: number,
    src: Buffer,
    begin: number,
    end: number,
    omitted: number,
  ): boolean {
    const out = (this.ring[slot] ??= Buffer.allocUnsafe(TRACE_LINE_BYTES));
    let from = begin;
    let continued = false;
    this.ringHasStamp[slot] = 0;
    this.ringCleared[slot] = 0;
    if (this.normalize) {
      // Response.text() drops only the initial UTF-8 BOM; `logs` shows the same text.
      if (number === 0 && end - from >= 3 && src[from] === 0xef) {
        if (src[from + 1] === 0xbb && src[from + 2] === 0xbf) from += 3;
      }
      if (end - from >= TIMESTAMP_HEADER_BYTES && isTimestampHeader(src, from)) {
        src.copy(this.ringStamp, slot * TIMESTAMP_BYTES, from, from + TIMESTAMP_BYTES);
        this.ringHasStamp[slot] = 1;
        continued = src[from + TIMESTAMP_HEADER_BYTES - 1] === CONTINUATION;
        from += TIMESTAMP_HEADER_BYTES;
      }
      this.ringLength[slot] = renderTraceLine(src, from, end, out);
      if (renderCleared) this.ringCleared[slot] = 1;
    } else {
      this.ringLength[slot] = src.copy(out, 0, from, end);
    }
    this.ringOmitted[slot] = omitted;
    return continued;
  }

  private openGroup(number: number, matchable: boolean): void {
    this.groupOpen = true;
    this.groupFirst = number;
    this.groupEnd = number;
    this.groupMatchable = matchable && number >= this.startLine;
    this.logicalLength = -1;
  }

  /** Joins a fragment to the logical line; a lone CR in it clears what came before. */
  private extendGroup(number: number, slot: number): void {
    // Room for every fragment the group may hold, so no fragment text goes unsearched.
    const logical = (this.logical ??= Buffer.allocUnsafe(MAX_GROUP_LINES * TRACE_LINE_BYTES));
    if (this.logicalLength === -1) {
      const head = this.groupFirst % this.ringSize;
      this.logicalLength = (this.ring[head] as Buffer).copy(logical, 0, 0, this.ringLength[head]);
    }
    if (this.ringCleared[slot]) this.logicalLength = 0;
    this.logicalLength += (this.ring[slot] as Buffer).copy(
      logical,
      this.logicalLength,
      0,
      this.ringLength[slot],
    );
    this.groupEnd = number;
  }

  /** Matches the finished logical line and places its physical lines. */
  private closeGroup(): void {
    if (!this.groupOpen) return;
    this.groupOpen = false;
    const first = this.groupFirst;
    let isMatch = false;
    let hits = NO_PATTERNS;
    if (this.groupMatchable) {
      const head = first % this.ringSize;
      const text =
        this.logicalLength === -1
          ? (this.ring[head] as Buffer).subarray(0, this.ringLength[head])
          : (this.logical as Buffer).subarray(0, this.logicalLength);
      const found = this.matcher.match(text);
      isMatch = this.invert ? found.length === 0 : found.length > 0;
      if (!this.invert) hits = found;
    }
    const recorded = this.place(first, isMatch, hits);
    for (let line = first + 1; line <= this.groupEnd && this.stop === null; line++) {
      // The rest of a reported logical line belongs to it, whatever the after-context.
      if (recorded) this.emit(this.pending as GrepHunk, line, first);
      else this.place(line, false, NO_PATTERNS);
    }
    if (recorded && this.stop === null) this.afterRemaining = this.after;
  }

  /**
   * Places one physical line; returns whether it was reported as a match. A hunk stays
   * open after its context while a later match could still touch it, so overlapping and
   * adjacent windows form one hunk as with grep -C.
   */
  private place(number: number, isMatch: boolean, hits: readonly number[]): boolean {
    if (isMatch) {
      this.matchCount++;
      if (!this.draining && this.recorded < this.maxMatches) return this.record(number, hits);
    }
    if (this.pending === null) return false;
    if (this.afterRemaining > 0) {
      if (!this.emit(this.pending, number, number)) return false;
      if (--this.afterRemaining === 0 && this.draining) this.halt('budget');
    } else if (number - this.lastEmitted > this.before) {
      this.closePending();
    }
    return false;
  }

  private record(number: number, hits: readonly number[]): boolean {
    const hunk = (this.pending ??= {
      start_line: Math.max(this.lastEmitted + 1, number - this.before),
      lines: [],
      matches: [],
    });
    // Lines skipped since the hunk's tail are at most `before` back, so still in the ring.
    for (let line = Math.max(this.lastEmitted + 1, hunk.start_line); line <= number; line++)
      if (!this.emit(hunk, line, number)) return false;
    this.recorded++;
    this.lastRecorded = number;
    hunk.matches.push({ line: number, patterns: hits });
    this.afterRemaining = this.after;
    return true;
  }

  /** Appends a line to the hunk, or stops the scan when the output limit would be passed. */
  private emit(hunk: GrepHunk, number: number, matchLine: number): boolean {
    const slot = number % this.ringSize;
    const size = this.ringLength[slot];
    if (this.outputBytes > 0 && this.outputBytes + size > this.outputLimit) {
      this.stopForOutput(matchLine);
      return false;
    }
    this.outputBytes += size;
    const omitted = this.ringOmitted[slot];
    const decoded = decodeFragment(
      (this.ring[slot] as Buffer).subarray(0, size),
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
    if (lost > 0) {
      hunk.clipped ??= [];
      hunk.clipped.push({ line: number, omitted_bytes: lost });
    }
    this.lastEmitted = number;
    return true;
  }

  /**
   * At the output limit, an open hunk after others is dropped and found again on resume;
   * the first hunk is cut instead, since dropping it would make no progress.
   */
  private stopForOutput(matchLine: number): void {
    const hunk = this.pending as GrepHunk;
    if (this.closedHunks > 0 || hunk.matches.length === 0) {
      this.outputResume = hunk.matches.length > 0 ? hunk.matches[0].line : matchLine;
      this.pending = null;
    } else {
      // Matches past max_matches may sit in the emitted after-context unreported; the
      // next page starts at the first of them rather than after the emitted text.
      this.outputResume =
        this.matchCount > this.recorded ? this.lastRecorded + 1 : this.lastEmitted + 1;
      this.closePending();
    }
    this.groupOpen = false;
    this.halt('output');
  }

  private closePending(): void {
    if (this.pending === null) return;
    this.outbox.push(this.pending);
    this.closedHunks++;
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
