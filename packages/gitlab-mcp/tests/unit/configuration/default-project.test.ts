import { withDefaultProject } from '../../../src/configuration/default-project';

const declared = new Set(['project_id', 'group_id']);
const active = (): boolean => false;
const project = { id: 71, path_with_namespace: 'team/app', name_with_namespace: 'Team / App' };

describe('default project arguments', () => {
  // Defaults fill omitted targets only, never replacing an explicit or malformed argument.
  it.each([
    { args: {}, fields: declared, value: undefined },
    { args: { scope: 'group' }, fields: declared, value: '71' },
    { args: {}, fields: undefined, value: '71' },
    { args: {}, fields: new Set(['action']), value: '71' },
    { args: { project_id: null }, fields: declared, value: '71' },
    { args: { group_id: 'team' }, fields: declared, value: '71' },
  ])('preserves the call %j', async ({ args, fields, value }) => {
    const read = jest.fn();
    expect((await withDefaultProject('browse_todos', args, fields, value, active, read)).args).toBe(
      args,
    );
    expect(read).not.toHaveBeenCalled();
  });

  // String-valued project parameters retain their contract and require no metadata request.
  it('fills both project parameter spellings without a lookup', async () => {
    const read = jest.fn();
    expect(
      (await withDefaultProject('browse_pipelines', {}, declared, 'team/app', active, read)).args,
    ).toEqual({ project_id: 'team/app' });
    expect(
      (await withDefaultProject('browse_webhooks', {}, new Set(['projectId']), '71', active, read))
        .args,
    ).toEqual({ projectId: '71' });
    expect(read).not.toHaveBeenCalled();
  });

  // Todos take a number, not a coercible string; numeric defaults need no resolver.
  it('converts a numeric todo filter without I/O', async () => {
    const read = jest.fn();
    expect(
      (await withDefaultProject('browse_todos', {}, declared, '71', active, read)).args,
    ).toEqual({ project_id: 71 });
    expect(read).not.toHaveBeenCalled();
  });

  // A lossy or zero ID must never be sent to the todo endpoint.
  it.each(['0', '9007199254740993'])('rejects invalid numeric default %s', async (value) => {
    const read = jest.fn();
    await expect(
      withDefaultProject('browse_todos', {}, declared, value, active, read),
    ).rejects.toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  // Share the verified identity across aliases within this call, without caching another caller.
  it('resolves a path default once and reuses its identity', async () => {
    const read = jest.fn().mockResolvedValueOnce(project).mockResolvedValueOnce({ id: 72 });
    const prepared = await withDefaultProject(
      'browse_todos',
      {},
      declared,
      'team%2fapp',
      active,
      read,
    );
    expect(prepared.args).toEqual({ project_id: project.id });
    for (const path of ['projects/team%2Fapp', 'projects/71'])
      expect(await prepared.read(path)).toEqual(project);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await prepared.read('projects/72')).toEqual({ id: 72 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  // Missing projects and unrepresentable resolved IDs fail instead of widening a listing.
  it('refuses missing or invalid path identities', async () => {
    await expect(
      withDefaultProject(
        'browse_todos',
        {},
        declared,
        'missing/app',
        active,
        jest.fn().mockRejectedValue(new Error('GitLab API error: 404 Not Found')),
      ),
    ).rejects.toThrow('not found');
    await expect(
      withDefaultProject(
        'browse_todos',
        {},
        declared,
        'team/app',
        active,
        jest.fn().mockResolvedValue({ ...project, id: '9007199254740993' }),
      ),
    ).rejects.toThrow('safe integer');
  });

  // A resolver completing after the deadline cannot authorize another request or execution.
  it('checks the deadline before and after path resolution', async () => {
    const read = jest.fn().mockResolvedValue(project);
    await expect(
      withDefaultProject('browse_todos', {}, declared, 'team/app', () => true, read),
    ).rejects.toThrow('expired');
    expect(read).not.toHaveBeenCalled();
    let expired = false;
    await expect(
      withDefaultProject(
        'browse_todos',
        {},
        declared,
        'team/app',
        () => expired,
        async () => {
          expired = true;
          return project;
        },
      ),
    ).rejects.toThrow('expired');
  });
});
