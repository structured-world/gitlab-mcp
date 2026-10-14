/**
 * A working scope is saved as paths, while a call may name its project or group by numeric
 * id. The ids are read from GitLab and checked as the paths they stand for.
 */

import { withTargetPaths } from '../../../src/configuration/scope-ids';
import { buildPolicy, callRestriction } from '../../../src/configuration/policy';
import { gitlab } from '../../../src/utils/gitlab-api';

jest.mock('../../../src/utils/gitlab-api', () => ({ gitlab: { get: jest.fn() } }));

const notFound = new Error('GitLab API error: 404 Not Found');

/** A GitLab that knows project 7 (team/app), group 4 (team) and project 9 (other/api). */
const read = jest.fn(async (path: string): Promise<unknown> => {
  if (path === 'projects/7') return { id: 7, path_with_namespace: 'team/app' };
  if (path === 'projects/9') return { id: 9, path_with_namespace: 'other/api' };
  if (path === 'namespaces/4') return { id: 4, full_path: 'team' };
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
  // handlers do for a path without a slash.
  it('reads a numeric namespace as a group, else as a project', async () => {
    expect(await withTargetPaths({ namespace: '4' }, read)).toEqual({ namespace: 'team' });
    expect(await withTargetPaths({ namespace: '7' }, read)).toEqual({ namespace: 'team/app' });
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
});
