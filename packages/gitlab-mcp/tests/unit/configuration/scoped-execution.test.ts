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

  it('fails a project scope listing on a failure that is not an Error', async () => {
    const run = jest.fn().mockRejectedValue('connection reset');

    await expect(
      executeScoped(run, 'browse_projects', { action: 'list' }, projectPolicy),
    ).rejects.toBe('connection reset');
  });
});
