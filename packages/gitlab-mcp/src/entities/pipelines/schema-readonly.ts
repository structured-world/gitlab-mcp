import { z } from 'zod';
import { flexibleBoolean, paginationFields, requiredId, numericId } from '../utils';
import {
  ARTIFACT_DEFAULT_BYTES,
  ARTIFACT_MAX_BYTES,
  ARTIFACT_MAX_OFFSET,
  encodeArtifactPath,
} from './artifact-path';
import { MAX_PATTERN_LENGTH, MAX_PATTERNS } from '../../utils/re2-pattern';
import { MAX_SECTION_NAME } from './log-sections';

export const LOG_GREP_MAX_CONTEXT = 20;
export const LOG_GREP_MAX_MATCHES = 500;
export const LOG_GREP_MAX_JOBS = 20;
export const LOG_GREP_DEFAULT_JOBS = 10;
/** Trigger levels followed below the searched pipeline: child, then grandchild. */
export const LOG_GREP_MAX_DOWNSTREAM_DEPTH = 2;

// Pipeline related schemas
export const GitLabPipelineSchema = z.object({
  id: z.coerce.string(),
  project_id: z.coerce.string(),
  sha: z.string(),
  ref: z.string(),
  status: z.string(),
  source: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  web_url: z.string(),
  duration: z.number().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  coverage: z.coerce.number().nullable().optional(),
  user: z
    .object({
      id: z.coerce.string(),
      name: z.string(),
      username: z.string(),
      avatar_url: z.string().nullable().optional(),
    })
    .optional(),
  detailed_status: z
    .object({
      icon: z.string().optional(),
      text: z.string().optional(),
      label: z.string().optional(),
      group: z.string().optional(),
      tooltip: z.string().optional(),
      has_details: flexibleBoolean.optional(),
      details_path: z.string().optional(),
      illustration: z
        .object({
          image: z.string().optional(),
          size: z.string().optional(),
          title: z.string().optional(),
        })
        .nullable()
        .optional(),
      favicon: z.string().optional(),
    })
    .optional(),
});

