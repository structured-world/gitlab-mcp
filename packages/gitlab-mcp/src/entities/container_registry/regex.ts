import { Worker } from 'node:worker_threads';

const REGEX_TIMEOUT_MS = 1000;
const MAX_ACTIVE_MATCHERS = 2;
// Per-process compute admission only, not account or session state shared across replicas.
let activeMatchers = 0;

// Untrusted patterns and names are data, never interpolated into executable source.
const MATCHER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const remove = new RegExp(workerData.remove);
const keep = workerData.keep ? new RegExp(workerData.keep) : null;
parentPort.postMessage([]);
parentPort.once('message', names => {
  const selected = [];
  for (let i = 0; i < names.length; i++) {
    if (remove.test(names[i]) && !keep?.test(names[i])) selected.push(i);
  }
  parentPort.postMessage(selected);
  parentPort.close();
});
`;

/** One request owns the worker from validation through matching and termination. */
class TagMatcher {
  private readonly worker: Worker;
  private failure?: Error;
  private pending?: {
    resolve: (indices: number[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  readonly ready: Promise<number[]>;

  constructor(remove: string, keep: string | undefined) {
    this.worker = new Worker(MATCHER_SOURCE, {
      eval: true,
      workerData: { remove, keep },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
    this.worker.on('message', (indices: number[]) => {
      if (!this.pending) return;
      clearTimeout(this.pending.timer);
      this.pending.resolve(indices);
      this.pending = undefined;
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) =>
      this.fail(new Error(`Registry regex worker exited (${code})`)),
    );
    this.ready = this.wait();
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
    const result = this.wait();
    if (!this.failure) this.worker.postMessage(names);
    return result;
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}

/** Bound both compilation and matching before permitting any destructive operation. */
export async function withTagMatcher<T>(
  remove: string,
  keep: string | undefined,
  operation: (match: (names: string[]) => Promise<number[]>) => Promise<T>,
): Promise<T> {
  if (activeMatchers >= MAX_ACTIVE_MATCHERS)
    throw new Error('Registry regex matching is at capacity. Retry shortly.');
  activeMatchers++;
  let matcher: TagMatcher | undefined;
  try {
    const owned = new TagMatcher(remove, keep);
    matcher = owned;
    await owned.ready;
    return await operation((names) => owned.match(names));
  } finally {
    try {
      if (matcher) await matcher.close();
    } finally {
      activeMatchers--;
    }
  }
}
