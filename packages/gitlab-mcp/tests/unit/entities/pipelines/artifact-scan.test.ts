import {
  LineGrepScanner,
  serveLineGrep,
  type GrepPort,
  type GrepReply,
  type GrepRequest,
  type LineGrepOptions,
  type LineGrepResult,
} from '../../../../src/entities/pipelines/line-grep';
import { NotTextError, TextValidator } from '../../../../src/entities/pipelines/text-scan';

// Code points keep the source ASCII; the scanner sees multibyte UTF-8.
const EURO = String.fromCodePoint(0x20ac);
const SMILE = String.fromCodePoint(0x1f600);

// The options artifact_grep passes: raw lines, byte offsets, a scan limit and the text rule.
const options = (overrides: Partial<LineGrepOptions> = {}): LineGrepOptions => ({
  patterns: ['FAIL'],
  before: 0,
  after: 0,
  maxMatches: 50,
  invert: false,
  startLine: 0,
  normalize: false,
  budgetMs: 60_000,
  outputBytes: 1 << 20,
  byteOffsets: true,
  requireText: true,
  ...overrides,
});

function scan(
  source: string | Uint8Array,
  overrides: Partial<LineGrepOptions> = {},
  chunkSize = 5,
): LineGrepResult {
  const scanner = new LineGrepScanner(options(overrides));
  const bytes = typeof source === 'string' ? Buffer.from(source) : source;
  const streamed = [];
  for (let offset = 0; offset < bytes.length && !scanner.exhausted; offset += chunkSize) {
    scanner.push(bytes.slice(offset, offset + chunkSize));
    streamed.push(...scanner.progress().hunks);
  }
  const result = scanner.finish();
  return { ...result, hunks: streamed.concat(result.hunks) };
}

describe('byte offsets of hunks', () => {
  // Each offset must locate the hunk's first line in the source, multibyte text before it
  // included, so artifact_file can read the same lines back from it.
  it.each([1, 3, 7, 64])('locates every hunk in the source with %i-byte chunks', (chunk) => {
    const source = `${EURO} start\nok ${SMILE}\nFAIL one\nok\nok\n${EURO}${EURO}\nFAIL two\n`;
    const result = scan(source, { before: 1 }, chunk);
    expect(result.hunks.map((hunk) => hunk.start_line)).toEqual([1, 5]);
    for (const hunk of result.hunks) {
      const text = Buffer.from(source).subarray(hunk.byte_offset).toString();
      expect(text.startsWith(hunk.lines.join('\n'))).toBe(true);
    }
    expect(result.scanned_bytes).toBe(Buffer.byteLength(source));
  });

  // A match found on a continued page still reports its absolute offset.
  it('reports absolute offsets when the search starts past line 0', () => {
    const source = 'FAIL a\nok\nFAIL b\n';
    const result = scan(source, { startLine: 1 });
    expect(result.hunks).toMatchObject([{ start_line: 2, byte_offset: 10, lines: ['FAIL b'] }]);
  });

  // Hunks restarted at their match by the output limit move their offset with them.
  it('moves the offset when the first hunk restarts at its match', () => {
    const source = `${'x'.repeat(40)}\nFAIL\n`;
    const result = scan(source, { before: 1, outputBytes: 10 });
    expect(result.hunks).toMatchObject([{ start_line: 1, byte_offset: 41, lines: ['FAIL'] }]);
  });

  // Without byteOffsets (log_grep), neither field appears.
  it('adds no byte fields unless asked', () => {
    const result = scan('FAIL\n', { byteOffsets: false });
    expect(result.hunks[0]).not.toHaveProperty('byte_offset');
    expect(result).not.toHaveProperty('scanned_bytes');
  });
});

