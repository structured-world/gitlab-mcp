import { coreToolRegistry } from '../../../../src/entities/core/registry';
import { searchToolRegistry } from '../../../../src/entities/search/registry';
import { installFetchMock, mockOk, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const secretEntity = () => ({
  id: 123,
  name: 'example',
  runners_token: 'registration-secret',
  import_url: 'https://user:import-secret@example.com/repository.git',
  unknown_metadata: { enabled: false, count: 0, nullable: null },
});
const safeEntity = {
  id: 123,
  name: 'example',
  unknown_metadata: { enabled: false, count: 0, nullable: null },
};

describe('Project and group response credentials', () => {
  // Every metadata action must strip credentials, including mutation responses and restore passthroughs.
  it.each([
    ['browse_projects', { action: 'get', project_id: 'test/project' }],
    ['manage_project', { action: 'fork', project_id: 'test/project' }],
    ['manage_project', { action: 'update', project_id: 'test/project', description: 'updated' }],
    ['manage_project', { action: 'archive', project_id: 'test/project' }],
    ['manage_project', { action: 'unarchive', project_id: 'test/project' }],
    ['manage_project', { action: 'transfer', project_id: 'test/project', namespace: 'test' }],
    ['manage_project', { action: 'restore', project_id: 'test/project' }],
    ['browse_namespaces', { action: 'get', namespace_id: 'test' }],
    ['manage_namespace', { action: 'create', name: 'example', path: 'example' }],
    ['manage_namespace', { action: 'update', group_id: 'test', description: 'updated' }],
    ['manage_namespace', { action: 'restore', group_id: 'test' }],
  ] as const)('%s %j omits credentials and retains all other fields', async (tool, args) => {
    mockOk(secretEntity());
    expect(await coreToolRegistry.get(tool)!.handler(args)).toEqual(safeEntity);
  });

  // Lists, group-project listings and project search must preserve pagination data and every safe field.
  it.each([
    ['browse_projects', { action: 'search', q: 'example' }],
    ['browse_projects', { action: 'list' }],
    ['browse_projects', { action: 'list', group_id: 'test' }],
    ['browse_namespaces', { action: 'list' }],
  ] as const)('%s %j strips credentials in each list item', async (tool, args) => {
    mockOk([secretEntity(), secretEntity()]);
    expect(await coreToolRegistry.get(tool)!.handler(args)).toEqual([safeEntity, safeEntity]);
  });

  // Namespace verification returns its payload inside data, which must not bypass the filter.
  it('filters namespace verification data', async () => {
    mockOk(secretEntity());
    expect(
      await coreToolRegistry
        .get('browse_namespaces')!
        .handler({ action: 'verify', namespace_id: 'test' }),
    ).toEqual({ exists: true, status: 200, namespace: 'test', data: safeEntity });
  });

  // Creation adds validation metadata after the API response; both the entity and that metadata must survive.
  it('filters a newly created project without losing validation metadata', async () => {
    mockEnhancedFetch.mockResolvedValueOnce({ ok: false } as Response);
    mockOk(secretEntity());
    expect(
      await coreToolRegistry.get('manage_project')!.handler({ action: 'create', name: 'Example' }),
    ).toEqual({
      ...safeEntity,
      validation: { namespace_resolved: 'current-user', generated_path: 'example' },
    });
  });

  // Group detail and fork responses can contain further projects; neither nested credentials nor raw JSON may leak.
  it('filters nested group projects and fork metadata before serialization', async () => {
    mockOk({
      ...secretEntity(),
      projects: [{ ...secretEntity(), forked_from_project: secretEntity() }],
      shared_projects: [secretEntity()],
    });
    const result = await coreToolRegistry
      .get('browse_projects')!
      .handler({ action: 'get', project_id: 'test/project' });
    expect(result).toEqual({
      ...safeEntity,
      projects: [{ ...safeEntity, forked_from_project: safeEntity }],
      shared_projects: [safeEntity],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /registration-secret|import-secret|runners_token|import_url/,
    );
  });

  // A successful update still reports Duo settings that GitLab did not apply.
  it('preserves unapplied settings while removing credentials', async () => {
    mockOk(secretEntity());
    expect(
      await coreToolRegistry
        .get('manage_namespace')!
        .handler({ action: 'update', group_id: 'test', auto_duo_code_review_enabled: true }),
    ).toEqual({
      ...safeEntity,
      not_applied: [
        { setting: 'auto_duo_code_review_enabled', requested: true, requires: expect.any(String) },
      ],
    });
  });

  // REST search can also return project metadata and must use the same filter at every scope.
  it.each([
    { action: 'global' },
    { action: 'group', group_id: 'test' },
    { action: 'project', project_id: 'test/project' },
  ])('filters project search results for $action', async (args) => {
    mockOk([secretEntity()]);
    const result = await searchToolRegistry
      .get('browse_search')!
      .handler({ ...args, scope: 'projects', search: 'example' });
    const scopeFields = Object.fromEntries(
      Object.entries(args).filter(([key]) => key !== 'action'),
    );
    expect(result).toStrictEqual({
      ...scopeFields,
      scope: 'projects',
      count: 1,
      results: [safeEntity],
    });
  });
});
