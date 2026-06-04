import { z } from 'zod';

// ============================================================================
// manage_registry - CQRS Command Tool (discriminated union schema)
// Actions: delete_repository, delete_tag, delete_tags_bulk
// Backed by the GitLab GraphQL Container Registry mutations
// (destroyContainerRepository, destroyContainerRepositoryTags). GraphQL has no
// native regex bulk-delete, so delete_tags_bulk is composed in the handler:
// list tags, filter by regex/keep_n/older_than, then destroy the resolved names.
// Gated behind USE_REGISTRY. Writes require the write_registry token scope.
// ============================================================================

/** True when the string compiles as a regular expression (fail fast at parse). */
const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

// --- Shared fields ---
// Mutations address the repository directly by its numeric ID (as returned by
// browse_registry list_repositories); it is expanded to a global ID internally.
const repositoryIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the container repository (from browse_registry list_repositories)');
const tagNameField = z.string().min(1).describe('Container image tag name to delete');

// --- Action: delete_repository ---
const DeleteRepositorySchema = z.object({
  action: z
    .literal('delete_repository')
    .describe('Delete a container repository (queued as a background operation)'),
  repository_id: repositoryIdField,
});

// --- Action: delete_tag ---
const DeleteTagSchema = z.object({
  action: z.literal('delete_tag').describe('Delete a single tag from a container repository'),
  repository_id: repositoryIdField,
  tag_name: tagNameField,
});

// --- Action: delete_tags_bulk ---
const DeleteTagsBulkSchema = z.object({
  action: z
    .literal('delete_tags_bulk')
    .describe(
      'Bulk-delete tags by regex with optional retention rules. Destructive and irreversible. ' +
        'Tags are resolved client-side (regex match, keep the newest keep_n, drop only those older ' +
        'than older_than) and then deleted. Always pair name_regex_delete with keep_n and/or ' +
        'older_than to avoid deleting more than intended.',
    ),
  repository_id: repositoryIdField,
  name_regex_delete: z
    .string()
    .min(1)
    .refine(isValidRegex, 'Must be a valid regular expression')
    .describe('Regex for tag names to delete (e.g., ".*" for all, "^v.+" for version tags)'),
  name_regex_keep: z
    .string()
    .refine(isValidRegex, 'Must be a valid regular expression')
    .optional()
    .describe('Regex for tag names to always keep (takes precedence over name_regex_delete)'),
  keep_n: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Keep the N most recently created matching tags'),
  older_than: z
    .string()
    .regex(/^\d+(s|m|h|d)$/, 'Duration like "30m", "2h", "7d" (seconds/minutes/hours/days)')
    .optional()
    .describe('Only delete tags created longer ago than this duration (e.g., "7d", "12h")'),
});

// --- Discriminated union combining all actions ---
export const ManageRegistrySchema = z.discriminatedUnion('action', [
  DeleteRepositorySchema,
  DeleteTagSchema,
  DeleteTagsBulkSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type ManageRegistryInput = z.infer<typeof ManageRegistrySchema>;
