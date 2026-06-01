import { z } from 'zod';
import { requiredId, flexibleBoolean } from '../utils';

// ============================================================================
// manage_deploy_key - CQRS Command Tool (discriminated union schema)
// Actions: add, enable, update, delete
//
// Manages a project's deploy keys: the SSH public keys that let CI/automation
// access the repository without a user PAT. Project-level, Free tier.
// ============================================================================

const projectIdField = requiredId.describe(
  "Project ID or URL-encoded path (e.g. 'group/project' or '123').",
);
const keyIdField = z.coerce.number().int().positive().describe('Numeric deploy key ID.');
const canPushField = flexibleBoolean
  .optional()
  .describe('Whether the key may push to the repository (read/write). Default false (read-only).');

// --- Action: add ---
const AddDeployKeySchema = z.object({
  action: z.literal('add').describe('Add a deploy key to the project'),
  project_id: projectIdField,
  title: z.string().describe('Human-readable name for the deploy key.'),
  key: z.string().describe('The SSH public key (e.g. "ssh-ed25519 AAAA... comment").'),
  can_push: canPushField,
  expires_at: z
    .string()
    .optional()
    .describe('Optional expiry as an ISO 8601 datetime (e.g. "2026-12-31T00:00:00Z").'),
});

// --- Action: enable ---
const EnableDeployKeySchema = z.object({
  action: z
    .literal('enable')
    .describe('Enable an existing deploy key (from another project) on this project'),
  project_id: projectIdField,
  key_id: keyIdField,
});

// --- Action: update ---
const UpdateDeployKeySchema = z.object({
  action: z.literal('update').describe('Update a deploy key title or push permission'),
  project_id: projectIdField,
  key_id: keyIdField,
  title: z.string().optional().describe('New title for the deploy key.'),
  can_push: canPushField,
});

// --- Action: delete ---
const DeleteDeployKeySchema = z.object({
  action: z.literal('delete').describe('Remove a deploy key from the project'),
  project_id: projectIdField,
  key_id: keyIdField,
});

// --- Discriminated union combining all actions ---
export const ManageDeployKeySchema = z.discriminatedUnion('action', [
  AddDeployKeySchema,
  EnableDeployKeySchema,
  UpdateDeployKeySchema,
  DeleteDeployKeySchema,
]);

export type ManageDeployKeyInput = z.infer<typeof ManageDeployKeySchema>;
