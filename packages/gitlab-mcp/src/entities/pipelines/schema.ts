import { z } from 'zod';
import { requiredId, numericId } from '../utils';

// ============================================================================
// Shared schemas for pipeline variables and inputs
// ============================================================================

const PipelineVariableSchema = z.object({
  key: z.string().describe('Variable name'),
  value: z.string().describe('Variable value'),
  variable_type: z
    .enum(['env_var', 'file'])
    .optional()
    .describe('Variable type: env_var (default) or file'),
});

// Pipeline input value types: string, number, boolean, array
const PipelineInputValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
  .describe('Input value: string, number, boolean, or array of strings');

// ============================================================================
// manage_pipeline - CQRS Command Tool (discriminated union schema)
// Pipeline-level actions: create (branch/tag or merge request), retry, cancel
// Job-level actions: play_job, retry_job, cancel_job (folded in; the _job suffix
// avoids colliding with the pipeline-level retry/cancel).
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe('Project ID or URL-encoded path');
const pipelineIdField = numericId.describe('The ID of the pipeline');
const jobIdField = numericId.describe('The ID of the job');

// --- Action: create ---
// One action for both targets, so a profile that denies manage_pipeline:create also
// denies merge request pipelines.
const CreatePipelineSchema = z.object({
  action: z
    .literal('create')
    .describe(
      'Trigger a new pipeline: on a branch/tag (ref) or for a merge request (merge_request_iid). Exactly one target.',
    ),
  project_id: projectIdField.describe(
    'Project ID or URL-encoded path. For a merge request pipeline: the project the merge request belongs to (the target project of a fork MR).',
  ),
  ref: z
    .string()
    .optional()
    .describe('The branch or tag to run a branch/tag pipeline on. Omit with merge_request_iid.'),
  merge_request_iid: numericId
    .optional()
    .describe(
      'Internal ID of a merge request to run a merge request pipeline for (source merge_request_event; a merged results pipeline when the project enables them). Not combinable with ref, variables or inputs.',
    ),
  variables: z
    .array(PipelineVariableSchema)
    .optional()
    .describe(
      'CI/CD variables to pass to a branch/tag pipeline (key-value pairs with optional type)',
    ),
  inputs: z
    .record(z.string(), PipelineInputValueSchema)
    .optional()
    .describe(
      'Typed pipeline inputs defined in the .gitlab-ci.yml spec (GitLab 17.10+), for a branch/tag pipeline. Keys must match input names in the pipeline spec.',
    ),
});

// --- Action: retry ---
const RetryPipelineSchema = z.object({
  action: z.literal('retry').describe('Re-run a failed/canceled pipeline'),
  project_id: projectIdField,
  pipeline_id: pipelineIdField,
});

// --- Action: cancel ---
const CancelPipelineSchema = z.object({
  action: z.literal('cancel').describe('Stop a running pipeline'),
  project_id: projectIdField,
  pipeline_id: pipelineIdField,
});

// --- Action: play_job ---
const PlayJobSchema = z.object({
  action: z.literal('play_job').describe('Trigger a manual job'),
  project_id: projectIdField,
  job_id: jobIdField,
  job_variables_attributes: z
    .array(PipelineVariableSchema)
    .optional()
    .describe('Variables to pass to the job'),
});

// --- Action: retry_job ---
const RetryJobSchema = z.object({
  action: z.literal('retry_job').describe('Re-run a failed/canceled job'),
  project_id: projectIdField,
  job_id: jobIdField,
});

// --- Action: cancel_job ---
const CancelJobSchema = z.object({
  action: z.literal('cancel_job').describe('Stop a running job'),
  project_id: projectIdField,
  job_id: jobIdField,
  force: z.boolean().optional().describe('Force cancellation of the job'),
});

// --- Discriminated union combining all pipeline + job actions ---
export const ManagePipelineSchema = z
  .discriminatedUnion('action', [
    CreatePipelineSchema,
    RetryPipelineSchema,
    CancelPipelineSchema,
    PlayJobSchema,
    RetryJobSchema,
    CancelJobSchema,
  ])
  .superRefine((input, context) => {
    if (input.action !== 'create') return;
    if (input.merge_request_iid === undefined) {
      if (input.ref === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['ref'],
          message: 'create requires exactly one target: ref or merge_request_iid',
        });
      }
      return;
    }
    // The merge request pipeline endpoint takes its ref from the merge request and accepts
    // neither variables nor inputs; GitLab would drop them without an error.
    const unsupported = {
      ref: input.ref !== undefined,
      variables: (input.variables?.length ?? 0) > 0,
      inputs: Object.keys(input.inputs ?? {}).length > 0,
    };
    for (const [name, present] of Object.entries(unsupported)) {
      if (present) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} cannot be combined with merge_request_iid: a merge request pipeline takes no ${name}`,
        });
      }
    }
  });

// ============================================================================
// Type exports
// ============================================================================

export type ManagePipelineInput = z.infer<typeof ManagePipelineSchema>;
