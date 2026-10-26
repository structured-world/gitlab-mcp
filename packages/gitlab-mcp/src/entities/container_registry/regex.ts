import { Worker } from 'node:worker_threads';

const REGEX_TIMEOUT_MS = 1000;
const MAX_ACTIVE_MATCHERS = 2;
export const MAX_REGISTRY_PATTERN_LENGTH = 500;
// Per-process compute admission only, not account or session state shared across replicas.
type MatcherSlot = { matcher: TagMatcher; ready: Promise<number[]> };
const matcherSlots: MatcherSlot[] = [];

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
  private constructor() {
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
  }

  static create(): MatcherSlot {
    const matcher = new TagMatcher();
    const ready = matcher.wait();
    // An idle prewarmed worker must not keep CLI commands or test processes alive.
    ready.then(
      () => {
        if (!matcher.busy) matcher.worker.unref();
      },
      (error: unknown) => matcher.fail(error),
    );
    return { matcher, ready };
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
  while (matcherSlots.length < MAX_ACTIVE_MATCHERS) matcherSlots.push(TagMatcher.create());
  await Promise.all(matcherSlots.map(warmMatcherSlot));
}

/** Repair a transient startup failure once, without an unbounded restart loop. */
async function warmMatcherSlot(slot: MatcherSlot): Promise<void> {
  try {
    await slot.ready;
  } catch (error) {
    if (slot.matcher.busy) throw error;
    slot.matcher.lease();
    let owned = slot;
    try {
      owned = await replaceMatcherSlot(slot);
      await owned.ready;
    } finally {
      owned.matcher.release();
    }
  }
}

/** Terminate idle and active compute workers during server shutdown. */
export async function closeTagMatchers(): Promise<void> {
  const owned = matcherSlots.splice(0);
  await Promise.all(owned.map((slot) => slot.matcher.close()));
}

/** Keep the slot reserved until termination completes, including across concurrent calls. */
async function replaceMatcherSlot(slot: MatcherSlot): Promise<MatcherSlot> {
  await slot.matcher.close();
  const index = matcherSlots.indexOf(slot);
  if (index === -1) throw new Error('Registry regex pool closed');
  const replacement = TagMatcher.create();
  replacement.matcher.lease();
  matcherSlots[index] = replacement;
  return replacement;
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
  while (matcherSlots.length < MAX_ACTIVE_MATCHERS) matcherSlots.push(TagMatcher.create());
  let slot = matcherSlots.find((candidate) => !candidate.matcher.busy);
  if (!slot) throw new Error('Registry regex matching is at capacity. Retry shortly.');
  slot.matcher.lease();
  let resetRequired = false;
  try {
    if (slot.matcher.failure) slot = await replaceMatcherSlot(slot);
    const { matcher } = slot;
    await slot.ready;
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
    const { matcher } = slot;
    try {
      if (!matcher.failure && resetRequired) await matcher.send({ action: 'reset' });
    } finally {
      if (!matcher.failure) matcher.release();
      else {
        await matcher.close();
        const index = matcherSlots.indexOf(slot);
        if (index !== -1) matcherSlots.splice(index, 1, TagMatcher.create());
      }
    }
  }
}