// Pipeline job related schemas
export const GitLabPipelineJobSchema = z.object({
  id: z.coerce.string(),
  status: z.string(),
  stage: z.string(),
  name: z.string(),
  ref: z.string(),
  tag: flexibleBoolean,
  coverage: z.coerce.number().nullable().optional(),
  allow_failure: flexibleBoolean.optional(),
  created_at: z.string(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  duration: z.number().optional(),
  queued_duration: z.number().optional(),
  user: z
    .object({
      id: z.coerce.string(),
      name: z.string(),
      username: z.string(),
      state: z.string(),
      avatar_url: z.string().nullable().optional(),
      web_url: z.string(),
    })
    .optional(),
  commit: z
    .object({
      id: z.string(),
      short_id: z.string(),
      title: z.string(),
      author_name: z.string(),
      author_email: z.string(),
      created_at: z.string(),
      message: z.string(),
    })
    .optional(),
  pipeline: z
    .object({
      id: z.coerce.string(),
      project_id: z.coerce.string(),
      ref: z.string(),
      sha: z.string(),
      status: z.string(),
    })
    .optional(),
  web_url: z.string(),
});

// Pipeline trigger job (bridge) schema
export const GitLabPipelineTriggerJobSchema = z.object({
  id: z.coerce.string(),
  status: z.string(),
  stage: z.string(),
  name: z.string(),
  ref: z.string(),
  tag: flexibleBoolean,
  coverage: z.coerce.number().nullable().optional(),
  allow_failure: flexibleBoolean.optional(),
  created_at: z.string(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  duration: z.number().optional(),
  queued_duration: z.number().optional(),
  user: z
    .object({
      id: z.coerce.string(),
      name: z.string(),
      username: z.string(),
      state: z.string(),
      avatar_url: z.string().nullable().optional(),
      web_url: z.string(),
    })
    .optional(),
  commit: z
    .object({
      id: z.string(),
      short_id: z.string(),
      title: z.string(),
      author_name: z.string(),
      author_email: z.string(),
      created_at: z.string(),
      message: z.string(),
    })
    .optional(),
  pipeline: z
    .object({
      id: z.coerce.string(),
      project_id: z.coerce.string(),
      ref: z.string(),
      sha: z.string(),
      status: z.string(),
    })
    .optional(),
  web_url: z.string(),
  downstream_pipeline: z
    .object({
      id: z.coerce.string(),
      sha: z.string(),
      ref: z.string(),
      status: z.string(),
      created_at: z.string(),
      updated_at: z.string(),
      web_url: z.string(),
    })
    .optional(),
});

// ============================================================================
// Shared enums for pipeline filtering
// ============================================================================

const PipelineScopeSchema = z
  .enum(['running', 'pending', 'finished', 'branches', 'tags'])
  .describe('The scope of pipelines to return');

const PipelineStatusSchema = z
  .enum([
    'created',
    'waiting_for_resource',
    'preparing',
    'pending',
    'running',
    'success',
    'failed',
    'canceled',
    'skipped',
    'manual',
    'scheduled',
  ])
  .describe('The status of pipelines to return');

const PipelineSourceSchema = z
  .enum([
    'push',
    'web',
    'trigger',
    'schedule',
    'api',
    'external',
    'chat',
    'webide',
    'merge_request_event',
    'external_pull_request_event',
    'parent_pipeline',
    'ondemand_dast_scan',
    'ondemand_dast_validation',
  ])
  .describe('The source of pipelines');

export const JobScopeSchema = z
  .enum(['created', 'pending', 'running', 'failed', 'success', 'canceled', 'skipped', 'manual'])
  .describe('Scope of jobs to show');

const TriggerJobScopeSchema = z
  .enum([
    'created',
    'pending',
    'running',
    'failed',
    'success',
    'canceled',
    'skipped',
    'manual',
    'waiting_for_resource',
    'preparing',
  ])
  .describe('Scope of trigger jobs to show');

// ============================================================================
// browse_pipelines - CQRS Query Tool (discriminated union schema)
// Actions: list, get, jobs, triggers, job, log_sections, logs, log_grep, artifact_file, artifact_grep
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe('Project ID or URL-encoded path');

// --- Action: list ---
const ListPipelinesSchema = z.object({
  action: z.literal('list').describe('List pipelines with filtering'),
  project_id: projectIdField,
  scope: PipelineScopeSchema.optional().describe('Pipeline scope filter'),
  status: PipelineStatusSchema.optional().describe('Pipeline status filter'),
  source: PipelineSourceSchema.optional().describe('Pipeline source filter'),
  ref: z.string().optional().describe('Filter by branch or tag ref'),
  sha: z.string().optional().describe('Filter by SHA'),
  yaml_errors: z.boolean().optional().describe('Filter by YAML errors'),
  name: z.string().optional().describe('Filter by name of user who triggered pipeline'),
  username: z.string().optional().describe('Filter by username who triggered pipeline'),
  updated_after: z.string().optional().describe('ISO 8601 datetime to filter by updated_after'),
  updated_before: z.string().optional().describe('ISO 8601 datetime to filter by updated_before'),
  order_by: z
    .enum(['id', 'status', 'ref', 'updated_at', 'user_id'])
    .optional()
    .describe('Order pipelines by'),
  sort: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  ...paginationFields(),
});

// --- Action: get ---
const GetPipelineSchema = z.object({
  action: z.literal('get').describe('Get single pipeline details'),
  project_id: projectIdField,
  pipeline_id: numericId.describe('The ID of the pipeline'),
});

// --- Action: jobs ---
const ListPipelineJobsSchema = z.object({
  action: z.literal('jobs').describe('List jobs in a pipeline'),
  project_id: projectIdField,
  pipeline_id: numericId.describe('The ID of the pipeline'),
  job_scope: z.array(JobScopeSchema).optional().describe('Scope of jobs to show'),
  include_retried: z.boolean().optional().describe('Include retried jobs in the response'),
  ...paginationFields(),
});

// --- Action: triggers ---
const ListPipelineTriggersSchema = z.object({
  action: z.literal('triggers').describe('List bridge/trigger jobs in a pipeline'),
  project_id: projectIdField,
  pipeline_id: numericId.describe('The ID of the pipeline'),
  trigger_scope: z
    .array(TriggerJobScopeSchema)
    .optional()
    .describe('Scope of trigger jobs to show'),
  include_retried: z.boolean().optional().describe('Include retried jobs in the response'),
  ...paginationFields(),
});

// --- Action: job ---
const GetJobSchema = z.object({
  action: z.literal('job').describe('Get single job details'),
  project_id: projectIdField,
  job_id: numericId.describe('The ID of the job'),
});

// --- Section selection, shared by logs and log_grep ---
const sectionField = z
  .string()
  .min(1)
  .max(MAX_SECTION_NAME)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Section names use letters, digits, _ . and -')
  .optional()
  .describe(
    'Only this log section, by its exact name from log_sections (for example step_script); an unknown name returns the available ones',
  );
const sectionIndexField = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Which section of that name, counting from 0 (default: 0); requires section');

/** section_index means nothing without the section it counts. */
function requireSectionForIndex(
  input: { section?: string; section_index?: number },
  context: z.RefinementCtx,
): void {
  if (input.section_index !== undefined && input.section === undefined)
    context.addIssue({
      code: 'custom',
      path: ['section_index'],
      message: "'section_index' needs 'section'",
    });
}

// --- Action: log_sections ---
const ListLogSectionsSchema = z.object({
  action: z
    .literal('log_sections')
    .describe(
      'List the sections of a job log (runner steps such as step_script, and custom sections) with line ranges and durations',
    ),
  project_id: projectIdField,
  job_id: numericId.describe('The ID of the job'),
});

// --- Action: logs ---
const GetJobLogsSchema = z
  .object({
    action: z
      .literal('logs')
      .describe('Read job logs with bounded memory and explicit byte truncation'),
    project_id: projectIdField,
    job_id: numericId.describe('The ID of the job'),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe(
        'Maximum source lines to return (default: 200, max: 10000). Up to 16 KiB per line and 1 MiB per page of source bytes; omitted content is reported in truncation.lines. Use with start for pagination',
      ),
    start: z
      .number()
      .int()
      .optional()
      .describe(
        'Start from specific line number (0-based). Positive from beginning, negative from end (e.g., -100 = last 100 lines). Use nextStart from previous response to paginate. With section, counted within the section',
      ),
    section: sectionField,
    section_index: sectionIndexField,
  })
  .superRefine(requireSectionForIndex);

// --- Action: log_grep ---
const contextLines = (side: string) =>
  z
    .number()
    .int()
    .min(0)
    .max(LOG_GREP_MAX_CONTEXT)
    .default(2)
    .describe(`Context lines ${side} each match (default: 2, max: ${LOG_GREP_MAX_CONTEXT})`);

const maxMatchesField = z
  .number()
  .int()
  .min(1)
  .max(LOG_GREP_MAX_MATCHES)
  .default(50)
  .describe(
    `Matches to return (default: 50, max: ${LOG_GREP_MAX_MATCHES}); match_count still counts all`,
  );

const patternList = z.array(z.string().min(1).max(MAX_PATTERN_LENGTH)).min(1).max(MAX_PATTERNS);
const PATTERNS_DESCRIPTION = `RE2 patterns (up to ${MAX_PATTERNS}, ${MAX_PATTERN_LENGTH} chars each); inline flags such as (?i). A line matches when any pattern does`;

const invertField = flexibleBoolean
  .optional()
  .describe('Select lines that match no pattern instead of lines that match one');

const PIPELINE_ONLY_FIELDS = [
  'job_scope',
  'include_downstream',
  'include_allowed_failures',
  'max_jobs',
  'resume',
] as const;

const GrepJobLogsSchema = z
  .object({
    action: z
      .literal('log_grep')
      .describe(
        "Search a whole job log, or the logs of a pipeline's failed jobs, with RE2 patterns; returns matching lines with context and absolute line numbers",
      ),
    project_id: projectIdField,
    job_id: numericId.optional().describe('The job to search; omit when pipeline_id is given'),
    pipeline_id: numericId
      .optional()
      .describe(
        "Search the logs of this pipeline's jobs instead of one job, grouped per job; omit when job_id is given. Without patterns the failures preset is used",
      ),
    job_scope: z
      .array(JobScopeSchema)
      .min(1)
      .optional()
      .describe('With pipeline_id: statuses of the jobs to search (default: failed)'),
    include_downstream: flexibleBoolean
      .optional()
      .describe(
        `With pipeline_id: also search jobs of child and multi-project pipelines started by its trigger jobs of any status, up to ${LOG_GREP_MAX_DOWNSTREAM_DEPTH} levels down (default: true)`,
      ),
    include_allowed_failures: flexibleBoolean
      .optional()
      .describe(
        'With pipeline_id: also search failed jobs and follow failed trigger jobs marked allow_failure (default: false)',
      ),
    max_jobs: z
      .number()
      .int()
      .min(1)
      .max(LOG_GREP_MAX_JOBS)
      .optional()
      .describe(
        `With pipeline_id: most jobs to search (default: 10, max: ${LOG_GREP_MAX_JOBS}); further jobs are listed as skipped`,
      ),
    resume: z
      .array(
        z.object({
          job_id: numericId.describe('Job from a previous resume list'),
          start_line: z.number().int().min(0).describe('Line to continue from'),
        }),
      )
      .min(1)
      .max(LOG_GREP_MAX_JOBS)
      .optional()
      .describe(
        'With pipeline_id: pass the resume list of a previous result to search only the jobs and lines it left',
      ),
    patterns: patternList.optional().describe(PATTERNS_DESCRIPTION),
    preset: z
      .enum(['failures'])
      .optional()
      .describe(
        'failures: common compiler, test, interpreter and runner failure output. Usable alone or with patterns',
      ),
    before: contextLines('before'),
    after: contextLines('after'),
    max_matches: maxMatchesField,
    invert: invertField,
    start_line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'With job_id: first line to search (0-based); pass resume_from from a truncated result',
      ),
    raw: flexibleBoolean
      .optional()
      .describe(
        'Match source bytes as stored. By default timestamps, ANSI escapes, CR rewrites and section markers are removed, as the GitLab log view shows them',
      ),
    section: sectionField,
    section_index: sectionIndexField,
  })
  // Cross-field rules stay out of the JSON Schema: the default flat mode merges action
  // branches into one object for clients without oneOf support, so a per-branch oneOf would
  // be lost or rejected. The parameter descriptions state them instead.
  .superRefine((input, context) => {
    requireSectionForIndex(input, context);
    if ((input.job_id === undefined) === (input.pipeline_id === undefined))
      context.addIssue({ code: 'custom', message: 'Give exactly one of job_id or pipeline_id' });
    if (input.job_id !== undefined) {
      for (const field of PIPELINE_ONLY_FIELDS)
        if (input[field] !== undefined)
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `'${field}' applies only with pipeline_id`,
          });
    } else if (input.start_line !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['start_line'],
        message: "With pipeline_id, continue through 'resume' instead of 'start_line'",
      });
    }
  });

