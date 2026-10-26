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
    Promise.resolve().then(() => worker.emit('message', { indices: [] }));
    return worker;
  }),
}));

afterEach(async () => {
  await closeTagMatchers();
  mockWorkers.length = 0;
  jest.useRealTimers();
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
