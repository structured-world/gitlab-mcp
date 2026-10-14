/**
 * Feeds GitLab offers only wider than the working scope, kept to it: the rows of a group
 * without its subgroups and the caller's own runners the scope can use.
 */

import {
  directGroup,
  directGroupSearchRows,
  keepNodes,
  ownedRunnersInScope,
} from '../../../src/configuration/scoped-feeds';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';

const groupOnly = new ScopeEnforcer({ group: 'team', includeSubgroups: false });

describe('directGroup', () => {
  it.each([
    [{ group: 'team', includeSubgroups: false }, 'team'],
    [{ group: 'team', includeSubgroups: true }, undefined],
    [{ group: 'team' }, undefined],
    [{ project: 'team/app' }, undefined],
    [{ groups: ['team'], includeSubgroups: false }, 'team'],
    [{ groups: ['team', 'ops'], includeSubgroups: false }, undefined],
    // A namespace always covers its subgroups.
    [{ namespace: 'team', includeSubgroups: false }, undefined],
    [{ group: 'team', project: 'other/app', includeSubgroups: false }, undefined],
  ])('reads %j as the direct group %s', (scope, expected) => {
    expect(directGroup(scope)).toBe(expected);
  });
});

describe('directGroupSearchRows', () => {
  // The group listing pages through its projects; projects shared into the group from other
  // namespaces, and rows without a path, are not its own.
  it('keeps the rows of the group own projects across listing pages', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: 100 + i,
      path_with_namespace: `team/p${i}`,
    }));
    const run = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'browse_namespaces') return { id: 10 };
      if (args.page === 1) return full;
      return [
        { id: 7, path_with_namespace: 'other/shared' },
        { id: 8 },
        { id: 9, path_with_namespace: 'team/last' },
      ];
    });

    const { keep, complete } = await directGroupSearchRows(run, 'team', 'issues', groupOnly, {
      requests: 0,
    });

    expect(complete).toBe(true);
    expect(
      keep([
        { project_id: 150 },
        { project_id: 9 },
        { project_id: 7 },
        { project_id: 8 },
        { project_id: null, group_id: 10 },
        { title: 'no place' },
      ]),
    ).toEqual([{ project_id: 150 }, { project_id: 9 }, { project_id: null, group_id: 10 }]);
  });

  // Groups found by a group search are kept by their own path: the group itself, not its
  // subgroups.
  it('keeps the groups of a group search by their path', async () => {
    const run = jest.fn();

    const { keep, complete } = await directGroupSearchRows(run, 'team', 'groups', groupOnly, {
      requests: 0,
    });

    expect(complete).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(keep([{ full_path: 'team' }, { full_path: 'team/sub' }, { name: 'no path' }])).toEqual([
      { full_path: 'team' },
    ]);
  });

  // The group's projects are unknown, so the answer cannot claim to be complete.
  it('keeps no project rows, and says so, when the group listing is not a list', async () => {
    const run = jest.fn(async (tool: string) =>
      tool === 'browse_namespaces' ? { id: 10 } : { message: 'not a list' },
    );

    const { keep, complete } = await directGroupSearchRows(run, 'team', 'blobs', groupOnly, {
      requests: 0,
    });

    expect(complete).toBe(false);
    expect(keep([{ project_id: 1 }, { group_id: 10 }])).toEqual([{ group_id: 10 }]);
  });
});

describe('keepNodes', () => {
  it('passes on a result that is not a connection', () => {
    const result = { message: 'not a connection' };

    expect(keepNodes(result, () => false)).toBe(result);
  });
});

describe('ownedRunnersInScope', () => {
  // The group's runners are read through their cursor; the owned feed keeps its own.
  it('keeps the owned runners a scope group can use, over several pages of its runners', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => {
      if (args.action === 'list_owned') {
        return { nodes: [{ id: 1 }, { id: 2 }, { id: 3 }], pageInfo: { hasNextPage: false } };
      }
      return args.after === undefined
        ? { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'next' } }
        : { nodes: [{ id: 3 }], pageInfo: { hasNextPage: false, endCursor: null } };
    });

    const result = await ownedRunnersInScope(run, { action: 'list_owned' }, { group: 'team' });

    expect(run).toHaveBeenCalledWith('browse_runners', {
      action: 'list_group',
      group_id: 'team',
      first: 100,
      after: 'next',
    });
    expect(result).toEqual({ nodes: [{ id: 1 }, { id: 3 }], pageInfo: { hasNextPage: false } });
  });

  // The scope's runners are read up to a bound; an owned runner past it would be dropped, so
  // the answer says it is partial instead of looking complete.
  it('marks the owned runners partial when the scope has more runners than are read', async () => {
    let next = 0;
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) => {
      if (args.action === 'list_owned') return { nodes: [{ id: 0 }], pageInfo: {} };
      const nodes = Array.from({ length: 100 }, () => ({ id: next++ }));
      return { nodes, pageInfo: { hasNextPage: true, endCursor: String(next) } };
    });

    const result = await ownedRunnersInScope(
      run,
      { action: 'list_owned' },
      { project: 'team/app' },
    );

    expect(result).toEqual({
      nodes: [{ id: 0 }],
      pageInfo: {},
      partial: true,
      message:
        "Runners are kept to the first 1000 runners the scope's project or group can use; your runners beyond them are not shown.",
    });
  });

  // Before GitLab 18.3 the owned runners come from REST with numeric IDs, while the scope's
  // runners come from GraphQL with string IDs; the same runner matches either way.
  it('matches owned runners with numeric IDs against the string IDs of the scope', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.action === 'list_owned'
        ? { nodes: [{ id: 7 }, { id: 8 }], pageInfo: { hasNextPage: false } }
        : { nodes: [{ id: '7' }], pageInfo: { hasNextPage: false } },
    );

    expect(
      await ownedRunnersInScope(run, { action: 'list_owned' }, { project: 'team/app' }),
    ).toEqual({ nodes: [{ id: 7 }], pageInfo: { hasNextPage: false } });
  });

  it('keeps no owned runner when the scope runners come back without nodes', async () => {
    const run = jest.fn(async (_tool: string, args: Record<string, unknown>) =>
      args.action === 'list_owned' ? { nodes: [{ id: 1 }] } : undefined,
    );

    expect(
      await ownedRunnersInScope(run, { action: 'list_owned' }, { project: 'team/app' }),
    ).toEqual({
      nodes: [],
    });
  });
});
