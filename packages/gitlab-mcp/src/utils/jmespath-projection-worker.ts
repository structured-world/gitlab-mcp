import { availableParallelism } from 'node:os';
import { inspect } from 'node:util';
import { Worker } from 'node:worker_threads';
import {
  ProjectionError,
  projectionEnvelope,
  type ProjectedResult,
  type Projection,
  type ProjectionReply,
  type ProjectionRequest,
} from './jmespath-projection';

// Per-process compute admission only; no caller data survives a lease.
const MAX_WORKERS = Math.max(1, Math.min(4, availableParallelism() - 1));
// A cold start loads the evaluator and its RE2 engine before the first answer.
const START_TIMEOUT_MS = 5000;
// The evaluator stops itself at 1 s between steps; one step (a serialization, a huge
// allocation) can outlast that, and then the worker is stopped.
const EVALUATION_TIMEOUT_MS = 2000;

// Expressions and data arrive as messages and are never interpolated into this source.
// From TypeScript sources (test runner, dev server) Node strips types itself but resolves
// only explicit extensions, so the thread maps extensionless relative imports to `.ts`.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
if (workerData.typescript) {
  require('node:module').registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith('.')) throw error;
        return nextResolve(specifier + '.ts', context);
      }
    },
  });
}
require(workerData.module).serveProjection(parentPort);
`;
const EVALUATOR_MODULE = require.resolve('./jmespath-projection');

/** A worker leased to one call at a time; the pool owns its lifetime. */
class ProjectionWorker {
  private readonly worker: Worker;
  private readonly ready: Promise<ProjectionReply>;
  failure?: Error;
  busy = false;
  private waiting?: {
    resolve: (reply: ProjectionReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor() {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { module: EVALUATOR_MODULE, typescript: EVALUATOR_MODULE.endsWith('.ts') },
      // A tool result is cloned into the worker; the limit stops a runaway allocation.
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    this.ready = this.await(START_TIMEOUT_MS);
    // A start failure surfaces to the call that awaits `ready`; an idle worker has none.
    this.ready.catch(() => undefined);
    this.worker.on('message', (reply: ProjectionReply) => {
      const waiting = this.waiting;
      if (!waiting) return;
      this.waiting = undefined;
      clearTimeout(waiting.timer);
      waiting.resolve(reply);
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => this.fail(new Error(`Projection worker exited (${code})`)));
    this.worker.unref();
  }

  private await(timeoutMs: number): Promise<ProjectionReply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new ProjectionError('evaluation exceeded its time limit')),
        timeoutMs,
      );
      this.waiting = { resolve, reject, timer };
    });
  }

  async evaluate(request: ProjectionRequest): Promise<ProjectionReply> {
    // A worker that failed to start rejects `ready`; one that failed while idle is dropped
    // by the pool before it is leased again.
    await this.ready;
    const reply = this.await(EVALUATION_TIMEOUT_MS);
    try {
      this.worker.postMessage(request);
    } catch (error) {
      this.fail(error);
    }
    return reply;
  }

  lease(): void {
    this.busy = true;
    this.worker.ref();
  }

  release(): void {
    this.busy = false;
    this.worker.unref();
  }

  fail(error: unknown): void {
    this.failure ??= describe(error);
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = undefined;
    clearTimeout(waiting.timer);
    waiting.reject(this.failure);
  }

  async terminate(): Promise<void> {
    this.fail(new Error('Projection worker closed'));
    await this.worker.terminate();
  }
}

/** The caller-facing error for a worker that failed; a resource limit reads as a refusal. */
function describe(error: unknown): Error {
  if (error instanceof Error && error.name === 'ProjectionError') return error;
  // Thread errors may come from another realm or without a prototype: describe any value.
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  if (code === 'ERR_WORKER_OUT_OF_MEMORY')
    return new ProjectionError('evaluation exceeded its memory limit');
  if (error instanceof Error) return error;
  return new Error(`Projection worker failed: ${inspect(error)}`, { cause: error });
}

const workers: ProjectionWorker[] = [];

function discard(worker: ProjectionWorker): void {
  const index = workers.indexOf(worker);
  if (index !== -1) workers.splice(index, 1);
  void worker.terminate();
}

function leaseWorker(): ProjectionWorker {
  // Backwards, since discard() removes entries while the loop runs.
  for (let index = workers.length - 1; index >= 0; index--) {
    const worker = workers[index];
    if (!worker.busy && worker.failure) discard(worker);
  }
  let worker = workers.find((candidate) => !candidate.busy);
  if (!worker) {
    if (workers.length >= MAX_WORKERS) throw new Error('Projection is at capacity; retry shortly');
    worker = new ProjectionWorker();
    workers.push(worker);
  }
  worker.lease();
  return worker;
}

/** Terminate every projection worker, idle or active, during server shutdown. */
export async function closeProjectionWorkers(): Promise<void> {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
}

/**
 * Apply a compiled projection to a tool result. The expression runs in a worker that is
 * stopped when one step outlasts the time limit or memory runs out, so no expression can
 * hold the request thread; the result it returns is bounded before it is serialized.
 */
export async function applyProjection(
  projection: Projection,
  result: unknown,
): Promise<ProjectedResult> {
  const worker = leaseWorker();
  let reply: ProjectionReply;
  try {
    reply = await worker.evaluate({ expression: projection.expression, input: result });
  } finally {
    if (worker.failure) discard(worker);
    else worker.release();
  }
  if (!reply.ok) throw new ProjectionError(reply.detail);
  return projectionEnvelope(projection.expression, result, reply.data);
}
