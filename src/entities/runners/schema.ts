import { z } from 'zod';
import { requiredId, flexibleBoolean } from '../utils';

// ============================================================================
// manage_runner - CQRS Command Tool (discriminated union schema)
// Actions: create_authentication_token, update, pause, resume, delete,
//          reset_authentication_token
// Backed by the GitLab GraphQL runner mutations (runnerCreate / runnerUpdate /
// runnerDelete). pause/resume map to runnerUpdate(paused). Per-runner token reset
// has no GraphQL mutation, so reset_authentication_token uses the REST endpoint.
// Gated behind USE_RUNNERS. Writes require the create_runner / manage_runner scope.
// ============================================================================

const groupPathField = requiredId.describe("Group full path for a group runner (e.g., 'my-group')");
const projectPathField = requiredId.describe(
  "Project full path for a project runner (e.g., 'my-group/my-project')",
);
const runnerIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the runner (from browse_runners); expanded to a global ID internally');
const accessLevelField = z
  .enum(['NOT_PROTECTED', 'REF_PROTECTED'])
  .optional()
  .describe('Access level: NOT_PROTECTED or REF_PROTECTED (protected refs only)');
const tagListField = z.array(z.string()).optional().describe('Tags that determine which jobs run');
const descriptionField = z.string().optional().describe('Runner description');
const maintenanceNoteField = z
  .string()
  .optional()
  .describe('Free-form maintenance note (Markdown)');
const maximumTimeoutField = z.coerce
  .number()
  .int()
  .optional()
  .describe('Maximum job timeout in seconds');

// Settings shared by create and update.
const runnerSettings = {
  description: descriptionField,
  paused: flexibleBoolean.optional().describe('Whether the runner is paused (ignores new jobs)'),
  locked: flexibleBoolean.optional().describe('Lock the runner to its current projects'),
  run_untagged: flexibleBoolean.optional().describe('Allow running untagged jobs'),
  tag_list: tagListField,
  access_level: accessLevelField,
  maximum_timeout: maximumTimeoutField,
  maintenance_note: maintenanceNoteField,
};

// --- Action: create_authentication_token (GitLab 16+ runner registration) ---
const CreateRunnerSchema = z.object({
  action: z
    .literal('create_authentication_token')
    .describe(
      'Create a new runner and return its one-time authentication token (GitLab 16+ flow). ' +
        'For GROUP_TYPE pass group_id; for PROJECT_TYPE pass project_id.',
    ),
  runner_type: z
    .enum(['INSTANCE_TYPE', 'GROUP_TYPE', 'PROJECT_TYPE'])
    .describe(
      'Runner scope. INSTANCE_TYPE needs admin; GROUP_TYPE/PROJECT_TYPE need the namespace',
    ),
  group_id: groupPathField.optional(),
  project_id: projectPathField.optional(),
  ...runnerSettings,
});

// --- Action: update ---
const UpdateRunnerSchema = z.object({
  action: z.literal('update').describe("Update a runner's settings"),
  runner_id: runnerIdField,
  ...runnerSettings,
});

// --- Action: pause ---
const PauseRunnerSchema = z.object({
  action: z.literal('pause').describe('Pause a runner (stops it picking up new jobs)'),
  runner_id: runnerIdField,
});

// --- Action: resume ---
const ResumeRunnerSchema = z.object({
  action: z.literal('resume').describe('Resume a paused runner'),
  runner_id: runnerIdField,
});

// --- Action: delete ---
const DeleteRunnerSchema = z.object({
  action: z.literal('delete').describe('Delete a runner permanently'),
  runner_id: runnerIdField,
});

// --- Action: reset_authentication_token ---
const ResetTokenSchema = z.object({
  action: z
    .literal('reset_authentication_token')
    .describe('Rotate the runner authentication token, returning the new value'),
  runner_id: runnerIdField,
});

// --- Discriminated union combining all actions ---
export const ManageRunnerSchema = z.discriminatedUnion('action', [
  CreateRunnerSchema,
  UpdateRunnerSchema,
  PauseRunnerSchema,
  ResumeRunnerSchema,
  DeleteRunnerSchema,
  ResetTokenSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type ManageRunnerInput = z.infer<typeof ManageRunnerSchema>;
