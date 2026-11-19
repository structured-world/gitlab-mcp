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

/**
 * End of the escape sequence at `start`, mirroring GitLab's ansi2json tokens
 * `\e([@-_])(.*?)([@-~])` and `\e(?:[@-_].*?)?$`: a sequence ends at the first byte in
 * @ through ~, one cut off by the line end drops the rest, and an ESC followed by
 * anything else starts no sequence, so `start` comes back and the ESC is text.
 */
function skipEscape(src: Uint8Array, start: number, end: number): number {
  let at = start + 1;
  if (at >= end) return end;
  if (src[at] < 0x40 || src[at] > 0x5f) return start;
  at++;
  while (at < end && (src[at] < 0x40 || src[at] > 0x7e)) at++;
  return at >= end ? end : at + 1;
}

/** End of the run of `\w` bytes at `at`. */
function wordEnd(src: Uint8Array, at: number, end: number): number {
  while (at < end && isWord(src[at])) at++;
  return at;
}

/** End of a section options block `[\w+=\w+(, ?\w+=\w+)*]` starting at `[`, or -1. */
function sectionOptionsEnd(src: Uint8Array, start: number, end: number): number {
  let at = start + 1;
  for (;;) {
    const keyEnd = wordEnd(src, at, end);
    if (keyEnd === at || src[keyEnd] !== 0x3d) return -1;
    at = wordEnd(src, keyEnd + 1, end);
    if (at === keyEnd + 1) return -1;
    if (src[at] === 0x5d) return at + 1;
    if (src[at] !== 0x2c) return -1;
    at += src[at + 1] === 0x20 ? 2 : 1;
  }
}

/**
 * End of a GitLab section marker at `start`, or -1. Grammar from Gitlab::Regex
 * build_trace_section_regex: section_(start|end):\d+:[A-Za-z0-9_.-]+
 * (\[\w+=\w+(, ?\w+=\w+)*\])?\r\e\[0K. Called only where SECTION_PREFIX starts.
 */
