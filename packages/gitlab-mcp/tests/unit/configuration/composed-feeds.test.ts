/** Composition preserves provenance and cursors while bounding aggregate upstream work. */
import {
  scanScopeConnections,
  multiTargetRunners,
  multiTargetSearch,
  multiTargetVulnerabilities,
  scopeAuditEvents,
  scopeProjectSnippets,
  scopeSnippetTitleSearch,
} from '../../../src/configuration/composed-feeds';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { createHash } from 'node:crypto';

const scope = { projects: ['team/a', 'team/b'] };
const enforcer = new ScopeEnforcer(scope);
const connection = (nodes: unknown[], hasNextPage = false, endCursor: unknown = null) => ({
  nodes,
  pageInfo: { hasNextPage, endCursor },
});
const vulnerability = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  severity: 'LOW',
  project: { fullPath: 'team/a' },
  ...extra,
});

describe('composed scope feeds', () => {
  // Wide sorting must normalize each timestamp once, not once per comparison.
  it('normalizes at most 1000 timestamps within the aggregate page budget', async () => {
    let page = 0;
    const run = jest.fn(async () =>
      connection(
        Array.from({ length: 100 }, (_, i) =>
          vulnerability(String(page * 100 + i + 1), {
            detectedAt: new Date(Date.UTC(2024, 0, 1) + (page * 100 + i) * 1000).toISOString(),
          }),
        ),
        true,
        String(++page),
      ),
    );
    const parse = jest.spyOn(Date, 'parse');
    try {
      const result = (await multiTargetVulnerabilities(
        run,
        { action: 'list', sort: 'detected_desc', first: 100 },
        scope,
        enforcer,
      )) as { nodes: unknown[]; partial: boolean };
      expect(result.nodes).toHaveLength(100);
      expect(result.partial).toBe(true);
      expect(run).toHaveBeenCalledTimes(10);
      expect(parse).toHaveBeenCalledTimes(1000);
    } finally {
      parse.mockRestore();
    }
  });
  // A wide preset costs at most ten requests in total, even when every target is empty.
  it('bounds all targets and deduplicates repeated target declarations', async () => {
    const run = jest.fn().mockResolvedValue(connection([]));
    const wide = {
      project: 'team/a',
      projects: ['team/a', ...Array.from({ length: 11 }, (_, i) => `team/p${i}`)],
      group: 'team',
      groups: ['team'],
      namespace: 'team',
    };
    expect(await scanScopeConnections(run, 'browse_runners', {}, wide, jest.fn())).toEqual({
      complete: false,
    });
    expect(run).toHaveBeenCalledTimes(10);
    const mixed = {
      project: 'team/a',
      projects: ['team/a'],
      group: 'team',
      groups: ['team'],
      namespace: 'team',
    };
    run.mockClear();
    expect(await scanScopeConnections(run, 'browse_runners', {}, mixed, jest.fn())).toEqual({
      complete: true,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('browse_runners', {
      action: 'list_group',
      group_id: 'team',
      first: 100,
    });
  });

  // Availability cursors are independent of the requested feed's cursor.
  it('walks target pages with their own cursor and reports missing or repeated cursors', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(connection([{ id: 1 }], true, 'next'))
      .mockResolvedValueOnce(connection([{ id: 2 }], true, 'next'));
    const visit = jest.fn();
    expect(
      await scanScopeConnections(
        run,
        'browse_runners',
        { action: 'list_owned', after: 'owned', first: 1 },
        { group: 'team' },
        visit,
      ),
    ).toEqual({ complete: false });
    expect(run.mock.calls[1][1]).toEqual({
      action: 'list_group',
      group_id: 'team',
      first: 100,
      after: 'next',
    });
    expect(visit).toHaveBeenCalledTimes(2);
  });

  // Bad response shapes and permission failures must not masquerade as a complete empty listing.
  it('preserves an upstream error-shaped result and propagates thrown errors', async () => {
    const answer = { error: 'unavailable' };
    const run = jest.fn().mockResolvedValue(answer);
    expect(await scanScopeConnections(run, 'browse_runners', {}, scope, jest.fn())).toEqual({
      complete: false,
      answer,
    });
    run.mockRejectedValueOnce(new Error('401 unauthorized'));
    await expect(scanScopeConnections(run, 'browse_runners', {}, scope, jest.fn())).rejects.toThrow(
      '401 unauthorized',
    );
    run.mockResolvedValueOnce({ nodes: [] });
    expect(await scanScopeConnections(run, 'browse_runners', {}, {}, jest.fn())).toEqual({
      complete: true,
    });
    expect(
      await scanScopeConnections(run, 'browse_runners', {}, { project: 'team/a' }, jest.fn()),
    ).toEqual({ complete: true });
  });

  // Never let a server response multiply the advertised page-work bound.
  it('rejects an oversized connection before processing its rows', async () => {
    const run = jest
      .fn()
      .mockResolvedValue(connection(Array.from({ length: 101 }, (_, id) => ({ id }))));
    const visit = jest.fn();
    await expect(scanScopeConnections(run, 'browse_runners', {}, scope, visit)).rejects.toThrow(
      'oversized',
    );
    expect(visit).not.toHaveBeenCalled();
  });

  // Exhausting the union scan must preserve the original native cursor and signal omissions.
  it('marks runner intersections partial at the shared page bound', async () => {
    let page = 0;
    const run = jest.fn(async (_tool, args) =>
      args.action === 'list_owned'
        ? connection([{ id: 1 }, { id: 99 }], true, 'owned-next')
        : connection([{ id: 1 }, {}], true, String(++page)),
    );
    expect(await multiTargetRunners(run, { action: 'list_owned' }, scope)).toMatchObject({
      nodes: [{ id: 1 }],
      partial: true,
      pageInfo: { endCursor: 'owned-next' },
    });
    expect(run).toHaveBeenCalledTimes(11);
  });

  // Native error shapes must survive both the feed and availability paths.
  it('retains non-connection answers from runner feeds', async () => {
    const answer = { error: 'unavailable' };
    const run = jest.fn().mockResolvedValue(answer);
    expect(await multiTargetRunners(run, { action: 'list_owned' }, scope)).toBe(answer);
    run.mockImplementation(async (_tool, args) =>
      args.action === 'list_owned' ? answer : connection([], true, null),
    );
    expect(await multiTargetRunners(run, { action: 'list_owned' }, scope)).toBe(answer);
  });

  // All runners of several targets: a foreign cursor asks GitLab nothing, runners without a
  // numeric ID keep target order, a cut-off scan says so, and an error is passed on.
  it('reports composed runner listings it cannot reach, order or finish', async () => {
    const idle = jest.fn();
    await expect(
      multiTargetRunners(idle, { action: 'list_all', after: 'other:1' }, scope),
    ).rejects.toThrow('Invalid composed runner cursor');
    const hash = createHash('sha256')
      .update(JSON.stringify(scope))
      .update(JSON.stringify({ action: 'list_all' }))
      .digest('hex');
    expect(
      await multiTargetRunners(idle, { action: 'list_all', after: `scope:${hash}:1000` }, scope),
    ).toMatchObject({ nodes: [], partial: true });
    expect(idle).not.toHaveBeenCalled();

    const unnumbered = jest.fn().mockResolvedValue(connection([{ id: 'gid' }, { id: '3' }]));
    expect(await multiTargetRunners(unnumbered, { action: 'list_all' }, scope)).toMatchObject({
      nodes: [{ id: 'gid' }, { id: '3' }],
      partial: true,
      message: expect.stringContaining('IDs'),
    });

    let page = 0;
    const endless = jest.fn(async () => connection([{ id: String(++page) }], true, String(page)));
    expect(await multiTargetRunners(endless, { action: 'list_all' }, scope)).toMatchObject({
      partial: true,
      message: expect.stringContaining('ten connection requests'),
    });

    const answer = { error: 'forbidden' };
    const failing = jest.fn().mockResolvedValue(answer);
    expect(await multiTargetRunners(failing, { action: 'list_all' }, scope)).toBe(answer);
  });

  // Sort values are normalized once; enum priorities and timestamp offsets must be respected.
  it.each([
    ['severity_asc', { severity: 'INFO' }, { severity: 'UNKNOWN' }],
    ['state_desc', { state: 'CONFIRMED' }, { state: 'DETECTED' }],
    ['title_asc', { title: 'a' }, { title: 'z' }],
    [
      'detected_asc',
      { detectedAt: '2024-01-01T02:00:00+03:00' },
      { detectedAt: '2024-01-01T00:00:00Z' },
    ],
  ])('sorts %s across targets before pagination', async (sort, first, second) => {
    const a = vulnerability('10', first),
      b = vulnerability('2', second);
    const run = jest.fn(async (_tool, args) =>
      connection(args.project_id === 'team/a' ? [b, a] : [a]),
    );
    expect(
      await multiTargetVulnerabilities(run, { action: 'list', sort, first: 1 }, scope, enforcer),
    ).toMatchObject({ nodes: [a], pageInfo: { hasNextPage: true } });
  });

  // Equal keys must compare IDs numerically without losing precision or returning duplicates.
  it('orders equal keys by exact numeric ID descending', async () => {
    const nodes = ['9', '10', '9007199254740993', '9007199254740992'].map((id) =>
      vulnerability(id),
    );
    const run = jest.fn().mockResolvedValue(connection(nodes));
    expect(await multiTargetVulnerabilities(run, { action: 'list' }, scope, enforcer)).toEqual({
      nodes: [nodes[2], nodes[3], nodes[1], nodes[0]],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  // A continuation may not be reused after scope/filter changes, and malformed input makes no request.
  it('rejects malformed or mismatched composed cursors before GitLab access', async () => {
    const run = jest.fn().mockResolvedValue(connection([vulnerability('1'), vulnerability('2')]));
    const first = (await multiTargetVulnerabilities(
      run,
      { action: 'list', first: 1 },
      scope,
      enforcer,
    )) as { pageInfo: { endCursor: string } };
    run.mockClear();
    for (const after of ['garbage', first.pageInfo.endCursor, 'x'.repeat(200)]) {
      await expect(
        multiTargetVulnerabilities(
          run,
          { action: 'list', severity: ['HIGH'], after },
          scope,
          enforcer,
        ),
      ).rejects.toThrow('cursor');
    }
    expect(run).not.toHaveBeenCalled();
  });

  // A cursor beyond the scan bound cannot cause a costly rescan or imply completeness.
  it('returns a partial empty page beyond the row bound without requesting GitLab', async () => {
    const filters = { action: 'list' };
    const hash = createHash('sha256')
      .update(JSON.stringify(scope))
      .update(JSON.stringify(filters))
      .digest('hex');
    const run = jest.fn();
    expect(
      await multiTargetVulnerabilities(
        run,
        { ...filters, after: `scope:${hash}:1000` },
        scope,
        enforcer,
      ),
    ).toMatchObject({ nodes: [], partial: true });
    expect(run).not.toHaveBeenCalled();
  });

  // Several targets answer an instance audit listing as one trail, newest first, paged after
  // the merge, with each target read only as far as the page needs.
  it('merges the audit trails of several targets newest first before paging', async () => {
    const event = (id: number, day: string) => ({ id, created_at: `2026-01-0${day}T00:00:00Z` });
    const run = jest.fn(async (_tool, args) =>
      args.project_id === 'team/a' ? [event(3, '3'), event(1, '1')] : [event(2, '2')],
    );
    expect(
      await scopeAuditEvents(
        run,
        { action: 'list_instance', created_after: '2026-01-01', page: 1, per_page: 2 },
        scope,
        enforcer,
      ),
    ).toEqual([event(3, '3'), event(2, '2')]);
    expect(run).toHaveBeenCalledWith('browse_audit_events', {
      action: 'list_project',
      project_id: 'team/a',
      created_after: '2026-01-01',
      page: 1,
      per_page: 100,
    });
    expect(
      await scopeAuditEvents(
        run,
        { action: 'list_instance', page: 2, per_page: 2 },
        scope,
        enforcer,
      ),
    ).toEqual([event(1, '1')]);
  });

  // A group is read with its projects: a project named both by the scope and through its
  // group is read once, and a group without subgroups gives a complete page.
  it('reads a group trail with its projects, each place once', async () => {
    const mixed = { project: 'ops/app', groups: ['ops'], includeSubgroups: false };
    const run = jest.fn(async (tool: string, _args: Record<string, unknown>) =>
      tool === 'browse_projects' ? [{ path_with_namespace: 'OPS/App' }] : [],
    );
    expect(
      await scopeAuditEvents(run, { action: 'list_instance' }, mixed, new ScopeEnforcer(mixed)),
    ).toEqual([]);
    expect(run.mock.calls.map(([, args]) => args.project_id ?? args.group_id)).toEqual([
      'ops/app',
      'ops',
      'ops',
    ]);
  });

  // A preset may name a group URL-encoded, as tools accept it. The group is read by its path,
  // and its listed projects, named by path, are read too.
  it('reads the projects of a group the scope names URL-encoded', async () => {
    const encoded = { group: 'parent%2Fteam' };
    const run = jest.fn(async (tool: string, _args: Record<string, unknown>) =>
      tool === 'browse_projects' ? [{ path_with_namespace: 'parent/team/app' }] : [],
    );
    await scopeAuditEvents(run, { action: 'list_instance' }, encoded, new ScopeEnforcer(encoded));
    expect(run.mock.calls.map(([, args]) => args.project_id ?? args.group_id)).toEqual([
      'parent/team',
      'parent/team',
      'parent/team/app',
    ]);
  });

  // The group project listings share one page bound; a group listed only in part says so.
  it('marks the trails partial when the group project listing is cut off', async () => {
    let page = 0;
    const wide = { group: 'ops', includeSubgroups: false };
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_projects'
        ? Array.from({ length: 100 }, (_, i) => ({ path_with_namespace: `ops/p${page++}-${i}` }))
        : [],
    );
    const result = await scopeAuditEvents(
      run,
      { action: 'list_instance' },
      wide,
      new ScopeEnforcer(wide),
    );
    // Each trail costs a request, so the read bound stops it before the listing bound.
    expect(result).toMatchObject({ items: [], partial: true });
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_audit_events')).toHaveLength(10);
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_projects')).toHaveLength(1);
  });

  // A failing group project listing is passed on rather than read as a group without projects.
  it('passes on a group project listing that is not a list', async () => {
    const answer = { error: 'forbidden' };
    const group = { group: 'ops' };
    const run = jest.fn(async (tool: string) => (tool === 'browse_projects' ? answer : []));
    expect(
      await scopeAuditEvents(run, { action: 'list_instance' }, group, new ScopeEnforcer(group)),
    ).toBe(answer);
  });

  // Snippets merge newest (highest ID) first; one without an ID keeps project order and says so.
  it('merges project snippets by ID and reports snippets it cannot order', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.projectId === 'team/a' ? [{ id: 1 }, { id: 1 }] : [{ id: 2 }],
    );
    expect(
      await scopeProjectSnippets(run, { action: 'list', scope: 'project' }, scope, enforcer),
    ).toEqual([{ id: 2 }, { id: 1 }]);
    const unnumbered = jest.fn().mockResolvedValue([{ title: 'no id' }]);
    expect(
      await scopeProjectSnippets(unnumbered, { action: 'list', scope: 'project' }, scope, enforcer),
    ).toMatchObject({ partial: true, message: expect.stringContaining('ID') });
    const idle = jest.fn();
    expect(
      await scopeProjectSnippets(
        idle,
        { action: 'list', scope: 'project', page: 11, per_page: 100 },
        scope,
        enforcer,
      ),
    ).toMatchObject({ items: [], partial: true });
    expect(idle).not.toHaveBeenCalled();
  });

  // A snippet title search passes on a failed listing, answers a page past the read bound
  // without asking GitLab, and says when snippets lack the time it orders them by.
  it('reports snippet title searches it cannot read, reach or order', async () => {
    const search = { action: 'global', scope: 'snippet_titles', search: 'deploy' };
    const answer = { error: 'forbidden' };
    expect(
      await scopeSnippetTitleSearch(jest.fn().mockResolvedValue(answer), search, scope, enforcer),
    ).toBe(answer);
    const idle = jest.fn();
    expect(
      await scopeSnippetTitleSearch(idle, { ...search, page: 11, per_page: 100 }, scope, enforcer),
    ).toMatchObject({ items: [], partial: true });
    expect(idle).not.toHaveBeenCalled();
    const undated = jest.fn(async (_tool: string, args: Record<string, unknown>) => [
      { id: args.projectId === 'team/a' ? 1 : 2, title: 'deploy' },
    ]);
    expect(await scopeSnippetTitleSearch(undated, search, scope, enforcer)).toMatchObject({
      items: [{ id: 1 }, { id: 2 }],
      partial: true,
      message: expect.stringContaining('updated_at'),
    });
  });

  // An entity filter naming a user namespace finds no group trail; a lookup failure other
  // than not found fails the call rather than reading as an empty trail.
  it('finds no group trail for a user namespace and passes on lookup failures', async () => {
    const userNamespace = jest.fn().mockResolvedValue({ id: 7, full_path: 'team', kind: 'user' });
    expect(
      await scopeAuditEvents(
        userNamespace,
        { action: 'list_instance', entity_type: 'Group', entity_id: 7 },
        scope,
        enforcer,
      ),
    ).toEqual([]);
    expect(userNamespace).toHaveBeenCalledTimes(1);
    const failing = jest.fn().mockRejectedValue(new Error('GitLab API error: 500 Server Error'));
    await expect(
      scopeAuditEvents(
        failing,
        { action: 'list_instance', entity_type: 'Project', entity_id: 7 },
        scope,
        enforcer,
      ),
    ).rejects.toThrow('500');
  });

  // Full trails cost at most ten requests across the scope; the unread rest makes it partial.
  it('bounds audit trail reads across targets and marks the page partial', async () => {
    let id = 0;
    const run = jest.fn(async () =>
      Array.from({ length: 100 }, () => ({ id: ++id, created_at: '2026-01-01T00:00:00Z' })),
    );
    const result = (await scopeAuditEvents(
      run,
      { action: 'list_instance', page: 6, per_page: 100 },
      scope,
      enforcer,
    )) as { items: Array<{ id: number }>; partial: boolean };
    expect(run).toHaveBeenCalledTimes(10);
    expect(result.partial).toBe(true);
    expect(result.items).toHaveLength(100);
    // Equal timestamps keep the newest (highest) IDs first.
    expect(result.items[0].id).toBe(500);
  });

  // Error envelopes pass on; a page past the read bound and an unordered trail say so.
  it('passes on audit errors and reports pages it cannot order or reach', async () => {
    const answer = { error: 'forbidden' };
    expect(
      await scopeAuditEvents(
        jest.fn().mockResolvedValue(answer),
        { action: 'list_instance' },
        scope,
        enforcer,
      ),
    ).toBe(answer);
    const idle = jest.fn();
    expect(
      await scopeAuditEvents(
        idle,
        { action: 'list_instance', page: 11, per_page: 100 },
        scope,
        enforcer,
      ),
    ).toMatchObject({ items: [], partial: true });
    expect(idle).not.toHaveBeenCalled();
    expect(
      await scopeAuditEvents(
        jest.fn().mockResolvedValue([{ id: 1 }]),
        { action: 'list_instance' },
        scope,
        enforcer,
      ),
    ).toMatchObject({ partial: true, message: expect.stringContaining('created_at') });
  });

  // Bounded/malformed source data must be reported honestly rather than silently mis-sorted.
  it('marks incomplete scans and missing ordering fields partial', async () => {
    const run = jest.fn().mockResolvedValue(connection([vulnerability('1')], true, null));
    expect(
      await multiTargetVulnerabilities(run, { action: 'list' }, scope, enforcer),
    ).toMatchObject({ partial: true });
    run.mockResolvedValue(
      connection([vulnerability('1', { severity: null }), vulnerability('bad')]),
    );
    expect(
      await multiTargetVulnerabilities(run, { action: 'list' }, scope, enforcer),
    ).toMatchObject({
      nodes: [vulnerability('1', { severity: null })],
      partial: true,
      message: expect.stringContaining('ordering'),
    });
    run.mockResolvedValue(connection([vulnerability('1', { detectedAt: 'invalid' })]));
    expect(
      await multiTargetVulnerabilities(
        run,
        { action: 'list', sort: 'detected_desc' },
        scope,
        enforcer,
      ),
    ).toMatchObject({ partial: true });
    run.mockResolvedValue({ error: 'unavailable' });
    expect(await multiTargetVulnerabilities(run, { action: 'list' }, scope, enforcer)).toEqual({
      error: 'unavailable',
    });
    // A detection-time order with a vulnerability lacking detectedAt cannot be kept.
    run.mockResolvedValue(connection([vulnerability('1')]));
    expect(
      await multiTargetVulnerabilities(
        run,
        { action: 'list', sort: 'detected_desc' },
        scope,
        enforcer,
      ),
    ).toMatchObject({ partial: true });
  });

  // State follows GitLab's enum priorities and title its text, each in the requested direction.
  it.each([
    ['state_asc', 'state', ['DISMISSED', 'CONFIRMED'], ['2', '1']],
    ['title_desc', 'title', ['beta', 'alpha'], ['1', '2']],
  ])('orders vulnerabilities by %s', async (sort, field, values, expected) => {
    const run = jest
      .fn()
      .mockResolvedValue(
        connection([
          vulnerability('1', { [field]: values[1] }),
          vulnerability('2', { [field]: values[0] }),
        ]),
      );
    const result = (await multiTargetVulnerabilities(
      run,
      { action: 'list', sort },
      scope,
      enforcer,
    )) as { nodes: Array<{ id: string }> };
    expect(result.nodes.map(({ id }) => id)).toEqual(
      sort === 'state_asc' ? expected : [...expected].reverse(),
    );
  });

  // A vulnerability without the field it is ordered by cannot be placed: the page says so.
  it.each(['state_asc', 'title_desc'])(
    'reports vulnerabilities it cannot order by %s',
    async (sort) => {
      const run = jest.fn().mockResolvedValue(connection([vulnerability('1')]));
      expect(
        await multiTargetVulnerabilities(run, { action: 'list', sort }, scope, enforcer),
      ).toMatchObject({ partial: true });
    },
  );

  // A group-only entity filter reads only group trails. A scope naming a project or group
  // twice reads it once; a project only shared with the group is not one of its places; and a
  // group whose projects are listed past the page bound marks the trails partial.
  it('reads each place once and reports groups listed only in part', async () => {
    const wide = {
      project: 'other/x',
      projects: ['other/x'],
      groups: ['ops', 'ops'],
      includeSubgroups: false,
    };
    let next = 0;
    const run = jest.fn(async (tool: string, _args: Record<string, unknown>) =>
      tool === 'browse_projects'
        ? [
            { path_with_namespace: 'other/x' },
            ...Array.from({ length: 99 }, () => ({ path_with_namespace: `ops/p${next++}` })),
          ]
        : [],
    );
    const result = await scopeAuditEvents(
      run,
      { action: 'list_instance', entity_type: 'Group' },
      wide,
      new ScopeEnforcer(wide),
    );
    expect(result).toMatchObject({
      items: [],
      partial: true,
      message: expect.stringContaining('listed up to 1000'),
    });
    expect(run.mock.calls.filter(([tool]) => tool === 'browse_projects')).toHaveLength(10);
    expect(
      run.mock.calls.filter(([tool]) => tool === 'browse_audit_events').map(([, args]) => args),
    ).toEqual([expect.objectContaining({ action: 'list_group', group_id: 'ops' })]);
  });

  // A not-found lookup thrown as a plain value still reads as an entity GitLab does not know.
  it('finds no trail for an entity whose lookup answers 404 with a plain value', async () => {
    const run = jest.fn().mockRejectedValue('GitLab API error: 404 Not Found');
    expect(
      await scopeAuditEvents(
        run,
        { action: 'list_instance', entity_type: 'Project', entity_id: 7 },
        scope,
        enforcer,
      ),
    ).toEqual([]);
  });

  // A failing group project listing is passed on by the project snippet listing too.
  it('passes on a group project listing that is not a list for snippets', async () => {
    const answer = { error: 'forbidden' };
    const group = { group: 'ops' };
    const run = jest.fn(async (tool: string) => (tool === 'browse_projects' ? answer : []));
    expect(
      await scopeProjectSnippets(
        run,
        { action: 'list', scope: 'project' },
        group,
        new ScopeEnforcer(group),
      ),
    ).toBe(answer);
  });

  // A snippet title search without a search term, or only blanks, matches every snippet.
  it.each([[undefined], ['   ']])('matches every snippet for the search %j', async (search) => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => [
      { id: args.projectId === 'team/a' ? 1 : 2, updated_at: '2026-01-01T00:00:00Z' },
    ]);
    const result = (await scopeSnippetTitleSearch(
      run,
      { action: 'global', scope: 'snippet_titles', search },
      scope,
      enforcer,
    )) as Array<{ id: number }>;
    expect(result.map(({ id }) => id)).toEqual([2, 1]);
  });
});

