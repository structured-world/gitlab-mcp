import { z } from 'zod';
import { vulnerabilityIdField } from './schema-readonly';

// ============================================================================
// manage_vulnerability - CQRS Command Tool (discriminated union schema)
// Actions: dismiss, confirm, resolve, revert
//
// Drives the vulnerability state machine via the GitLab GraphQL mutations
// (vulnerabilityDismiss / Confirm / Resolve / RevertToDetected). Ultimate tier.
// Gated behind USE_VULNERABILITIES.
// ============================================================================

// --- Action: dismiss ---
const DismissSchema = z.object({
  action: z
    .literal('dismiss')
    .describe(
      'Dismiss a vulnerability (e.g. false positive), optionally with a reason and comment',
    ),
  vulnerability_id: vulnerabilityIdField,
  comment: z.string().optional().describe('Free-text justification for the dismissal.'),
  dismissal_reason: z
    .enum([
      'ACCEPTABLE_RISK',
      'FALSE_POSITIVE',
      'MITIGATING_CONTROL',
      'USED_IN_TESTS',
      'NOT_APPLICABLE',
    ])
    .optional()
    .describe('Structured dismissal reason.'),
});

// --- Action: confirm ---
const ConfirmSchema = z.object({
  action: z.literal('confirm').describe('Confirm a vulnerability as a genuine finding'),
  vulnerability_id: vulnerabilityIdField,
});

// --- Action: resolve ---
const ResolveSchema = z.object({
  action: z.literal('resolve').describe('Mark a vulnerability as resolved'),
  vulnerability_id: vulnerabilityIdField,
});

// --- Action: revert ---
const RevertSchema = z.object({
  action: z
    .literal('revert')
    .describe('Revert a vulnerability back to the detected state (un-dismiss / un-resolve)'),
  vulnerability_id: vulnerabilityIdField,
});

// --- Discriminated union combining all actions ---
export const ManageVulnerabilitySchema = z.discriminatedUnion('action', [
  DismissSchema,
  ConfirmSchema,
  ResolveSchema,
  RevertSchema,
]);

export type ManageVulnerabilityInput = z.infer<typeof ManageVulnerabilitySchema>;
