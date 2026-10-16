/**
 * A working scope is saved as paths, while a call may name its project or group by numeric
 * id. The ids are read from GitLab and checked as the paths they stand for.
 */

import { withScopePaths, withTargetPaths } from '../../../src/configuration/scope-ids';
import { buildPolicy, callRestriction } from '../../../src/configuration/policy';
import { scopedResult } from '../../../src/configuration/scope-targets';
import { gitlab } from '../../../src/utils/gitlab-api';

jest.mock('../../../src/utils/gitlab-api', () => ({ gitlab: { get: jest.fn() } }));

const notFound = new Error('GitLab API error: 404 Not Found');

/**
 * A GitLab that knows project 7 (team/app), group 4 (team) and project 9 (other/api). Namespace
 * 7 is a user's namespace (alice): its id collides with project 7.
 */
const read = jest.fn(async (path: string): Promise<unknown> => {
  if (path === 'projects/7') return { id: 7, path_with_namespace: 'team/app' };
  if (path === 'projects/9') return { id: 9, path_with_namespace: 'other/api' };
  if (path === 'namespaces/4' || path === 'groups/4') return { id: 4, full_path: 'team' };
  if (path === 'namespaces/7') return { id: 7, kind: 'user', full_path: 'alice' };
  throw notFound;
});

beforeEach(() => read.mockClear());

describe('withTargetPaths', () => {
  it('replaces numeric project and group ids with their paths', async () => {
    expect(
      await withTargetPaths({ action: 'list', project_id: 7, namespace_id: '4' }, read),
    ).toEqual({ action: 'list', project_id: 'team/app', namespace_id: 'team' });
  });

  // A namespace argument may be a group or a project; a group is tried first, as the
  // handlers do for a path without a slash. A user namespace with the same id is no group:
  // the handlers read project 7 then, so the check does too.
  it('reads a numeric namespace as a group, else as a project', async () => {
    expect(await withTargetPaths({ namespace: '4' }, read)).toEqual({ namespace: 'team' });
    expect(await withTargetPaths({ namespace: '7' }, read)).toEqual({ namespace: 'team/app' });
  });

  // An argument that only names a namespace keeps reading it as one, users' included.
  it('reads a numeric namespace_id as a namespace', async () => {
    expect(await withTargetPaths({ namespace_id: '7' }, read)).toEqual({ namespace_id: 'alice' });
  });

  // An id GitLab does not know stays numeric, and the scope check then refuses it.
  it('keeps an id GitLab does not resolve', async () => {
    expect(await withTargetPaths({ project_id: '12' }, read)).toEqual({ project_id: '12' });
  });

  // Only a definitive not-found keeps an id numeric. A rejected token or any other failure
  // fails the call with GitLab's own error, so an expired sign-in reaches the reauthorization
  // challenge instead of reading as an out-of-scope target.
  it.each([
    ['GitLab API error: 401 Unauthorized'],
    ['GitLab API error: 403 Forbidden - insufficient_scope'],
    ['GitLab API error: 500 Internal Server Error'],
  ])('fails on %s', async (message) => {
    const failing = jest.fn().mockRejectedValue(new Error(message));

    await expect(withTargetPaths({ project_id: 7 }, failing)).rejects.toThrow(message);
  });

  it('fails on a failure that is not an Error', async () => {
    const failing = jest.fn().mockRejectedValue('connection reset');

    await expect(withTargetPaths({ project_id: 7 }, failing)).rejects.toBe('connection reset');
  });

  // A namespace that is not a group is read as a project; a failure there still fails.
  it('fails when the group lookup of a namespace fails other than not found', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

    await expect(withTargetPaths({ namespace: '4' }, failing)).rejects.toThrow('401');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  // Without a reader the caller's own GitLab client is asked; an empty answer resolves nothing.
  it("reads with the caller's GitLab client and keeps an id it gets no path for", async () => {
    jest.mocked(gitlab.get).mockResolvedValue(undefined);

    expect(await withTargetPaths({ project_id: 7 })).toEqual({ project_id: 7 });
    expect(gitlab.get).toHaveBeenCalledWith('projects/7');
  });

  it('asks GitLab nothing when no target is numeric', async () => {
    const args = { project_id: 'team/app' };

    expect(await withTargetPaths(args, read)).toBe(args);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks a numeric id as the path it stands for', async () => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'group', path: 'team', includeSubgroups: true } },
      {},
    );
    const tool = { name: 'browse_merge_requests', readOnly: true };

    expect(
      callRestriction(policy, tool, await withTargetPaths({ action: 'list', project_id: 7 }, read)),
    ).toBeNull();
    expect(
      callRestriction(policy, tool, await withTargetPaths({ action: 'list', project_id: 9 }, read)),
    ).toMatch(/other\/api/);
  });

  // A preset may list a project by its numeric id. A call naming that id is checked as the
  // id, without asking GitLab: its path is not what the scope lists.
  it('keeps a numeric id the scope lists itself', async () => {
    const policy = buildPolicy({ scope: { projects: ['7'] } }, {}, {});
    const tool = { name: 'browse_merge_requests', readOnly: true };
    const args = await withTargetPaths(
      { action: 'list', project_id: 7 },
      read,
      policy.scopeEnforcer,
    );

    expect(args).toEqual({ action: 'list', project_id: 7 });
    expect(read).not.toHaveBeenCalled();
    expect(callRestriction(policy, tool, args)).toBeNull();
  });
});

