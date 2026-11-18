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
  outputBytes: 1 << 20,
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
    const result = scan(`${stamp} 00O plain\n${stamp} 01E error here\n`, {
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

  // raw:true promises the stored bytes, the leading byte order mark included.
  it('keeps the leading byte order mark in raw mode', () => {
    const result = scan(`${BOM}error\nok`, { normalize: false, patterns: ['^\\x{FEFF}error'] });
    expect(texts(result)).toEqual([[`${BOM}error`]]);
  });

  // The runner splits a long output line into timestamped fragments marked '+';
  // GitLab shows them as one line, so a match may span the fragments.
  it('matches across timestamped continuation fragments', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = `${stamp} 00O ER\n${stamp} 00O+ROR: failed\n${stamp} 00O done`;
    const result = scan(source, { patterns: ['^ERROR: failed$'] });
    expect(result.hunks).toEqual([
      {
        start_line: 0,
        lines: ['ER', 'ROR: failed'],
        matches: [{ line: 0, patterns: [0] }],
        timestamps: [stamp, stamp],
      },
    ]);
    expect(result.match_count).toBe(1);
  });

  // The context ring grows on the first continuation; earlier context must survive it.
  it('keeps the before-context when the first continuation arrives late', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const plain = Array.from({ length: 6 }, (_, index) => `${stamp} 00O ok ${index}`);
    const fragments = [
      `${stamp} 00O E`,
      `${stamp} 00O+RR`,
      `${stamp} 00O+OR: x`,
      `${stamp} 00O tail`,
    ];
    const result = scan(plain.concat(fragments).join('\n'), {
      patterns: ['^ERROR: x$'],
      before: 3,
    });
    expect(result.hunks).toEqual([
      {
        start_line: 3,
        lines: ['ok 3', 'ok 4', 'ok 5', 'E', 'RR', 'OR: x'],
        matches: [{ line: 6, patterns: [0] }],
        timestamps: Array.from({ length: 6 }, () => stamp),
      },
    ]);
  });

  // Fragments below the per-line limit stay searchable however long their logical line is.
  it('searches every fragment of a logical line longer than one line limit', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const filler = 'x'.repeat(4000);
    const source = [
      `${stamp} 00O ${filler}`,
      ...Array.from({ length: 4 }, () => `${stamp} 00O+${filler}`),
      `${stamp} 00O+ error`,
    ].join('\n');
    const result = scan(source, { patterns: ['error'] }, 65536);
    expect(result.match_count).toBe(1);
    expect(result.hunks[0].matches).toEqual([{ line: 0, patterns: [0] }]);
  });

  // A logical line longer than the fragment limit continues in a new group that is still
  // searched; only a fragment whose head was never read is context.
  it('keeps fragments searchable past the fragment limit of one logical line', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = [
      `${stamp} 00O start`,
      ...Array.from({ length: 31 }, (_, index) => `${stamp} 00O+ part ${index}`),
      `${stamp} 00O+ error here`,
      `${stamp} 00O+ more`,
    ].join('\n');
    const result = scan(source, { patterns: ['error'] }, 65536);
    expect(result.match_count).toBe(1);
    expect(result.hunks[0].matches).toEqual([{ line: 32, patterns: [0] }]);
  });

  // Fragment groups follow the trace, not start_line: a resumed search inside a long
  // logical line still searches every later group and reports each match once.
  it('resumes inside a long logical line without losing later groups', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = Array.from({ length: 65 }, (_, index) => {
      const text = index % 32 === 0 ? ` error ${index}` : ` part ${index}`;
      return `${stamp} 00O${index === 0 ? ' ' : '+'}${text}`;
    }).join('\n');
    const seen: number[] = [];
    let start: number | null = 0;
    for (let page = 0; start !== null && page < 5; page++) {
      const result = scan(source, { startLine: start, maxMatches: 1 }, 65536);
      seen.push(...matched(result));
      start = result.resume_from;
    }
    expect(start).toBeNull();
    expect(seen).toEqual([0, 32, 64]);
  });

  // A CR inside a later fragment clears the whole logical line, as in the GitLab view,
  // in the matched text and in the returned fragments alike.
  it('lets a carriage return in a fragment clear the earlier fragments', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = `${stamp} 00O progress 10%\n${stamp} 00O+ 50%\rERROR: x`;
    const result = scan(source, { patterns: ['^ERROR: x$', 'progress'] });
    expect(result.hunks[0].matches).toEqual([{ line: 0, patterns: [0] }]);
    expect(texts(result)).toEqual([['', 'ERROR: x']]);
  });

  // GitLab joins fragments before CR handling: a CR ending a continued fragment clears it.
  it('lets a carriage return ending a continued fragment clear it', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = `${stamp} 00O progress\r\n${stamp} 00O+ERROR\n${stamp} 00O done\r\n`;
    const result = scan(source, { patterns: ['^ERROR$', '^done$'] });
    expect(result.hunks).toEqual([
      {
        start_line: 0,
        lines: ['', 'ERROR', 'done'],
        matches: [
          { line: 0, patterns: [0] },
          { line: 2, patterns: [1] },
        ],
        timestamps: [stamp, stamp, stamp],
      },
    ]);
  });

  // A continuation whose first fragment lies before start_line is context, never a match.
  it('does not match a continuation fragment without its head', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const source = `${stamp} 00O ER\n${stamp} 00O+ROR: failed`;
    expect(scan(source, { patterns: ['ROR'], startLine: 1 }).match_count).toBe(0);
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
      // A cursor that does not advance would loop forever instead of failing.
      if (page.resume_from !== null) expect(page.resume_from).toBeGreaterThan(start);
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
    expect(first.resume_from).toBeGreaterThan(0);
    expect(first.resume_from).toBeLessThanOrEqual(first.scanned_lines);
    const rest = scan(many, { startLine: first.resume_from!, maxMatches: 2000 }, 65536);
    expect(matched(first).concat(matched(rest))).toEqual(
      Array.from({ length: 2000 }, (_, index) => index),
    );
  });

  // Resuming far into a trace must make progress even when skipping the prefix is slow.
  it('advances past start_line when the budget is spent before reaching it', () => {
    const many = Array.from({ length: 4000 }, (_, index) => `error ${index}`).join('\n');
    const page = scan(many, { budgetMs: 0, startLine: 3000, maxMatches: 500 }, 65536);
    expect(page.truncated).toBe('budget');
    expect(page.resume_from).toBeGreaterThan(3000);
    expect(matched(page)[0]).toBe(3000);
  });

  // A budget stop finishes the after-context it promised instead of cutting the hunk.
  it('completes the after-context of the open hunk when the budget stops the scan', () => {
    const lines = Array.from({ length: 600 }, (_, index) =>
      index === 250 ? 'error' : `ok ${index}`,
    );
    const page = scan(lines.join('\n'), { budgetMs: 0, after: 10 }, 65536);
    expect(page.truncated).toBe('budget');
    expect(page.hunks).toEqual([
      { start_line: 250, lines: lines.slice(250, 261), matches: [{ line: 250, patterns: [0] }] },
    ]);
    expect(page.resume_from).toBe(261);
  });

  // Output is bounded: a page stops at the byte limit and resuming loses no match.
  // Matches past max_matches shown only as after-context must not fall behind the cursor
  // when the output limit then cuts the first hunk.
  it('resumes at unreported matches when the output limit cuts after max_matches', () => {
    const log = Array.from(
      { length: 100 },
      (_, index) => `error ${String(index).padStart(93, '0')}`,
    );
    const seen: number[] = [];
    let start: number | null = 0;
    for (let page = 0; start !== null && page < 20; page++) {
      const result = scan(log.join('\n'), {
        startLine: start,
        after: 20,
        maxMatches: 60,
        outputBytes: 6400,
      });
      seen.push(...matched(result));
      if (result.resume_from !== null) expect(result.resume_from).toBeGreaterThan(start);
      start = result.resume_from;
    }
    expect(seen).toEqual(Array.from({ length: 100 }, (_, index) => index));
  });

  it('stops at the output limit and resumes every match exactly once', () => {
    const log = Array.from(
      { length: 200 },
      (_, index) => `error ${String(index).padStart(200, '0')}`,
    );
    const seen: number[] = [];
    let start: number | null = 0;
    let pages = 0;
    while (start !== null) {
      const page = scan(log.join('\n'), {
        startLine: start,
        before: 2,
        after: 20,
        maxMatches: 500,
        outputBytes: 4096,
      });
      const bytes = page.hunks.reduce(
        (sum, hunk) => sum + hunk.lines.reduce((total, line) => total + Buffer.byteLength(line), 0),
        0,
      );
      expect(bytes).toBeLessThanOrEqual(4096);
      if (page.resume_from !== null) {
        expect(page.truncated).toBe('output_limit');
        expect(page.resume_from).toBeGreaterThan(start);
      }
      seen.push(...matched(page));
      start = page.resume_from;
      pages++;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(Array.from({ length: 200 }, (_, index) => index));
  });

  // The limit counts returned text: invalid bytes grow into U+FFFD when decoded.
  it('applies the output limit to decoded text', () => {
    const line = Buffer.concat([Buffer.from('error '), Buffer.alloc(1000, 0xff)]);
    const source = Buffer.concat(
      Array.from({ length: 40 }, (_, index) =>
        Buffer.concat([index > 0 ? Buffer.from('\n') : Buffer.alloc(0), line]),
      ),
    );
    const seen: number[] = [];
    let start: number | null = 0;
    for (let page = 0; start !== null && page < 40; page++) {
      const result = scan(source, { startLine: start, outputBytes: 8192 }, 65536);
      const bytes = result.hunks.reduce(
        (sum, hunk) => sum + hunk.lines.reduce((total, text) => total + Buffer.byteLength(text), 0),
        0,
      );
      expect(bytes).toBeLessThanOrEqual(8192);
      seen.push(...matched(result));
      start = result.resume_from;
    }
    expect(seen).toEqual(Array.from({ length: 40 }, (_, index) => index));
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

  // Patterns valid on their own stay valid together: shared group names, \Q to the end.
  it.each([
    [['(?P<part>error)', '(?P<part>warning)'], 'a warning here', [1]],
    [['\\Q[error]'], 'got [error] now', [0]],
    [['ok', '\\Q[error]'], 'got [error] now', [1]],
    // Joined, the open \Q would quote the next wrapper and still compile.
    [['\\Qfoo', '\\Qbar\\E'], 'bar', [1]],
  ])('accepts %j together', (patterns, line, hits) => {
    expect(scan(line, { patterns }).hunks[0].matches).toEqual([{ line: 0, patterns: hits }]);
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
