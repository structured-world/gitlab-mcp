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
          containerRepositories: {
            nodes: [{ id: 'gid://gitlab/ContainerRepository/7' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
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
      mockClient.request.mockResolvedValueOnce({
        containerRepository: {
          id: 'gid://gitlab/ContainerRepository/3',
          tags: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      });

      await browse().handler({ action: 'list_tags', repository_id: 3 });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_CONTAINER_REPOSITORY_TAGS);
      expect(vars).toMatchObject({ id: 'gid://gitlab/ContainerRepository/3' });
    });

    it('get_tag selects the exact tag among substring matches', async () => {
      mockClient.request.mockResolvedValueOnce({
        containerRepository: {
          id: 'gid://gitlab/ContainerRepository/3',
          tags: {
            nodes: [
              { name: 'v1.0.0-rc', digest: 'sha256:a' },
              { name: 'v1.0.0', digest: 'sha256:b' },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });

      const result = (await browse().handler({
        action: 'get_tag',
        repository_id: 3,
        tag_name: 'v1.0.0',
      })) as { name: string };

      expect(result.name).toBe('v1.0.0');
    });

    it('get_tag throws when the exact tag is absent', async () => {
      mockClient.request.mockResolvedValueOnce({
        containerRepository: {
          id: 'gid://gitlab/ContainerRepository/3',
          tags: { nodes: [{ name: 'latest' }], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      });
      await expect(
        browse().handler({ action: 'get_tag', repository_id: 3, tag_name: 'v9' }),
      ).rejects.toThrow('Tag "v9" not found');
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
      expect(vars).toEqual({ id: 'gid://gitlab/ContainerRepository/5' });
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
      expect(vars).toEqual({ id: 'gid://gitlab/ContainerRepository/5', tagNames: ['old'] });
    });

    it('delete_tags_bulk applies regex + keep_n, then destroys the rest', async () => {
      // 4 version tags newest-first by createdAt; keep_n=1 keeps the newest, the
      // "latest" tag is excluded by the regex.
      mockClient.request
        .mockResolvedValueOnce({
          containerRepository: {
            id: 'gid://gitlab/ContainerRepository/5',
            tags: {
              nodes: [
                { name: 'v4', createdAt: '2026-04-04T00:00:00Z' },
                { name: 'v3', createdAt: '2026-03-03T00:00:00Z' },
                { name: 'v2', createdAt: '2026-02-02T00:00:00Z' },
                { name: 'v1', createdAt: '2026-01-01T00:00:00Z' },
                { name: 'latest', createdAt: '2026-05-05T00:00:00Z' },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
        .mockResolvedValueOnce({
          destroyContainerRepositoryTags: { deletedTagNames: [], errors: [] },
        });

      const result = (await manage().handler({
        action: 'delete_tags_bulk',
        repository_id: 5,
        name_regex_delete: '^v\\d+$',
        keep_n: 1,
      })) as { deleted_count: number; deleted_tags: string[] };

      // newest matching (v4) kept; v3, v2, v1 deleted; "latest" never matched.
      expect(result.deleted_tags).toEqual(['v3', 'v2', 'v1']);
      expect(result.deleted_count).toBe(3);
      const destroyCall = mockClient.request.mock.calls[1];
      expect(destroyCall[0]).toBe(DESTROY_CONTAINER_REPOSITORY_TAGS);
      expect(destroyCall[1]).toEqual({
        id: 'gid://gitlab/ContainerRepository/5',
        tagNames: ['v3', 'v2', 'v1'],
      });
    });

    it('delete_tags_bulk with name_regex_keep protects matching tags', async () => {
      mockClient.request
        .mockResolvedValueOnce({
          containerRepository: {
            id: 'gid://gitlab/ContainerRepository/5',
            tags: {
              nodes: [
                { name: 'v1', createdAt: '2026-01-01T00:00:00Z' },
                { name: 'v2-keep', createdAt: '2026-02-01T00:00:00Z' },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
        .mockResolvedValueOnce({
          destroyContainerRepositoryTags: { deletedTagNames: [], errors: [] },
        });

      const result = (await manage().handler({
        action: 'delete_tags_bulk',
        repository_id: 5,
        name_regex_delete: '.*',
        name_regex_keep: 'keep',
      })) as { deleted_tags: string[] };

      expect(result.deleted_tags).toEqual(['v1']);
    });

    it('delete_tags_bulk deletes nothing when no tag matches', async () => {
      mockClient.request.mockResolvedValueOnce({
        containerRepository: {
          id: 'gid://gitlab/ContainerRepository/5',
          tags: {
            nodes: [{ name: 'latest', createdAt: '2026-01-01T00:00:00Z' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });

      const result = (await manage().handler({
        action: 'delete_tags_bulk',
        repository_id: 5,
        name_regex_delete: '^v\\d+$',
      })) as { deleted_count: number };

      expect(result.deleted_count).toBe(0);
      // only the list call happened; no destroy call.
      expect(mockClient.request).toHaveBeenCalledTimes(1);
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
