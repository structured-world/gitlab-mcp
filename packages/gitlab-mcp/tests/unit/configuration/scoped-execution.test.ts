/**
 * Calls under a working scope that one GitLab request cannot answer: filtered listings read
 * further pages, a scope of projects lists its projects, mark_all_done marks the scope's
 * todos. These cover the answers GitLab may give besides the usual rows.
 */

import { executeScoped } from '../../../src/configuration/scoped-execution';
import { buildPolicy } from '../../../src/configuration/policy';
import { isActionDenied } from '../../../src/config';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { searchToolRegistry } from '../../../src/entities/search/registry';
import { gitlab } from '../../../src/utils/gitlab-api';

jest.mock('../../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../../src/utils/gitlab-api'),
  gitlab: { get: jest.fn() },
}));

jest.mock('../../../src/config', () => ({
  ...jest.requireActual('../../../src/config'),
  isActionDenied: jest.fn(() => false),
}));

const groupPolicy = buildPolicy(
  undefined,
  { scope: { type: 'group', path: 'team', includeSubgroups: true } },
  {},
);
/** The answer of the search tool for a group search: its rows under `results`. */
const searchAnswer = (scope: string, results: unknown[]) => ({
  group_id: 'team',
  scope,
  count: results.length,
  results,
});
const groupOnlyPolicy = buildPolicy(
  undefined,
  { scope: { type: 'group', path: 'team', includeSubgroups: false } },
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

  // Emulating a call under a scope runs other actions in its place; an action the operator
  // denied stays denied instead of running through them.
  it.each([
    ['manage_todos', { action: 'mark_all_done' }, groupPolicy],
    ['browse_events', { action: 'user' }, projectPolicy],
    ['browse_search', { action: 'global', search: 'x', scope: 'issues' }, groupPolicy],
  ])('refuses %s %j the operator denied', async (tool, args, policy) => {
    jest
      .mocked(isActionDenied)
      .mockImplementation((name, action) => name === tool && action === args.action);
    const run = jest.fn();

    try {
      await expect(executeScoped(run, tool, args, policy)).rejects.toThrow(
        `Action '${args.action}' is not allowed for ${tool} tool`,
      );
      expect(run).not.toHaveBeenCalled();
    } finally {
      jest.mocked(isActionDenied).mockImplementation(() => false);
    }
  });

  // Project search has no projects scope: the scope project itself answers, when it matches,
  // in the shape of a search answer.
  it.each([
    [
      'app',
      {
        scope: 'projects',
        count: 1,
        results: [{ id: 7, name: 'App', path_with_namespace: 'team/app' }],
      },
    ],
    ['other', { scope: 'projects', count: 0, results: [] }],
  ])('answers a project search for %s with the scope project', async (search, expected) => {
    const run = jest.fn().mockResolvedValue({
      id: 7,
      name: 'App',
      path_with_namespace: 'team/app',
      permissions: {},
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'projects', search },
      projectPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_projects', { action: 'get', project_id: 'team/app' });
    expect(result).toEqual(expected);
  });

  // An emulated call is validated as the tool itself would: a call the tool refuses is not
  // turned into a listing of the scope.
  it.each([
    ['browse_search', { action: 'global', scope: 'projects' }],
    ['browse_search', { action: 'global', scope: 'projects', search: '' }],
    ['browse_projects', { action: 'list', per_page: 'many' }],
  ])('refuses the invalid call %s %j before emulating it', async (tool, args) => {
    const run = jest.fn();

    await expect(executeScoped(run, tool, args, projectPolicy)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  // The group's own audit trail answers an instance listing under a group scope; the events
  // of its projects are listed per project, which the result says.
  it('lists the scope group audit trail and says project events are listed per project', async () => {
    const run = jest.fn().mockResolvedValue([{ id: 1 }]);

    const result = await executeScoped(
      run,
      'browse_audit_events',
      { action: 'list_instance', created_after: '2026-01-01' },
      groupPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_group',
      group_id: 'team',
      created_after: '2026-01-01',
    });
    expect(result).toEqual({
      items: [{ id: 1 }],
      partial: true,
      message:
        "These are the audit events of group 'team' itself; events of its projects are listed per project with action 'list_project'.",
    });
  });

  it('passes on a group audit answer that is not a list', async () => {
    const run = jest.fn().mockResolvedValue({ message: 'not a list' });

    expect(
      await executeScoped(run, 'browse_audit_events', { action: 'list_instance' }, groupPolicy),
    ).toEqual({ message: 'not a list' });
  });

  // A scope of many projects: the first page reads only the projects it needs, a few at a
  // time, instead of every project of the scope at once.
  it('reads a page of a large project scope a few projects at a time', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `team/p${i}`);
    const many = buildPolicy(undefined, {}, {});
    many.scope = { projects: paths };
    many.scopeEnforcer = new ScopeEnforcer(many.scope);
    let inFlight = 0;
    let peak = 0;
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { id: 1, name: String(args.project_id), path_with_namespace: args.project_id };
    });

    const result = (await executeScoped(
      run,
      'browse_projects',
      { action: 'list', per_page: 2 },
      many,
    )) as Array<Record<string, unknown>>;

    expect(result.map((p) => p.path_with_namespace)).toEqual(['team/p0', 'team/p1']);
    expect(run.mock.calls.length).toBeLessThanOrEqual(5);
    expect(peak).toBeLessThanOrEqual(5);
  });

  // The caller's own runners stay the caller's: the owned feed, with its own cursor, keeps
  // the runners available to the scope project.
  it('lists the owned runners available to the scope', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.action === 'list_project'
        ? { nodes: [{ id: 1 }, { id: 2 }], pageInfo: { hasNextPage: false, endCursor: null } }
        : { nodes: [{ id: 2 }, { id: 3 }], pageInfo: { hasNextPage: true, endCursor: 'c' } },
    );

    const result = await executeScoped(
      run,
      'browse_runners',
      { action: 'list_owned', status: 'ONLINE', first: 20 },
      projectPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_runners', {
      action: 'list_owned',
      status: 'ONLINE',
      first: 20,
    });
    expect(run).toHaveBeenCalledWith('browse_runners', {
      action: 'list_project',
      project_id: 'team/app',
      first: 100,
    });
    expect(result).toEqual({
      nodes: [{ id: 2 }],
      pageInfo: { hasNextPage: true, endCursor: 'c' },
    });
  });

  // A group without its subgroups has no search of its own: the group search answers, kept
  // to the group's direct projects and the group itself.
  it('searches a group without its subgroups through its direct projects', async () => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: 10, full_path: 'team' };
      if (tool === 'browse_projects') {
        return args.page === 1 ? [{ id: 1, path_with_namespace: 'team/app' }] : [];
      }
      // The search tool's own answer shape.
      return searchAnswer('issues', [
        { project_id: 1, title: 'direct' },
        { project_id: 2, title: 'subgroup' },
        { group_id: 10, title: 'group' },
        { group_id: 11, title: 'subgroup group' },
      ]);
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'x' },
      groupOnlyPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_search', {
      action: 'group',
      group_id: 'team',
      scope: 'issues',
      search: 'x',
      page: 1,
      per_page: 100,
    });
    expect(result).toEqual(
      searchAnswer('issues', [
        { project_id: 1, title: 'direct' },
        { group_id: 10, title: 'group' },
      ]),
    );
  });

  // The group's own projects are read up to a bound; past it, rows of the projects not read
  // would be dropped, so the answer says it is partial instead of looking complete.
  it('marks a group search partial when the group has more direct projects than are read', async () => {
    let next = 0;
    const run = jest.fn(async (tool: string) => {
      if (tool === 'browse_namespaces') return { id: 10 };
      if (tool === 'browse_projects') {
        return Array.from({ length: 100 }, () => ({
          id: next++,
          path_with_namespace: `team/p${next}`,
        }));
      }
      return searchAnswer('issues', [{ project_id: 5, title: 'read' }]);
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'x' },
      groupOnlyPolicy,
    );

    expect(result).toEqual({
      ...searchAnswer('issues', [{ project_id: 5, title: 'read' }]),
      partial: true,
      message:
        "Results are kept to the first 1000 direct projects of group 'team'; results of its other projects are not shown. Narrow the listing (for example with a search) to see the rest.",
    });
  });

  // A page that is partial for its own reason keeps it, and adds the projects bound.
  it.each([
    [
      { action: 'global', scope: 'issues', search: 'x', page: 51, per_page: 20 },
      {
        ...searchAnswer('issues', []),
        partial: true,
        message:
          "Results are kept to the first 1000 direct projects of group 'team'; results of its other projects are not shown. A scoped listing reads the first 1000 rows GitLab returns, and page 51 starts after them. Narrow the listing (for example with a search) to see the rest.",
      },
    ],
  ])('combines the reasons of a partial group search %j', async (args, expected) => {
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_namespaces' ? { id: 10 } : { message: 'not a list' },
    );

    expect(await executeScoped(run, 'browse_search', args, groupOnlyPolicy)).toEqual(expected);
  });

  it('passes on a group search answer that is not a list', async () => {
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_search' ? { message: 'search failed' } : { message: 'not a list' },
    );

    expect(
      await executeScoped(
        run,
        'browse_search',
        { action: 'global', scope: 'issues', search: 'x' },
        groupOnlyPolicy,
      ),
    ).toEqual({ message: 'search failed' });
  });

  // Against the search tool itself, not a stand-in: its answer wraps the rows, and those are
  // what the group scope keeps.
  it('keeps the rows the search tool returns for a group without subgroups', async () => {
    const searchTool = searchToolRegistry.get('browse_search');
    jest.mocked(gitlab.get).mockResolvedValue([
      { project_id: 1, title: 'direct' },
      { project_id: 2, title: 'subgroup' },
    ]);
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: 10 };
      if (tool === 'browse_projects') return [{ id: 1, path_with_namespace: 'team/app' }];
      return searchTool?.handler(args);
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'x' },
      groupOnlyPolicy,
    );

    expect(result).toEqual(searchAnswer('issues', [{ project_id: 1, title: 'direct' }]));
  });

  it.each([
    [
      'projects',
      [{ path_with_namespace: 'team/app' }, { path_with_namespace: 'team/sub/x' }],
      [{ path_with_namespace: 'team/app' }],
    ],
    // Users belong to no project; a group search lists them all.
    ['users', [{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]],
  ])(
    'keeps %s of a group search without subgroups by their own place',
    async (scope, rows, expected) => {
      const run = jest.fn().mockResolvedValue(searchAnswer(scope, rows));

      const result = await executeScoped(
        run,
        'browse_search',
        { action: 'global', scope, search: 'x' },
        groupOnlyPolicy,
      );

      expect(result).toEqual(searchAnswer(scope, expected));
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  // The group's vulnerabilities, kept to its direct projects; the cursor stays the group's.
  it('lists the vulnerabilities of a group without its subgroups', async () => {
    const run = jest.fn().mockResolvedValue({
      nodes: [
        { id: 1, project: { fullPath: 'team/app' } },
        { id: 2, project: { fullPath: 'team/sub/x' } },
      ],
      pageInfo: { hasNextPage: true, endCursor: 'c' },
    });

    const result = await executeScoped(
      run,
      'browse_vulnerabilities',
      { action: 'list', first: 20 },
      groupOnlyPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_vulnerabilities', {
      action: 'list',
      group_id: 'team',
      first: 20,
    });
    expect(result).toEqual({
      nodes: [{ id: 1, project: { fullPath: 'team/app' } }],
      pageInfo: { hasNextPage: true, endCursor: 'c' },
    });
  });

  it('fails a project scope listing on a failure that is not an Error', async () => {
    const run = jest.fn().mockRejectedValue('connection reset');

    await expect(
      executeScoped(run, 'browse_projects', { action: 'list' }, projectPolicy),
    ).rejects.toBe('connection reset');
  });
});
