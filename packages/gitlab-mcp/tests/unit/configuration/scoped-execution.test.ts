/**
 * Calls under a working scope that one GitLab request cannot answer: filtered listings read
 * further pages, a scope of projects lists its projects, mark_all_done marks the scope's
 * todos. These cover the answers GitLab may give besides the usual rows.
 */

import { executeScoped } from '../../../src/configuration/scoped-execution';
import { buildPolicy } from '../../../src/configuration/policy';

const groupPolicy = buildPolicy(
  undefined,
  { scope: { type: 'group', path: 'team', includeSubgroups: true } },
  {},
);
const projectPolicy = buildPolicy(
  undefined,
  { scope: { type: 'project', path: 'team/app', includeSubgroups: false } },
  {},
);

describe('executeScoped', () => {
  it('runs the call unchanged without a working scope', async () => {
    const run = jest.fn().mockResolvedValue([{ path_with_namespace: 'other/api' }]);

    const result = await executeScoped(
      run,
      'browse_projects',
      { action: 'search' },
      buildPolicy(undefined, {}, {}),
    );

    expect(run).toHaveBeenCalledWith('browse_projects', { action: 'search' });
    expect(result).toEqual([{ path_with_namespace: 'other/api' }]);
  });

  // A tool may answer a listing with an object (an error envelope, a wrapped result): it is
  // passed on as GitLab gave it instead of being paged.
  it('passes on a listing answer that is not a list', async () => {
    const run = jest.fn().mockResolvedValue({ message: 'not a list' });

    expect(await executeScoped(run, 'browse_projects', { action: 'search' }, groupPolicy)).toEqual({
      message: 'not a list',
    });
  });

  it('marks nothing when the todo listing is not a list', async () => {
    const run = jest.fn().mockResolvedValue({ message: 'not a list' });

    expect(
      await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, groupPolicy),
    ).toMatchObject({ success: true, marked: 0, failed: [] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a todo failure that is not an Error by its value', async () => {
    const run = jest.fn(async (tool: string) => {
      if (tool === 'browse_todos') return [{ id: 1, project: { path_with_namespace: 'team/app' } }];
      throw 'rate limited';
    });

    expect(
      await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, groupPolicy),
    ).toMatchObject({ success: false, marked: 0, failed: [{ id: 1, error: 'rate limited' }] });
  });

  // A project listing answers with GitLab's simple representation unless simple is false;
  // the scope's projects are read one by one, which returns the full one.
  it.each([
    [{ action: 'list' }, ['id', 'name', 'path_with_namespace', 'namespace']],
    [{ action: 'list', simple: true }, ['id', 'name', 'path_with_namespace', 'namespace']],
    [
      { action: 'list', simple: false },
      ['id', 'name', 'path_with_namespace', 'namespace', 'permissions', 'statistics'],
    ],
  ])('lists the scope project %j with the fields %j', async (args, fields) => {
    const run = jest.fn().mockResolvedValue({
      id: 7,
      name: 'App',
      path_with_namespace: 'team/app',
      namespace: { full_path: 'team' },
      permissions: { project_access: null },
      statistics: { commit_count: 3 },
    });

    const [project] = (await executeScoped(run, 'browse_projects', args, projectPolicy)) as Array<
      Record<string, unknown>
    >;

    expect(Object.keys(project).sort()).toEqual([...fields].sort());
  });

  // Reading stops after a bounded number of GitLab pages; a page that could not be filled
  // then says so instead of looking like the end of the results.
  it('reports a page it could not fill within the rows it reads', async () => {
    const outside = Array.from({ length: 100 }, (_, i) => ({ path_with_namespace: `other/p${i}` }));
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.page === 3 ? [...outside.slice(1), { path_with_namespace: 'team/app' }] : outside,
    );

    const result = await executeScoped(run, 'browse_projects', { action: 'search' }, groupPolicy);

    expect(run).toHaveBeenCalledTimes(10);
    expect(result).toEqual({
      items: [{ path_with_namespace: 'team/app' }],
      partial: true,
      message:
        'Read the first 1000 rows GitLab returned and found 1 in the working scope; more may follow. Narrow the listing (for example with a search) to see the rest.',
    });
  });

  // A page that starts past the rows a call may read cannot be filled: no request is made.
  it('answers a page past the readable rows without asking GitLab', async () => {
    const run = jest.fn();

    const result = await executeScoped(
      run,
      'browse_projects',
      { action: 'search', page: 51, per_page: 20 },
      groupPolicy,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      partial: true,
      message:
        'A scoped listing reads the first 1000 rows GitLab returns, and page 51 starts after them. Narrow the listing (for example with a search) to see the rest.',
    });
  });

  it('fails a project scope listing on a failure that is not an Error', async () => {
    const run = jest.fn().mockRejectedValue('connection reset');

    await expect(
      executeScoped(run, 'browse_projects', { action: 'list' }, projectPolicy),
    ).rejects.toBe('connection reset');
  });
});
