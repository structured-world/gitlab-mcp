import { z } from 'zod';
import { requiredId, paginationFields } from '../utils';

// ============================================================================
// browse_environments - CQRS Query Tool (discriminated union schema)
// Actions: list, get, list_deployments
// Uses z.discriminatedUnion() for type-safe action handling.
// Schema pipeline flattens to flat JSON Schema for AI clients that don't support oneOf.
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

// --- Action: list ---
const ListEnvironmentsSchema = z.object({
  action: z.literal('list').describe('List environments for a project'),
  project_id: projectIdField,
  name: z.string().optional().describe('Return the environment with this exact name'),
  search: z
    .string()
    .optional()
    .describe('Return environments matching this search term (min 3 characters)'),
  states: z
    .enum(['available', 'stopping', 'stopped'])
    .optional()
    .describe('Filter environments by state'),
  ...paginationFields(),
});

// --- Action: get ---
const GetEnvironmentSchema = z.object({
  action: z
    .literal('get')
    .describe('Get a single environment by ID, including its last deployment'),
  project_id: projectIdField,
  environment_id: environmentIdField,
});

// --- Action: list_deployments ---
const ListDeploymentsSchema = z.object({
  action: z
    .literal('list_deployments')
    .describe('List deployments for a project, optionally filtered by environment'),
  project_id: projectIdField,
  environment: z.string().optional().describe('Filter deployments by environment name'),
  status: z
    .enum(['created', 'running', 'success', 'failed', 'canceled', 'skipped', 'blocked'])
    .optional()
    .describe('Filter deployments by status'),
  order_by: z
    .enum(['id', 'iid', 'created_at', 'updated_at', 'finished_at', 'ref'])
    .optional()
    .describe('Order deployments by field (default: id)'),
  sort: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: asc)'),
  updated_after: z
    .string()
    .optional()
    .describe('Return deployments updated after this ISO 8601 date'),
  updated_before: z
    .string()
    .optional()
    .describe('Return deployments updated before this ISO 8601 date'),
  finished_after: z
    .string()
    .optional()
    .describe(
      'Return deployments finished after this ISO 8601 date (requires order_by=finished_at)',
    ),
  finished_before: z
    .string()
    .optional()
    .describe(
      'Return deployments finished before this ISO 8601 date (requires order_by=finished_at)',
    ),
  ...paginationFields(),
});

// --- Discriminated union combining all actions ---
export const BrowseEnvironmentsSchema = z.discriminatedUnion('action', [
  ListEnvironmentsSchema,
  GetEnvironmentSchema,
  ListDeploymentsSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseEnvironmentsInput = z.infer<typeof BrowseEnvironmentsSchema>;
