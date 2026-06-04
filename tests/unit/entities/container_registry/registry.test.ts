import {
  containerRegistryToolRegistry,
  getContainerRegistryReadOnlyToolNames,
} from '../../../../src/entities/container_registry/registry';
import {
  LIST_CONTAINER_REPOSITORIES,
  GET_CONTAINER_REPOSITORY,
  LIST_CONTAINER_REPOSITORY_TAGS,
  DESTROY_CONTAINER_REPOSITORY,
  DESTROY_CONTAINER_REPOSITORY_TAGS,
} from '../../../../src/graphql/containerRegistry';

const mockClient = { request: jest.fn() };

jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({ getClient: jest.fn(() => mockClient) })),
  },
}));

const browse = () => containerRegistryToolRegistry.get('browse_registry')!;
const manage = () => containerRegistryToolRegistry.get('manage_registry')!;

// --- Response builders (keep mock setup DRY across cases) ---
const REPO_GID = 'gid://gitlab/ContainerRepository/5';
const tag = (name: string, createdAt = '2026-01-01T00:00:00Z') => ({ name, createdAt });
const tagsPage = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({
  containerRepository: { id: REPO_GID, tags: { nodes, pageInfo: { hasNextPage, endCursor } } },
});
const destroyTagsOk = () => ({
  destroyContainerRepositoryTags: { deletedTagNames: [], errors: [] },
});
const destroyTagsError = (msg: string) => ({
  destroyContainerRepositoryTags: { deletedTagNames: [], errors: [msg] },
});

/** Run delete_tags_bulk; first request resolves to the given tag pages, the rest to destroy-ok. */
async function runBulk(
  params: Record<string, unknown>,
  pages: ReturnType<typeof tagsPage>[],
): Promise<{ deleted_count: number; deleted_tags: string[]; scan_capped: boolean }> {
  for (const p of pages) mockClient.request.mockResolvedValueOnce(p);
  mockClient.request.mockResolvedValue(destroyTagsOk());
  return (await manage().handler({
    action: 'delete_tags_bulk',
    repository_id: 5,
    ...params,
  })) as { deleted_count: number; deleted_tags: string[]; scan_capped: boolean };
}

beforeEach(() => {
  mockClient.request.mockReset();
});

