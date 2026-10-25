import { withDefaultProject } from '../../../src/configuration/default-project';

const declared = new Set(['project_id', 'group_id']);
const active = (): boolean => false;
const project = { id: 71, path_with_namespace: 'team/app', name_with_namespace: 'Team / App' };

describe('default project arguments', () => {
  // Omitting a token/snippet owner selects a personal resource, even with a project default.
  it.each([
    { tool: 'browse_access_tokens', args: { action: 'get', token_id: '123' } },
    { tool: 'manage_access_token', args: { action: 'rotate', token_id: '123' } },
    { tool: 'manage_access_token', args: { action: 'revoke', token_id: '123' } },
    { tool: 'browse_snippets', args: { action: 'get', id: '123' } },
    { tool: 'browse_snippets', args: { action: 'list', scope: 'personal' } },
    { tool: 'browse_snippets', args: { action: 'list', scope: 'public' } },
    { tool: 'manage_snippet', args: { action: 'create', title: 'Personal' } },
    { tool: 'manage_snippet', args: { action: 'update', id: '123' } },
    { tool: 'manage_snippet', args: { action: 'delete', id: '123' } },
  ])('preserves personal resource arguments for $tool $args.action', async ({ tool, args }) => {
    const read = jest.fn();
    const prepared = await withDefaultProject(
      tool,
      args,
      new Set(['project_id', 'projectId', 'group_id']),
      '71',
      active,
      read,
    );
    expect(prepared.args).toBe(args);
    expect(read).not.toHaveBeenCalled();
  });

  // Explicit project actions retain defaults, including the project snippet listing.
  it.each([
    { tool: 'browse_access_tokens', args: { action: 'list_project' }, field: 'project_id' },
    { tool: 'manage_access_token', args: { action: 'create_project' }, field: 'project_id' },
    { tool: 'browse_snippets', args: { action: 'list', scope: 'project' }, field: 'projectId' },
  ])('retains project defaults for $tool $args.action', async ({ tool, args, field }) => {
    const read = jest.fn();
    expect(
      (await withDefaultProject(tool, args, new Set([field]), '71', active, read)).args,
    ).toEqual({ ...args, [field]: '71' });
    expect(read).not.toHaveBeenCalled();
  });

  // GraphQL project(fullPath:) cannot consume a numeric configured default.
  it.each([
    { tool: 'browse_vulnerabilities', args: { action: 'list' } },
    { tool: 'browse_registry', args: { action: 'list_repositories' } },
    { tool: 'browse_runners', args: { action: 'list_project' } },
    {
      tool: 'manage_runner',
      args: { action: 'create_authentication_token', runner_type: 'PROJECT_TYPE' },
    },
  ])('resolves numeric defaults to a full path for $tool', async ({ tool, args }) => {
    const read = jest.fn().mockResolvedValue(project);
    const prepared = await withDefaultProject(tool, args, declared, '71', active, read);
    expect(prepared.args).toEqual({ ...args, project_id: project.path_with_namespace });
    expect(await prepared.read('projects/team%2Fapp')).toEqual(project);
    expect(await prepared.read('projects/71')).toEqual(project);
    expect(read.mock.calls).toEqual([['projects/71']]);
  });

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

  // Full paths already contain the GraphQL identity and need decoding, not a metadata lookup.
  it('decodes a path default for GraphQL without I/O', async () => {
    const read = jest.fn();
    expect(
      (
        await withDefaultProject(
          'browse_registry',
          { action: 'list_repositories' },
          declared,
          'team%2Fapp',
          active,
          read,
        )
      ).args,
    ).toEqual({ action: 'list_repositories', project_id: 'team/app' });
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
      'team%2fold-name',
      active,
      read,
    );
    expect(prepared.args).toEqual({ project_id: project.id });
    for (const path of ['projects/team%2Fold-name', 'projects/team%2Fapp', 'projects/71'])
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