describe('scan limit', () => {
  // A line that ends exactly at the limit is searched; nothing past it is.
  it('searches lines ending at the limit and stops before the next', () => {
    const source = 'ok\nFAIL 1\nFAIL 2\n';
    const result = scan(source, { maxBytes: 10 });
    expect(result).toMatchObject({
      match_count: 1,
      match_count_complete: false,
      scanned_lines: 2,
      scanned_bytes: 10,
      total_lines: null,
      truncated: 'scan_limit',
      resume_from: null,
      scan_limit_reached: true,
    });
  });

  // An unterminated line crossing the limit is not reported as a whole line.
  it('drops an unterminated line that crosses the limit', () => {
    const result = scan('ok\nFAIL and more', { maxBytes: 8 });
    expect(result).toMatchObject({ match_count: 0, scan_limit_reached: true, scanned_bytes: 3 });
  });

  // A file of exactly the limit is complete.
  it('treats a file of exactly the limit as complete', () => {
    const result = scan('ok\nFAIL', { maxBytes: 7 });
    expect(result).toMatchObject({
      match_count: 1,
      total_lines: 2,
      truncated: null,
      scan_limit_reached: false,
      scanned_bytes: 7,
    });
  });

  // max_matches still offers a continuation; the limit is reported alongside.
  it('keeps the max_matches continuation when the limit is also reached', () => {
    const result = scan('FAIL 1\nFAIL 2\nFAIL 3\n', { maxBytes: 16, maxMatches: 1 });
    expect(result).toMatchObject({
      match_count: 2,
      truncated: 'max_matches',
      resume_from: 1,
      scan_limit_reached: true,
    });
  });

  // Binary bytes past the limit are never searched, so they do not refuse the file.
  it('ignores binary bytes past the limit', () => {
    const result = scan(Buffer.concat([Buffer.from('FAIL\n'), Buffer.from([0, 1, 2])]), {
      maxBytes: 5,
    });
    expect(result).toMatchObject({ match_count: 1, scan_limit_reached: true });
  });
});

describe('text rule', () => {
  // A NUL deep in the file refuses it, as artifact_file refuses binary windows.
  it('refuses a control byte mid-stream', () => {
    const source = Buffer.concat([Buffer.from('FAIL\n'.repeat(20)), Buffer.from([0])]);
    expect(() => scan(source)).toThrow(NotTextError);
  });

  // Tab, FF, CR and ESC are text in test output.
  it('accepts the control bytes artifact_file accepts', () => {
    expect(scan('FAIL\t\f\r\x1b[0m\n').match_count).toBe(1);
  });

  // Characters split across every possible chunk boundary are valid.
  it.each([1, 2, 3])('accepts multibyte text split into %i-byte chunks', (chunk) => {
    expect(scan(`${SMILE}${EURO} FAIL ${SMILE}\n`, {}, chunk).match_count).toBe(1);
  });

  // Invalid UTF-8 is refused whether the bad byte is alone or completes a split character.
  it.each([
    ['a lone continuation byte', Buffer.from([0x46, 0x80, 0x0a])],
    ['a truncated character at EOF', Buffer.from([0x46, 0xe2, 0x82])],
    ['a lead byte followed by ASCII', Buffer.from([0xe2, 0x41, 0x41, 0x0a])],
    ['an overlong encoding', Buffer.from([0xc0, 0xaf, 0x0a])],
  ])('refuses %s', (_name, bytes) => {
    for (const chunk of [1, 2, 64]) expect(() => scan(bytes, {}, chunk)).toThrow(NotTextError);
  });

  // A search stopped early never judges a character the stream cut off.
  it('does not judge a split character when the scan stopped first', () => {
    const scanner = new LineGrepScanner(options({ maxBytes: 4 }));
    scanner.push(Buffer.from([0x46, 0x0a, 0x41, 0x41, 0x41, 0xe2]));
    expect(scanner.finish()).toMatchObject({ scan_limit_reached: true });
  });
});

describe('TextValidator', () => {
  // Holding back an incomplete character must not accept one that never completes.
  it('rejects a character still incomplete at the end', () => {
    const validator = new TextValidator();
    validator.push(Buffer.from([0xf0, 0x9f]));
    validator.push(Buffer.from([0x98]));
    expect(() => validator.end()).toThrow('not valid UTF-8');
  });
});

// The worker must report a refusal by type, so the caller can answer with not_text.
it('replies refused for content that is not text', () => {
  const replies: GrepReply[] = [];
  let handler: ((request: GrepRequest) => void) | undefined;
  const port: GrepPort = {
    on: ((_event: string, listener: (request: GrepRequest) => void) => {
      handler = listener;
    }) as GrepPort['on'],
    postMessage: (reply: GrepReply) => replies.push(reply),
  };
  serveLineGrep(port);
  handler!({ type: 'start', options: options() });
  const buffer = new Uint8Array([0x41, 0x00, 0x0a]).buffer;
  handler!({ type: 'chunk', buffer, offset: 0, length: 3 });
  expect(replies[1]).toEqual({
    type: 'refused',
    message: 'Artifact is binary and cannot be searched as text',
  });
});
