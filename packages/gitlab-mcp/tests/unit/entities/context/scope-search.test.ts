/**
 * Scope search for the settings panel: it asks GitLab for projects the account is a
 * member of and groups it can see, and returns only their type, path and name.
 */

import { findScopeTargets } from '../../../../src/entities/context/scope-search';
import { gitlab } from '../../../../src/utils/gitlab-api';

jest.mock('../../../../src/utils/gitlab-api', () => ({
  gitlab: { get: jest.fn() },
}));

const mockGet = gitlab.get as jest.Mock;

describe('findScopeTargets', () => {
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
    expect(mockGet).toHaveBeenCalledWith('groups', { query: { search: 'team', per_page: '10' } });
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
});
