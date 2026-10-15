/**
 * Project and merge request listings composed from a scope's targets: which calls are
 * composed, how each target is read within one request bound, and how the merge is ordered,
 * deduplicated, paged and marked partial.
 */
import {
  isComposedListing,
  multiTargetListing,
  orderRows,
} from '../../../src/configuration/composed-listings';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';

type Args = Record<string, unknown>;

const project = (id: number, path: string, extra: Args = {}) => ({
  id,
  path_with_namespace: path,
  created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`,
  ...extra,
});
const mergeRequest = (id: number, path: string, extra: Args = {}) => ({
  id,
  references: { full: `${path}!${id}` },
  created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`,
  ...extra,
});
const compose = (tool: string, requested: Args, scope: Args, run: jest.Mock) =>
  multiTargetListing(run, tool, requested, scope, new ScopeEnforcer(scope));

describe('isComposedListing', () => {
  // Only targetless listings are composed; a call naming its place runs as itself.
  it.each([
    ['browse_projects', { action: 'list' }, true],
    ['browse_projects', { action: 'get', project_id: 'a/b' }, false],
    ['browse_projects', { action: 'list', group_id: 'team' }, false],
    ['browse_merge_requests', { action: 'list' }, true],
    ['browse_merge_requests', { action: 'list', group_id: 'team' }, false],
    ['browse_merge_requests', { action: 'list', project_id: 'a/b' }, false],
    ['browse_issues', { action: 'list' }, false],
  ])('composes %s %j: %s', (tool, requested, expected) => {
    expect(isComposedListing(tool, requested, { groups: ['team', 'other'] })).toBe(expected);
  });

  // A project of the scope is read on its own and applies only search, simple and ordering;
  // with other options such a scope keeps the filtered listing, a scope of groups does not.
  it('composes a project listing with other options only when no project needs reading', () => {
    const requested = { action: 'list', owned: true };
    expect(isComposedListing('browse_projects', requested, { groups: ['team', 'other'] })).toBe(
      true,
    );
    expect(
      isComposedListing('browse_projects', requested, { project: 'solo/app', groups: ['team'] }),
    ).toBe(false);
  });
});

