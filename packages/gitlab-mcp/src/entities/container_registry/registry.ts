import * as z from 'zod';
import { BrowseRegistrySchema } from './schema-readonly';
import { ManageRegistrySchema } from './schema';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';
import { ConnectionManager } from '../../services/ConnectionManager';
import { cleanGidsFromObject } from '../../utils/idConversion';
import { getGitLabApiUrlFromContext } from '../../oauth/token-context';
import {
  LIST_CONTAINER_REPOSITORIES,
  GET_CONTAINER_REPOSITORY,
  LIST_CONTAINER_REPOSITORY_TAGS,
  DESTROY_CONTAINER_REPOSITORY,
  DESTROY_CONTAINER_REPOSITORY_TAGS,
  type ContainerTagNode,
  type ListTagsResult,
} from '../../graphql/containerRegistry';

/**
 * Container Registry tools registry - 2 CQRS tools
 *
 * browse_registry (Query): list_repositories, get_repository, list_tags, get_tag
 * manage_registry (Command): delete_repository, delete_tag, delete_tags_bulk
 *
 * Backed by the GitLab GraphQL Container Registry API. GraphQL has no native
 * regex/keep_n/older_than bulk-delete mutation, so delete_tags_bulk lists tags,
 * filters client-side, and calls destroyContainerRepositoryTags. Gated behind
 * USE_REGISTRY. Free tier (writes require the write_registry scope).
 */

const REPOSITORY_GID_PREFIX = 'gid://gitlab/ContainerRepository/';
const repositoryGid = (id: number): string => `${REPOSITORY_GID_PREFIX}${id}`;

// GitLab caps destroyContainerRepositoryTags at 20 tag names per call.
const DESTROY_TAGS_BATCH = 20;
// Safety cap when paginating tags for bulk cleanup, so a huge repository can't
// spin forever. Surfaced in the result when hit (never silently truncated).
const BULK_TAG_SCAN_CAP = 1000;

const OLDER_THAN_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse a duration like "7d"/"12h" into milliseconds (validated by the schema). */
function durationToMs(older_than: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(older_than);
  /* istanbul ignore next -- schema regex guarantees a match */
  if (!match) throw new Error(`Invalid duration: ${older_than}`);
  return parseInt(match[1], 10) * OLDER_THAN_UNIT_MS[match[2]];
}

/**
 * Resolve which tag names a bulk cleanup should delete, mirroring GitLab's own
 * cleanup-policy order: match name_regex_delete, drop anything matching
 * name_regex_keep, keep the newest keep_n, then of the remainder keep only those
 * older than older_than.
 */
function resolveBulkDeleteTags(
  tags: ContainerTagNode[],
  opts: {
    name_regex_delete: string;
    name_regex_keep?: string;
    keep_n?: number;
    older_than?: string;
  },
): string[] {
  const deleteRe = new RegExp(opts.name_regex_delete);
  const keepRe = opts.name_regex_keep ? new RegExp(opts.name_regex_keep) : null;

  let candidates = tags.filter((t) => deleteRe.test(t.name) && !keepRe?.test(t.name));

  // Newest first by creation date (tags without a date sort last).
  candidates.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  if (opts.keep_n !== undefined) {
    candidates = candidates.slice(opts.keep_n);
  }

  if (opts.older_than !== undefined) {
    const cutoff = Date.now() - durationToMs(opts.older_than);
    candidates = candidates.filter((t) => t.createdAt !== null && Date.parse(t.createdAt) < cutoff);
  }

  return candidates.map((t) => t.name);
}

