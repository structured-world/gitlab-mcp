import { z } from "zod";
import { requiredId } from "../utils";

// ============================================================================
// Shared schemas for pipeline variables and inputs
// ============================================================================

const PipelineVariableSchema = z.object({
  key: z.string().describe("Variable name"),
  value: z.string().describe("Variable value"),
  variable_type: z
    .enum(["env_var", "file"])
    .optional()
    .describe("Variable type: env_var (default) or file"),
});

// Pipeline input value types (GitLab 15.5+ supports string, number, boolean, array)
const PipelineInputValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
  .describe("Input value: string, number, boolean, or array of strings");

// ============================================================================
// manage_pipeline - CQRS Command Tool (discriminated union schema)
// Actions: create, retry, cancel
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe("Project ID or URL-encoded path");
const pipelineIdField = requiredId.describe("The ID of the pipeline");

// --- Action: create ---
const CreatePipelineSchema = z.object({
  action: z.literal("create").describe("Trigger a new pipeline on branch/tag"),
  project_id: projectIdField,
  ref: z.string().describe("The branch or tag to run the pipeline on"),
  variables: z
    .array(PipelineVariableSchema)
    .optional()
    .describe("Legacy variables to pass to the pipeline (key-value pairs with optional type)"),
  inputs: z
    .record(z.string(), PipelineInputValueSchema)
    .optional()
    .describe(
      "Typed pipeline inputs defined in .gitlab-ci.yml spec (GitLab 15.5+). Keys must match input names in pipeline spec."
    ),
});

// --- Action: retry ---
const RetryPipelineSchema = z.object({
  action: z.literal("retry").describe("Re-run a failed/canceled pipeline"),
  project_id: projectIdField,
  pipeline_id: pipelineIdField,
});

// --- Action: cancel ---
const CancelPipelineSchema = z.object({
  action: z.literal("cancel").describe("Stop a running pipeline"),
  project_id: projectIdField,
  pipeline_id: pipelineIdField,
});

// --- Discriminated union combining all actions ---
export const ManagePipelineSchema = z.discriminatedUnion("action", [
  CreatePipelineSchema,
  RetryPipelineSchema,
  CancelPipelineSchema,
]);

// ============================================================================
// manage_pipeline_job - CQRS Command Tool (discriminated union schema)
// Actions: play, retry, cancel
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
// ============================================================================

// --- Shared fields ---
const jobIdField = requiredId.describe("The ID of the job");

// --- Action: play ---
const PlayJobSchema = z.object({
  action: z.literal("play").describe("Trigger a manual job"),
  project_id: projectIdField,
  job_id: jobIdField,
  job_variables_attributes: z
    .array(PipelineVariableSchema)
    .optional()
    .describe("Variables to pass to the job"),
});

// --- Action: retry ---
const RetryJobSchema = z.object({
  action: z.literal("retry").describe("Re-run a failed/canceled job"),
  project_id: projectIdField,
  job_id: jobIdField,
});

// --- Action: cancel ---
const CancelJobSchema = z.object({
  action: z.literal("cancel").describe("Stop a running job"),
  project_id: projectIdField,
  job_id: jobIdField,
  force: z.boolean().optional().describe("Force cancellation of the job"),
});

// --- Discriminated union combining all actions ---
export const ManagePipelineJobSchema = z.discriminatedUnion("action", [
  PlayJobSchema,
  RetryJobSchema,
  CancelJobSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type ManagePipelineInput = z.infer<typeof ManagePipelineSchema>;
export type ManagePipelineJobInput = z.infer<typeof ManagePipelineJobSchema>;
