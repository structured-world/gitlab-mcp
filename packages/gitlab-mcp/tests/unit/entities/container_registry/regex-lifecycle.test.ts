import type { EventEmitter } from 'node:events';
import {
  withTagMatcher,
  warmTagMatchers,
  closeTagMatchers,
} from '../../../../src/entities/container_registry/regex';

type MockWorker = EventEmitter & {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  ref: jest.Mock;
  unref: jest.Mock;
};
const mockWorkers: MockWorker[] = [];
let mockStartupFailures = 0;
jest.mock('node:worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => {
    const { EventEmitter } = jest.requireActual<typeof import('node:events')>('node:events');
    const worker = new EventEmitter() as MockWorker;
    worker.ref = jest.fn();
    worker.unref = jest.fn();
    worker.postMessage = jest.fn(() => {
      Promise.resolve().then(() => worker.emit('message', { indices: [] }));
    });
    worker.terminate = jest.fn(async () => {
      worker.emit('exit', 1);
      return 1;
    });
    mockWorkers.push(worker);
    const failStartup = mockStartupFailures > 0;
    if (failStartup) mockStartupFailures--;
    Promise.resolve().then(() => {
      if (failStartup) worker.emit('error', new Error('worker startup failed'));
      else worker.emit('message', { indices: [] });
    });
    return worker;
  }),
}));

afterEach(async () => {
  await closeTagMatchers();
  mockWorkers.length = 0;
  mockStartupFailures = 0;
  jest.useRealTimers();
});

// A transient startup failure is repaired during warming, before any caller needs the pool.
it('repairs a transient startup failure during prewarming', async () => {
  mockStartupFailures = 1;
  await expect(warmTagMatchers()).resolves.toBeUndefined();
  expect(mockWorkers).toHaveLength(3);
  expect(mockWorkers[0].terminate).toHaveBeenCalledTimes(1);
  await expect(withTagMatcher('.*', undefined, (match) => match(['tag']))).resolves.toEqual([]);
});

// Persistent startup failure must stop recovery after one replacement per slot, not spin forever.
it('bounds startup recovery and permits a later request to recover', async () => {
  mockStartupFailures = 4;
  await expect(warmTagMatchers()).rejects.toThrow('worker startup failed');
  expect(mockWorkers).toHaveLength(4);
  await expect(withTagMatcher('.*', undefined, (match) => match(['tag']))).resolves.toEqual([]);
});

// Warm requests must reuse their compute workers, not repeat startup or retain a caller's pattern.
it('reuses prewarmed workers and resets after a failed tag fetch', async () => {
  await warmTagMatchers();
  await withTagMatcher('first', undefined, (match) => match(['first']));
  const error = new Error('fetch failed');
  await expect(
    withTagMatcher('second', undefined, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  await withTagMatcher('third', undefined, (match) => match(['third']));
  expect(mockWorkers).toHaveLength(2);
  expect(mockWorkers[0].postMessage.mock.calls.map(([message]) => message.action)).toEqual([
    'compile',
    'match',
    'compile',
    'reset',
    'compile',
    'match',
  ]);
  expect(mockWorkers.every((worker) => worker.unref.mock.calls.length > 0)).toBe(true);
});

// An idle crash belongs to pool maintenance, not to the next caller's valid pattern.
it.each(['error', 'exit'] as const)(
  'replaces an idle worker after %s before serving the next caller',
  async (event) => {
    await warmTagMatchers();
    const stale = mockWorkers[0];
    stale.emit(event, event === 'exit' ? 9 : new Error('idle worker failed'));
    await expect(withTagMatcher('.*', undefined, (match) => match(['tag']))).resolves.toEqual([]);
    expect(stale.postMessage).not.toHaveBeenCalled();
    expect(stale.terminate).toHaveBeenCalledTimes(1);
    expect(mockWorkers).toHaveLength(3);
  },
);

// A stuck compilation is terminated at the deadline and replaced without blocking later work.
it('terminates and replaces a worker after its deadline', async () => {
  jest.useFakeTimers();
  await warmTagMatchers();
  const stuck = mockWorkers[0];
  stuck.postMessage.mockImplementation(() => undefined);
  const result = withTagMatcher('.*', undefined, (match) => match(['tag']));
  const rejected = expect(result).rejects.toThrow('time limit');
  await jest.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(stuck.terminate).toHaveBeenCalledTimes(1);
  expect(mockWorkers).toHaveLength(3);
  await withTagMatcher('.*', undefined, (match) => match(['tag']));
});

// Worker crashes, early exit and failed message delivery must all release capacity and timers.
it.each(['error', 'exit', 'postMessage'] as const)('recovers from %s failure', async (failure) => {
  await warmTagMatchers();
  const worker = mockWorkers[0];
  await expect(
    withTagMatcher('.*', undefined, (match) => {
      if (failure === 'postMessage')
        worker.postMessage.mockImplementation(() => {
          throw new Error('delivery failed');
        });
      else worker.emit(failure, failure === 'exit' ? 9 : new Error('worker failed'));
      return match(['tag']);
    }),
  ).rejects.toThrow();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  await withTagMatcher('.*', undefined, (match) => match(['tag']));
});

// Shutdown owns all active work and must not recreate the pool while rejecting in-flight requests.
it('closes active work without spawning replacement workers', async () => {
  await warmTagMatchers();
  let compiling!: () => void;
  const started = new Promise<void>((resolve) => {
    compiling = resolve;
  });
  mockWorkers[0].postMessage.mockImplementation(() => compiling());
  const result = withTagMatcher('.*', undefined, (match) => match(['tag']));
  const rejected = expect(result).rejects.toThrow('closed');
  await started;
  await closeTagMatchers();
  await rejected;
  expect(mockWorkers).toHaveLength(2);
});