describe('withScopePaths', () => {
  const listed = [{ path_with_namespace: 'team/app' }, { path_with_namespace: 'other/api' }];

  // A preset may name its group by numeric id, while GitLab lists projects by path: the
  // scope's ids are read as paths, so the group's projects are kept instead of none.
  it("keeps a numeric group scope's projects in a listing", async () => {
    const policy = await withScopePaths(buildPolicy({ scope: { group: '4' } }, {}, {}), read);

    expect(policy.scope).toEqual({ group: 'team' });
    expect(
      scopedResult('browse_projects', { action: 'list' }, listed, policy.scopeEnforcer!),
    ).toEqual([{ path_with_namespace: 'team/app' }]);
  });

  // Every field naming a project or a group is read; paths stay as written, and an id GitLab
  // does not know stays numeric, matching nothing it lists.
  it('reads the numeric projects and groups of every scope field', async () => {
    const policy = await withScopePaths(
      buildPolicy(
        {
          scope: {
            project: '7',
            projects: ['9', 'solo/app', '12'],
            groups: ['4', 'other'],
            namespace: '4',
            includeSubgroups: false,
          },
        },
        {},
        {},
      ),
      read,
    );

    expect(policy.scope).toEqual({
      project: 'team/app',
      projects: ['other/api', 'solo/app', '12'],
      groups: ['team', 'other'],
      namespace: 'team',
      includeSubgroups: false,
    });
    expect(policy.scopeEnforcer?.isAllowed('other/api')).toBe(true);
  });

  it('asks GitLab nothing when the scope names only paths', async () => {
    const policy = buildPolicy({ scope: { group: 'team', projects: ['other/api'] } }, {}, {});

    expect(await withScopePaths(policy, read)).toBe(policy);
    expect(read).not.toHaveBeenCalled();
  });

  it('asks GitLab nothing without a scope', async () => {
    const policy = buildPolicy(undefined, {}, {});

    expect(await withScopePaths(policy, read)).toBe(policy);
    expect(read).not.toHaveBeenCalled();
  });

  // As for a call's own ids: a rejected token fails the call instead of emptying the scope.
  it('fails when GitLab fails other than not found', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('GitLab API error: 401 Unauthorized'));

    await expect(
      withScopePaths(buildPolicy({ scope: { group: '4' } }, {}, {}), failing),
    ).rejects.toThrow('401');
  });
});