export const containerRegistryToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_registry - CQRS Query Tool (discriminated union schema)
  // ============================================================================
  [
    'browse_registry',
    {
      name: 'browse_registry',
      description:
        "Inspect the GitLab Container Registry. Actions: list_repositories (a project's image repositories), get_repository (single repository by ID), list_tags (tags of a repository), get_tag (single tag with manifest digest, size, and timestamps). Related: manage_registry to delete repositories and tags (including regex bulk cleanup).",
      inputSchema: z.toJSONSchema(BrowseRegistrySchema),
      requirements: { default: { tier: 'free', minVersion: '12.0' } },
      gate: { envVar: 'USE_REGISTRY', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseRegistrySchema.parse(args);

        assertActionAllowed('browse_registry', input.action);

        const client = ConnectionManager.getInstance().getClient(getGitLabApiUrlFromContext());

        switch (input.action) {
          case 'list_repositories': {
            const res = await client.request(LIST_CONTAINER_REPOSITORIES, {
              fullPath: input.project_id,
              name: input.name ?? null,
              first: input.first ?? 20,
              after: input.after ?? null,
            });
            if (!res.project) {
              throw new Error(`Project "${input.project_id}" not found or not accessible`);
            }
            return cleanGidsFromObject(res.project.containerRepositories);
          }

          case 'get_repository': {
            const res = await client.request(GET_CONTAINER_REPOSITORY, {
              id: repositoryGid(input.repository_id),
            });
            if (!res.containerRepository) {
              throw new Error(`Container repository ${input.repository_id} not found`);
            }
            return cleanGidsFromObject(res.containerRepository);
          }

          case 'list_tags': {
            const res = await client.request(LIST_CONTAINER_REPOSITORY_TAGS, {
              id: repositoryGid(input.repository_id),
              name: input.name ?? null,
              first: input.first ?? 20,
              after: input.after ?? null,
            });
            if (!res.containerRepository) {
              throw new Error(`Container repository ${input.repository_id} not found`);
            }
            return cleanGidsFromObject(res.containerRepository.tags);
          }

          case 'get_tag': {
            // The tags `name` filter is a substring match, so the exact tag can sit
            // on any page of the filtered results — page through until it's found.
            const gid = repositoryGid(input.repository_id);
            let after: string | null = null;
            for (;;) {
              // Explicit type: `after` is both an input var and assigned from the
              // result below, which defeats generic inference (circular).
              const res: ListTagsResult = await client.request(LIST_CONTAINER_REPOSITORY_TAGS, {
                id: gid,
                name: input.tag_name,
                first: 100,
                after,
              });
              if (!res.containerRepository) {
                throw new Error(`Container repository ${input.repository_id} not found`);
              }
              const conn = res.containerRepository.tags;
              const tag = conn.nodes.find((t) => t.name === input.tag_name);
              if (tag) return cleanGidsFromObject(tag);
              if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
              after = conn.pageInfo.endCursor;
            }
            throw new Error(
              `Tag "${input.tag_name}" not found in container repository ${input.repository_id}`,
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_registry - CQRS Command Tool (discriminated union schema)
  // ============================================================================
  [
    'manage_registry',
    {
      name: 'manage_registry',
      description:
        'Delete GitLab Container Registry repositories and tags. Actions: delete_repository (remove a whole repository), delete_tag (remove one tag), delete_tags_bulk (regex cleanup with keep_n/older_than retention - destructive). Related: browse_registry to inspect before deleting.',
      inputSchema: z.toJSONSchema(ManageRegistrySchema),
      requirements: { default: { tier: 'free', minVersion: '12.0' } },
      gate: { envVar: 'USE_REGISTRY', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageRegistrySchema.parse(args);

        assertActionAllowed('manage_registry', input.action);

        const client = ConnectionManager.getInstance().getClient(getGitLabApiUrlFromContext());
        const gid = repositoryGid(input.repository_id);

        switch (input.action) {
          case 'delete_repository': {
            const res = await client.request(DESTROY_CONTAINER_REPOSITORY, { id: gid });
            const errors = res.destroyContainerRepository?.errors ?? [];
            if (errors.length > 0) {
              throw new Error(`GitLab API error: ${errors.join(', ')}`);
            }
            return {
              deleted: true,
              repository_id: input.repository_id,
              status: res.destroyContainerRepository?.containerRepository?.status ?? null,
            };
          }

          case 'delete_tag': {
            const res = await client.request(DESTROY_CONTAINER_REPOSITORY_TAGS, {
              id: gid,
              tagNames: [input.tag_name],
            });
            const errors = res.destroyContainerRepositoryTags?.errors ?? [];
            if (errors.length > 0) {
              throw new Error(`GitLab API error: ${errors.join(', ')}`);
            }
            return {
              deleted: true,
              repository_id: input.repository_id,
              tag_name: input.tag_name,
            };
          }

          case 'delete_tags_bulk': {
            // Page through tags (up to BULK_TAG_SCAN_CAP) so the regex/keep_n/
            // older_than filtering happens over the full set.
            const tags: ContainerTagNode[] = [];
            let capped = false;
            let after: string | null = null;
            for (;;) {
              // Explicit result type: `after` is both an input var and assigned
              // from the result below, which defeats generic inference (circular).
              const page: ListTagsResult = await client.request(LIST_CONTAINER_REPOSITORY_TAGS, {
                id: gid,
                name: null,
                first: 100,
                after,
              });
              // A null repository means the ID is invalid / inaccessible; fail
              // rather than reporting a misleading deleted_count: 0 success.
              if (!page.containerRepository) {
                throw new Error(`Container repository ${input.repository_id} not found`);
              }
              const conn = page.containerRepository.tags;
              tags.push(...conn.nodes);
              if (tags.length >= BULK_TAG_SCAN_CAP) {
                tags.length = BULK_TAG_SCAN_CAP;
                capped = true;
                break;
              }
              if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
              after = conn.pageInfo.endCursor;
            }

            const toDelete = resolveBulkDeleteTags(tags, {
              name_regex_delete: input.name_regex_delete,
              name_regex_keep: input.name_regex_keep,
              keep_n: input.keep_n,
              older_than: input.older_than,
            });

            const deleted: string[] = [];
            for (let i = 0; i < toDelete.length; i += DESTROY_TAGS_BATCH) {
              const batch = toDelete.slice(i, i + DESTROY_TAGS_BATCH);
              const res = await client.request(DESTROY_CONTAINER_REPOSITORY_TAGS, {
                id: gid,
                tagNames: batch,
              });
              const errors = res.destroyContainerRepositoryTags?.errors ?? [];
              if (errors.length > 0) {
                throw new Error(`GitLab API error: ${errors.join(', ')}`);
              }
              deleted.push(...batch);
            }

            return {
              deleted: true,
              repository_id: input.repository_id,
              deleted_count: deleted.length,
              deleted_tags: deleted,
              // true when the repository had more than BULK_TAG_SCAN_CAP tags and
              // only the first page-set was considered; re-run to continue.
              scan_capped: capped,
            };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getContainerRegistryReadOnlyToolNames(): string[] {
  return ['browse_registry'];
}
