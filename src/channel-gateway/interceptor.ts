/**
 * Gateway interceptor (issue #483): the single forward-path hook. Every tool
 * call is forwarded verbatim to the downstream gitlab-mcp; when the result is a
 * non-final CI resource, a watch is registered (deduplicated) that polls jobs
 * and emits channel events. Kept free of MCP wiring so it is unit-testable with
 * a fake `forward` — the MCP adapter (gateway.ts) supplies the real transport.
 */
import {
  detectWatchable,
  WatchManager,
  type JobState,
  type WatchEvent,
  type WatchTarget,
} from './watch';
import { parseJobs, parseToolResult } from './format';

/** Injected I/O: downstream forwarding and channel delivery. */
export interface InterceptorDeps {
  /** Forward a tool call to the downstream gitlab-mcp and return its raw result. */
  forward: (name: string, args: unknown) => Promise<unknown>;
  /** Deliver a watch event to the channel. */
  emit: (event: WatchEvent) => void;
  /** Poll interval for watches in ms (default 10s). */
  pollMs?: number;
  /** Hard cap per watch in ms (default 1h). */
  maxDurationMs?: number;
}

/** Pull the project identifier out of a tool call's args (path or numeric id). */
export function extractProjectId(args: unknown): string {
  if (args && typeof args === 'object') {
    const p = (args as Record<string, unknown>).project_id;
    if (typeof p === 'string') return p;
    if (typeof p === 'number') return String(p);
  }
  return '';
}

export class Interceptor {
  private readonly watches: WatchManager;
  private readonly pollMs: number;
  private readonly maxDurationMs: number;

  constructor(private readonly deps: InterceptorDeps) {
    this.pollMs = deps.pollMs ?? 10_000;
    this.maxDurationMs = deps.maxDurationMs ?? 3_600_000;
    this.watches = new WatchManager({
      pollJobs: (t) => this.pollJobs(t),
      emit: deps.emit,
    });
  }

  /** Number of active watches (introspection/tests). */
  get activeWatches(): number {
    return this.watches.size;
  }

  /** Re-query the jobs of a watched pipeline through the same downstream path. */
  private async pollJobs(target: WatchTarget): Promise<JobState[]> {
    const result = await this.deps.forward('browse_pipelines', {
      action: 'jobs',
      project_id: target.projectId,
      pipeline_id: target.id,
    });
    return parseJobs(result);
  }

  /**
   * Forward one tool call, then arm a watch if the result is a non-final CI
   * resource. The watch runs fire-and-forget; the original result is returned
   * unchanged so the agent sees exactly what the downstream produced.
   */
  async handleCall(name: string, args: unknown): Promise<unknown> {
    const result = await this.deps.forward(name, args);
    const target = detectWatchable(extractProjectId(args), parseToolResult(result));
    if (target && !this.watches.has(target)) {
      void this.watches.watch(target, { pollMs: this.pollMs, maxDurationMs: this.maxDurationMs });
    }
    return result;
  }

  /** Cancel all watches (session end / shutdown). */
  shutdown(): void {
    this.watches.cancelAll();
  }
}
