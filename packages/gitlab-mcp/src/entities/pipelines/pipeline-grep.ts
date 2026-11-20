import * as z from 'zod';
import { gitlab, type ApiPage } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { grepAll, type GrepOutcome } from './line-grep-worker';
import type { LineGrepOptions, LineGrepResult } from './line-grep';
import { TRACE_PAGE_BYTES } from './trace';
import { openTrace } from './trace-open';
import {
  LOG_GREP_DEFAULT_JOBS,
  LOG_GREP_MAX_DOWNSTREAM_DEPTH,
  type BrowsePipelinesInput,
} from './schema-readonly';

/** Processing time one log search call may spend before it returns a resumable result. */
export const LOG_GREP_BUDGET_MS = 2000;
/** Traces of one call scanned at once; most of a scan waits on GitLab, not on the CPU. */
const JOB_CONCURRENCY = 3;
const PAGE_SIZE = 100;

type LogGrepInput = Extract<BrowsePipelinesInput, { action: 'log_grep' }>;
type PipelineGrepInput = LogGrepInput & { pipeline_id: string };

const JobRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  stage: z.string(),
  status: z.string(),
  allow_failure: z.boolean().optional(),
  failure_reason: z.string().optional(),
  web_url: z.string(),
});
const BridgeRowSchema = JobRowSchema.extend({
  downstream_pipeline: z.object({ id: z.number(), project_id: z.number() }).nullish(),
});
type JobRow = z.infer<typeof JobRowSchema>;

/** Who a reported job is; enough to read or retry it with job tools. */
export interface JobIdentity {
  job_id: string;
  name: string;
  stage: string;
  status: string;
  failure_reason: string | null;
  project_id: string;
  pipeline_id: string;
  web_url: string;
}

export type SkipReason =
  | 'allowed_failure'
  | 'max_jobs'
  | 'no_downstream_pipeline'
  | 'downstream_depth'
  | 'downstream_unreadable'
  | 'not_found';

export type SkippedJob = Partial<JobIdentity> & {
  job_id: string;
  reason: SkipReason;
  error?: string;
};

export type JobGrepResult = JobIdentity &
  (Omit<LineGrepResult, 'preset_index'> | { error: string });

export interface PipelineGrepResult {
  pipeline_id: string;
  jobs: JobGrepResult[];
  jobs_scanned: number;
  jobs_skipped: SkippedJob[];
  /** False when the job limit stopped the listing before every reachable job was seen. */
  listing_complete: boolean;
  /** Jobs and lines a next call continues from, through `resume`; null when nothing is left. */
  resume: Array<{ job_id: string; start_line: number }> | null;
  preset_index?: number;
}

interface PipelineRef {
  projectId: string;
  pipelineId: string;
  /** Trigger levels below the searched pipeline. */
  depth: number;
  /** The trigger job that started this pipeline; absent for the searched one. */
  bridge?: JobIdentity;
}

interface Discovery {
  jobs: JobIdentity[];
  skipped: SkippedJob[];
  complete: boolean;
}

function identity(row: JobRow, ref: PipelineRef): JobIdentity {
  return {
    job_id: String(row.id),
    name: row.name,
    stage: row.stage,
    status: row.status,
    failure_reason: row.failure_reason ?? null,
    project_id: ref.projectId,
    pipeline_id: ref.pipelineId,
    web_url: row.web_url,
  };
}

async function* pages<T>(
  path: string,
  schema: z.ZodType<T>,
  scope: readonly string[],
): AsyncGenerator<{ rows: T[]; more: boolean }> {
  let page: number | null = 1;
  while (page !== null) {
    const result: ApiPage<unknown> = await gitlab.getPage<unknown>(path, {
      query: { scope: [...scope], per_page: PAGE_SIZE, page },
    });
    const rows = z.array(schema).safeParse(result.items);
    if (!rows.success) throw new Error(`GitLab returned an unexpected listing for ${path}`);
    page = result.nextPage;
    yield { rows: rows.data, more: page !== null };
  }
}

/**
 * Collect the jobs to search, the pipeline's own first, then each followed trigger's
 * pipeline breadth first. Listing stops once the job limit is passed.
 */
