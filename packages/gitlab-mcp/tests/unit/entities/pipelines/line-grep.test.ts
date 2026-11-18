import {
  LineGrepScanner,
  serveLineGrep,
  type GrepPort,
  type GrepReply,
  type GrepRequest,
  type LineGrepOptions,
  type LineGrepResult,
} from '../../../../src/entities/pipelines/line-grep';
import { TRACE_LINE_BYTES } from '../../../../src/entities/pipelines/trace';
import { MAX_PATTERN_LENGTH } from '../../../../src/utils/re2-pattern';

const ESC = '\x1b';
// Code points keep the source ASCII; the scanner sees the same multibyte UTF-8.
const BOM = String.fromCodePoint(0xfeff);
const E_ACUTE = String.fromCodePoint(0xe9);
const I_DIAERESIS = String.fromCodePoint(0xef);
const GO = String.fromCodePoint(0x8a9e);
const NIHONGO = String.fromCodePoint(0x65e5, 0x672c, 0x8a9e);
const EURO = String.fromCodePoint(0x20ac);
const options = (overrides: Partial<LineGrepOptions> = {}): LineGrepOptions => ({
  patterns: ['error'],
  before: 0,
  after: 0,
  maxMatches: 50,
  invert: false,
  startLine: 0,
  normalize: true,
  budgetMs: 60_000,
  ...overrides,
});

/** Feed `source` in chunks and merge streamed progress with the final report, as the pool does. */
function scan(
  source: string | Uint8Array,
  overrides: Partial<LineGrepOptions> = {},
  chunkSize = 7,
): LineGrepResult {
  const scanner = new LineGrepScanner(options(overrides));
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  const streamed = [];
  for (let offset = 0; offset < bytes.length && !scanner.exhausted; offset += chunkSize) {
    scanner.push(bytes.slice(offset, offset + chunkSize));
    streamed.push(...scanner.progress().hunks);
  }
  const result = scanner.finish();
  return { ...result, hunks: streamed.concat(result.hunks) };
}

const texts = (result: LineGrepResult) => result.hunks.map((hunk) => hunk.lines);
const matched = (result: LineGrepResult) =>
  result.hunks.flatMap((hunk) => hunk.matches.map((match) => match.line));

