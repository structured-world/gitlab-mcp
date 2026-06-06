import { z } from 'zod';
import { requiredId } from '../utils';

// ============================================================================
// browse_registry - CQRS Query Tool (discriminated union schema)
// Actions: list_repositories, get_repository, list_tags, get_tag
// Backed by the GitLab GraphQL Container Registry API. Tags fold in as actions
// rather than a separate CQRS pair. Gated behind USE_REGISTRY. Free tier.
// ============================================================================

// --- Shared fields ---
// list_repositories resolves the project via the GraphQL `project(fullPath:)`
// field, so it needs the project PATH (numeric IDs are not accepted there).
const projectPathField = requiredId.describe(
  "Project full path (e.g., 'my-group/my-project') - required by the GraphQL project lookup",
);
// Other actions address the repository directly by its numeric ID (as returned
// by list_repositories); it is expanded to a global ID internally.
const repositoryIdField = z.coerce
  .number()
  .int()
  .positive()
  .describe('Numeric ID of the container repository (from list_repositories)');
const tagNameField = z
  .string()
  .min(1)
  .describe('Container image tag name (e.g., "latest", "v1.2.0")');
const firstField = z.coerce
  .number()
  .int()
  .positive()
  .max(100)
  .optional()
  .describe('Max number of items to return (cursor pagination, default 20, max 100)');
const afterField = z
  .string()
  .optional()
  .describe('Cursor for the next page (endCursor from a previous response)');

// --- Action: list_repositories ---
const ListRepositoriesSchema = z.object({
  action: z
    .literal('list_repositories')
    .describe("List a project's container registry repositories"),
  project_id: projectPathField,
  name: z.string().optional().describe('Filter repositories by name (substring match)'),
  first: firstField,
  after: afterField,
});

// --- Action: get_repository ---
const GetRepositorySchema = z.object({
  action: z
    .literal('get_repository')
    .describe('Get a single container repository by its numeric ID'),
  repository_id: repositoryIdField,
});

// --- Action: list_tags ---
const ListTagsSchema = z.object({
  action: z.literal('list_tags').describe('List tags of a container repository'),
  repository_id: repositoryIdField,
  name: z.string().optional().describe('Filter tags by name (substring match)'),
  first: firstField,
  after: afterField,
});

// --- Action: get_tag ---
const GetTagSchema = z.object({
  action: z
    .literal('get_tag')
    .describe('Get a single tag with its manifest digest, size, and timestamps'),
  repository_id: repositoryIdField,
  tag_name: tagNameField,
});

// --- Discriminated union combining all actions ---
export const BrowseRegistrySchema = z.discriminatedUnion('action', [
  ListRepositoriesSchema,
  GetRepositorySchema,
  ListTagsSchema,
  GetTagSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type BrowseRegistryInput = z.infer<typeof BrowseRegistrySchema>;
