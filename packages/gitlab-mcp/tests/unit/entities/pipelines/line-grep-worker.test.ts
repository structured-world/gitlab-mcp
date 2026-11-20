import { setImmediate } from 'node:timers';
import type { LineGrepOptions } from '../../../../src/entities/pipelines/line-grep';
import { fakeGrepWorkers as mockWorkers } from '../../helpers/in-process-grep-worker';

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
// Three cores leave two workers: enough to show capacity without many processes.
jest.mock('node:os', () => ({
  ...jest.requireActual<typeof import('node:os')>('node:os'),
  availableParallelism: () => 3,
}));

import {
  closeLineGrepWorkers,
  grepStream,
} from '../../../../src/entities/pipelines/line-grep-worker';

const options = (overrides: Partial<LineGrepOptions> = {}): LineGrepOptions => ({
  patterns: ['error'],
  before: 1,
  after: 1,
  maxMatches: 50,
  invert: false,
  startLine: 0,
  normalize: true,
  budgetMs: 60_000,
  outputBytes: 1 << 20,
  ...overrides,
});

/**
 * Wait on real immediates for a condition, failing after a bounded number of turns or
 * when the scan under test settles first, so a broken scan cannot hang the test.
 */
async function waitFor(condition: () => boolean, settled: Promise<unknown>): Promise<void> {
  let done = false;
  settled.then(
    () => (done = true),
    () => (done = true),
  );
  for (let turn = 0; turn < 10_000; turn++) {
    if (condition()) return;
    if (done) throw new Error('The scan settled before the awaited condition');
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Condition not reached within 10000 turns');
}

function body(text: string, chunkSize = 5) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const cancel = jest.fn();
  const stream = new ReadableStream({
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
    cancel,
  });
  return { stream, cancel };
}

afterEach(async () => {
  await closeLineGrepWorkers();
  mockWorkers.length = 0;
});

