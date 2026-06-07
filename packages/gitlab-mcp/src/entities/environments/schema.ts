import { z } from 'zod';
import { requiredId, flexibleBoolean } from '../utils';

// ============================================================================
// manage_environment - CQRS Command Tool (discriminated union schema)
// Actions: create, update, stop, delete, update_deployment_status
// Deployments are folded in as the update_deployment_status action rather than a
// separate tool, keeping the MCP tool count lean.
// Uses z.discriminatedUnion() for type-safe action handling.
// ============================================================================

// --- Shared fields ---
const projectIdField = requiredId.describe(
  "Project ID or URL-encoded path (e.g., 'my-group/my-project')",
);
const environmentIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the environment');
const tierField = z
  .enum(['production', 'staging', 'testing', 'development', 'other'])
  .describe('Deployment tier of the environment');
const externalUrlField = z
  .string()
  .url()
  .describe(
    'URL where the deployed environment can be reached (e.g., https://staging.example.com)',
  );
const descriptionField = z.string().describe('Description of the environment');

// --- Action: create ---
const CreateEnvironmentSchema = z.object({
  action: z.literal('create').describe('Create a new environment'),
  project_id: projectIdField,
  name: z.string().describe('Name of the environment'),
  external_url: externalUrlField.optional(),
  tier: tierField.optional(),
  description: descriptionField.optional(),
});

// --- Action: update ---
const UpdateEnvironmentSchema = z.object({
  action: z
    .literal('update')
    .describe('Update an existing environment (name cannot be changed via the API)'),
  project_id: projectIdField,
  environment_id: environmentIdField,
  external_url: externalUrlField.optional(),
  tier: tierField.optional(),
  description: descriptionField.optional(),
});

// --- Action: stop ---
const StopEnvironmentSchema = z.object({
  action: z.literal('stop').describe('Stop an environment (required before it can be deleted)'),
  project_id: projectIdField,
  environment_id: environmentIdField,
  force: flexibleBoolean
    .optional()
    .describe('Force the stop, skipping the on_stop action if one is defined'),
});

// --- Action: delete ---
const DeleteEnvironmentSchema = z.object({
  action: z.literal('delete').describe('Delete a stopped environment'),
  project_id: projectIdField,
  environment_id: environmentIdField,
});

// --- Action: update_deployment_status ---
const UpdateDeploymentStatusSchema = z.object({
  action: z
    .literal('update_deployment_status')
    .describe(
      'Update the status of a deployment. Only deployments not tied to a pipeline job can be updated.',
    ),
  project_id: projectIdField,
  deployment_id: z.coerce
    .number()
    .int()
    .positive()
    .describe('Numeric ID of the deployment to update'),
  status: z.enum(['running', 'success', 'failed', 'canceled']).describe('New deployment status'),
});

// --- Discriminated union combining all actions ---
export const ManageEnvironmentSchema = z
  .discriminatedUnion('action', [
    CreateEnvironmentSchema,
    UpdateEnvironmentSchema,
    StopEnvironmentSchema,
    DeleteEnvironmentSchema,
    UpdateDeploymentStatusSchema,
  ])
  // An update with no fields would send an empty body and be rejected by GitLab;
  // require at least one updatable field.
  .refine(
    (data) =>
      data.action !== 'update' ||
      data.external_url !== undefined ||
      data.tier !== undefined ||
      data.description !== undefined,
    {
      message: 'update requires at least one of: external_url, tier, description',
      path: ['external_url'],
    },
  );

// ============================================================================
// Type exports
// ============================================================================

export type ManageEnvironmentInput = z.infer<typeof ManageEnvironmentSchema>;
