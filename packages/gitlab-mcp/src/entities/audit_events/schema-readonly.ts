import { z } from 'zod';
import { requiredId, paginationFields } from '../utils';

// ============================================================================
// browse_audit_events - CQRS Query Tool (discriminated union schema)
// Actions: list_instance, list_group, list_project, get
//
// Audit events are an immutable compliance record of who did what, when. There is
// no manage_* counterpart - they cannot be created or edited via the API. Exposed
// only through REST. The instance/group/project scopes fold in as actions; get
// infers the scope from project_id / group_id. Gated behind USE_AUDIT_EVENTS.
// Premium/Ultimate tier; list_instance additionally requires admin.
// ============================================================================

export const projectIdField = requiredId.describe(
  "Project ID or URL-encoded path (e.g. 'group/project' or '123').",
);
export const groupIdField = requiredId.describe(
  "Group ID or URL-encoded path (e.g. 'my-group' or '42').",
);
export const auditEventIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric audit-event ID (from a list action).');

const createdAfterField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'created_after must be a YYYY-MM-DD date')
  .optional()
  .describe('Return events created on or after this date (YYYY-MM-DD).');
const createdBeforeField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'created_before must be a YYYY-MM-DD date')
  .optional()
  .describe('Return events created on or before this date (YYYY-MM-DD).');

// --- Action: list_instance (admin-only, instance-wide) ---
const ListInstanceSchema = z.object({
  action: z
    .literal('list_instance')
    .describe('List instance-wide audit events (requires admin; Premium+)'),
  entity_type: z
    .string()
    .optional()
    .describe("Filter by entity type, e.g. 'User', 'Group', 'Project', 'Key'."),
  entity_id: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter by the numeric ID of the entity (used with entity_type).'),
  created_after: createdAfterField,
  created_before: createdBeforeField,
  ...paginationFields(),
});

// --- Action: list_group ---
const ListGroupSchema = z.object({
  action: z
    .literal('list_group')
    .describe('List a group audit events (Premium+, group owner/admin)'),
  group_id: groupIdField,
  created_after: createdAfterField,
  created_before: createdBeforeField,
  ...paginationFields(),
});

// --- Action: list_project ---
const ListProjectSchema = z.object({
  action: z
    .literal('list_project')
    .describe('List a project audit events (Premium+, project owner/admin)'),
  project_id: projectIdField,
  created_after: createdAfterField,
  created_before: createdBeforeField,
  ...paginationFields(),
});

// --- Action: get (single event; scope inferred from project_id/group_id) ---
const GetAuditEventSchema = z.object({
  action: z
    .literal('get')
    .describe(
      'Get a single audit event by ID. Pass project_id for a project event, group_id for a group event, or neither for an instance event (admin).',
    ),
  audit_event_id: auditEventIdField,
  project_id: requiredId.optional().describe('Set for a project audit event.'),
  group_id: requiredId.optional().describe('Set for a group audit event.'),
});

// --- Discriminated union combining all actions ---
export const BrowseAuditEventsSchema = z
  .discriminatedUnion('action', [
    ListInstanceSchema,
    ListGroupSchema,
    ListProjectSchema,
    GetAuditEventSchema,
  ])
  // An audit event belongs to a single scope; project_id and group_id are mutually exclusive.
  .refine((data) => data.action !== 'get' || !(data.project_id && data.group_id), {
    message: 'Pass at most one of project_id or group_id (an event belongs to a single scope)',
    path: ['project_id'],
  });

export type BrowseAuditEventsInput = z.infer<typeof BrowseAuditEventsSchema>;