describe('GitLab trace rendering before matching', () => {
  // Colors split words in the source; agents write patterns against the rendered text.
  it('removes ANSI escapes so a colored word matches', () => {
    const result = scan(`${ESC}[31;1mERR${ESC}[0;mOR: Job failed\n`, { patterns: ['^ERROR: Job'] });
    expect(texts(result)).toEqual([['ERROR: Job failed']]);
  });

  // A progress bar rewrites its line with CR; only the final state is visible in GitLab.
  it('keeps only the text after the last carriage return', () => {
    const result = scan('Downloading 10%\rDownloading 100%\n', { patterns: ['10'] });
    expect(texts(result)).toEqual([['Downloading 100%']]);
  });

  // CRLF and repeated CRs before LF end the line instead of clearing it (GitLab CRLF_REGEX).
  it.each(['done\r\n', 'done\r\r\n'])('treats %j as a line ending', (source) => {
    expect(texts(scan(source, { patterns: ['^done$'] }))).toEqual([['done']]);
  });

  // Section markers are rendering metadata; the visible header text follows them.
  it('drops section markers with and without options', () => {
    const source =
      `section_start:1700000000:step_script[collapsed=true,hide_duration=false]\r${ESC}[0K` +
      `${ESC}[0K${ESC}[36;1mExecuting "step_script"${ESC}[0;m\n` +
      `section_end:1700000042:step_script\r${ESC}[0K`;
    const result = scan(source, { patterns: ['^Executing', '^$'] });
    expect(texts(result)).toEqual([['Executing "step_script"', '']]);
    expect(result.hunks[0].matches).toEqual([
      { line: 0, patterns: [0] },
      { line: 1, patterns: [1] },
    ]);
  });

  // A text that only resembles a marker (missing the \r\e[0K suffix) is ordinary output.
  it('keeps marker-like text without the GitLab suffix', () => {
    expect(texts(scan('section_start:1:name\n', { patterns: ['section_start'] }))).toEqual([
      ['section_start:1:name'],
    ]);
  });

  // GitLab drops the rest of a line after an unterminated escape sequence.
  it('drops the remainder after an unterminated escape like the GitLab view', () => {
    expect(texts(scan(`visible${ESC}[31\x01hidden error`, { invert: true }))).toEqual([
      ['visible'],
    ]);
  });

  // Timestamped runner logs prefix every line; the prefix is reported, not matched.
  it('strips and reports runner timestamps', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const result = scan(`${stamp} 00O plain\n${stamp} 01E+error here\n`, {
      patterns: ['^error here$'],
      before: 1,
    });
    expect(result.hunks).toEqual([
      {
        start_line: 0,
        lines: ['plain', 'error here'],
        matches: [{ line: 1, patterns: [0] }],
        timestamps: [stamp, stamp],
      },
    ]);
  });

  // A timestamp-like prefix that breaks the header grammar stays part of the text.
  it('does not strip an invalid timestamp header', () => {
    const line = '2026-11-18T10:00:00.123456Z 0gO error';
    expect(texts(scan(`${line}\n`))).toEqual([[line]]);
  });

  // raw:true matches the stored bytes, escapes and markers included.
  it('matches source bytes when normalization is disabled', () => {
    const result = scan(`${ESC}[31merror${ESC}[0m\n`, {
      patterns: ['\\x1b\\[31m'],
      normalize: false,
    });
    expect(texts(result)).toEqual([[`${ESC}[31merror${ESC}[0m`]]);
  });

  // Response.text() removes only the initial BOM; later BOMs are content.
  it('drops only the leading byte order mark', () => {
    const result = scan(`${BOM}error\n${BOM}error`, {});
    expect(texts(result)).toEqual([['error', `${BOM}error`]]);
  });
});

describe('hunks and context', () => {
  const lines = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n');

  // Context is clamped at both ends of the log, not padded or wrapped.
  it('clamps context at the first and last line', () => {
    const result = scan(lines, { patterns: ['line [09]$'], before: 3, after: 3 });
    expect(result.hunks.map((hunk) => [hunk.start_line, hunk.lines.length])).toEqual([
      [0, 4],
      [6, 4],
    ]);
  });

  // Overlapping and adjacent windows form one hunk, as with grep -C.
  it('merges overlapping and adjacent windows', () => {
    const overlapping = scan(lines, { patterns: ['line [24]$'], before: 1, after: 1 });
    expect(overlapping.hunks.map((hunk) => [hunk.start_line, hunk.lines.length])).toEqual([[1, 5]]);
    const adjacent = scan(lines, { patterns: ['line [25]$'], before: 1, after: 1 });
    expect(adjacent.hunks.map((hunk) => [hunk.start_line, hunk.lines.length])).toEqual([[1, 6]]);
    const apart = scan(lines, { patterns: ['line [26]$'], before: 1, after: 1 });
    expect(apart.hunks.map((hunk) => [hunk.start_line, hunk.lines.length])).toEqual([
      [1, 3],
      [5, 3],
    ]);
  });

  // Every pattern that matches a line is reported, and the preset follows caller patterns.
  it('reports each matching pattern and the preset index', () => {
    const result = scan('ERROR: thing\nok\n', { patterns: ['thing', 'ERR'], preset: 'failures' });
    expect(result.preset_index).toBe(2);
    expect(result.hunks[0].matches).toEqual([{ line: 0, patterns: [0, 1, 2] }]);
  });

  // The preset alone finds common failure output and stays quiet on a green log.
  it('finds common failures with the preset alone', () => {
    const log = [
      'Running tests',
      'error[E0425]: cannot find value `x` in this scope',
      'All good',
      "thread 'main' panicked at src/main.rs:2:5",
      'Traceback (most recent call last):',
      'ValueError: bad input',
      'npm ERR! code ELIFECYCLE',
      'ERROR: Job failed: exit code 1',
      'Job succeeded',
      'make: *** [Makefile:4: all] Error 2',
      '0 errors, 0 warnings',
    ].join('\n');
    const result = scan(log, { patterns: [], preset: 'failures' });
    expect(matched(result)).toEqual([1, 3, 4, 5, 6, 7, 9]);
  });

  // invert selects the lines no pattern matches, without pattern indexes.
  it('selects non-matching lines with invert', () => {
    const result = scan('a\nerror\nb', { invert: true });
    expect(result.hunks).toEqual([
      { start_line: 0, lines: ['a'], matches: [{ line: 0, patterns: [] }] },
      { start_line: 2, lines: ['b'], matches: [{ line: 2, patterns: [] }] },
    ]);
    expect(result.match_count).toBe(2);
  });
});