async function discover(
  input: PipelineGrepInput,
  scope: readonly string[],
  wanted: ReadonlyMap<string, number> | null,
): Promise<Discovery> {
  // A resume names its jobs already; the job limit applied when it was produced.
  const maxJobs = wanted?.size ?? input.max_jobs ?? LOG_GREP_DEFAULT_JOBS;
  const downstream = input.include_downstream ?? true;
  const allowFailures = input.include_allowed_failures ?? false;
  const queue: PipelineRef[] = [
    { projectId: input.project_id, pipelineId: input.pipeline_id, depth: 0 },
  ];
  const jobs: JobIdentity[] = [];
  const skipped: SkippedJob[] = [];
  // Set once a further eligible job is seen; the listing then stops after its page.
  let full = false;
  const skip = (job: JobIdentity, reason: SkipReason, error?: string): void => {
    if (wanted === null) skipped.push({ ...job, reason, ...(error ? { error } : {}) });
  };
  const take = (job: JobIdentity, row: JobRow): void => {
    if (wanted !== null) {
      if (wanted.has(job.job_id)) jobs.push(job);
    } else if (row.status === 'failed' && row.allow_failure && !allowFailures) {
      skip(job, 'allowed_failure');
    } else if (jobs.length < maxJobs) {
      jobs.push(job);
    } else {
      full = true;
      skip(job, 'max_jobs');
    }
  };
  const done = (): boolean => full || (wanted !== null && jobs.length === wanted.size);

  let index = 0;
  let unlisted = false;
  for (; index < queue.length && !done(); index++) {
    const ref = queue[index];
    const base = `projects/${normalizeProjectId(ref.projectId)}/pipelines/${encodeApiSegment(ref.pipelineId)}`;
    try {
      for await (const { rows, more } of pages(`${base}/jobs`, JobRowSchema, scope)) {
        for (const row of rows) take(identity(row, ref), row);
        if (done()) {
          unlisted = more || downstream;
          break;
        }
      }
      if (!downstream || done()) continue;
      for await (const { rows } of pages(`${base}/bridges`, BridgeRowSchema, scope)) {
        for (const row of rows) {
          const bridge = identity(row, ref);
          const child = row.downstream_pipeline;
          if (row.status === 'failed' && row.allow_failure && !allowFailures)
            skip(bridge, 'allowed_failure');
          else if (!child) skip(bridge, 'no_downstream_pipeline');
          else if (ref.depth >= LOG_GREP_MAX_DOWNSTREAM_DEPTH) skip(bridge, 'downstream_depth');
          else
            queue.push({
              projectId: String(child.project_id),
              pipelineId: String(child.id),
              depth: ref.depth + 1,
              bridge,
            });
        }
      }
    } catch (error) {
      // The searched pipeline must be readable; a triggered one in another project may not be.
      if (!ref.bridge) throw error;
      skip(
        ref.bridge,
        'downstream_unreadable',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  // Only the job limit stops a listing early; a finished resume needs nothing more.
  const complete = !full || (!unlisted && index >= queue.length);
  if (wanted !== null) {
    const seen = new Set(jobs.map((job) => job.job_id));
    for (const jobId of wanted.keys())
      if (!seen.has(jobId)) skipped.push({ job_id: jobId, reason: 'not_found' });
  }
  return { jobs, skipped, complete };
}

/**
 * Search the logs of a pipeline's jobs, its triggered pipelines' included, in one call.
 * The processing budget and the output size are shared by all jobs of the call; jobs the
 * budget left unscanned, or scanned in part, come back in `resume`.
 */
export async function grepPipelineLogs(input: LogGrepInput): Promise<PipelineGrepResult> {
  if (input.pipeline_id === undefined) throw new Error('log_grep needs job_id or pipeline_id');
  const pipelineInput = input as PipelineGrepInput;
  const patterns = input.patterns ?? [];
  const preset = input.preset ?? (patterns.length === 0 ? 'failures' : undefined);
  const scope = input.job_scope ?? ['failed'];
  const wanted = input.resume
    ? new Map(input.resume.map((entry) => [entry.job_id, entry.start_line]))
    : null;

  const discovery = await discover(pipelineInput, scope, wanted);
  const spent = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const shared: Omit<LineGrepOptions, 'startLine'> = {
    patterns,
    preset,
    before: input.before,
    after: input.after,
    maxMatches: input.max_matches,
    invert: input.invert ?? false,
    normalize: !input.raw,
    budgetMs: LOG_GREP_BUDGET_MS,
    spent,
    // One page of `logs` in total, divided between the jobs.
    outputBytes: Math.floor(TRACE_PAGE_BYTES / Math.max(1, discovery.jobs.length)),
  };
  const startLines = discovery.jobs.map((job) => wanted?.get(job.job_id) ?? 0);
  const outcomes = await grepAll(
    discovery.jobs.map((job, index) => ({
      options: { ...shared, startLine: startLines[index] },
      open: () => openTrace(job.project_id, job.job_id),
    })),
    JOB_CONCURRENCY,
    () => Atomics.load(spent, 0) < LOG_GREP_BUDGET_MS * 1000,
  );

  const jobs: JobGrepResult[] = [];
  const resume: Array<{ job_id: string; start_line: number }> = [];
  discovery.jobs.forEach((job, index) => {
    const outcome: GrepOutcome = outcomes[index];
    if (outcome.status === 'not_started') {
      resume.push({ job_id: job.job_id, start_line: startLines[index] });
    } else if (outcome.status === 'failed') {
      const error = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      jobs.push({ ...job, error });
    } else {
      const { preset_index: _preset, ...result } = outcome.result;
      jobs.push({ ...job, ...result });
      if (result.resume_from !== null)
        resume.push({ job_id: job.job_id, start_line: result.resume_from });
    }
  });

  return {
    pipeline_id: input.pipeline_id,
    jobs,
    jobs_scanned: outcomes.filter((outcome) => outcome.status === 'done').length,
    jobs_skipped: discovery.skipped,
    listing_complete: discovery.complete,
    resume: resume.length > 0 ? resume : null,
    ...(preset ? { preset_index: patterns.length } : {}),
  };
}
