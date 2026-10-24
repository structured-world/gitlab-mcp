import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';
import {
  readTracePage,
  TRACE_LINE_BYTES,
  TRACE_PAGE_BYTES,
} from '../../../../src/entities/pipelines/trace';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const logs = (start?: number, per_page = 200) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    action: 'logs',
    project_id: 'test/project',
    job_id: '1',
    start,
    per_page,
  });

function streamed(text: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const response = new Response(
    new ReadableStream({
      type: 'bytes',
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          controller.byobRequest?.respond(0);
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    }),
  );
  // A small returned page must never materialize the complete response body.
  response.text = jest.fn().mockRejectedValue(new Error('Unbounded trace read'));
  return response;
}

describe('streamed job trace pagination', () => {
  it('reads a requested page without the whole-body text reader', async () => {
    // Prevent full trace buffering even when the result contains just two lines.
    mockEnhancedFetch.mockResolvedValueOnce(streamed('first\nsecond\nthird\nfourth'));
    await expect(logs(1, 2)).resolves.toEqual({
      trace: '[LOG TRUNCATED: Showing lines 1-2 of 4]\nsecond\nthird',
      totalLines: 4,
      shownLines: 2,
      startLine: 1,
      hasMore: true,
      nextStart: 3,
    });
  });

  it('preserves a UTF-8 character divided between network chunks', async () => {
    // Network boundaries must not introduce replacement characters into complete lines.
    mockEnhancedFetch.mockResolvedValueOnce(streamed('naïve\n日本語\n', 1));
    await expect(logs()).resolves.toEqual({
      trace: 'naïve\n日本語\n',
      totalLines: 3,
      shownLines: 3,
      startLine: 0,
      hasMore: false,
      nextStart: null,
    });
  });

  it.each(['', '\n', '\n\n', 'a\r\nb\r\n', '\uFEFFa\n\uFEFFb', 'a\nb\nc\nd'])(
    'preserves line selection for %j',
    async (source) => {
      // Compare all pagination directions with the previous split/slice contract.
      const all = source.replace(/^\uFEFF/, '').split('\n');
      for (const start of [undefined, -10000, -3, -1, 0, 1, all.length, all.length + 1]) {
        for (const size of [1, 2, 200, 10000]) {
          const expected =
            start === undefined
              ? all.slice(-size)
              : start < 0
                ? all.slice(start).slice(-size)
                : all.slice(start, start + size);
          const startLine = start === undefined || start < 0 ? all.length - expected.length : start;
          const body = streamed(source, 1).body;
          await expect(readTracePage(body, size, start)).resolves.toEqual({
            lines: expected,
            totalLines: all.length,
            startLine,
          });
          expect(body!.locked).toBe(false);
        }
      }
    },
  );

  it('reports exactly the bytes clipped from one huge line', async () => {
    // A missing LF must not allow the carry buffer to grow with the trace.
    const source = 'x'.repeat(2 * TRACE_PAGE_BYTES);
    const page = await readTracePage(streamed(source, 65536).body, 200);
    expect(page.lines).toEqual(['x'.repeat(TRACE_LINE_BYTES)]);
    expect(page.totalLines).toBe(1);
    expect(page.truncation).toEqual({
      reason: 'byte_limits',
      maxLineBytes: TRACE_LINE_BYTES,
      maxPageBytes: TRACE_PAGE_BYTES,
      lines: [
        { line: 0, omittedPrefixBytes: 0, omittedSuffixBytes: source.length - TRACE_LINE_BYTES },
      ],
    });
  });

  it.each([0, undefined])('bounds page content with start=%s', async (start) => {
    // Many individually acceptable lines must still obey the shared page budget.
    const all = Array.from({ length: 1000 }, (_, i) => `${i}:`.padEnd(2048, 'x'));
    const page = await readTracePage(streamed(all.join('\n'), 65536).body, 1000, start);
    expect(page.lines).toHaveLength(1000);
    expect(page.startLine).toBe(0);
    expect(page.totalLines).toBe(1000);
    expect(page.lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0)).toBe(
      TRACE_PAGE_BYTES,
    );
    expect(page.truncation!.lines).toHaveLength(488);
    const cut = start === 0 ? 512 : 0;
    expect(page.truncation!.lines[0]).toEqual({
      line: cut,
      omittedPrefixBytes: start === 0 ? 0 : 2048,
      omittedSuffixBytes: start === 0 ? 2048 : 0,
    });
    for (let i = 0; i < all.length; i++) {
      expect(page.lines[i]).toBe(start === 0 ? (i < 512 ? all[i] : '') : i < 488 ? '' : all[i]);
    }
  });

  it.each(['\u00E9', '\u20AC', '\u{1F600}'])(
    'does not split %s when the line byte limit cuts it',
    async (character) => {
      // A clipped code point is omitted explicitly rather than changed to U+FFFD.
      const source = `${'a'.repeat(TRACE_LINE_BYTES - 1)}${character}`;
      const page = await readTracePage(streamed(source, 65536).body, 1);
      expect(page.lines).toEqual(['a'.repeat(TRACE_LINE_BYTES - 1)]);
      expect(page.truncation!.lines).toEqual([
        { line: 0, omittedPrefixBytes: 0, omittedSuffixBytes: Buffer.byteLength(character) },
      ]);
    },
  );

  it('decodes the surviving UTF-8 suffix after the byte ring wraps', async () => {
    // The oldest retained line can lose a prefix partway through a code point.
    const source = Array(100).fill('\u20AC'.repeat(5461)).join('\n');
    const page = await readTracePage(streamed(source, 32768).body, 100);
    expect(page.lines.join('')).not.toContain('\uFFFD');
    expect(page.lines.at(-1)).toBe('\u20AC'.repeat(5461));
    expect(page.truncation!.lines.every((line) => line.omittedPrefixBytes % 3 === 0)).toBe(true);
    expect(page.lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(
      TRACE_PAGE_BYTES,
    );
  });

  it('adds content clipping metadata without changing source-line pagination', async () => {
    // Notice lines never contribute to shownLines or move the continuation cursor.
    mockEnhancedFetch.mockResolvedValueOnce(
      streamed(`${'x'.repeat(TRACE_LINE_BYTES + 2)}\nnext\nlast`, 65536),
    );
    const result = (await logs(0, 2)) as Record<string, unknown>;
    expect(result).toMatchObject({
      totalLines: 3,
      shownLines: 2,
      startLine: 0,
      hasMore: true,
      nextStart: 2,
    });
    expect(result.trace).toContain('line pagination cannot recover omitted bytes');
    expect(result.truncation).toMatchObject({ lines: [{ line: 0, omittedSuffixBytes: 2 }] });
  });

  it('rejects an absent body instead of falling back to text()', async () => {
    // A missing body cannot silently reintroduce unbounded materialization.
    await expect(readTracePage(null, 200)).rejects.toThrow('no readable body');
  });

  it('preserves decoding of malformed UTF-8 when no byte limit applies', async () => {
    // Byte-level line scanning must agree with Response.text() on invalid encodings.
    const bytes = new Uint8Array([0xc0, 0xff, 10, 0xf0, 0x9f]);
    const decoded = await new Response(bytes).text();
    await expect(readTracePage(new Response(bytes).body, 200)).resolves.toEqual({
      lines: decoded.split('\n'),
      totalLines: 2,
      startLine: 0,
    });
  });

  it('keeps the GitLab status when cancelling an error body also fails', async () => {
    // Cleanup errors must not replace an authentication or permission error.
    const cause = new Error('broken error body');
    const body = new ReadableStream<Uint8Array>({
      type: 'bytes',
      start(controller) {
        controller.error(cause);
      },
    });
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(body, { status: 403, statusText: 'Forbidden' }),
    );
    await expect(logs()).rejects.toMatchObject({
      message: 'GitLab API error: 403 Forbidden',
      cause,
    });
  });

  it('propagates a mid-stream failure and releases its reader', async () => {
    // Partial data must not be returned as a successfully completed trace.
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      type: 'bytes',
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('partial\n'));
        else controller.error(new Error('broken body'));
      },
    });
    await expect(readTracePage(body, 200)).rejects.toThrow('broken body');
    expect(body.locked).toBe(false);
  });

  it('rejects fractional and unsafe line offsets before fetching GitLab', async () => {
    // Ring indices and line cursors must be safe integers, never rounded offsets.
    for (const start of [0.5, -0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(logs(start)).rejects.toThrow();
    }
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });
});