describe('limits and continuation', () => {
  const log = Array.from({ length: 40 }, (_, index) =>
    index % 4 === 0 ? `error ${index}` : `ok ${index}`,
  ).join('\n');

  // max_matches limits reported matches while match_count still counts to EOF.
  it('counts all matches beyond max_matches', () => {
    const result = scan(log, { maxMatches: 3 });
    expect(matched(result)).toEqual([0, 4, 8]);
    expect(result).toMatchObject({
      match_count: 10,
      match_count_complete: true,
      total_lines: 40,
      truncated: 'max_matches',
      resume_from: 9,
    });
  });

  // Resuming from resume_from returns every remaining match exactly once.
  it('resumes without losing or repeating matches', () => {
    const seen: number[] = [];
    let start: number | null = 0;
    while (start !== null) {
      const page = scan(log, { maxMatches: 3, startLine: start, before: 2, after: 1 });
      seen.push(...matched(page));
      start = page.resume_from;
    }
    expect(seen).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
  });

  // Lines before start_line may appear as context but are never reported as matches.
  it('shows earlier lines only as context after start_line', () => {
    const result = scan(log, { startLine: 3, before: 2, maxMatches: 1 });
    expect(result.hunks).toEqual([
      { start_line: 2, lines: ['ok 2', 'ok 3', 'error 4'], matches: [{ line: 4, patterns: [0] }] },
    ]);
  });

  // A match after the limit inside the last after-context is shown as context only.
  it('keeps the last after-context when the limit is reached', () => {
    const result = scan('error 0\nerror 1\nerror 2', { maxMatches: 1, after: 2 });
    expect(result.hunks).toEqual([
      {
        start_line: 0,
        lines: ['error 0', 'error 1', 'error 2'],
        matches: [{ line: 0, patterns: [0] }],
      },
    ]);
    expect(result.resume_from).toBe(1);
  });

  // An exhausted budget stops at a line boundary with a cursor, not an error.
  it('returns a resumable partial result when the budget is spent', () => {
    const many = Array.from({ length: 2000 }, (_, index) => `error ${index}`).join('\n');
    const first = scan(many, { budgetMs: 0, maxMatches: 500 }, 65536);
    expect(first).toMatchObject({
      truncated: 'budget',
      match_count_complete: false,
      total_lines: null,
    });
    expect(first.resume_from).toBe(first.scanned_lines);
    expect(matched(first)).toEqual(Array.from({ length: first.match_count }, (_, i) => i));
    const rest = scan(many, { startLine: first.resume_from!, maxMatches: 2000 }, 65536);
    expect(matched(first).concat(matched(rest))).toEqual(
      Array.from({ length: 2000 }, (_, index) => index),
    );
  });

  // Line totals follow String.split: empty input and a final LF each count a line.
  it.each([
    ['', 1],
    ['error', 1],
    ['error\n', 2],
    ['a\n\nb', 3],
  ])('counts lines of %j like String.split', (source, total) => {
    expect(scan(source).total_lines).toBe(total);
  });
});