describe('container registry registry', () => {
  it('registers the CQRS pair with browse_registry read-only', () => {
    expect(containerRegistryToolRegistry.has('browse_registry')).toBe(true);
    expect(containerRegistryToolRegistry.has('manage_registry')).toBe(true);
    expect(getContainerRegistryReadOnlyToolNames()).toEqual(['browse_registry']);
    expect(browse().gate).toEqual({ envVar: 'USE_REGISTRY', defaultValue: true });
    expect(manage().gate).toEqual({ envVar: 'USE_REGISTRY', defaultValue: true });
  });

  describe('browse_registry', () => {
    it('list_repositories queries the project by full path', async () => {
      mockClient.request.mockResolvedValueOnce({
        project: {
          containerRepositories: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      });

      await browse().handler({
        action: 'list_repositories',
        project_id: 'my-group/my-project',
        first: 5,
      });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_CONTAINER_REPOSITORIES);
      expect(vars).toMatchObject({ fullPath: 'my-group/my-project', first: 5 });
    });

    it('list_repositories throws when the project is not found', async () => {
      mockClient.request.mockResolvedValueOnce({ project: null });
      await expect(
        browse().handler({ action: 'list_repositories', project_id: 'missing/project' }),
      ).rejects.toThrow('not found or not accessible');
    });

    it('get_repository expands the numeric id to a global ID', async () => {
      mockClient.request.mockResolvedValueOnce({
        containerRepository: { id: 'gid://gitlab/ContainerRepository/42', name: 'app' },
      });

      await browse().handler({ action: 'get_repository', repository_id: 42 });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(GET_CONTAINER_REPOSITORY);
      expect(vars).toEqual({ id: 'gid://gitlab/ContainerRepository/42' });
    });

    it('get_repository throws when missing', async () => {
      mockClient.request.mockResolvedValueOnce({ containerRepository: null });
      await expect(
        browse().handler({ action: 'get_repository', repository_id: 99 }),
      ).rejects.toThrow('Container repository 99 not found');
    });

    it('list_tags queries tags by repository global ID', async () => {
      mockClient.request.mockResolvedValueOnce(tagsPage([]));

      await browse().handler({ action: 'list_tags', repository_id: 5 });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_CONTAINER_REPOSITORY_TAGS);
      expect(vars).toMatchObject({ id: REPO_GID });
    });

    it('list_tags throws when the repository is not found', async () => {
      mockClient.request.mockResolvedValueOnce({ containerRepository: null });
      await expect(browse().handler({ action: 'list_tags', repository_id: 5 })).rejects.toThrow(
        'Container repository 5 not found',
      );
    });

    it('get_tag selects the exact tag among substring matches', async () => {
      mockClient.request.mockResolvedValueOnce(tagsPage([tag('v1.0.0-rc'), tag('v1.0.0')]));

      const result = (await browse().handler({
        action: 'get_tag',
        repository_id: 5,
        tag_name: 'v1.0.0',
      })) as { name: string };

      expect(result.name).toBe('v1.0.0');
    });

    it('get_tag throws when the exact tag is absent', async () => {
      mockClient.request.mockResolvedValueOnce(tagsPage([tag('latest')]));
      await expect(
        browse().handler({ action: 'get_tag', repository_id: 5, tag_name: 'v9' }),
      ).rejects.toThrow('Tag "v9" not found');
    });

    it('get_tag paginates past the first page to find the exact tag', async () => {
      // First page (substring matches) lacks the exact name; it lives on page 2.
      mockClient.request
        .mockResolvedValueOnce(tagsPage([tag('v1.0.0-rc1'), tag('v1.0.0-rc2')], true, 'CURSOR1'))
        .mockResolvedValueOnce(tagsPage([tag('v1.0.0')]));

      const result = (await browse().handler({
        action: 'get_tag',
        repository_id: 5,
        tag_name: 'v1.0.0',
      })) as { name: string };

      expect(result.name).toBe('v1.0.0');
      expect(mockClient.request.mock.calls[1][1]).toMatchObject({ after: 'CURSOR1' });
    });

    it('get_tag throws when the repository is not found', async () => {
      mockClient.request.mockResolvedValueOnce({ containerRepository: null });
      await expect(
        browse().handler({ action: 'get_tag', repository_id: 5, tag_name: 'v1' }),
      ).rejects.toThrow('Container repository 5 not found');
    });
  });

  describe('manage_registry', () => {
    it('delete_repository runs the destroy mutation by global ID', async () => {
      mockClient.request.mockResolvedValueOnce({
        destroyContainerRepository: {
          containerRepository: { id: 'x', status: 'DELETE_SCHEDULED' },
          errors: [],
        },
      });

      const result = (await manage().handler({
        action: 'delete_repository',
        repository_id: 5,
      })) as {
        deleted: boolean;
        status: string;
      };

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(DESTROY_CONTAINER_REPOSITORY);
      expect(vars).toEqual({ id: REPO_GID });
      expect(result.deleted).toBe(true);
      expect(result.status).toBe('DELETE_SCHEDULED');
    });

    it('delete_repository surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce({
        destroyContainerRepository: { containerRepository: null, errors: ['Not authorized'] },
      });
      await expect(
        manage().handler({ action: 'delete_repository', repository_id: 5 }),
      ).rejects.toThrow('GitLab API error: Not authorized');
    });

    it('delete_tag destroys a single tag by name', async () => {
      mockClient.request.mockResolvedValueOnce({
        destroyContainerRepositoryTags: { deletedTagNames: ['old'], errors: [] },
      });

      await manage().handler({ action: 'delete_tag', repository_id: 5, tag_name: 'old' });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(DESTROY_CONTAINER_REPOSITORY_TAGS);
      expect(vars).toEqual({ id: REPO_GID, tagNames: ['old'] });
    });

    it('delete_tag surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce(destroyTagsError('tag protected'));
      await expect(
        manage().handler({ action: 'delete_tag', repository_id: 5, tag_name: 'prod' }),
      ).rejects.toThrow('GitLab API error: tag protected');
    });

    it('delete_tags_bulk applies regex + keep_n, then destroys the rest', async () => {
      const result = await runBulk({ name_regex_delete: '^v\\d+$', keep_n: 1 }, [
        tagsPage([
          tag('v4', '2026-04-04T00:00:00Z'),
          tag('v3', '2026-03-03T00:00:00Z'),
          tag('v2', '2026-02-02T00:00:00Z'),
          tag('v1', '2026-01-01T00:00:00Z'),
          tag('latest', '2026-05-05T00:00:00Z'),
        ]),
      ]);

      // newest matching (v4) kept; v3,v2,v1 deleted; "latest" never matched.
      expect(result.deleted_tags).toEqual(['v3', 'v2', 'v1']);
      expect(result.deleted_count).toBe(3);
      const destroyCall = mockClient.request.mock.calls[1];
      expect(destroyCall[0]).toBe(DESTROY_CONTAINER_REPOSITORY_TAGS);
      expect(destroyCall[1]).toEqual({ id: REPO_GID, tagNames: ['v3', 'v2', 'v1'] });
    });

    it('delete_tags_bulk with name_regex_keep protects matching tags', async () => {
      const result = await runBulk({ name_regex_delete: '.*', name_regex_keep: 'keep' }, [
        tagsPage([tag('v1'), tag('v2-keep', '2026-02-01T00:00:00Z')]),
      ]);
      expect(result.deleted_tags).toEqual(['v1']);
    });

    it('delete_tags_bulk with older_than deletes only stale tags', async () => {
      const now = Date.now();
      const recent = new Date(now - 60_000).toISOString(); // 1 min ago
      const old = new Date(now - 10 * 86_400_000).toISOString(); // 10 days ago
      const result = await runBulk({ name_regex_delete: '.*', older_than: '7d' }, [
        tagsPage([tag('fresh', recent), tag('stale', old)]),
      ]);
      expect(result.deleted_tags).toEqual(['stale']);
    });

    it('delete_tags_bulk paginates across multiple tag pages', async () => {
      const result = await runBulk({ name_regex_delete: '^v' }, [
        tagsPage([tag('v1')], true, 'CURSOR1'),
        tagsPage([tag('v2')], false, null),
      ]);
      expect(result.deleted_count).toBe(2);
      // two list calls (pages) before the destroy call
      expect(mockClient.request.mock.calls[0][0]).toBe(LIST_CONTAINER_REPOSITORY_TAGS);
      expect(mockClient.request.mock.calls[1][1]).toMatchObject({ after: 'CURSOR1' });
    });

    it('delete_tags_bulk caps the tag scan at 1000', async () => {
      const big = Array.from({ length: 1000 }, (_, i) => tag(`v${i}`));
      const result = await runBulk({ name_regex_delete: '.*' }, [tagsPage(big, true, 'NEXT')]);
      expect(result.scan_capped).toBe(true);
      expect(result.deleted_count).toBe(1000);
    });

    it('delete_tags_bulk surfaces destroy errors', async () => {
      mockClient.request.mockResolvedValueOnce(tagsPage([tag('v1')]));
      mockClient.request.mockResolvedValueOnce(destroyTagsError('rate limited'));
      await expect(
        manage().handler({ action: 'delete_tags_bulk', repository_id: 5, name_regex_delete: '.*' }),
      ).rejects.toThrow('GitLab API error: rate limited');
    });

    it('delete_tags_bulk deletes nothing when no tag matches', async () => {
      mockClient.request.mockResolvedValueOnce(tagsPage([tag('latest')]));
      const result = (await manage().handler({
        action: 'delete_tags_bulk',
        repository_id: 5,
        name_regex_delete: '^v\\d+$',
      })) as { deleted_count: number };
      expect(result.deleted_count).toBe(0);
      expect(mockClient.request).toHaveBeenCalledTimes(1); // only the list call
    });

    it('delete_tags_bulk throws when the repository does not exist', async () => {
      mockClient.request.mockResolvedValueOnce({ containerRepository: null });
      await expect(
        manage().handler({ action: 'delete_tags_bulk', repository_id: 5, name_regex_delete: '.*' }),
      ).rejects.toThrow('Container repository 5 not found');
    });

    it('delete_tags_bulk destroys tags in batches of 20', async () => {
      const many = Array.from({ length: 45 }, (_, i) => tag(`v${i}`));
      const result = await runBulk({ name_regex_delete: '^v\\d+$' }, [tagsPage(many)]);

      expect(result.deleted_count).toBe(45);
      const destroyCalls = mockClient.request.mock.calls.filter(
        (c) => c[0] === DESTROY_CONTAINER_REPOSITORY_TAGS,
      );
      expect(destroyCalls.map((c) => (c[1] as { tagNames: string[] }).tagNames.length)).toEqual([
        20, 20, 5,
      ]);
    });

    it('rejects an invalid name_regex_delete at schema parse', async () => {
      await expect(
        manage().handler({ action: 'delete_tags_bulk', repository_id: 5, name_regex_delete: '[' }),
      ).rejects.toThrow();
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('rejects an invalid older_than duration at schema parse', async () => {
      await expect(
        manage().handler({
          action: 'delete_tags_bulk',
          repository_id: 5,
          name_regex_delete: '.*',
          older_than: '7days',
        }),
      ).rejects.toThrow();
      expect(mockClient.request).not.toHaveBeenCalled();
    });
  });
});
