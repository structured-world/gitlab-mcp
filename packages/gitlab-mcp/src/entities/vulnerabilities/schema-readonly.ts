import { z } from 'zod';
import { requiredId } from '../utils';

// ============================================================================
// browse_vulnerabilities - CQRS Query Tool (discriminated union schema)
// Actions: list, get
//
// Vulnerability Management is an Ultimate-tier capability. GraphQL exposes a much
// richer surface than REST (nested scanner/location/state metadata), so the entity
// is GraphQL-first. list scopes by project_id / group_id, or neither for an
// instance-wide view. Gated behind USE_VULNERABILITIES.
// ============================================================================

export const vulnerabilityIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric vulnerability ID (from a list action); expanded to a global ID internally.');

const stateFilter = z
  .array(z.enum(['DETECTED', 'CONFIRMED', 'RESOLVED', 'DISMISSED']))
  .optional()
  .describe('Filter by vulnerability state(s).');
const severityFilter = z
  .array(z.enum(['INFO', 'UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']))
  .optional()
  .describe('Filter by severity level(s).');
const reportTypeFilter = z
  .array(
    z.enum([
      'SAST',
      'DAST',
      'DEPENDENCY_SCANNING',
      'CONTAINER_SCANNING',
      'SECRET_DETECTION',
      'COVERAGE_FUZZING',
      'API_FUZZING',
      'CLUSTER_IMAGE_SCANNING',
      'GENERIC',
    ]),
  )
  .optional()
  .describe('Filter by scanner report type(s).');
const sortField = z
  .enum([
    'severity_desc',
    'severity_asc',
    'detected_desc',
    'detected_asc',
    'state_desc',
    'state_asc',
    'title_desc',
    'title_asc',
  ])
  .optional()
  .describe('Sort order (default: severity_desc).');
const firstField = z.coerce
  .number()
  .int()
  .positive()
  .max(100)
  .optional()
  .describe('Max items to return (cursor pagination, default 20, max 100).');
const afterField = z.string().optional().describe('Cursor for the next page (endCursor).');

// --- Action: list (project / group / instance) ---
const ListVulnerabilitiesSchema = z.object({
  action: z
    .literal('list')
    .describe(
      'List vulnerabilities. Pass project_id for a project, group_id for a group, or neither for an instance-wide view (admin).',
    ),
  project_id: requiredId.optional().describe('Project full path or ID to scope the list.'),
  group_id: requiredId.optional().describe('Group full path or ID to scope the list.'),
  state: stateFilter,
  severity: severityFilter,
  report_type: reportTypeFilter,
  sort: sortField,
  first: firstField,
  after: afterField,
});

// --- Action: get ---
const GetVulnerabilitySchema = z.object({
  action: z.literal('get').describe('Get a single vulnerability by its numeric ID.'),
  vulnerability_id: vulnerabilityIdField,
});

// --- Discriminated union combining all actions ---
export const BrowseVulnerabilitiesSchema = z
  .discriminatedUnion('action', [ListVulnerabilitiesSchema, GetVulnerabilitySchema])
  // A vulnerability list is scoped to a single namespace; project_id and group_id
  // are mutually exclusive.
  .refine((data) => data.action !== 'list' || !(data.project_id && data.group_id), {
    message: 'Pass at most one of project_id or group_id (a list targets a single scope)',
    path: ['project_id'],
  });

export type BrowseVulnerabilitiesInput = z.infer<typeof BrowseVulnerabilitiesSchema>;