describe('multiTargetListing', () => {
  // A page past the rows a call may read is answered without a request.
  it('answers a page past the read bound without asking GitLab', async () => {
    const run = jest.fn();

    const result = await compose(
      'browse_projects',
      { action: 'list', page: 51, per_page: 20 },
      { groups: ['team', 'other'] },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], partial: true });
  });

  // An answer GitLab gave that is not a list (an error payload) is passed on as it came.
  it.each([
    ['a group', { groups: ['team', 'other'] }],
    ['a project', { projects: ['team/a', 'other/b'] }],
  ])('passes on a non-list answer of %s', async (_, scope) => {
    const run = jest.fn().mockResolvedValue({ message: '403 Forbidden' });

    expect(await compose('browse_merge_requests', { action: 'list' }, scope, run)).toEqual({
      message: '403 Forbidden',
    });
  });

  // A target named twice is read once, and a row listed by two targets (a project named on
  // its own and through its group) is kept once; rows without an ID are told apart whole.
  it('reads each target once and keeps each row once', async () => {
    const shared = mergeRequest(1, 'team/a');
    const unnumbered = { references: { full: 'team/a!9' }, created_at: '2026-01-09T00:00:00Z' };
    const run = jest.fn(async (_tool: string, args: Args) =>
      args.group_id === 'team' ? [shared, unnumbered] : [shared],
    );

    const result = await compose(
      'browse_merge_requests',
      { action: 'list' },
      { groups: ['team', 'team'], project: 'team/a' },
      run,
    );

    expect(run).toHaveBeenCalledTimes(2);
    expect(result).toEqual([unnumbered, shared]);
  });

  // A target is read only as far as the page needs: a full GitLab page is followed by the
  // next one until the target ends or holds enough rows.
  it('reads further pages of a target until it holds the page', async () => {
    const run = jest.fn(async (_tool: string, args: Args) => {
      if (args.group_id !== 'team') return [];
      const page = args.page as number;
      const size = page === 1 ? 100 : 5;
      return Array.from({ length: size }, (_, i) =>
        mergeRequest(page * 1000 + i, 'team/a', { created_at: '2026-01-01T00:00:00Z' }),
      );
    });

    const result = (await compose(
      'browse_merge_requests',
      { action: 'list', per_page: 100, page: 2 },
      { groups: ['team', 'other'] },
      run,
    )) as unknown[];

    expect(run.mock.calls.filter(([, args]) => args.group_id === 'team')).toHaveLength(2);
    expect(result).toHaveLength(5);
  });

  // The ten requests are shared by all targets; a page the bound left unread is marked
  // partial instead of looking complete, whether a listing or a project read hit the bound.
  it.each([
    ['a group listing', { groups: ['team', 'other'] }],
    ['a project read', { projects: Array.from({ length: 11 }, (_, i) => `solo/p${i}`) }],
  ])('marks the page partial when the request bound stops %s', async (_, scope) => {
    let next = 0;
    const run = jest.fn(async (_tool: string, args: Args) =>
      args.action === 'get'
        ? { ...project(++next, String(args.project_id)), archived: false }
        : Array.from({ length: 100 }, () => project(++next, `team/p${next}`)),
    );

    const result = await compose(
      'browse_projects',
      { action: 'list', per_page: 100, page: 10 },
      scope,
      run,
    );

    expect(run).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({
      partial: true,
      message: expect.stringContaining('at most 10 requests'),
    });
  });

  // A project of the scope answers a project listing itself: when its name, path or
  // description holds the search, in the simple representation unless simple is false.
  it.each([
    [{ search: 'APP' }, ['solo/app']],
    [{ search: 'nothing' }, []],
  ])('lists a scope project matching %j', async (filters, paths) => {
    const run = jest.fn(async (_tool: string, args: Args) =>
      args.action === 'get' ? { ...project(5, 'solo/app'), name: 'App', archived: false } : [],
    );

    const result = (await compose(
      'browse_projects',
      { action: 'list', ...filters },
      { project: 'solo/app', groups: ['team'] },
      run,
    )) as Array<{ path_with_namespace: string }>;

    expect(result.map((row) => row.path_with_namespace)).toEqual(paths);
  });

  it('returns a scope project in full with simple false', async () => {
    const full = { ...project(5, 'solo/app'), archived: false, permissions: {} };
    const run = jest.fn(async (_tool: string, args: Args) => (args.action === 'get' ? full : []));

    const result = await compose(
      'browse_projects',
      { action: 'list', simple: false },
      { project: 'solo/app', groups: ['team'] },
      run,
    );

    expect(result).toEqual([full]);
  });

  // Rows without the field the listing is ordered by cannot be merged in order: they keep
  // target order, and the page says so.
  it('keeps target order when GitLab omits the ordering field', async () => {
    const run = jest.fn(async (_tool: string, args: Args) =>
      args.project_id === 'team/a'
        ? [{ id: 1, references: { full: 'team/a!1' } }]
        : [mergeRequest(2, 'other/b')],
    );

    const result = await compose(
      'browse_merge_requests',
      { action: 'list' },
      { projects: ['team/a', 'other/b'] },
      run,
    );

    expect(result).toMatchObject({
      items: [{ id: 1 }, { id: 2 }],
      partial: true,
      message: expect.stringContaining('omitted the created_at'),
    });
  });
});

describe('orderRows', () => {
  // Projects are ordered by ID numerically and by name as text, in the direction asked;
  // equal names are ordered by ID the same way.
  it.each([
    ['id', 1, [1, 2, 3]],
    ['name', -1, [3, 2, 1]],
    ['name', 1, [1, 2, 3]],
  ])('orders by %s in direction %d', (field, direction, ids) => {
    const rows = [
      { id: 2, name: 'a' },
      { id: 3, name: 'b' },
      { id: 1, name: 'a' },
    ];

    expect(orderRows(rows, { field, direction })?.map((row) => row.id)).toEqual(ids);
  });

  // A row without a usable value cannot be placed: an ID that is not a number, a name that
  // is not text.
  it.each([
    ['id', { id: '7' }],
    ['name', { id: 1, name: 7 }],
  ])('cannot order by %s when a row lacks it', (field, row) => {
    expect(orderRows([row, { id: 2, name: 'b' }], { field, direction: 1 })).toBeUndefined();
  });
});