function sectionMarkerEnd(src: Uint8Array, start: number, end: number): number {
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

// Source offsets where each later fragment of a joined logical line starts. Rendering
// rewrites the first `startCount` in place to the same points in the rendered text, so
// each fragment's rendered text is a slice; `clearedFragments` counts the fragments a CR
// cleared whole.
const fragmentStarts = new Int32Array(MAX_GROUP_LINES);
let startCount = 0;
let startsMapped = 0;
let clearedFragments = 0;
// Whether the fragment before each start was clipped, so its kept bytes do not adjoin it.
const gapBefore = new Uint8Array(MAX_GROUP_LINES);
let gapCount = 0;

/**
 * End of the text an escape or marker at `next` may span: the next clipped gap, since the
 * bytes the clip dropped lie between, or the line end. Starts past `next` are unmapped.
 */
function tokenEnd(next: number, size: number): number {
  if (gapCount === 0) return size;
  for (let index = startsMapped; index < startCount; index++)
    if (gapBefore[index] && fragmentStarts[index] > next) return fragmentStarts[index];
  return size;
}

/** Maps the fragment starts before `to` inside a run copied from `from` to `out`. */
function mapCopied(from: number, to: number, out: number): void {
  while (startsMapped < startCount && fragmentStarts[startsMapped] < to) {
    fragmentStarts[startsMapped] = out + fragmentStarts[startsMapped] - from;
    startsMapped++;
  }
}

/** Maps the fragment starts before `to` inside removed text to `out`. */
function mapRemoved(to: number, out: number): void {
  while (startsMapped < startCount && fragmentStarts[startsMapped] < to)
    fragmentStarts[startsMapped++] = out;
}

// A ring slot holds a line's first 16 KiB plus the rest of a UTF-8 character that a
// fragment boundary moved into it.
const SLOT_BYTES = TRACE_LINE_BYTES + 3;

const isContinuationByte = (byte: number) => (byte & 0xc0) === 0x80;

/**
 * Moves a fragment boundary back to the start of the UTF-8 character it splits, so the
 * character is returned whole in the later fragment. Only a complete character inside the
 * rendered text `[floor, end)` counts; any other byte run keeps the boundary.
 */
function characterBoundary(text: Buffer, at: number, floor: number, end: number): number {
  if (at <= floor || at >= end || !isContinuationByte(text[at])) return at;
  let lead = at - 1;
  while (lead > floor && at - lead < 3 && isContinuationByte(text[lead])) lead--;
  const byte = text[lead];
  let width = 0;
  if (byte >= 0xf0) width = 4;
  else if (byte >= 0xe0) width = 3;
  else if (byte >= 0xc0) width = 2;
  const close = lead + width;
  if (close <= at || close > end) return at;
  for (let next = at + 1; next < close; next++) if (!isContinuationByte(text[next])) return at;
  return lead;
}

/** End of the CR run starting at `at`. */
function crRunEnd(line: Buffer, at: number, size: number): number {
  while (at < size && line[at] === CR) at++;
  return at;
}

// Rendered length of the line renderTraceLine is working on.
let renderLength = 0;

/**
 * Applies the CR, escape or section marker at `next` and returns where rendering goes on,
 * or -1 when a CR run ends the line.
 */
function applyToken(
  line: Buffer,
  next: number,
  size: number,
  isCr: boolean,
  isEscape: boolean,
): number {
  if (isCr) {
    const at = crRunEnd(line, next, size);
    if (at === size) return -1;
    // A lone CR clears everything before it: a fragment ending at or before the end of the
    // CR run is cleared whole, even one that ends exactly where the CR starts.
    renderLength = 0;
    fragmentStarts.fill(0, 0, startsMapped);
    mapRemoved(at + 1, 0);
    clearedFragments = startsMapped;
    return at;
  }
  const end = tokenEnd(next, size);
  const at = isEscape ? skipEscape(line, next, end) : sectionMarkerEnd(line, next, end);
  if (at > next) {
    mapRemoved(at, renderLength);
    return at;
  }
  // An escape or marker that is not one stays text: its first byte is kept.
  line[renderLength] = line[next];
  mapCopied(next, next + 1, renderLength);
  renderLength++;
  return next + 1;
}

/**
 * Next position of `needle` at or after `at`. A known position still ahead is reused, and
 * -1 means none remain, so each needle is searched once per occurrence, not per token.
 */
function nextOf(line: Buffer, needle: number | Buffer, known: number, at: number): number {
  return known !== -1 && known < at ? line.indexOf(needle, at) : known;
}

/** The smaller of `limit` and a found position (`-1` is not found). */
function earliest(limit: number, position: number): number {
  return position !== -1 && position < limit ? position : limit;
}

/**
 * Render a logical line in place as GitLab's job log view shows it: a trailing `\r*` ends
 * the line, any other CR clears the text before it, escapes and section markers vanish.
 * Rendering only removes bytes, so the text moves left within `line`; plain runs between
 * those tokens are found natively and not moved at all while nothing was removed yet.
 * Fragments are joined before rendering, as GitLab does, so a token split by the runner
 * is still one token.
 */
function renderTraceLine(buffer: Buffer, size: number): number {
  // Searches must stop at the line's end, not run on through the rest of its slot.
  const line = buffer.subarray(0, size);
  startsMapped = 0;
  clearedFragments = 0;
  renderLength = 0;
  let esc = line.indexOf(ESC);
  let cr = line.indexOf(CR);
  let section = line.indexOf(SECTION_PREFIX);
  let at = 0;
  for (;;) {
    esc = nextOf(line, ESC, esc, at);
    cr = nextOf(line, CR, cr, at);
    section = nextOf(line, SECTION_PREFIX, section, at);
    const next = earliest(earliest(earliest(size, esc), cr), section);
    if (next > at) {
      if (renderLength !== at) line.copy(line, renderLength, at, next);
      mapCopied(at, next, renderLength);
      renderLength += next - at;
    }
    if (next === size) break;
    at = applyToken(line, next, size, next === cr, next === esc);
    if (at === -1) break;
  }
  mapRemoved(Infinity, renderLength);
  return renderLength;
}

type StopReason = 'budget' | 'output';

/**
 * Streaming line search with `grep -C` hunks. Memory is bounded by the context ring
 * (at most before + 2 + MAX_GROUP_LINES lines of 16 KiB), a logical line buffer of
 * MAX_GROUP_LINES lines allocated only for traces with continuations, and `outputBytes`
 * of reported text, whatever the source size.
 *
 * A logical line is one physical line, or with runner timestamps, a line and the
 * fragments that continue it, joined MAX_GROUP_LINES at a time. Groups are counted from
 * the first line of the trace, so every page of a resumed search sees the same ones, and
 * a group is searched only by the page whose range holds its head. Matching sees the
 * logical text; every reported number is a physical line, as `logs` counts them. A
 * logical line is matched once the next one starts, so placement runs one logical line
 * behind the input.
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
  // First line stored: a group reaching firstKept may start up to MAX_GROUP_LINES - 1 lines
  // earlier and is rendered whole. Lines before firstKept are never reported, since no hunk
  // opens before start_line.
  private readonly firstStored: number;
  private readonly normalize: boolean;
  private readonly budgetMs: number;
  private readonly outputLimit: number;
  // Holds the before-context, the open logical line and the line just read: lines of the
  // open group as source bytes, placed lines as rendered text. It starts at
  // one fragment per logical line and grows once if the trace has continuations, so a
  // trace without them keeps a small, cache-friendly working set.
  private ringSize: number;
  private ring: Array<Buffer | undefined>;
  private ringLength: Int32Array;
  private ringOmitted: Float64Array;
  private ringStamp: Buffer;
  private ringHasStamp: Uint8Array;
  private readonly carry = Buffer.allocUnsafe(TRACE_LINE_BYTES);
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  private carryLength = 0;
  private lineBytes = 0;
  private line = 0;
  // Fragments in the trace's current group, skipped lines included.
  private chainLength = 0;
  // The kept part of the current group, still collecting fragments.
  private groupOpen = false;
  private groupFirst = 0;
  private groupEnd = 0;
  private groupMatchable = false;
  // Joined source fragments of a multi-fragment group, rendered in place.
  private logical: Buffer | undefined;
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
    this.firstStored = options.normalize
      ? Math.max(0, this.firstKept - (MAX_GROUP_LINES - 1))
      : this.firstKept;
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
  }

  /** Re-index the held lines into a ring with room for the longest logical line. */
  private growRing(number: number): void {
    const size = this.before + 2 + MAX_GROUP_LINES;
    const ring = new Array<Buffer | undefined>(size);
    const length = new Int32Array(size);
    const omitted = new Float64Array(size);
    const stamp = Buffer.allocUnsafe(size * TIMESTAMP_BYTES);
    const hasStamp = new Uint8Array(size);
    for (let line = Math.max(this.firstStored, number - this.ringSize + 1); line < number; line++) {
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
    }
    this.ringSize = size;
    this.ring = ring;
    this.ringLength = length;
    this.ringOmitted = omitted;
    this.ringStamp = stamp;
    this.ringHasStamp = hasStamp;
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
      if (newline === -1) {
        this.collect(bytes, offset, bytes.length - offset);
        break;
      }
      if (!this.endLine(bytes, offset, newline - offset)) break;
      offset = newline + 1;
    }
    this.elapsedMs += performance.now() - this.sliceStart;
  }

  /**
   * Keeps what the line in progress needs from a piece of it: up to the per-line limit of
   * a stored line, and of a skipped line only enough to tell whether it continues the last.
   */
  private collect(bytes: Buffer, offset: number, length: number): void {
    let limit = 0;
    if (this.line >= this.firstStored) limit = TRACE_LINE_BYTES;
    else if (this.normalize) limit = TIMESTAMP_HEADER_BYTES;
    const keep = Math.min(length, limit - this.carryLength);
    if (keep > 0) {
      bytes.copy(this.carry, this.carryLength, offset, offset + keep);
      this.carryLength += keep;
    }
    this.lineBytes += length;
  }

  /** Finishes the line whose last piece ends at `offset + length`; false once stopped. */
  private endLine(bytes: Buffer, offset: number, length: number): boolean {
    if (this.lineBytes === 0 && this.line >= this.firstStored) {
      // The whole line is inside this chunk: render it without the carry copy.
      return this.finishLine(bytes, offset, offset + Math.min(length, TRACE_LINE_BYTES), length);
    }
    this.collect(bytes, offset, length);
    return this.finishLine(this.carry, 0, this.carryLength, this.lineBytes);
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
    // An unfinished logical line has not been matched yet; one headed before start_line
    // belongs to an earlier page and is never matched here.
    return this.groupOpen && this.groupMatchable ? Math.min(resume, this.groupFirst) : resume;
  }

  private halt(reason: StopReason): void {
    this.stop ??= reason;
    this.stopLine = this.line;
  }

  /**
   * Checks the budget every BUDGET_CHECK_LINES searched lines; true when the scan stops.
   * Lines up to start_line are skipped or kept as context and spend none of it, so every
   * continuation advances past the line it started from. Past the budget, an open hunk
   * first finishes its after-context.
   */
  private overBudget(): boolean {
    if (this.draining || this.line <= this.startLine || ++this.sinceCheck < BUDGET_CHECK_LINES)
      return false;
    this.sinceCheck = 0;
    if (this.elapsedMs + performance.now() - this.sliceStart <= this.budgetMs) return false;
    if (this.pending !== null && this.afterRemaining > 0) {
      this.draining = true;
      return false;
    }
    this.halt('budget');
    return true;
  }

  /**
   * Whether the line continues the trace's current group, counting it either way. GitLab
   * joins continuations without limit; past MAX_GROUP_LINES fragments the scanner starts a
   * new group of the same line, so a match spanning that boundary is not found.
   */
  private chain(src: Buffer, begin: number, end: number): boolean {
    const chained =
      this.normalize &&
      this.chainLength > 0 &&
      this.chainLength < MAX_GROUP_LINES &&
      continuesLine(src, begin, end);
    this.chainLength = chained ? this.chainLength + 1 : 1;
    return chained;
  }

  /** Returns false once the scan has stopped; the stopping line is left unprocessed. */
  private finishLine(src: Buffer, begin: number, end: number, sourceBytes: number): boolean {
    if (this.overBudget()) return false;
    const number = this.line++;
    this.carryLength = 0;
    this.lineBytes = 0;
    const chained = this.chain(src, begin, end);
    if (number < this.firstStored) return true;
    // Grow before storing, so the new fragment cannot overwrite a line still to be placed.
    if (chained && this.groupOpen && this.ringSize < this.before + 2 + MAX_GROUP_LINES)
      this.growRing(number);
    const slot = number % this.ringSize;
    this.store(slot, number, src, begin, end, sourceBytes - (end - begin));
    if (chained && this.groupOpen) {
      this.groupEnd = number;
    } else {
      this.closeGroup();
      // Placing the previous logical line stopped the scan: this line was never placed.
      if (this.stop !== null) {
        this.stopLine = number;
        return false;
      }
      // The first stored line may continue a group headed before it: never a match.
      this.openGroup(number, !chained);
    }
    // Raw lines stand alone, so each is placed as soon as it is read.
    if (!this.normalize) this.closeGroup();
    return this.stop === null;
  }

  /** Stores the line's source bytes after its BOM and timestamp, which is kept apart. */
  private store(
    slot: number,
    number: number,
    src: Buffer,
    begin: number,
    end: number,
    omitted: number,
  ): void {
    const out = (this.ring[slot] ??= Buffer.allocUnsafe(SLOT_BYTES));
    let from = begin;
    this.ringHasStamp[slot] = 0;
    if (this.normalize) {
      // Response.text() drops only the initial UTF-8 BOM; `logs` shows the same text.
      if (number === 0 && end - from >= 3 && src[from] === 0xef) {
        if (src[from + 1] === 0xbb && src[from + 2] === 0xbf) from += 3;
      }
      if (end - from >= TIMESTAMP_HEADER_BYTES && isTimestampHeader(src, from)) {
        src.copy(this.ringStamp, slot * TIMESTAMP_BYTES, from, from + TIMESTAMP_BYTES);
        this.ringHasStamp[slot] = 1;
        from += TIMESTAMP_HEADER_BYTES;
      }
    }
    this.ringLength[slot] = src.copy(out, 0, from, end);
    this.ringOmitted[slot] = omitted;
  }

  private openGroup(number: number, matchable: boolean): void {
    this.groupOpen = true;
    this.groupFirst = number;
    this.groupEnd = number;
    this.groupMatchable = matchable && number >= this.startLine;
  }

  /**
   * Renders the finished group and returns its logical text. A single line renders in its
   * slot. Several fragments are joined before rendering, as GitLab joins them, and each
   * slot then gets its own fragment's part; a fragment a CR cleared whole is empty and
   * loses its clipped tail with the rest of its text.
   */
  private renderGroup(): Buffer {
    const first = this.groupFirst;
    const head = first % this.ringSize;
    if (this.groupEnd === first) {
      startCount = 0;
      gapCount = 0;
      const line = this.ring[head] as Buffer;
      this.ringLength[head] = renderTraceLine(line, this.ringLength[head]);
      return line.subarray(0, this.ringLength[head]);
    }
    // Room for every fragment the group may hold, so no fragment text goes unsearched.
    const logical = (this.logical ??= Buffer.allocUnsafe(MAX_GROUP_LINES * TRACE_LINE_BYTES));
    let size = 0;
    startCount = this.groupEnd - first;
    gapCount = 0;
    for (let line = first; line <= this.groupEnd; line++) {
      const slot = line % this.ringSize;
      if (line < this.groupEnd) {
        const gap = this.ringOmitted[slot] > 0 ? 1 : 0;
        gapBefore[line - first] = gap;
        gapCount += gap;
      }
      if (line > first) fragmentStarts[line - first - 1] = size;
      size += (this.ring[slot] as Buffer).copy(logical, size, 0, this.ringLength[slot]);
    }
    const length = renderTraceLine(logical, size);
    let from = 0;
    for (let index = 0; index <= startCount; index++) {
      const slot = (first + index) % this.ringSize;
      let to = length;
      if (index < startCount) {
        // A clipped fragment's tail is not next to the following one: nothing to rejoin.
        to = fragmentStarts[index];
        if (this.ringOmitted[slot] === 0) to = characterBoundary(logical, to, from, length);
      }
      this.ringLength[slot] = logical.copy(this.ring[slot] as Buffer, 0, from, to);
      if (index < clearedFragments) this.ringOmitted[slot] = 0;
      from = to;
    }
    return logical.subarray(0, length);
  }

  /** Matches the finished logical line and places its physical lines. */
  private closeGroup(): void {
    if (!this.groupOpen) return;
    this.groupOpen = false;
    const first = this.groupFirst;
    let isMatch = false;
    let hits = NO_PATTERNS;
    // Raw lines are matched as stored; every rendered line is kept for the returned text.
    const text = this.normalize
      ? this.renderGroup()
      : (this.ring[first % this.ringSize] as Buffer).subarray(
          0,
          this.ringLength[first % this.ringSize],
        );
    if (this.groupMatchable) {
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
    const omitted = this.ringOmitted[slot];
    const decoded = decodeFragment(
      (this.ring[slot] as Buffer).subarray(0, this.ringLength[slot]),
      false,
      omitted > 0,
      this.decoder,
    );
    // Counted after decoding: each invalid source byte becomes a three-byte U+FFFD.
    const size = Buffer.byteLength(decoded.text);
    if (this.outputBytes > 0 && this.outputBytes + size > this.outputLimit) {
      this.stopForOutput(matchLine);
      return false;
    }
    this.outputBytes += size;
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