describe('bytes and long lines', () => {
  // Network chunks can split a UTF-8 character; matching must see the whole line.
  it('matches multibyte text split across chunks', () => {
    const french = `na${I_DIAERESIS}ve ${E_ACUTE}chec`;
    const japanese = `${NIHONGO} error`;
    const result = scan(
      `${french}\n${japanese}\n`,
      { patterns: [`${E_ACUTE}chec`, `${GO} error`] },
      1,
    );
    expect(texts(result)).toEqual([[french, japanese]]);
  });

  // Only the first 16 KiB of a line is matched and returned; the rest is reported.
  it('clips a long line and reports the omitted bytes', () => {
    const source = `error${'x'.repeat(TRACE_LINE_BYTES)}tail-error\nnext`;
    const result = scan(source, { patterns: ['tail-error', '^error'] }, 65536);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].lines[0]).toHaveLength(TRACE_LINE_BYTES);
    expect(result.hunks[0].matches).toEqual([{ line: 0, patterns: [1] }]);
    expect(result.hunks[0].clipped).toEqual([{ line: 0, omitted_bytes: 15 }]);
  });

  // A clip through a multibyte character omits the fragment instead of inventing U+FFFD.
  it('never splits a character at the clip boundary', () => {
    const source = `${'a'.repeat(TRACE_LINE_BYTES - 1)}${EURO} error`;
    const result = scan(source, { invert: true }, 4096);
    expect(result.hunks[0].lines[0]).toBe('a'.repeat(TRACE_LINE_BYTES - 1));
    expect(result.hunks[0].clipped).toEqual([{ line: 0, omitted_bytes: 9 }]);
  });
});

describe('pattern contract', () => {
  // Every invalid caller pattern is rejected with its index before any data is read.
  it.each([
    [['ok', '(unclosed'], 'Invalid RE2 pattern 1: '],
    [['x'.repeat(MAX_PATTERN_LENGTH + 1)], 'exceeds 512 characters'],
    [['(?:a{1000}){1000}'], 'Invalid RE2 pattern 0'],
    [['(?:a{1000}|b{1000}|c{1000})'], 'more than 2000 instructions'],
    [['(?<=a)b'], 'Invalid RE2 pattern 0'],
    [Array.from({ length: 9 }, () => 'a'), 'at most 8 patterns'],
  ])('rejects %j', (patterns, message) => {
    expect(() => new LineGrepScanner(options({ patterns }))).toThrow(message);
  });
});

describe('worker protocol', () => {
  function port() {
    const replies: GrepReply[] = [];
    let listener: (request: GrepRequest) => void = () => undefined;
    const fake = {
      on: (_event: string, handler: (request: GrepRequest) => void) => {
        listener = handler;
        return fake;
      },
      postMessage: (reply: GrepReply) => replies.push(reply),
    } as unknown as GrepPort;
    serveLineGrep(fake);
    return { replies, send: (request: GrepRequest) => listener(request) };
  }

  // The worker answers each request once and returns the transport buffer with progress.
  it('runs start, chunk and end, then holds no state', () => {
    const { replies, send } = port();
    send({ type: 'start', options: options() });
    const bytes = new TextEncoder().encode('ok\nerror\n');
    const { buffer } = bytes;
    send({ type: 'chunk', buffer, offset: 0, length: bytes.length });
    send({ type: 'end' });
    send({ type: 'chunk', buffer, offset: 0, length: bytes.length });
    expect(replies.map((reply) => reply.type)).toEqual(['ready', 'progress', 'done', 'failed']);
    expect(replies[1]).toMatchObject({ buffer, progress: { scanned_lines: 2 } });
    expect(replies[2]).toMatchObject({ result: { total_lines: 3, match_count: 1 } });
  });

  // Pattern errors are distinguished from internal failures so callers can report them.
  it('reports invalid patterns and recovers on reset', () => {
    const { replies, send } = port();
    send({ type: 'start', options: options({ patterns: ['('] }) });
    send({ type: 'reset' });
    expect(replies[0]).toMatchObject({
      type: 'invalid',
      message: expect.stringContaining('pattern 0'),
    });
    expect(replies[1]).toEqual({ type: 'ready' });
  });
});
