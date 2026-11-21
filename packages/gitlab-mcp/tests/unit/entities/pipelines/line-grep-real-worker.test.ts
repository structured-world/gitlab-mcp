import {
  closeLineGrepWorkers,
  grepStream,
} from '../../../../src/entities/pipelines/line-grep-worker';

afterAll(() => closeLineGrepWorkers());

// The worker thread must load the scanner in the runtime that loaded the pool: compiled
// JavaScript in production, TypeScript sources under the test runner and the dev server.
it('scans on a real worker thread when the pool runs from TypeScript sources', async () => {
  const result = await grepStream(
    {
      patterns: ['error'],
      before: 0,
      after: 0,
      maxMatches: 50,
      invert: false,
      startLine: 0,
      normalize: true,
      budgetMs: 2000,
      outputBytes: 1 << 20,
    },
    async () => new Response('ok\nerror\n').body,
  );
  expect(result).toMatchObject({
    hunks: [{ start_line: 1, lines: ['error'], matches: [{ line: 1, patterns: [0] }] }],
    match_count: 1,
    total_lines: 3,
    truncated: null,
  });
}, 30_000);

// A missing section is found on the worker; its explanation must reach the caller intact.
it('reports a missing section from the worker thread with the available names', async () => {
  const log = 'section_start:1:step_script\r\x1b[0Kx\nsection_end:2:step_script\r\x1b[0K\n';
  await expect(
    grepStream(
      {
        patterns: [],
        before: 0,
        after: 0,
        maxMatches: 1,
        invert: false,
        startLine: 0,
        normalize: true,
        budgetMs: 2000,
        outputBytes: 1 << 20,
        section: { name: 'build', index: 0 },
      },
      async () => new Response(log).body,
    ),
  ).rejects.toThrow("Section 'build' not found; sections: step_script");
}, 30_000);

// A stream that is not a byte stream (the raw artifact download) cannot be read in place.
// Its chunks, here 3 bytes cutting through multibyte characters and lines, are copied
// into the transport buffer unchanged and in order.
it('searches a stream that is not a byte stream', async () => {
  const text = `ok\n${'€'.repeat(40000)}\nFAIL €\nok\n`;
  const bytes = Buffer.from(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + 3));
      offset += 3;
    },
  });
  const result = await grepStream(
    {
      patterns: ['^FAIL'],
      before: 0,
      after: 0,
      maxMatches: 50,
      invert: false,
      startLine: 0,
      normalize: false,
      budgetMs: 2000,
      outputBytes: 1 << 20,
      byteOffsets: true,
      requireText: true,
    },
    async () => body,
  );
  expect(result).toMatchObject({
    hunks: [{ start_line: 2, lines: ['FAIL €'], byte_offset: 120004 }],
    total_lines: 5,
    scanned_bytes: bytes.length,
  });
}, 30_000);