describe('multiTargetSearch', () => {
  const search = (results: unknown[]) => ({ results });

  // Kinds with no order shared across targets keep target order and say so; rows without an
  // ID (code hits) are told apart by their content.
  it('keeps target order for results with no shared order', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      search([{ path: `${String(args.project_id)}.md`, data: 'x' }]),
    );
    expect(
      await multiTargetSearch(
        run,
        { action: 'global', scope: 'blobs', search: 'x' },
        scope,
        enforcer,
      ),
    ).toEqual({
      scope: 'blobs',
      count: 2,
      results: [
        { path: 'team/a.md', data: 'x' },
        { path: 'team/b.md', data: 'x' },
      ],
      partial: true,
      message: expect.stringContaining('no order shared'),
    });
  });

  // Issues order by creation time; results lacking it keep target order and say so, and an
  // ID that is not a number does not break the comparison.
  it('reports results it cannot order by time', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      search([{ id: args.project_id === 'team/a' ? 'a1' : 2 }]),
    );
    expect(
      await multiTargetSearch(
        run,
        { action: 'global', scope: 'issues', search: 'x' },
        scope,
        enforcer,
      ),
    ).toMatchObject({ count: 2, partial: true, message: expect.stringContaining('ordering time') });
  });

  // Equal creation times put the numbered ID first over one GitLab gave as text.
  it('orders equal times with a non-numeric ID last', async () => {
    const at = '2026-01-01T00:00:00Z';
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      search([{ id: args.project_id === 'team/a' ? 'a1' : 2, created_at: at }]),
    );
    const result = (await multiTargetSearch(
      run,
      { action: 'global', scope: 'issues', search: 'x' },
      scope,
      enforcer,
    )) as { results: Array<{ id: unknown }> };
    expect(result.results.map(({ id }) => id)).toEqual([2, 'a1']);
  });

  // Full pages are read on until the requested page holds its rows.
  it('reads further pages of a target to fill the page', async () => {
    let id = 0;
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      search(
        args.project_id === 'team/a' && args.page === 1
          ? Array.from({ length: 100 }, () => ({ id: ++id, updated_at: '2026-01-01T00:00:00Z' }))
          : [],
      ),
    );
    const result = (await multiTargetSearch(
      run,
      { action: 'global', scope: 'milestones', search: 'x', page: 2, per_page: 60 },
      scope,
      enforcer,
    )) as { count: number };
    expect(result.count).toBe(40);
    expect(run).toHaveBeenCalledWith('browse_search', expect.objectContaining({ page: 2 }));
  });

  // A target named twice is searched once.
  it('searches a repeated target once', async () => {
    const twice = { projects: ['team/a', 'team/a'] };
    const run = jest.fn(async () => search([{ id: 1, created_at: '2026-01-01T00:00:00Z' }]));
    await multiTargetSearch(
      run,
      { action: 'global', scope: 'issues', search: 'x' },
      twice,
      new ScopeEnforcer(twice),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  // A page past the read bound is answered without GitLab; a failed search is passed on.
  it('answers past the read bound and passes on a failed search', async () => {
    const idle = jest.fn();
    expect(
      await multiTargetSearch(
        idle,
        { action: 'global', scope: 'issues', search: 'x', page: 11, per_page: 100 },
        scope,
        enforcer,
      ),
    ).toMatchObject({ results: [], partial: true });
    expect(idle).not.toHaveBeenCalled();
    const answer = { error: 'forbidden' };
    expect(
      await multiTargetSearch(
        jest.fn().mockResolvedValue(answer),
        { action: 'global', scope: 'issues', search: 'x' },
        scope,
        enforcer,
      ),
    ).toBe(answer);
  });
});
