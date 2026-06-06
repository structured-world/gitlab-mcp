/**
 * CI watch core for the channel-gateway (issue #483).
 *
 * Pure mechanism, validated end-to-end against a live instance: detect a
 * watchable CI resource by the SHAPE of a tool result, start a poll timer from
 * the moment its id is known, and emit an event on every state-snapshot change
 * until the pipeline reaches a terminal state. Network (poll) and delivery
 * (emit) are injected, so this module is unit-testable without MCP or Channels.
 */

/** CI resource kinds the gateway knows how to watch. */
export type CiResourceKind = 'pipeline' | 'job' | 'deployment';

/**
 * Statuses that mean "still in flight" — a watch keeps polling while any is
 * present. `blocked` covers a deployment waiting on a manual approval gate.
 */
export const NON_FINAL: ReadonlySet<string> = new Set([
  'created',
  'pending',
  'running',
  'waiting_for_resource',
  'preparing',
  'scheduled',
  'blocked',
]);

/** Terminal status sets per resource kind (GitLab CI vocabulary). */
export const TERMINAL: Record<CiResourceKind, ReadonlySet<string>> = {
  pipeline: new Set(['success', 'failed', 'canceled', 'skipped']),
  job: new Set(['success', 'failed', 'canceled', 'skipped', 'manual']),
  deployment: new Set(['success', 'failed', 'canceled', 'skipped']),
};

/** A resource to watch: kind + the project and id needed to re-query it. */
export interface WatchTarget {
  kind: CiResourceKind;
  projectId: string;
  id: number;
}

/** One job's state as seen during a poll. */
export interface JobState {
  id: number;
  name: string;
  stage: string;
  status: string;
}

/** A single transition of one job, included in the emitted event. */
export interface JobTransition {
  name: string;
  from: string | null;
  to: string;
}

/** What the gateway pushes to the channel on each change. */
export interface WatchEvent {
  target: WatchTarget;
  /** Aggregate pipeline state derived from the jobs. */
  pipelineState: string;
  jobs: JobState[];
  transitions: JobTransition[];
  terminal: boolean;
}

/** Derive a pipeline-level state from its jobs (no separate pipeline GET needed). */
export function aggregateState(jobs: readonly JobState[]): string {
  if (jobs.length === 0) return 'pending';
  const states = new Set(jobs.map((j) => j.status));
  for (const s of states) if (NON_FINAL.has(s)) return 'running';
  if (states.has('failed')) return 'failed';
  if (states.has('canceled')) return 'canceled';
  if (states.has('skipped') && states.size === 1) return 'skipped';
  return 'success';
}

/** True once the aggregate pipeline state can no longer change. */
export function isTerminal(pipelineState: string): boolean {
  return TERMINAL.pipeline.has(pipelineState);
}

/** Compute per-job transitions between the previous and current snapshot. */
export function diffJobs(
  prev: ReadonlyMap<string, string>,
  jobs: readonly JobState[],
): JobTransition[] {
  const out: JobTransition[] = [];
  for (const j of jobs) {
    const before = prev.get(j.name) ?? null;
    if (before !== j.status) out.push({ name: j.name, from: before, to: j.status });
  }
  return out;
}

/** Build a name -> status map for snapshot comparison. */
export function snapshot(jobs: readonly JobState[]): Map<string, string> {
  return new Map(jobs.map((j) => [j.name, j.status]));
}

/**
 * Detect whether a tool result is a watchable CI resource, by shape rather than
 * by a hardcoded tool-name whitelist. Returns a target only when the resource
 * is still non-final (a result already terminal needs no watch).
 *
 * @param projectId - resolved from the originating call's args
 * @param result    - the verbatim downstream tool result (object or array)
 */
