import { z } from 'zod';
import { requiredId, paginationFields } from '../utils';

// ============================================================================
// browse_deploy_keys - CQRS Query Tool (discriminated union schema)
// Actions: list, get
//
// Deploy keys are SSH public keys that grant a project read (or read/write)
// repository access without a user PAT — used by CI/automation to clone/push.
// ============================================================================

const projectIdField = requiredId.describe(
  "Project ID or URL-encoded path (e.g. 'group/project' or '123').",
);
const keyIdField = z.coerce.number().int().positive().describe('Numeric deploy key ID.');

// --- Action: list ---
const ListDeployKeysSchema = z.object({
  action: z
    .literal('list')
    .describe(
      'List deploy keys. With project_id: the keys on that project. Without project_id: all deploy keys across the instance (requires admin).',
    ),
  project_id: requiredId
    .optional()
    .describe('Project to list keys for. Omit to list all instance deploy keys (admin only).'),
  public: z
    .boolean()
    .optional()
    .describe('Instance list only: when true, return only the public (non-sensitive) fields.'),
  ...paginationFields(),
});

// --- Action: get ---
const GetDeployKeySchema = z.object({
  action: z.literal('get').describe('Get a single project deploy key by ID'),
  project_id: projectIdField,
  key_id: keyIdField,
});

// --- Discriminated union combining all actions ---
export const BrowseDeployKeysSchema = z.discriminatedUnion('action', [
  ListDeployKeysSchema,
  GetDeployKeySchema,
]);

export type BrowseDeployKeysInput = z.infer<typeof BrowseDeployKeysSchema>;
