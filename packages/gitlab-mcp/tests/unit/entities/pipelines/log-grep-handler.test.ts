import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { closeLineGrepWorkers } from '../../../../src/entities/pipelines/line-grep-worker';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
jest.mock('node:worker_threads', () => ({
  ...jest.requireActual<typeof import('node:worker_threads')>('node:worker_threads'),
  // A plain constructor: mock resets between tests must not erase the worker stand-in.
  Worker: function Worker() {
    return jest
      .requireActual<typeof import('../../helpers/in-process-grep-worker')>(
        '../../helpers/in-process-grep-worker',
      )
      .createFakeGrepWorker();
  },
}));
installFetchMock();
afterEach(() => closeLineGrepWorkers());

const grep = (args: Record<string, unknown>) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    action: 'log_grep',
    project_id: 'test/project',
    job_id: '7',
    ...args,
  });

const trace = (text: string) => new Response(new TextEncoder().encode(text));

describe('browse_pipelines log_grep', () => {
  // The preset alone answers "why did this job fail" with context and line numbers.
  it('finds failures in the job trace with default context', async () => {
    const log = [
      '$ make',
      'cc -c main.c',
      'main.c:3: error: expected ;',
      'make: *** [all] Error 1',
    ];
    mockEnhancedFetch.mockResolvedValueOnce(
      trace(log.concat('', 'done', 'x', 'y', 'z').join('\n')),
    );
    const result = await grep({ preset: 'failures' });
    expect(mockEnhancedFetch.mock.calls[0][0]).toMatch(
      /\/api\/v4\/projects\/test%2Fproject\/jobs\/7\/trace$/,
    );
    expect(result).toEqual({
      hunks: [
        {
          start_line: 0,
          lines: [...log, '', 'done'],
          matches: [
            { line: 2, patterns: [0] },
            { line: 3, patterns: [0] },
          ],
        },
      ],
      match_count: 2,
      match_count_complete: true,
      scanned_lines: 9,
      total_lines: 9,
      truncated: null,
      resume_from: null,
      preset_index: 0,
    });
  });

  // Without patterns or a preset there is nothing to search: refuse before GitLab.
  it('requires patterns or a preset', async () => {
    await expect(grep({})).rejects.toThrow('needs patterns, a preset or both');
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // Invalid RE2 is reported with its index and costs no GitLab request.
  it('rejects an invalid pattern before fetching the trace', async () => {
    await expect(grep({ patterns: ['ok', 'a**'] })).rejects.toThrow('Invalid RE2 pattern 1');
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // Schema bounds are enforced before any work starts.
  it.each([
    { patterns: Array.from({ length: 9 }, () => 'a') },
    { patterns: ['x'.repeat(513)] },
    { patterns: [''] },
    { patterns: ['a'], before: 21 },
    { patterns: ['a'], max_matches: 0 },
    { patterns: ['a'], max_matches: 501 },
    { patterns: ['a'], start_line: -1 },
    { preset: 'everything' },
  ])('rejects out-of-range arguments %j', async (args) => {
    await expect(grep(args)).rejects.toThrow();
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // GitLab errors keep their status and never return an empty successful search.
  it('reports a GitLab error and releases the body', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream({ type: 'bytes', cancel });
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(body, { status: 403, statusText: 'Forbidden' }),
    );
    await expect(grep({ patterns: ['error'] })).rejects.toThrow('GitLab API error: 403 Forbidden');
    expect(cancel).toHaveBeenCalled();
  });

  // Resuming with start_line continues after a max_matches cut without repeats.
  it('continues from resume_from', async () => {
    const log = Array.from({ length: 6 }, (_, i) => `error ${i}`).join('\n');
    mockEnhancedFetch.mockResolvedValueOnce(trace(log)).mockResolvedValueOnce(trace(log));
    const first = (await grep({ patterns: ['error'], max_matches: 4, before: 0, after: 0 })) as {
      resume_from: number;
      truncated: string;
    };
    expect(first).toMatchObject({ truncated: 'max_matches', resume_from: 4, match_count: 6 });
    const rest = await grep({
      patterns: ['error'],
      before: 0,
      after: 0,
      start_line: first.resume_from,
    });
    expect(rest).toMatchObject({
      hunks: [{ start_line: 4, lines: ['error 4', 'error 5'] }],
      truncated: null,
    });
  });
});
