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