const artifactJobField = numericId.describe('The ID of the job that uploaded artifacts:paths');
const artifactPathField = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => {
    try {
      encodeArtifactPath(path);
      return true;
    } catch {
      return false;
    }
  }, 'Expected a relative artifact file path without traversal')
  .describe(
    'Relative path within artifacts:paths, such as reports/test-results.txt; reports-only uploads are not archive entries',
  );

const GrepArtifactFileSchema = z.object({
  action: z
    .literal('artifact_grep')
    .describe(
      'Search one text artifact file (test reports, JUnit XML, coverage or tool output) with RE2 patterns; returns matching lines with context, absolute line numbers and the byte offset of each hunk for artifact_file',
    ),
  project_id: projectIdField,
  job_id: artifactJobField,
  artifact_path: artifactPathField,
  patterns: patternList.describe(PATTERNS_DESCRIPTION),
  before: contextLines('before'),
  after: contextLines('after'),
  max_matches: maxMatchesField,
  invert: invertField,
  start_line: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'First line to search (0-based); pass resume_from from a truncated result. The first 20 MiB of the file are searched',
    ),
});

const GetArtifactFileSchema = z.object({
  action: z
    .literal('artifact_file')
    .describe(
      'Read one artifact file as bounded UTF-8 text; inspect job metadata to choose its path',
    ),
  project_id: projectIdField,
  job_id: artifactJobField,
  artifact_path: artifactPathField,
  byte_offset: z
    .number()
    .int()
    .min(0)
    .max(ARTIFACT_MAX_OFFSET)
    .default(0)
    .describe(
      'Source byte offset (default: 0, max: 20 MiB); use next_byte_offset to preserve UTF-8 boundaries',
    ),
  byte_limit: z
    .number()
    .int()
    .min(1)
    .max(ARTIFACT_MAX_BYTES)
    .default(ARTIFACT_DEFAULT_BYTES)
    .describe(
      'Maximum source bytes returned (default: 64 KiB, max: 1 MiB). An undersized window cannot split a UTF-8 character',
    ),
});

// --- Discriminated union combining all actions ---
export const BrowsePipelinesSchema = z.discriminatedUnion('action', [
  ListPipelinesSchema,
  GetPipelineSchema,
  ListPipelineJobsSchema,
  ListPipelineTriggersSchema,
  GetJobSchema,
  ListLogSectionsSchema,
  GetJobLogsSchema,
  GrepJobLogsSchema,
  GetArtifactFileSchema,
  GrepArtifactFileSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowsePipelinesInput = z.infer<typeof BrowsePipelinesSchema>;
export type GitLabPipeline = z.infer<typeof GitLabPipelineSchema>;
export type GitLabPipelineJob = z.infer<typeof GitLabPipelineJobSchema>;
export type GitLabPipelineTriggerJob = z.infer<typeof GitLabPipelineTriggerJobSchema>;
