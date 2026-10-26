import { Worker } from 'node:worker_threads';

const REGEX_TIMEOUT_MS = 1000;
const MAX_ACTIVE_MATCHERS = 2;
export const MAX_REGISTRY_PATTERN_LENGTH = 500;
// Per-process compute admission only, not account or session state shared across replicas.
const matchers: TagMatcher[] = [];

// Untrusted patterns and names are data, never interpolated into executable source.
const MATCHER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { RE2JS } = require(workerData.library);
let remove = null;
let keep = null;
function compile(pattern) {
  const compiled = RE2JS.compile(pattern);
  if (compiled.programSize() > 1000) throw new Error('Registry regex exceeds 1000 instructions. Use smaller repetitions.');
  return compiled;
}
parentPort.postMessage({ indices: [] });
parentPort.on('message', message => {
  try {
    if (message.action === 'compile') {
      remove = compile(message.remove);
      keep = message.keep ? compile(message.keep) : null;
      parentPort.postMessage({ indices: [] });
    } else {
      const selected = [];
      if (message.action === 'match') {
        for (let i = 0; i < message.names.length; i++) {
          if (remove.test(message.names[i]) && !keep?.test(message.names[i])) selected.push(i);
        }
      }
      remove = null;
      keep = null;
      parentPort.postMessage({ indices: selected });
    }
  } catch (error) {
    remove = null;
    keep = null;
    parentPort.postMessage({ error: error.message });
  }
});
`;

/** A request leases one worker exclusively; the process pool owns its lifetime. */
class TagMatcher {
  private readonly worker: Worker;
  failure?: Error;
  busy = false;
  private pending?: {
    resolve: (indices: number[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  readonly ready: Promise<number[]>;

  constructor() {
    this.worker = new Worker(MATCHER_SOURCE, {
      eval: true,
      workerData: { library: require.resolve('re2js') },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
    this.worker.on('message', (message: { indices: number[] } | { error: string }) => {
      if (!this.pending) return;
      clearTimeout(this.pending.timer);
      if ('error' in message)
        this.pending.reject(new Error(`Invalid RE2 registry regex: ${message.error}`));
      else this.pending.resolve(message.indices);
      this.pending = undefined;
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) =>
      this.fail(new Error(`Registry regex worker exited (${code})`)),
    );
    this.ready = this.wait();
    // An idle prewarmed worker must not keep CLI commands or test processes alive.
    this.ready.then(
      () => {
        if (!this.busy) this.worker.unref();
      },
      (error: unknown) => this.fail(error),
    );
  }

  private fail(error: unknown): void {
    this.failure =
      error instanceof Error ? error : new Error('Registry regex worker failed', { cause: error });
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(this.failure);
    this.pending = undefined;
  }

  private wait(): Promise<number[]> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error('Registry regex exceeded the 1000 ms time limit. Use a simpler pattern.'),
          ),
        REGEX_TIMEOUT_MS,
      );
      this.pending = { resolve, reject, timer };
    });
  }

  match(names: string[]): Promise<number[]> {
    return this.send({ action: 'match', names });
  }

  send(message: object): Promise<number[]> {
    const result = this.wait();
    if (!this.failure) {
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.fail(error);
      }
    }
    return result;
  }

  lease(): void {
    this.busy = true;
    this.worker.ref();
  }

  release(): void {
    this.busy = false;
    this.worker.unref();
  }

  async close(): Promise<void> {
    this.fail(new Error('Registry regex worker closed'));
    await this.worker.terminate();
  }
}

/** Preload a bounded process-local compute pool without retaining caller context. */
export async function warmTagMatchers(): Promise<void> {
  while (matchers.length < MAX_ACTIVE_MATCHERS) matchers.push(new TagMatcher());
  await Promise.all(matchers.map((matcher) => matcher.ready));
}

/** Terminate idle and active compute workers during server shutdown. */
export async function closeTagMatchers(): Promise<void> {
  const owned = matchers.splice(0);
  await Promise.all(owned.map((matcher) => matcher.close()));
}

/** Bound both compilation and matching before permitting any destructive operation. */
export async function withTagMatcher<T>(
  remove: string,
  keep: string | undefined,
  operation: (match: (names: string[]) => Promise<number[]>) => Promise<T>,
): Promise<T> {
  if (
    remove.length > MAX_REGISTRY_PATTERN_LENGTH ||
    (keep !== undefined && keep.length > MAX_REGISTRY_PATTERN_LENGTH)
  )
    throw new Error('Registry regex exceeds 500 characters.');
  // Do not await warming before leasing: simultaneous requests must reserve distinct workers.
  while (matchers.length < MAX_ACTIVE_MATCHERS) matchers.push(new TagMatcher());
  const matcher = matchers.find((candidate) => !candidate.busy);
  if (!matcher) throw new Error('Registry regex matching is at capacity. Retry shortly.');
  matcher.lease();
  let resetRequired = false;
  try {
    await matcher.ready;
    await matcher.send({ action: 'compile', remove, keep });
    resetRequired = true;
    return await operation(async (names) => {
      try {
        return await matcher.match(names);
      } finally {
        resetRequired = false;
      }
    });
  } finally {
    try {
      if (!matcher.failure && resetRequired) await matcher.send({ action: 'reset' });
    } finally {
      if (!matcher.failure) matcher.release();
      else {
        await matcher.close();
        const index = matchers.indexOf(matcher);
        if (index !== -1) matchers.splice(index, 1, new TagMatcher());
      }
    }
  }
}
