import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { serveLineGrep, type GrepRequest } from '../../../src/entities/pipelines/line-grep';

export type FakeGrepWorker = EventEmitter & {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  ref: jest.Mock;
  unref: jest.Mock;
  /** Leave chunk requests after this many unanswered, as a line that never finishes would. */
  stallAfterChunks?: number;
  chunks: number;
};

/** Every worker the pool created in this test file, in creation order. */
export const fakeGrepWorkers: FakeGrepWorker[] = [];

/**
 * A `Worker` stand-in running the real worker entry in-process. Messages cross with
 * structuredClone, so transferred buffers are detached exactly as between threads.
 * Use from a per-file `jest.mock('node:worker_threads', ...)` factory.
 */
export function createFakeGrepWorker(): FakeGrepWorker {
  const worker = new EventEmitter() as FakeGrepWorker;
  let deliver: (request: GrepRequest) => void = () => undefined;
  serveLineGrep({
    on: (_event: string, listener: (request: GrepRequest) => void) => {
      deliver = listener;
    },
    postMessage: (reply: unknown, transfer?: ArrayBuffer[]) => {
      const copy = structuredClone(reply, { transfer });
      setImmediate(() => worker.emit('message', copy));
    },
  } as never);
  worker.chunks = 0;
  worker.ref = jest.fn();
  worker.unref = jest.fn();
  worker.postMessage = jest.fn((request: GrepRequest, transfer?: ArrayBuffer[]) => {
    const copy = structuredClone(request, { transfer });
    if (request.type === 'chunk' && ++worker.chunks > (worker.stallAfterChunks ?? Infinity)) return;
    setImmediate(() => deliver(copy));
  });
  worker.terminate = jest.fn(() => {
    worker.emit('exit', 1);
    return Promise.resolve(1);
  });
  fakeGrepWorkers.push(worker);
  return worker;
}
