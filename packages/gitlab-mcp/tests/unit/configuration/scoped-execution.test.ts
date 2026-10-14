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
  // Multiple targets must be combined and deduplicated before global sorting and pagination.
  it('composes vulnerabilities across overlapping targets and continues with its own cursor', async () => {
    const scope = { project: 'team/app', groups: ['team', 'other'], includeSubgroups: false };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const a = { id: '1', severity: 'LOW', project: { fullPath: 'team/app' } };
    const b = { id: '2', severity: 'CRITICAL', project: { fullPath: 'other/app' } };
    const outside = { id: '3', severity: 'CRITICAL', project: { fullPath: 'team/sub/app' } };
    const run = jest.fn(async (_tool, args) => ({
      nodes: args.project_id ? [a] : args.group_id === 'team' ? [a, outside] : [b],
      pageInfo: { hasNextPage: false },
    }));
    const request = { action: 'list', severity: ['LOW', 'CRITICAL'], first: 1 };
    const first = (await executeScoped(run, 'browse_vulnerabilities', request, policy)) as {
      nodes: unknown[];
      pageInfo: { endCursor: string };
    };
    expect(first.nodes).toEqual([b]);
    expect(
      await executeScoped(
        run,
        'browse_vulnerabilities',
        { ...request, after: first.pageInfo.endCursor },
        policy,
      ),
    ).toEqual({ nodes: [a], pageInfo: { hasNextPage: false, endCursor: null } });
    expect(run).toHaveBeenCalledWith(
      'browse_vulnerabilities',
      expect.objectContaining({ project_id: 'team/app', severity: request.severity, first: 100 }),
    );
  });
  // A multi-target scope intersects the original runner feed with the union of usable runners.
  it.each(['list_all', 'list_owned'])(
    'keeps %s runners available to any scoped target with its original cursor',
    async (action) => {
      const scope = { projects: ['team/a', 'team/b'] };
      const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
      const run = jest.fn(async (_tool, args) => {
        if (args.action === action)
          return {
            nodes: [{ id: '1' }, { id: '2' }, { id: '9' }],
            pageInfo: { hasNextPage: true, endCursor: 'owned-next' },
          };
        return {
          nodes: [{ id: args.project_id === 'team/a' ? '1' : '2' }],
          pageInfo: { hasNextPage: false },
        };
      });
      expect(
        await executeScoped(
          run,
          'browse_runners',
          { action, after: 'cursor', status: 'ONLINE' },
          policy,
        ),
      ).toEqual({
        nodes: [{ id: '1' }, { id: '2' }],
        pageInfo: { hasNextPage: true, endCursor: 'owned-next' },
      });
      expect(run).toHaveBeenCalledWith(
        'browse_runners',
        expect.objectContaining({
          action: 'list_project',
          project_id: 'team/b',
          status: 'ONLINE',
          first: 100,
        }),
      );
    },
  );
  it('bounds distinct activity lookups and reports omitted rows as partial', async () => {
    // Paging a wide activity feed cannot cause an unbounded project-lookup fan-out.
    const read = jest.mocked(gitlab.get);
    read.mockClear();
    read.mockImplementation(async (path) => ({
      path_with_namespace: `team/p${path.split('/')[1]}`,
    }));
    const run = jest.fn(async (_tool, args) =>
      Array.from({ length: 100 }, (_, i) => ({ project_id: (args.page - 1) * 100 + i + 1 })),
    );
    const result = await executeScoped(
      run,
      'browse_events',
      { action: 'user', page: 2, per_page: 100 },
      groupPolicy,
    );
    expect(result).toMatchObject({
      items: [],
      partial: true,
      message: expect.stringContaining('100 distinct projects'),
    });
    expect(read).toHaveBeenCalledTimes(100);
    expect(run).toHaveBeenCalledTimes(10);
    read.mockReset();
  });

  it('drops inaccessible activity targets and preserves authentication failures', async () => {
    // Unknown/deleted projects are omitted; a rejected sign-in fails the request instead of looking complete.
    const read = jest.mocked(gitlab.get);
    read.mockRejectedValueOnce(new Error('GitLab API error: 404 Not Found'));
    const run = jest
      .fn()
      .mockResolvedValue([{ project_id: 42 }, { project_id: 42 }, { project_id: 'invalid' }, {}]);
    await expect(
      executeScoped(run, 'browse_events', { action: 'user' }, groupOnlyPolicy),
    ).resolves.toEqual([]);
    read.mockRejectedValueOnce(new Error('GitLab API error: 401 Unauthorized'));
    await expect(
      executeScoped(run, 'browse_events', { action: 'user' }, groupOnlyPolicy),
    ).rejects.toThrow('401');
    read.mockReset();
  });

  it('bounds the aggregate deploy-key request count and reports partial pages', async () => {
    // Eleven projects must cost at most ten key requests, not ten pages per project.
    const run = jest.fn(async (tool, args) =>
      tool === 'browse_projects'
        ? Array.from({ length: 11 }, (_, id) => ({ path_with_namespace: `team/p${id}` }))
        : [{ id: args.project_id }],
    );
    const result = await executeScoped(
      run,
      'browse_deploy_keys',
      { action: 'list', per_page: 20 },
      groupPolicy,
    );
    expect(result).toMatchObject({
      partial: true,
      items: expect.any(Array),
      message: expect.stringContaining('key request bound'),
    });
    expect((result as { items: unknown[] }).items).toHaveLength(10);
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_deploy_keys')).toHaveLength(10);
  });

  it.each(['browse_projects', 'browse_deploy_keys'])(
    'preserves a non-list answer from %s while composing keys',
    async (failure) => {
      // A wrapped upstream error must never be disguised as an empty complete key listing.
      const answer = { error: 'unavailable' };
      const run = jest.fn(async (tool) =>
        tool === failure ? answer : [{ path_with_namespace: 'team/app' }],
      );
      await expect(
        executeScoped(run, 'browse_deploy_keys', { action: 'list' }, groupPolicy),
      ).resolves.toEqual(answer);
    },
  );

  it('refuses pages past the key read bound without making requests', async () => {
    // An unreachable offset must not trigger project enumeration or key fan-out.
    const run = jest.fn();
    await expect(
      executeScoped(
        run,
        'browse_deploy_keys',
        { action: 'list', page: 11, per_page: 100 },
        groupPolicy,
      ),
    ).resolves.toMatchObject({ partial: true, items: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it('marks sorted project results partial when GitLab omits the sort field', async () => {
    // Missing metadata must not silently claim that the requested ordering was applied.
    const scope = { projects: ['team/app', 'team/app2'] };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => ({
      name: 'app',
      path_with_namespace: args.project_id,
    }));
    await expect(
      executeScoped(
        run,
        'browse_search',
        { action: 'global', scope: 'projects', search: 'app', sort: 'desc' },
        policy,
      ),
    ).resolves.toMatchObject({ partial: true, message: expect.stringContaining('ordering field') });
  });
  it('merges group project deploy keys and deduplicates shared keys before paging', async () => {
    // A group can expose its projects' keys without an instance-wide administrator listing.
    const run = jest.fn(async (tool, args) => {
      if (tool === 'browse_projects')
        return [
          { path_with_namespace: 'team/a' },
          { path_with_namespace: 'outside/app' },
          { path_with_namespace: 'team/b' },
        ];
      if (args.project_id === 'team/a') return [{ id: 1 }, { id: 2 }];
      if (args.project_id === 'team/b') return [{ id: 2 }, { id: 3 }];
      return [{ id: 999 }];
    });
    const result = await executeScoped(
      run,
      'browse_deploy_keys',
      { action: 'list', page: 2, per_page: 2 },
      groupPolicy,
    );
    expect(result).toEqual([{ id: 3 }]);
    expect(run).not.toHaveBeenCalledWith(
      'browse_deploy_keys',
      expect.not.objectContaining({ project_id: expect.any(String) }),
    );
  });

  // A global search under several targets searches each one and merges the answers in
  // GitLab's order (issues newest first by default), without repeating a row two targets
  // both returned, and pages after the merge.
  it('composes a global issue search across several targets in creation order', async () => {
    const scope = { project: 'solo/app', groups: ['team'], includeSubgroups: true };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const issue = (id: number, day: number) => ({
      id,
      created_at: `2026-01-0${day}T00:00:00Z`,
      updated_at: `2026-02-0${10 - day}T00:00:00Z`,
    });
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => ({
      scope: 'issues',
      results: args.project_id ? [issue(1, 3), issue(2, 1)] : [issue(3, 4), issue(1, 3)],
    }));

    const first = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'bug', per_page: 2 },
      policy,
    );
    expect(first).toEqual({ scope: 'issues', count: 2, results: [issue(3, 4), issue(1, 3)] });
    expect(run).toHaveBeenCalledWith(
      'browse_search',
      expect.objectContaining({ action: 'project', project_id: 'solo/app', search: 'bug' }),
    );
    expect(run).toHaveBeenCalledWith(
      'browse_search',
      expect.objectContaining({ action: 'group', group_id: 'team', search: 'bug' }),
    );

    // updated_at ascending is GitLab's other issue ordering.
    const updated = (await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'bug', order_by: 'updated_at', sort: 'asc' },
      policy,
    )) as { results: Array<{ id: number }> };
    expect(updated.results.map((row) => row.id)).toEqual([3, 1, 2]);
  });

  // Commits, code and notes have no order shared across targets: they keep target order,
  // and the answer says so instead of passing for one sorted search.
  it('marks a composed search without a shared order partial', async () => {
    const scope = { projects: ['team/a', 'team/b'] };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => ({
      results: [{ id: `${args.project_id as string}-sha` }],
    }));

    await expect(
      executeScoped(
        run,
        'browse_search',
        { action: 'global', scope: 'commits', search: 'x' },
        policy,
      ),
    ).resolves.toMatchObject({
      scope: 'commits',
      count: 2,
      partial: true,
      message: expect.stringContaining('target order'),
    });
  });

  // A scope of several projects or groups shares one request bound across its searches.
  it('bounds a composed search to ten requests and reports the rest as partial', async () => {
    const scope = { projects: Array.from({ length: 12 }, (_, i) => `team/p${i}`) };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => ({
      results: [
        { id: Number(String(args.project_id).slice(6)), created_at: '2026-01-01T00:00:00Z' },
      ],
    }));

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'x' },
      policy,
    );

    expect(run).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({
      partial: true,
      message: expect.stringContaining('10 requests'),
    });
  });

  // Groups without subgroups list their direct projects to keep their rows; those lookups
  // share one bound across the scope, so many large groups cannot multiply the requests.
  it('bounds the direct-project lookups of a composed search across its groups', async () => {
    const scope = { groups: ['a', 'b', 'c'], includeSubgroups: false };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: String(args.namespace_id).charCodeAt(0) };
      if (tool === 'browse_projects')
        return Array.from({ length: 100 }, (_, i) => ({
          id: `${args.group_id as string}-${args.page as number}-${i}`,
          path_with_namespace: `${args.group_id as string}/p${args.page as number}-${i}`,
        }));
      return { results: [{ id: 1, project_id: `${args.group_id as string}-1-0` }] };
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'issues', search: 'x' },
      policy,
    );

    // One group lookup and ten project pages, as a single group without subgroups reads.
    const lookups = run.mock.calls.filter(([tool]) => tool !== 'browse_search');
    expect(lookups.length).toBeLessThanOrEqual(11);
    expect(run.mock.calls.length - lookups.length).toBeLessThanOrEqual(10);
    expect(result).toMatchObject({ partial: true });
  });

  // A scope of several targets lists the keys of its named projects and of its groups'
  // projects, deduplicated, instead of refusing what GitLab can answer per project.
  it('composes deploy keys across a mixed multi-target scope', async () => {
    const scope = { project: 'solo/app', groups: ['team', 'ops'], includeSubgroups: true };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (tool, args) => {
      if (tool === 'browse_projects')
        return args.group_id === 'team'
          ? [{ path_with_namespace: 'team/a' }, { path_with_namespace: 'solo/app' }]
          : [{ path_with_namespace: 'ops/b' }];
      if (args.project_id === 'solo/app') return [{ id: 1 }];
      if (args.project_id === 'team/a') return [{ id: 1 }, { id: 2 }];
      return [{ id: 3 }];
    });
    expect(await executeScoped(run, 'browse_deploy_keys', { action: 'list' }, policy)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    // Each project's keys are read once, also when a group lists a named project again.
    expect(
      run.mock.calls.filter(
        ([tool, args]) => tool === 'browse_deploy_keys' && args.project_id === 'solo/app',
      ),
    ).toHaveLength(1);
  });

  // Explicit false must use the same per-project composition and omit the instance-only field.
  it('composes group deploy keys when public is explicitly false', async () => {
    const run = jest.fn(async (tool, args) =>
      tool === 'browse_projects'
        ? [{ path_with_namespace: 'team/app' }]
        : args.project_id
          ? [{ id: 1 }]
          : [],
    );
    expect(
      await executeScoped(
        run,
        'browse_deploy_keys',
        { action: 'list', public: false },
        groupPolicy,
      ),
    ).toEqual([{ id: 1 }]);
    expect(run).toHaveBeenLastCalledWith('browse_deploy_keys', {
      action: 'list',
      project_id: 'team/app',
      page: 1,
      per_page: 100,
    });
  });
  it('filters user activity by resolved project paths under a group scope', async () => {
    // Numeric IDs in the user's feed must be resolved once, not used to refuse all group activity.
    const read = jest.mocked(gitlab.get);
    read.mockImplementation(async (path) => ({
      path_with_namespace: path === 'projects/1' ? 'team/app' : 'outside/app',
    }));
    const run = jest.fn().mockResolvedValue([
      { id: 10, project_id: 1 },
      { id: 11, project_id: 2 },
      { id: 12, project_id: 1 },
    ]);
    const result = await executeScoped(run, 'browse_events', { action: 'user' }, groupPolicy);
    expect(result).toEqual([
      { id: 10, project_id: 1 },
      { id: 12, project_id: 1 },
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockReset();
  });
  it('sorts scoped project-search matches before selecting their page', async () => {
    // Preset order must not decide the contents of a sorted search page.
    const policy = buildPolicy(
      { scope: { projects: ['team/new', 'team/old', 'team/middle'] } },
      {},
      {},
    );
    const rows: Record<string, unknown> = {
      'team/new': {
        id: 3,
        name: 'app new',
        created_at: '2026-03-01',
        path_with_namespace: 'team/new',
      },
      'team/old': {
        id: 1,
        name: 'app old',
        created_at: '2026-01-01',
        path_with_namespace: 'team/old',
      },
      'team/middle': {
        id: 2,
        name: 'app middle',
        created_at: '2026-02-01',
        path_with_namespace: 'team/middle',
      },
    };
    const run = jest.fn(async (_tool, args) => rows[args.project_id]);
    const result = await executeScoped(
      run,
      'browse_search',
      {
        action: 'global',
        scope: 'projects',
        search: 'app',
        sort: 'asc',
        order_by: 'created_at',
        page: 2,
        per_page: 1,
      },
      policy,
    );
    expect(result).toMatchObject({ results: [{ id: 2 }] });
  });
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
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_namespaces' ? { id: 5 } : { message: 'not a list' },
    );

    expect(
      await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, groupPolicy),
    ).toMatchObject({ success: true, marked: 0, failed: [] });
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_todos')).toHaveLength(1);
  });

  it('reports a todo failure that is not an Error by its value', async () => {
    const run = jest.fn(async (tool: string) => {
      if (tool === 'browse_namespaces') return { id: 5 };
      if (tool === 'browse_todos') return [{ id: 1, project: { path_with_namespace: 'team/app' } }];
      throw 'rate limited';
    });

    expect(
      await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, groupPolicy),
    ).toMatchObject({ success: false, marked: 0, failed: [{ id: 1, error: 'rate limited' }] });
  });

  // A large pending feed must not run past the handler timeout: one call marks at most 100
  // todos, says it is partial, and a repeat continues because marked todos leave the feed.
  it('marks at most one page of scope todos per call and reports the rest as partial', async () => {
    let next = 0;
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: 5 };
      if (tool !== 'browse_todos') return {};
      if ((args.page as number) > 15) return [];
      return Array.from({ length: 100 }, () => ({
        id: ++next,
        project: { path_with_namespace: 'team/app' },
      }));
    });

    const result = await executeScoped(
      run,
      'manage_todos',
      { action: 'mark_all_done' },
      groupPolicy,
    );

    // The second page shows that more scope todos remain than one call marks.
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_todos')).toHaveLength(2);
    expect(run.mock.calls.filter(([tool]) => tool === 'manage_todos')).toHaveLength(100);
    expect(result).toMatchObject({ success: true, marked: 100, failed: [], partial: true });
    expect((result as { message: string }).message).toMatch(/call mark_all_done again/);
  });

  // Todos outside the scope stay pending, so they must not fill the pages one call reads: a
  // repeated call has to reach the scope's todos. Each target's todos are read with GitLab's
  // own group or project filter.
  it.each([
    [groupPolicy, 'browse_namespaces', { group_id: 5 }],
    [projectPolicy, 'browse_projects', { project_id: 5 }],
  ])('reads the pending todos of the scope target %#', async (policy, lookup, filter) => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === lookup) return { id: 5 };
      if (tool !== 'browse_todos') return {};
      const filtered = Object.entries(filter).every(([key, value]) => args[key] === value);
      if (filtered) return [{ id: 1, project: { path_with_namespace: 'team/app' } }];
      return (args.page as number) > 15
        ? []
        : Array.from({ length: 100 }, (_, id) => ({
            id: id + 100,
            project: { path_with_namespace: 'other/x' },
          }));
    });

    const result = await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, policy);

    expect(result).toMatchObject({ success: true, marked: 1 });
    expect(run).toHaveBeenCalledWith('manage_todos', { action: 'mark_done', id: 1 });
  });

  // A group without its subgroups reads its subgroups' todos too (GitLab's group filter covers
  // them); those beyond the bounded pages are reported instead of looking like the end.
  it('bounds the pages a group without subgroups reads past its first', async () => {
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_namespaces'
        ? { id: 5 }
        : Array.from({ length: 100 }, (_, id) => ({
            id,
            project: { path_with_namespace: 'team/sub/x' },
          })),
    );

    const result = await executeScoped(
      run,
      'manage_todos',
      { action: 'mark_all_done' },
      groupOnlyPolicy,
    );

    expect(run.mock.calls.filter(([tool]) => tool === 'browse_todos')).toHaveLength(11);
    expect(result).toMatchObject({ marked: 0, partial: true });
    expect((result as { message: string }).message).toMatch(/subgroups/);
  });

  // A scope target GitLab no longer knows has no todos to mark; the others are still marked.
  it('skips a scope target GitLab does not know', async () => {
    const scope = { projects: ['team/gone', 'team/app'] };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_projects') {
        if (args.project_id === 'team/gone') throw new Error('GitLab API error: 404 Not Found');
        return { id: 7 };
      }
      if (tool === 'browse_todos')
        return args.project_id === 7
          ? [{ id: 1, project: { path_with_namespace: 'team/app' } }]
          : [];
      return {};
    });

    expect(
      await executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, policy),
    ).toMatchObject({ success: true, marked: 1 });
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

  // A preset denying mark_done while allowing mark_all_done must not have the scoped bulk
  // emulation run the denied action for it: the call fails and no todo is marked.
  it('refuses an emulation that would run an action the preset denies', async () => {
    const policy = {
      ...groupPolicy,
      presetName: 'careful',
      deniedActions: new Map([['manage_todos', new Set(['mark_done'])]]),
    };
    const run = jest.fn(async (tool: string) => {
      if (tool === 'browse_namespaces') return { id: 5 };
      return tool === 'browse_todos'
        ? [{ id: 1, project: { path_with_namespace: 'team/app' } }]
        : {};
    });

    await expect(
      executeScoped(run, 'manage_todos', { action: 'mark_all_done' }, policy),
    ).rejects.toThrow("preset 'careful' denies the 'mark_done' action of manage_todos");
    expect(run).not.toHaveBeenCalledWith('manage_todos', expect.anything());
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

  const auditEvent = (id: number, day: number) => ({
    id,
    created_at: `2026-01-0${day}T00:00:00Z`,
  });

  // GitLab keeps a group's trail to the group's own events, so an instance listing under a
  // group scope also reads the trails of its projects and of the subgroups on the way to
  // them, merged newest first. A project only shared with the group is not read.
  it('composes the scope group audit trail with its subgroups and projects', async () => {
    const trails: Record<string, unknown[]> = {
      team: [auditEvent(1, 1)],
      'team/sub': [auditEvent(4, 4)],
      'team/app': [auditEvent(3, 3)],
      'team/sub/api': [auditEvent(2, 2)],
    };
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) =>
      tool === 'browse_projects'
        ? [
            { path_with_namespace: 'team/app' },
            { path_with_namespace: 'team/sub/api' },
            { path_with_namespace: 'other/shared' },
          ]
        : (trails[String(args.group_id ?? args.project_id)] ?? [auditEvent(9, 9)]),
    );

    const result = await executeScoped(
      run,
      'browse_audit_events',
      { action: 'list_instance', created_after: '2026-01-01' },
      groupPolicy,
    );

    expect(result).toEqual({
      items: [auditEvent(4, 4), auditEvent(3, 3), auditEvent(2, 2), auditEvent(1, 1)],
      partial: true,
      message: expect.stringContaining('holds no project'),
    });
    expect(run).toHaveBeenCalledWith('browse_projects', {
      action: 'list',
      group_id: 'team',
      include_subgroups: true,
      page: 1,
      per_page: 100,
    });
    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_group',
      group_id: 'team/sub',
      created_after: '2026-01-01',
      page: 1,
      per_page: 100,
    });
    expect(run).not.toHaveBeenCalledWith(
      'browse_audit_events',
      expect.objectContaining({ project_id: 'other/shared' }),
    );
  });

  // A group without its subgroups: its own trail and its direct projects' make the whole
  // listing, so the merged page is complete.
  it('composes a complete audit trail for a group scope without subgroups', async () => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_projects') return [{ path_with_namespace: 'team/app' }];
      return args.group_id === 'team' ? [auditEvent(1, 1)] : [auditEvent(2, 2)];
    });

    expect(
      await executeScoped(run, 'browse_audit_events', { action: 'list_instance' }, groupOnlyPolicy),
    ).toEqual([auditEvent(2, 2), auditEvent(1, 1)]);
    expect(run).toHaveBeenCalledWith('browse_projects', {
      action: 'list',
      group_id: 'team',
      include_subgroups: false,
      page: 1,
      per_page: 100,
    });
  });

  // Project snippets that name no project are the snippets of the scope's projects, merged
  // newest (highest ID) first as GitLab lists one project's, rather than a call failing for
  // the missing project.
  it('composes the project snippets of a group scope', async () => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_projects')
        return [{ path_with_namespace: 'team/app' }, { path_with_namespace: 'team/api' }];
      return args.projectId === 'team/app' ? [{ id: 5 }, { id: 1 }] : [{ id: 3 }];
    });

    expect(
      await executeScoped(
        run,
        'browse_snippets',
        { action: 'list', scope: 'project', per_page: 2 },
        groupOnlyPolicy,
      ),
    ).toEqual([{ id: 5 }, { id: 3 }]);
    expect(run).toHaveBeenCalledWith('browse_snippets', {
      action: 'list',
      scope: 'project',
      projectId: 'team/app',
      page: 1,
      per_page: 100,
    });
  });

  it('composes the project snippets of a scope of several projects', async () => {
    const scope = { projects: ['team/app', 'team/api'] };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.projectId === 'team/app' ? [{ id: 1 }] : [{ id: 2 }],
    );

    expect(
      await executeScoped(run, 'browse_snippets', { action: 'list', scope: 'project' }, policy),
    ).toEqual([{ id: 2 }, { id: 1 }]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // Several projects answer an instance audit listing with their merged trails.
  it('composes the audit trails of a scope of several projects', async () => {
    const scope = { projects: ['team/app', 'team/api'] };
    const policy = { ...projectPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => [
      { id: args.project_id === 'team/app' ? 1 : 2, created_at: '2026-01-01T00:00:00Z' },
    ]);

    expect(
      await executeScoped(run, 'browse_audit_events', { action: 'list_instance' }, policy),
    ).toEqual([
      { id: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('passes on a group audit answer that is not a list', async () => {
    const run = jest.fn().mockResolvedValue({ message: 'not a list' });

    expect(
      await executeScoped(run, 'browse_audit_events', { action: 'list_instance' }, groupPolicy),
    ).toEqual({ message: 'not a list' });
  });

  // The scope's trails hold project and group events only, so a filter for a user or the
  // instance finds nothing in them, without asking GitLab.
  it.each(['User', 'Gitlab::Audit::InstanceScope'])(
    'answers an audit listing filtered to %s with an empty page under a scope',
    async (entity_type) => {
      const run = jest.fn();
      expect(
        await executeScoped(
          run,
          'browse_audit_events',
          { action: 'list_instance', entity_type, entity_id: 4 },
          groupPolicy,
        ),
      ).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    },
  );

  // A filter by entity type reads only the trails of that kind of place; project trails hold
  // no subgroup events, so the page is complete.
  it('reads only the project trails of the scope for entity_type Project', async () => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_projects') return [{ path_with_namespace: 'team/app' }];
      return args.group_id ? [auditEvent(1, 1)] : [auditEvent(2, 2)];
    });

    expect(
      await executeScoped(
        run,
        'browse_audit_events',
        { action: 'list_instance', entity_type: 'Project' },
        groupPolicy,
      ),
    ).toEqual([auditEvent(2, 2)]);
    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_project',
      project_id: 'team/app',
      page: 1,
      per_page: 100,
    });
    expect(run).not.toHaveBeenCalledWith(
      'browse_audit_events',
      expect.objectContaining({ action: 'list_group' }),
    );
  });

  // A filter by one entity reads that entity's own trail when it is in the scope, also under a
  // scope of one project, and finds nothing for an entity outside the scope or not found.
  it('reads the trail of one filtered entity of the scope', async () => {
    const trail = [auditEvent(3, 3)];
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_projects') {
        if (args.project_id === '404') throw new Error('GitLab API error: 404 Not Found');
        return { id: 5, path_with_namespace: args.project_id === '5' ? 'team/app' : 'other/app' };
      }
      if (tool === 'browse_namespaces') return { id: 7, full_path: 'team', kind: 'group' };
      return trail;
    });
    const filtered = (entity_type: string, entity_id: number) => ({
      action: 'list_instance',
      entity_type,
      entity_id,
      page: 2,
      per_page: 5,
    });

    expect(
      await executeScoped(run, 'browse_audit_events', filtered('Project', 5), projectPolicy),
    ).toBe(trail);
    expect(run).toHaveBeenCalledWith('browse_projects', { action: 'get', project_id: '5' });
    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_project',
      project_id: 'team/app',
      page: 2,
      per_page: 5,
    });
    expect(await executeScoped(run, 'browse_audit_events', filtered('Group', 7), groupPolicy)).toBe(
      trail,
    );
    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_group',
      group_id: 'team',
      page: 2,
      per_page: 5,
    });
    run.mockClear();
    for (const [args, policy] of [
      [filtered('Project', 6), projectPolicy],
      [filtered('Project', 404), projectPolicy],
      [filtered('Group', 7), projectPolicy],
    ] as const) {
      expect(await executeScoped(run, 'browse_audit_events', args, policy)).toEqual([]);
    }
    expect(run).not.toHaveBeenCalledWith('browse_audit_events', expect.anything());
  });

  // GitLab refuses an entity type it does not know and an entity ID without its type.
  it.each([
    [{ entity_type: 'Key' }, /entity_type/],
    [{ entity_id: 3 }, /entity_type/],
  ])('refuses the audit entity filter %j as GitLab does', async (filter, reason) => {
    const run = jest.fn();
    await expect(
      executeScoped(
        run,
        'browse_audit_events',
        { action: 'list_instance', ...filter },
        projectPolicy,
      ),
    ).rejects.toThrow(reason);
    expect(run).not.toHaveBeenCalled();
  });

  // GitLab searches snippet titles only across the instance; under a scope the snippets of its
  // projects answer, matched as GitLab matches them (every word of three or more characters
  // in one of title, description or file name) and newest updated first.
  it('searches the snippet titles of the scope projects as GitLab matches them', async () => {
    const snippet = (id: number, day: number, fields: Record<string, unknown>) => ({
      id,
      title: 'x',
      description: null,
      file_name: 'x',
      updated_at: `2026-01-0${day}T00:00:00Z`,
      ...fields,
    });
    const snippets: Record<string, unknown[]> = {
      'team/app': [
        snippet(1, 1, { title: 'Deploy script' }),
        snippet(2, 3, { title: 'deploy', description: 'the script' }),
        snippet(3, 2, { description: 'SCRIPT to deploy' }),
      ],
      'team/sub/api': [snippet(4, 4, { file_name: 'deploy-script.sh' })],
    };
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) =>
      tool === 'browse_projects'
        ? [{ path_with_namespace: 'team/app' }, { path_with_namespace: 'team/sub/api' }]
        : (snippets[String(args.projectId)] ?? []),
    );

    expect(
      await executeScoped(
        run,
        'browse_search',
        { action: 'global', scope: 'snippet_titles', search: '  deploy   script ' },
        groupPolicy,
      ),
    ).toEqual({
      scope: 'snippet_titles',
      count: 3,
      results: [snippets['team/sub/api'][0], snippets['team/app'][2], snippets['team/app'][0]],
    });
    expect(run).toHaveBeenCalledWith('browse_snippets', {
      action: 'list',
      scope: 'project',
      projectId: 'team/app',
      page: 1,
      per_page: 100,
    });
    expect(run).not.toHaveBeenCalledWith('browse_search', expect.anything());
  });

  // A query without a word of three characters matches a whole field, ignoring case; a quoted
  // phrase is one word.
  it('matches short and quoted snippet title searches as GitLab does', async () => {
    const rows = [
      { id: 1, title: 'AB', updated_at: '2026-01-01T00:00:00Z' },
      { id: 2, title: 'abc', updated_at: '2026-01-02T00:00:00Z' },
      { id: 3, title: 'x a b c y', updated_at: '2026-01-03T00:00:00Z' },
    ];
    const run = jest.fn().mockResolvedValue(rows);
    const search = async (query: string) =>
      (
        (await executeScoped(
          run,
          'browse_search',
          { action: 'global', scope: 'snippet_titles', search: query },
          projectPolicy,
        )) as { results: Array<{ id: number }> }
      ).results.map((row) => row.id);

    expect(await search('ab')).toEqual([1]);
    expect(await search('"a b c"')).toEqual([3]);
  });

  // GitLab lists projects newest first when no order is named, so a page of a scope made of
  // projects comes from all of them ordered that way, read a few projects at a time.
  it('lists a project scope newest first, reading its projects a few at a time', async () => {
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
      const index = paths.indexOf(String(args.project_id));
      return {
        id: index + 1,
        name: String(args.project_id),
        path_with_namespace: args.project_id,
        created_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      };
    });

    const result = (await executeScoped(
      run,
      'browse_projects',
      { action: 'list', per_page: 2 },
      many,
    )) as Array<Record<string, unknown>>;

    expect(result.map((p) => p.path_with_namespace)).toEqual(['team/p49', 'team/p48']);
    expect(run).toHaveBeenCalledTimes(50);
    expect(peak).toBeLessThanOrEqual(5);
  });

  // A plain project listing lists active projects and GitLab's project search leaves archived
  // ones out, so an archived scope project is left out of both.
  it.each([
    ['browse_projects', { action: 'list' }],
    ['browse_search', { action: 'global', scope: 'projects', search: 'team' }],
  ])('leaves an archived scope project out of %s %j', async (tool, args) => {
    const scoped = buildPolicy(undefined, {}, {});
    scoped.scope = { projects: ['team/app', 'team/old'] };
    scoped.scopeEnforcer = new ScopeEnforcer(scoped.scope);
    const run = jest.fn(async (_tool: string, toolArgs: Record<string, unknown>) => ({
      id: 1,
      name: String(toolArgs.project_id),
      path_with_namespace: toolArgs.project_id,
      created_at: '2026-01-01T00:00:00Z',
      archived: toolArgs.project_id === 'team/old',
    }));

    const result = await executeScoped(run, tool, args, scoped);

    const rows = (
      Array.isArray(result) ? result : (result as { results: unknown[] }).results
    ) as Array<Record<string, unknown>>;
    expect(rows.map((p) => p.path_with_namespace)).toEqual(['team/app']);
  });

  // GitLab matches a project search against the description too.
  it('finds a scope project by its description', async () => {
    const scoped = buildPolicy(undefined, {}, {});
    scoped.scope = { projects: ['team/app', 'team/api'] };
    scoped.scopeEnforcer = new ScopeEnforcer(scoped.scope);
    const run = jest.fn(async (_tool: string, toolArgs: Record<string, unknown>) => ({
      id: 1,
      name: toolArgs.project_id === 'team/app' ? 'app' : 'api',
      path_with_namespace: toolArgs.project_id,
      created_at: '2026-01-01T00:00:00Z',
      description: toolArgs.project_id === 'team/app' ? 'Billing service' : null,
    }));

    const result = (await executeScoped(
      run,
      'browse_projects',
      { action: 'list', search: 'billing' },
      scoped,
    )) as Array<Record<string, unknown>>;

    expect(result.map((p) => p.path_with_namespace)).toEqual(['team/app']);
  });

  // The namespace listing is instance-wide; under a group scope it is read until the page of
  // the scope's namespaces is full.
  it('lists only the namespaces of the scope group', async () => {
    const run = jest.fn().mockResolvedValue([
      { kind: 'group', full_path: 'team' },
      { kind: 'group', full_path: 'other' },
      { kind: 'user', full_path: 'alice' },
    ]);

    const result = await executeScoped(run, 'browse_namespaces', { action: 'list' }, groupPolicy);

    expect(result).toEqual([{ kind: 'group', full_path: 'team' }]);
    expect(run).toHaveBeenCalledWith('browse_namespaces', {
      action: 'list',
      page: 1,
      per_page: 100,
    });
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

  // A search naming the scope group itself covers its subgroups at GitLab too, so it is kept
  // to the group's direct projects like a global one.
  it('keeps a search of the scope group to its direct projects', async () => {
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: 10, full_path: 'team' };
      if (tool === 'browse_projects') {
        return args.page === 1 ? [{ id: 1, path_with_namespace: 'team/app' }] : [];
      }
      return searchAnswer('issues', [
        { project_id: 1, title: 'direct' },
        { project_id: 2, title: 'subgroup' },
      ]);
    });

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'group', group_id: 'team', scope: 'issues', search: 'x' },
      groupOnlyPolicy,
    );

    expect(result).toEqual(searchAnswer('issues', [{ project_id: 1, title: 'direct' }]));
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

  // GitLab's group user search covers members of the whole hierarchy; without its subgroups
  // only the group's members (its own and those inherited from its parents) are kept, read in
  // one request per search page.
  it('keeps users of a group search without subgroups to the group members', async () => {
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_members' ? [{ id: 1 }] : searchAnswer('users', [{ id: 1 }, { id: 2 }]),
    );

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'users', search: 'x' },
      groupOnlyPolicy,
    );

    expect(result).toEqual(searchAnswer('users', [{ id: 1 }]));
    expect(run).toHaveBeenCalledWith('browse_members', {
      action: 'list_all_group',
      group_id: 'team',
      user_ids: ['1', '2'],
      per_page: 100,
    });
  });

  // A multi-target search keeps each direct group's users to its members the same way.
  it('keeps users of a direct group to its members in a multi-target search', async () => {
    const scope = { groups: ['team', 'other'], includeSubgroups: false };
    const policy = { ...groupOnlyPolicy, scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_members') return args.group_id === 'team' ? [{ id: 1 }] : [{ id: 3 }];
      return searchAnswer('users', args.group_id === 'team' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]);
    });

    const result = (await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'users', search: 'x' },
      policy,
    )) as { results: Array<{ id: number }> };

    expect(result.results.map(({ id }) => id).sort()).toEqual([1, 3]);
  });

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

  // A group or project search has no groups scope on the supported GitLab versions, so the
  // scope's groups matching the search are read from the namespace listing.
  it('answers a search of groups with the scope groups that match', async () => {
    const run = jest.fn().mockResolvedValue([
      { id: 5, kind: 'group', full_path: 'team/sub' },
      { id: 6, kind: 'group', full_path: 'other' },
      { id: 7, kind: 'user', full_path: 'team' },
    ]);

    const result = await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'groups', search: 'sub' },
      groupPolicy,
    );

    expect(run).toHaveBeenCalledWith('browse_namespaces', {
      action: 'list',
      search: 'sub',
      page: 1,
      per_page: 100,
    });
    expect(result).toEqual({
      scope: 'groups',
      count: 1,
      results: [{ id: 5, kind: 'group', full_path: 'team/sub' }],
    });
  });

  // GitLab's group search lists newest first (by ID, which follows creation), and an
  // ascending creation order when asked; the namespace listing's own order must not leak
  // into the answer or decide which groups land on the page.
  it.each([
    [{}, [9, 7]],
    [{ order_by: 'created_at', sort: 'desc' }, [9, 7]],
    [{ order_by: 'created_at', sort: 'asc' }, [3, 7]],
  ])('orders a search of groups %j by creation before paging', async (ordering, ids) => {
    const run = jest.fn().mockResolvedValue([
      { id: 3, kind: 'group', full_path: 'team/a' },
      { id: 9, kind: 'group', full_path: 'team/b' },
      { id: 7, kind: 'group', full_path: 'team/c' },
    ]);

    const result = (await executeScoped(
      run,
      'browse_search',
      { action: 'global', scope: 'groups', search: 'x', per_page: 2, ...ordering },
      groupPolicy,
    )) as { results: Array<{ id: number }> };

    expect(result.results.map((group) => group.id)).toEqual(ids);
  });

  // The namespace listing carries no update time, so that order cannot be reproduced.
  it('marks a search of groups ordered by update time partial', async () => {
    const run = jest.fn().mockResolvedValue([{ id: 3, kind: 'group', full_path: 'team/a' }]);

    await expect(
      executeScoped(
        run,
        'browse_search',
        { action: 'global', scope: 'groups', search: 'x', order_by: 'updated_at' },
        groupPolicy,
      ),
    ).resolves.toMatchObject({ partial: true, message: expect.stringContaining('updated_at') });
  });

  // Naming the scope group itself reads the same group feed, subgroups included.
  it('keeps a vulnerability listing of the scope group to its direct projects', async () => {
    const run = jest.fn().mockResolvedValue({
      nodes: [
        { id: 1, project: { fullPath: 'team/app' } },
        { id: 2, project: { fullPath: 'team/sub/x' } },
      ],
      pageInfo: {},
    });

    const result = await executeScoped(
      run,
      'browse_vulnerabilities',
      { action: 'list', group_id: 'team' },
      groupOnlyPolicy,
    );

    expect(result).toEqual({ nodes: [{ id: 1, project: { fullPath: 'team/app' } }], pageInfo: {} });
  });

  // The scope reads the call as the tool reads it: a string boolean is the boolean it names,
  // and an invalid page is refused instead of read as the first one.
  it('reads a string include_subgroups as the tool does', async () => {
    const run = jest.fn().mockResolvedValue([]);

    await executeScoped(
      run,
      'browse_projects',
      { action: 'list', include_subgroups: 'false' },
      groupPolicy,
    );

    expect(run.mock.calls[0][1]).toMatchObject({ group_id: 'team', include_subgroups: false });
  });

  it('refuses an invalid page before any request', async () => {
    const run = jest.fn().mockResolvedValue([]);

    await expect(
      executeScoped(run, 'browse_projects', { action: 'search', page: 0 }, groupPolicy),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails a project scope listing on a failure that is not an Error', async () => {
    const run = jest.fn().mockRejectedValue('connection reset');

    await expect(
      executeScoped(run, 'browse_projects', { action: 'list' }, projectPolicy),
    ).rejects.toBe('connection reset');
  });
});
