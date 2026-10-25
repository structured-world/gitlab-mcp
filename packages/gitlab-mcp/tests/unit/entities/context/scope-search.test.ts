/**
 * Scope search for the settings panel: it asks GitLab for projects the account is a
 * member of and groups it can see, and returns only their type, path and name.
 */

import { findScopeTargets } from '../../../../src/entities/context/scope-search';
import { gitlab } from '../../../../src/utils/gitlab-api';
import { GITLAB_ALLOWED_PROJECT_IDS } from '../../../../src/config';

jest.mock('../../../../src/utils/gitlab-api', () => ({
  gitlab: { get: jest.fn() },
}));

const mockGet = gitlab.get as jest.Mock;

describe('findScopeTargets', () => {
  const original = [...GITLAB_ALLOWED_PROJECT_IDS];
  afterEach(() =>
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, ...original),
  );
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns groups first, then member projects, with nothing but type, path and name', async () => {
    mockGet.mockImplementation(async (path: string) =>
      path === 'projects'
        ? [
            {
              id: 7,
              path_with_namespace: 'team/app',
              name_with_namespace: 'Team / App',
              visibility: 'private',
            },
          ]
        : [{ id: 3, full_path: 'team', full_name: 'Team', description: 'secret plans' }],
    );

    const result = await findScopeTargets('  team ');

    expect(result).toEqual({
      targets: [
        { type: 'group', path: 'team', name: 'Team' },
        { type: 'project', path: 'team/app', name: 'Team / App' },
      ],
    });
    expect(mockGet).toHaveBeenCalledWith('projects', {
      query: {
        search: 'team',
        membership: 'true',
        simple: 'true',
        per_page: '10',
        order_by: 'last_activity_at',
      },
    });
    // Without all_available GitLab lists a non-administrator only the groups it is a member of,
    // not the public and internal groups it can also see.
    expect(mockGet).toHaveBeenCalledWith('groups', {
      query: { search: 'team', all_available: 'true', per_page: '10' },
    });
  });

  it.each(['a', ' b ', 'x'.repeat(101)])(
    'rejects the query %p without asking GitLab',
    async (q) => {
      await expect(findScopeTargets(q)).rejects.toThrow('Search for 2 to 100 characters');
      expect(mockGet).not.toHaveBeenCalled();
    },
  );

  it('passes a GitLab failure on to the caller', async () => {
    mockGet.mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

    await expect(findScopeTargets('team')).rejects.toThrow('401 Unauthorized');
  });

  // The settings picker must never discover projects outside the operator boundary.
  it('searches only configured project identities', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, '71');
    mockGet.mockResolvedValue({
      id: 71,
      path_with_namespace: 'team/app',
      name_with_namespace: 'Team / App',
    });
    expect(await findScopeTargets('team')).toEqual({
      targets: [{ type: 'project', path: 'team/app', name: 'Team / App' }],
    });
    expect(mockGet.mock.calls).toEqual([['projects/71']]);
  });
});
