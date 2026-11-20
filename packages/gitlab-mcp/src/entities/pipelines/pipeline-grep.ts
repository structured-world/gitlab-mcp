import * as z from 'zod';
import { gitlab, type ApiPage } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { projectInCallScope } from '../../configuration/call-scope';
import { checkPatterns, grepAll, type GrepOutcome } from './line-grep-worker';
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
  | 'downstream_out_of_scope'
  | 'not_found';

export type SkippedJob = Partial<JobIdentity> & {
  job_id: string;
  reason: SkipReason;
  error?: string;
};

export type JobGrepResult = JobIdentity &
  (Omit<LineGrepResult, 'preset_index'> | { error: string });

/** A pipeline whose trigger jobs could not be listed, so its downstream pipelines are unknown. */
export interface ListingError {
  project_id: string;
  pipeline_id: string;
  error: string;
}

export interface PipelineGrepResult {
  pipeline_id: string;
  jobs: JobGrepResult[];
  jobs_scanned: number;
  jobs_skipped: SkippedJob[];
  /** False when the job limit or a failed listing left reachable jobs unseen. */
  listing_complete: boolean;
  listing_errors?: ListingError[];
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
  listingErrors: ListingError[];
  /** Resume entries not found in pipelines that could not all be listed; still owed. */
  unresolved: Array<{ job_id: string; start_line: number }>;
  complete: boolean;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

/**
 * Listing pages of `path`; `scope` filters by job status, null lists every status, and
 * `retried` adds the attempts a retry superseded.
 */
async function* pages<T>(
  path: string,
  schema: z.ZodType<T>,
  scope: readonly string[] | null,
  retried = false,
): AsyncGenerator<{ rows: T[]; more: boolean }> {
  let page: number | null = 1;
  while (page !== null) {
    const result: ApiPage<unknown> = await gitlab.getPage<unknown>(path, {
      query: {
        ...(scope ? { scope: [...scope] } : {}),
        ...(retried ? { include_retried: true } : {}),
        per_page: PAGE_SIZE,
        page,
      },
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
  // A resumed job is found by id, whatever its status became since the previous call.
  const jobScope = wanted === null ? scope : null;
  const queue: PipelineRef[] = [
    { projectId: input.project_id, pipelineId: input.pipeline_id, depth: 0 },
  ];
  const jobs: JobIdentity[] = [];
  const skipped: SkippedJob[] = [];
  const listingErrors: ListingError[] = [];
  // Set once a further eligible job is seen; the listing then stops after its page.
  let full = false;
  // Set when a listing failed, so jobs it would have shown are unknown, not absent.
  let gaps = false;
  // A resume repeats only read failures; the first call already reported the rest.
  const skip = (job: JobIdentity, reason: SkipReason, error?: string): void => {
    if (wanted === null || reason === 'downstream_unreadable')
      skipped.push({ ...job, reason, ...(error ? { error } : {}) });
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
  // A triggered pipeline may sit in a project the call may not read; each project is checked once.
  const scopeChecks = new Map<string, Promise<boolean>>();
  const inScope = (projectId: string): Promise<boolean> => {
    let check = scopeChecks.get(projectId);
    if (!check) {
      check = projectInCallScope(projectId);
      scopeChecks.set(projectId, check);
    }
    return check;
  };

  let index = 0;
  let unlisted = false;
  for (; index < queue.length && !done(); index++) {
    const ref = queue[index];
    const base = `projects/${normalizeProjectId(ref.projectId)}/pipelines/${encodeApiSegment(ref.pipelineId)}`;
    let read = false;
    try {
      // A resumed job may have been retried since; its id stays on the superseded attempt.
      const listing = pages(`${base}/jobs`, JobRowSchema, jobScope, wanted !== null);
      for await (const { rows, more } of listing) {
        read = true;
        for (const row of rows) take(identity(row, ref), row);
        if (done()) {
          unlisted = more || downstream;
          break;
        }
      }
    } catch (error) {
      gaps = true;
      if (read) {
        // A later page failed: the jobs already listed stay, and the triggers are still read.
        listingErrors.push({
          project_id: ref.projectId,
          pipeline_id: ref.pipelineId,
          error: message(error),
        });
      } else {
        // The searched pipeline must be readable; a triggered one in another project may not be.
        if (!ref.bridge) throw error;
        skip(ref.bridge, 'downstream_unreadable', message(error));
        continue;
      }
    }
    if (!downstream || done()) continue;
    try {
      // Trigger jobs of every status: with the default strategy one succeeds as soon as its
      // pipeline is created, however that pipeline ends.
      for await (const { rows } of pages(`${base}/bridges`, BridgeRowSchema, null)) {
        for (const row of rows) {
          const bridge = identity(row, ref);
          const child = row.downstream_pipeline;
          // A resume follows every trigger: a job it names may sit behind one that has
          // since failed as an allowed failure.
          if (wanted === null && row.status === 'failed' && row.allow_failure && !allowFailures)
            skip(bridge, 'allowed_failure');
          else if (!child) {
            // A manual or skipped trigger has no pipeline yet; only a searched status is news.
            if (jobScope?.includes(row.status)) skip(bridge, 'no_downstream_pipeline');
          } else if (ref.depth >= LOG_GREP_MAX_DOWNSTREAM_DEPTH) skip(bridge, 'downstream_depth');
          else if (!(await inScope(String(child.project_id))))
            skip(bridge, 'downstream_out_of_scope');
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
      // The jobs already listed stay searchable; only what the triggers lead to is unknown.
      gaps = true;
      listingErrors.push({
        project_id: ref.projectId,
        pipeline_id: ref.pipelineId,
        error: message(error),
      });
    }
  }
  // The job limit or a failed listing leaves jobs unseen; a finished resume needs nothing more.
  const complete = !gaps && (!full || (!unlisted && index >= queue.length));
  const unresolved: Array<{ job_id: string; start_line: number }> = [];
  if (wanted !== null) {
    const seen = new Set(jobs.map((job) => job.job_id));
    for (const [jobId, startLine] of wanted) {
      if (seen.has(jobId)) continue;
      if (gaps) unresolved.push({ job_id: jobId, start_line: startLine });
      else skipped.push({ job_id: jobId, reason: 'not_found' });
    }
  }
  return { jobs, skipped, listingErrors, unresolved, complete };
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
    // One page of `logs` in total, divided between the jobs below.
    outputBytes: TRACE_PAGE_BYTES,
  };
  // Invalid RE2 fails the call before GitLab is asked anything, with or without jobs.
  if (patterns.length > 0) await checkPatterns({ ...shared, startLine: 0 });

  const discovery = await discover(pipelineInput, scope, wanted);
  shared.outputBytes = Math.floor(TRACE_PAGE_BYTES / Math.max(1, discovery.jobs.length));
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
  const resume = [...discovery.unresolved];
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
    ...(discovery.listingErrors.length > 0 ? { listing_errors: discovery.listingErrors } : {}),
    resume: resume.length > 0 ? resume : null,
    ...(preset ? { preset_index: patterns.length } : {}),
  };
}