describe('grepStream', () => {
  // Hunks streamed with progress and those in the final report form one ordered result.
  it('returns every hunk across chunk progress and completion', async () => {
    const log = Array.from({ length: 30 }, (_, i) => (i % 7 === 0 ? `error ${i}` : `ok ${i}`));
    const { stream } = body(log.join('\n'));
    const result = await grepStream(options(), async () => stream);
    expect(result.hunks.map((hunk) => hunk.matches.map((match) => match.line))).toEqual([
      [0],
      [7],
      [14],
      [21],
      [28],
    ]);
    expect(result).toMatchObject({ total_lines: 30, match_count: 5, truncated: null });
    expect(stream.locked).toBe(false);
  });

  // An invalid pattern is reported before GitLab is asked for the trace.
  it('rejects an invalid pattern without opening the trace', async () => {
    const open = jest.fn();
    await expect(grepStream(options({ patterns: ['(unclosed'] }), open)).rejects.toThrow(
      'Invalid RE2 pattern 0',
    );
    expect(open).not.toHaveBeenCalled();
    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0].terminate).not.toHaveBeenCalled();
  });

  // A failed GitLab request resets the worker, which then serves the next call.
  it('reuses a worker after the trace request fails', async () => {
    const failure = new Error('GitLab API error: 403 Forbidden');
    await expect(
      grepStream(options(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const sent = mockWorkers[0].postMessage.mock.calls.map(([request]) => request.type);
    expect(sent).toEqual(['start', 'reset']);
    await expect(grepStream(options(), async () => body('error').stream)).resolves.toMatchObject({
      match_count: 1,
    });
    expect(mockWorkers).toHaveLength(1);
  });

  // Exhausting the budget stops reading and cancels the transfer.
  it('cancels the body once the scan budget is spent', async () => {
    const log = Array.from({ length: 5000 }, (_, i) => `error ${i}`).join('\n');
    const { stream, cancel } = body(log, 65536);
    const result = await grepStream(options({ budgetMs: 0, maxMatches: 500 }), async () => stream);
    expect(result).toMatchObject({ truncated: 'budget', total_lines: null });
    expect(result.resume_from).toBeGreaterThan(0);
    expect(result.resume_from).toBeLessThanOrEqual(result.scanned_lines);
    expect(cancel).toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });

  // A failing cancel of an already finished read must not replace the partial result.
  it('keeps the partial result when cancelling the body fails', async () => {
    const log = Array.from({ length: 5000 }, (_, i) => `error ${i}`).join('\n');
    const { stream, cancel } = body(log, 65536);
    cancel.mockRejectedValue(new Error('cancel failed'));
    const result = await grepStream(options({ budgetMs: 0, maxMatches: 500 }), async () => stream);
    expect(result.truncated).toBe('budget');
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(stream.locked).toBe(false);
  });

  // A stuck worker is killed; delivered hunks and a continuation that loses nothing remain.
  it('returns a resumable partial result when a worker stops answering', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
    try {
      // One line per chunk, each matched once the next arrives: the hunk of line 0 closes
      // when line 3 is placed on chunk 5, then chunk 6 never returns.
      const lines = ['error 0', 'ok 1', 'ok 2', 'ok 3', 'error 4', 'ok 5'];
      const pending = grepStream(options({ budgetMs: 10 }), async () => {
        mockWorkers[0].stallAfterChunks = 5;
        let index = 0;
        return new ReadableStream({
          type: 'bytes',
          pull(controller) {
            if (index === lines.length) {
              controller.close();
              controller.byobRequest?.respond(0);
              return;
            }
            controller.enqueue(new TextEncoder().encode(`${lines[index++]}\n`));
          },
        });
      });
      await waitFor(() => (mockWorkers[0]?.chunks ?? 0) >= 6, pending);
      await jest.advanceTimersByTimeAsync(2010);
      const result = await pending;
      // Line 4 was read but not yet matched, so the continuation starts there.
      expect(result).toMatchObject({
        truncated: 'worker_timeout',
        match_count_complete: false,
        total_lines: null,
        resume_from: 4,
        scanned_lines: 5,
      });
      expect(result.hunks).toEqual([
        { start_line: 0, lines: ['error 0', 'ok 1'], matches: [{ line: 0, patterns: [0] }] },
      ]);
      expect(mockWorkers[0].terminate).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Capacity is fixed per process; the extra caller fails fast instead of queueing.
  it('fails fast at capacity and recovers when a lease ends', async () => {
    const gates: Array<() => void> = [];
    const blocked = () =>
      grepStream(
        options(),
        () =>
          new Promise((resolve) => {
            gates.push(() => resolve(body('error').stream));
          }),
      );
    const first = blocked();
    const second = blocked();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(grepStream(options(), async () => body('error').stream)).rejects.toThrow(
      'at capacity',
    );
    await waitFor(() => gates.length === 2, Promise.race([first, second]));
    gates.forEach((open) => open());
    await Promise.all([first, second]);
    await expect(grepStream(options(), async () => body('error').stream)).resolves.toMatchObject({
      match_count: 1,
    });
    expect(mockWorkers).toHaveLength(2);
  });

  // A crashed worker fails its call and is replaced for the next caller.
  it('discards a worker that exits during a scan', async () => {
    const pending = grepStream(options(), async () => {
      mockWorkers[0].emit('exit', 9);
      return body('error').stream;
    });
    await expect(pending).rejects.toThrow('exited (9)');
    await expect(grepStream(options(), async () => body('error').stream)).resolves.toMatchObject({
      match_count: 1,
    });
    expect(mockWorkers).toHaveLength(2);
  });

  // A reply no request awaits is ignored and does not reach the next call.
  it('ignores a reply that no request awaits', async () => {
    await grepStream(options(), async () => body('error').stream);
    mockWorkers[0].emit('message', { type: 'ready' });
    await expect(
      grepStream(options(), async () => body('ok\nerror').stream),
    ).resolves.toMatchObject({ match_count: 1 });
    expect(mockWorkers).toHaveLength(1);
  });

  // A worker that fails while idle is discarded before the next lease.
  it('replaces a worker that failed while idle', async () => {
    await grepStream(options(), async () => body('error').stream);
    mockWorkers[0].emit('error', new Error('thread crashed'));
    await expect(grepStream(options(), async () => body('error').stream)).resolves.toMatchObject({
      match_count: 1,
    });
    expect(mockWorkers).toHaveLength(2);
    expect(mockWorkers[0].terminate).toHaveBeenCalled();
  });

  // A request that cannot be posted fails its call; the worker is not reused.
  it('fails the call when a request cannot be posted', async () => {
    await grepStream(options(), async () => body('error').stream);
    mockWorkers[0].postMessage.mockImplementationOnce(() => {
      throw new Error('could not clone');
    });
    await expect(grepStream(options(), async () => body('error').stream)).rejects.toThrow(
      'could not clone',
    );
    await expect(grepStream(options(), async () => body('error').stream)).resolves.toMatchObject({
      match_count: 1,
    });
    expect(mockWorkers).toHaveLength(2);
  });

  // A reply of the wrong kind is a protocol failure, never taken for the awaited one.
  it.each([
    [{ type: 'failed', message: 'scanner broke' }, 'scanner broke'],
    [{ type: 'done', result: {} }, 'sent done instead of ready'],
  ])('rejects the worker reply %j to start', async (reply, message) => {
    await grepStream(options(), async () => body('error').stream);
    const worker = mockWorkers[0];
    worker.postMessage.mockImplementationOnce(() => {
      setImmediate(() => worker.emit('message', reply));
    });
    const open = jest.fn();
    await expect(grepStream(options(), open)).rejects.toThrow(message);
    expect(open).not.toHaveBeenCalled();
  });

  // A missing body is an error, never an empty successful search.
  it('rejects a trace without a body', async () => {
    await expect(grepStream(options(), async () => null)).rejects.toThrow('no readable body');
  });

  // Shutdown terminates idle workers.
  it('terminates workers on close', async () => {
    await grepStream(options(), async () => body('error').stream);
    await closeLineGrepWorkers();
    expect(mockWorkers[0].terminate).toHaveBeenCalled();
  });
});
