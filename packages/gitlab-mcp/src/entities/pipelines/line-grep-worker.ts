import { availableParallelism } from 'node:os';
import { inspect } from 'node:util';
import { Worker } from 'node:worker_threads';
import type {
  GrepHunk,
  GrepReply,
  GrepRequest,
  LineGrepOptions,
  LineGrepProgress,
  LineGrepResult,
} from './line-grep';
import { NotTextError } from './text-scan';

// Per-process compute admission only; no caller data survives a lease.
const MAX_WORKERS = Math.max(1, Math.min(4, availableParallelism() - 1));
// Covers a cold worker start (module load) as well as bounded pattern compilation.
const START_TIMEOUT_MS = 5000;
// Beyond the scan budget, the time a single line may take before the worker is killed.
const LINE_GRACE_MS = 2000;
const CHUNK_BYTES = 64 * 1024;

// Patterns and data arrive as messages and are never interpolated into this source.
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
require(workerData.module).serveLineGrep(parentPort);
`;
const SCANNER_MODULE = require.resolve('./line-grep');

class WorkerTimeoutError extends Error {}

/** A worker leased to one call at a time; the pool owns its lifetime. */
class GrepWorker {
  private readonly worker: Worker;
  failure?: Error;
  busy = false;
  private waiting?: {
    resolve: (reply: GrepReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor() {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { module: SCANNER_MODULE, typescript: SCANNER_MODULE.endsWith('.ts') },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    this.worker.on('message', (reply: GrepReply) => {
      const waiting = this.waiting;
      if (!waiting) return;
      this.waiting = undefined;
      clearTimeout(waiting.timer);
      waiting.resolve(reply);
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => this.fail(new Error(`Log search worker exited (${code})`)));
    this.worker.unref();
  }

  request(message: GrepRequest, timeoutMs: number, transfer?: ArrayBuffer[]): Promise<GrepReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new WorkerTimeoutError('Log search worker exceeded its time limit')),
        timeoutMs,
      );
      this.waiting = { resolve, reject, timer };
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.fail(error);
      }
    });
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
    // Thread errors may come from another realm or without a prototype: describe any value.
    const message =
      typeof error === 'object' &&
      error !== null &&
      typeof Reflect.get(error, 'message') === 'string'
        ? (Reflect.get(error, 'message') as string)
        : inspect(error);
    this.failure ??=
      error instanceof Error
        ? error
        : new Error(`Log search worker failed: ${message}`, { cause: error });
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = undefined;
    clearTimeout(waiting.timer);
    waiting.reject(this.failure);
  }

  async terminate(): Promise<void> {
    this.fail(new Error('Log search worker closed'));
    await this.worker.terminate();
  }
}

const workers: GrepWorker[] = [];

function discard(worker: GrepWorker): void {
  const index = workers.indexOf(worker);
  if (index !== -1) workers.splice(index, 1);
  void worker.terminate();
}

/** An idle or new worker, or null when the pool is at capacity; throws if a thread cannot start. */
function acquireWorker(): GrepWorker | null {
  // Backwards, since discard() removes entries while the loop runs.
  for (let index = workers.length - 1; index >= 0; index--) {
    const worker = workers[index];
    if (!worker.busy && worker.failure) discard(worker);
  }
  let worker = workers.find((candidate) => !candidate.busy);
  if (!worker) {
    if (workers.length >= MAX_WORKERS) return null;
    worker = new GrepWorker();
    workers.push(worker);
  }
  worker.lease();
  return worker;
}

/** A further worker for a call that already holds one; a thread that cannot start is only missing capacity. */
function tryLeaseWorker(): GrepWorker | null {
  try {
    return acquireWorker();
  } catch {
    return null;
  }
}

function leaseWorker(): GrepWorker {
  const worker = acquireWorker();
  if (!worker) throw new Error('Log search is at capacity; retry shortly');
  return worker;
}

function giveBack(worker: GrepWorker): void {
  if (worker.failure) discard(worker);
  else worker.release();
}

/** Terminate every log search worker, idle or active, during server shutdown. */
export async function closeLineGrepWorkers(): Promise<void> {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
}

function expectReply<T extends GrepReply['type']>(
  reply: GrepReply,
  type: T,
): Extract<GrepReply, { type: T }> {
  if (reply.type === type) return reply as Extract<GrepReply, { type: T }>;
  if (reply.type === 'refused') throw new NotTextError(reply.message);
  if (reply.type === 'invalid' || reply.type === 'failed') throw new Error(reply.message);
  throw new Error(`Log search worker sent ${reply.type} instead of ${type}`);
}

/**
 * Search a byte stream on a leased worker. Patterns are compiled before `open` runs, so an
 * invalid pattern costs no GitLab request. The main thread only moves bytes: one transport
 * buffer travels to the worker and back for each read.
 */
export async function grepStream(
  options: LineGrepOptions,
  open: () => Promise<ReadableStream<Uint8Array> | null>,
): Promise<LineGrepResult> {
  const worker = leaseWorker();
  try {
    return await scanOn(worker, options, open);
  } finally {
    giveBack(worker);
  }
}

/** Patterns the worker refused to compile; every other stream would be refused as well. */
class InvalidPatternsError extends Error {}

/** Compile the patterns as a scan would, without reading anything; rejects invalid RE2. */
export async function checkPatterns(options: LineGrepOptions): Promise<void> {
  const worker = leaseWorker();
  try {
    const started = await worker.request({ type: 'start', options }, START_TIMEOUT_MS);
    if (started.type === 'invalid') throw new InvalidPatternsError(started.message);
    expectReply(started, 'ready');
    await worker.request({ type: 'reset' }, LINE_GRACE_MS);
  } finally {
    giveBack(worker);
  }
}

/** One stream of `grepAll`. */
export interface GrepTask {
  options: LineGrepOptions;
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

export type GrepOutcome =
  | { status: 'done'; result: LineGrepResult }
  | { status: 'failed'; error: unknown }
  | { status: 'not_started' };

/**
 * Search streams on up to `concurrency` workers, starting each only while `admit()` holds.
 * A stream that fails is reported alone; invalid patterns fail the whole call. Without a
 * free worker the call fails at once; streams left when every worker is lost stay
 * `not_started`.
 */
export async function grepAll(
  tasks: readonly GrepTask[],
  concurrency: number,
  admit: () => boolean,
): Promise<GrepOutcome[]> {
  const outcomes: GrepOutcome[] = tasks.map(() => ({ status: 'not_started' }));
  if (tasks.length === 0) return outcomes;
  const leased = [leaseWorker()];
  for (let slot = 1; slot < Math.min(concurrency, tasks.length); slot++) {
    const worker = tryLeaseWorker();
    if (!worker) break;
    leased.push(worker);
  }
  let next = 0;
  let invalid: InvalidPatternsError | undefined;
  const drain = async (first: GrepWorker): Promise<void> => {
    let worker: GrepWorker | null = first;
    try {
      while (worker && next < tasks.length && !invalid && admit()) {
        const index = next++;
        const task = tasks[index];
        try {
          outcomes[index] = {
            status: 'done',
            result: await scanOn(worker, task.options, task.open),
          };
        } catch (error) {
          if (error instanceof InvalidPatternsError) invalid = error;
          outcomes[index] = { status: 'failed', error };
        }
        if (worker.failure) {
          discard(worker);
          worker = tryLeaseWorker();
        }
      }
    } finally {
      if (worker) giveBack(worker);
    }
  };
  await Promise.all(leased.map(drain));
  if (invalid) throw invalid;
  return outcomes;
}

/** Scan one stream on a leased worker, leaving the worker idle unless it failed. */
async function scanOn(
  worker: GrepWorker,
  options: LineGrepOptions,
  open: () => Promise<ReadableStream<Uint8Array> | null>,
): Promise<LineGrepResult> {
  let idle = false;
  try {
    const started = await worker.request({ type: 'start', options }, START_TIMEOUT_MS);
    if (started.type === 'invalid') {
      idle = true;
      throw new InvalidPatternsError(started.message);
    }
    expectReply(started, 'ready');
    const body = await open();
    if (!body) throw new Error('GitLab trace response has no readable body');
    const result = await pump(worker, options, body);
    idle = result.truncated !== 'worker_timeout';
    return result;
  } finally {
    try {
      if (!idle && !worker.failure) await worker.request({ type: 'reset' }, LINE_GRACE_MS);
    } catch {
      // The failure is recorded on the worker, which its owner discards.
    }
  }
}

/** Fills a transport buffer from a stream; null at the end of the stream. */
interface ChunkReader {
  read(buffer: ArrayBuffer): Promise<Uint8Array<ArrayBuffer> | null>;
  cancel(): Promise<void>;
  release(): void;
}

/**
 * A byte stream reads straight into the transport buffer. Any other stream's chunks are
 * copied into it: they may share a pooled allocation, which must not be transferred away.
 */
function chunkReader(body: ReadableStream<Uint8Array>): ChunkReader {
  let byob: ReadableStreamBYOBReader | undefined;
  try {
    byob = body.getReader({ mode: 'byob' });
  } catch {
    // Not a byte stream: fall through to the copying reader.
  }
  if (byob) {
    const reader = byob;
    return {
      read: async (buffer) => {
        const { value, done } = await reader.read(new Uint8Array(buffer));
        return done ? null : value;
      },
      cancel: () => reader.cancel(),
      release: () => reader.releaseLock(),
    };
  }
  const reader = body.getReader();
  let rest: Uint8Array | undefined;
  let ended = false;
  return {
    // Fills the whole buffer from as many chunks as it takes, so each worker message carries
    // a full transport buffer however small the stream's chunks are.
    read: async (buffer) => {
      let size = 0;
      while (size < buffer.byteLength && !ended) {
        if (!rest?.length) {
          // A stream yields its chunks one after another; reads cannot run concurrently.
          const { value, done } = await reader.read();
          if (done) ended = true;
          else rest = value;
          continue;
        }
        const take = Math.min(rest.length, buffer.byteLength - size);
        new Uint8Array(buffer, size, take).set(rest.subarray(0, take));
        rest = rest.subarray(take);
        size += take;
      }
      return size === 0 && ended ? null : new Uint8Array(buffer, 0, size);
    },
    cancel: () => reader.cancel(),
    release: () => reader.releaseLock(),
  };
}

/** One line outran the budget: report what was delivered and where to continue. */
function timedOut(
  options: LineGrepOptions,
  hunks: GrepHunk[],
  last: LineGrepProgress | undefined,
): LineGrepResult {
  return {
    hunks,
    match_count: last?.match_count ?? 0,
    match_count_complete: false,
    scanned_lines: last?.scanned_lines ?? 0,
    total_lines: null,
    truncated: 'worker_timeout',
    resume_from: last?.safe_resume ?? options.startLine,
    ...(options.preset ? { preset_index: options.patterns.length } : {}),
    ...(options.section ? { section: last?.section ?? null } : {}),
    ...(options.byteOffsets ? { scanned_bytes: last?.scanned_bytes ?? 0 } : {}),
    ...(options.maxBytes !== undefined ? { scan_limit_reached: false } : {}),
    ...(last?.partially_searched_lines
      ? { partially_searched_lines: last.partially_searched_lines }
      : {}),
  };
}

async function pump(
  worker: GrepWorker,
  options: LineGrepOptions,
  body: ReadableStream<Uint8Array>,
): Promise<LineGrepResult> {
  const reader = chunkReader(body);
  const timeout = options.budgetMs + LINE_GRACE_MS;
  const hunks: GrepHunk[] = [];
  let last: LineGrepProgress | undefined;
  let buffer = new ArrayBuffer(CHUNK_BYTES);
  let eof = false;
  try {
    for (;;) {
      const value = await reader.read(buffer);
      if (value === null) {
        eof = true;
        break;
      }
      const reply = await worker.request(
        { type: 'chunk', buffer: value.buffer, offset: value.byteOffset, length: value.byteLength },
        timeout,
        [value.buffer],
      );
      const progress = expectReply(reply, 'progress');
      hunks.push(...progress.progress.hunks);
      last = progress.progress;
      buffer = progress.buffer;
      if (last.exhausted) break;
    }
    const done = expectReply(await worker.request({ type: 'end' }, timeout), 'done').result;
    return { ...done, hunks: hunks.concat(done.hunks) };
  } catch (error) {
    if (!(error instanceof WorkerTimeoutError)) throw error;
    // The killed worker never charged the stuck line; the wait alone exceeds the budget, so
    // no further scan of the call starts.
    if (options.spent) Atomics.add(options.spent, 0, timeout * 1000);
    return timedOut(options, hunks, last);
  } finally {
    // Cancelling only stops the transfer; a read failure already surfaced from read(),
    // so a cancel failure must not replace a finished result or that original error.
    if (!eof) await reader.cancel().catch(() => undefined);
    reader.release();
  }
}