export function detectWatchable(projectId: string, result: unknown): WatchTarget | null {
  if (!projectId) return null;
  // A pipeline-shaped object: numeric id + status + pipeline markers (ref/sha/source).
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const id = r.id;
    const status = r.status;
    if (typeof id === 'number' && typeof status === 'string') {
      // Deployment carries environment + deployable; job carries stage;
      // pipeline carries ref/sha/source. Check most-specific first.
      const kind: CiResourceKind =
        'environment' in r && 'deployable' in r ? 'deployment' : 'stage' in r ? 'job' : 'pipeline';
      if (!TERMINAL[kind].has(status)) return { kind, projectId, id };
    }
  }
  return null;
}

/** Injected dependencies — real impls hit MCP; tests pass fakes. */
export interface WatchDeps {
  /** Re-query the jobs of a watched pipeline. */
  pollJobs: (target: WatchTarget) => Promise<JobState[]>;
  /** Deliver an event to the channel. */
  emit: (event: WatchEvent) => void;
  /** Sleep helper (overridable in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Clock (overridable in tests). */
  now?: () => number;
}

/** Tunables for a single watch. */
export interface WatchOptions {
  /** Poll interval in ms (default 10s). */
  pollMs?: number;
  /** Hard cap on total watch duration in ms, guards an endless `running` (default 1h). */
  maxDurationMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Manages active watches, deduplicated by `${projectId}#${kind}#${id}`. Starting
 * a watch that already exists is a no-op (the channel-gateway calls this on every
 * intercepted CI-status result; re-queries must not spawn duplicate timers).
 */
export class WatchManager {
  private readonly active = new Map<string, AbortController>();
  private readonly deps: Required<WatchDeps>;

  constructor(deps: WatchDeps) {
    this.deps = {
      sleep: defaultSleep,
      now: () => Date.now(),
      ...deps,
    };
  }

  /** Stable dedup key for a target. */
  static key(t: WatchTarget): string {
    return `${t.projectId}#${t.kind}#${t.id}`;
  }

  /** Number of currently active watches (for tests/introspection). */
  get size(): number {
    return this.active.size;
  }

  /** True if a watch for this target is already running. */
  has(target: WatchTarget): boolean {
    return this.active.has(WatchManager.key(target));
  }

  /**
   * Start watching a target. No-op if already watched. Returns a promise that
   * resolves when the watch ends (terminal, cap, or cancellation) — callers may
   * ignore it (fire-and-forget) or await it in tests.
   */
  watch(target: WatchTarget, opts: WatchOptions = {}): Promise<void> {
    const key = WatchManager.key(target);
    if (this.active.has(key)) return Promise.resolve();
    const ctrl = new AbortController();
    this.active.set(key, ctrl);
    return this.run(target, opts, ctrl.signal).finally(() => {
      this.active.delete(key);
    });
  }

  /** Cancel a specific watch (e.g. on session end for one resource). */
  cancel(target: WatchTarget): void {
    this.active.get(WatchManager.key(target))?.abort();
  }

  /** Cancel every active watch (session end / shutdown). */
  cancelAll(): void {
    for (const ctrl of this.active.values()) ctrl.abort();
    this.active.clear();
  }

  private async run(target: WatchTarget, opts: WatchOptions, signal: AbortSignal): Promise<void> {
    const pollMs = opts.pollMs ?? 10_000;
    const maxDurationMs = opts.maxDurationMs ?? 3_600_000;
    const started = this.deps.now();
    let prev = new Map<string, string>();

    while (!signal.aborted) {
      const jobs = await this.deps.pollJobs(target);
      const pipelineState = aggregateState(jobs);
      const transitions = diffJobs(prev, jobs);
      const terminal = isTerminal(pipelineState);

      if (transitions.length > 0 || terminal) {
        this.deps.emit({ target, pipelineState, jobs, transitions, terminal });
      }
      prev = snapshot(jobs);

      if (terminal) return;
      if (this.deps.now() - started >= maxDurationMs) return;

      await this.deps.sleep(pollMs);
    }
  }
}
