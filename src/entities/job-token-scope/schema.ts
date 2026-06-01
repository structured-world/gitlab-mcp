import { z } from 'zod';
import { requiredId, flexibleBoolean } from '../utils';

// ============================================================================
// manage_job_token_scope - CQRS Command Tool (discriminated union schema)
// Actions: set_enabled, add_project, remove_project, add_group, remove_group
//
// Manages the inbound CI/CD job token allowlist: which other projects/groups
// may use their pipeline CI_JOB_TOKEN to access this project. After GitLab 19.0
// removes the legacy open-access mode, the allowlist is the only mechanism for
// cross-project token access. Project-level only. Requires Maintainer/Owner.
// ============================================================================

const projectIdField = requiredId.describe(
  "Project whose job token scope is modified. Numeric ID or URL-encoded path (e.g. 'group/project' or '123').",
);

// GitLab's allowlist endpoints identify the allowlisted entity by numeric ID only.
const targetProjectIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the project to add/remove from the inbound allowlist.');

const targetGroupIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the group to add/remove from the inbound allowlist.');

// --- Action: set_enabled ---
const SetEnabledSchema = z.object({
  action: z
    .literal('set_enabled')
    .describe('Enable or disable inbound job token access restriction (allowlist enforcement)'),
  project_id: projectIdField,
  enabled: flexibleBoolean.describe(
    'When true, only allowlisted projects/groups may access this project via CI_JOB_TOKEN.',
  ),
});

// --- Action: add_project ---
const AddProjectSchema = z.object({
  action: z.literal('add_project').describe('Add a project to the inbound job token allowlist'),
  project_id: projectIdField,
  target_project_id: targetProjectIdField,
});

// --- Action: remove_project ---
const RemoveProjectSchema = z.object({
  action: z
    .literal('remove_project')
    .describe('Remove a project from the inbound job token allowlist'),
  project_id: projectIdField,
  target_project_id: targetProjectIdField,
});

// --- Action: add_group ---
const AddGroupSchema = z.object({
  action: z.literal('add_group').describe('Add a group to the inbound job token allowlist'),
  project_id: projectIdField,
  target_group_id: targetGroupIdField,
});

// --- Action: remove_group ---
const RemoveGroupSchema = z.object({
  action: z.literal('remove_group').describe('Remove a group from the inbound job token allowlist'),
  project_id: projectIdField,
  target_group_id: targetGroupIdField,
});

// --- Discriminated union combining all actions ---
export const ManageJobTokenScopeSchema = z.discriminatedUnion('action', [
  SetEnabledSchema,
  AddProjectSchema,
  RemoveProjectSchema,
  AddGroupSchema,
  RemoveGroupSchema,
]);

export type ManageJobTokenScopeInput = z.infer<typeof ManageJobTokenScopeSchema>;
