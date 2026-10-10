/**
 * Under a working scope, listing and search calls that name no project or group are
 * narrowed to it: the scope becomes the call's filter where the tool has one, otherwise
 * the results outside it are left out.
 */

import {
  scopedArgs,
  scopedResult,
  targetlessRestriction,
} from '../../../src/configuration/scope-targets';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';

const group = { group: 'team', includeSubgroups: true };
const groupOnly = { group: 'team', includeSubgroups: false };
const project = { project: 'team/app' };
const several = { projects: ['team/app', 'other/api'] };

describe('scopedArgs', () => {
  it.each([
    [group, { action: 'group', group_id: 'team', search: 'x', scope: 'issues' }],
    [project, { action: 'project', project_id: 'team/app', search: 'x', scope: 'issues' }],
  ])('turns a global search under %j into a search of the scope', (scope, expected) => {
    expect(
      scopedArgs('browse_search', { action: 'global', search: 'x', scope: 'issues' }, scope),
    ).toEqual(expected);
  });

  it.each([
    [group, { action: 'list', group_id: 'team', include_subgroups: true }],
    [groupOnly, { action: 'list', group_id: 'team', include_subgroups: false }],
  ])('lists the projects of the scope group %j', (scope, expected) => {
    expect(scopedArgs('browse_projects', { action: 'list' }, scope)).toEqual(expected);
  });

  // Without a namespace GitLab creates the project in the user's own namespace.
  it('creates a project without a namespace in the scope group', () => {
    expect(scopedArgs('manage_project', { action: 'create', name: 'app' }, group)).toEqual({
      action: 'create',
      name: 'app',
      namespace: 'team',
    });
  });

  it('lists the merge requests of the scope project', () => {
    expect(
      scopedArgs('browse_merge_requests', { action: 'list', state: 'opened' }, project),
    ).toEqual({ action: 'list', state: 'opened', project_id: 'team/app' });
  });

  // A call that names its target is checked against the scope, not rewritten.
  it.each([
    ['browse_projects', { action: 'list', group_id: 'team/sub' }, group],
    ['browse_merge_requests', { action: 'list', project_id: 'team/app' }, project],
    ['browse_search', { action: 'project', project_id: 'team/app' }, project],
    ['browse_projects', { action: 'list' }, project],
    ['browse_merge_requests', { action: 'list' }, group],
    ['browse_projects', { action: 'list' }, several],
    ['browse_projects', { action: 'list' }, { project: 'team/app', group: 'other' }],
    ['browse_issues', { action: 'list' }, group],
  ])('leaves %s %j under %j as it is', (tool, args, scope) => {
    expect(scopedArgs(tool, args, scope)).toBe(args);
  });
});

describe('targetlessRestriction', () => {
  // GitLab's group search always covers subgroups; results are not filterable by path.
  it('refuses a global search under a group scope that excludes subgroups', () => {
    expect(targetlessRestriction('browse_search', { action: 'global' }, groupOnly)).toMatch(
      /subgroups/,
    );
  });

  it('refuses a global search under a scope of several projects', () => {
    expect(targetlessRestriction('browse_search', { action: 'global' }, several)).toMatch(
      /search within one of them/,
    );
  });

  // A project with no namespace lands in the user's namespace, a group without a parent at
  // the top level: both outside a scope that names no single group to put them in.
  it.each([
    ['manage_project', { action: 'create', name: 'app' }, project],
    ['manage_project', { action: 'create', name: 'app' }, several],
    ['manage_namespace', { action: 'create', name: 'Team', path: 'team2' }, group],
  ])('refuses %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toMatch(/outside the working scope/);
  });

  it.each([
    ['browse_search', { action: 'global' }, group],
    ['browse_search', { action: 'group', group_id: 'team' }, several],
    ['browse_projects', { action: 'list' }, several],
    ['manage_project', { action: 'create', name: 'app' }, group],
    ['manage_project', { action: 'create', name: 'app', namespace: 'team/sub' }, project],
    ['manage_namespace', { action: 'create', name: 'Sub', path: 'sub', parent_id: 7 }, group],
  ])('allows %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toBeNull();
  });
});

describe('scopedResult', () => {
  const enforcer = new ScopeEnforcer(group);

  it('keeps only projects of the scope from a project search', () => {
    const found = [
      { path_with_namespace: 'team/app' },
      { path_with_namespace: 'other/api' },
      { name: 'no path' },
    ];

    expect(scopedResult('browse_projects', { action: 'search' }, found, enforcer)).toEqual([
      { path_with_namespace: 'team/app' },
    ]);
  });

  // A group's project listing also returns projects only shared with the group.
  it('leaves out projects shared into the scope group from other namespaces', () => {
    const listed = [{ path_with_namespace: 'team/app' }, { path_with_namespace: 'other/shared' }];

    expect(
      scopedResult('browse_projects', { action: 'list', group_id: 'team' }, listed, enforcer),
    ).toEqual([{ path_with_namespace: 'team/app' }]);
  });

  it('keeps only merge requests of the scope from a cross-project listing', () => {
    const mrs = [
      { iid: 1, references: { full: 'team/sub/app!1' } },
      { iid: 2, references: { full: 'other/api!2' } },
      { iid: 3 },
    ];

    expect(scopedResult('browse_merge_requests', { action: 'list' }, mrs, enforcer)).toEqual([
      { iid: 1, references: { full: 'team/sub/app!1' } },
    ]);
  });

  it('keeps only todos of projects and groups in the scope', () => {
    const todos = [
      { id: 1, project: { path_with_namespace: 'team/app' } },
      { id: 2, project: { path_with_namespace: 'other/api' } },
      { id: 3, group: { full_path: 'team/sub' } },
      { id: 4, group: { full_path: 'other' } },
      { id: 5 },
    ];

    expect(scopedResult('browse_todos', { action: 'list' }, todos, enforcer)).toEqual([
      { id: 1, project: { path_with_namespace: 'team/app' } },
      { id: 3, group: { full_path: 'team/sub' } },
    ]);
  });

  it.each([
    ['browse_merge_requests', { action: 'list', project_id: 'team/app' }],
    ['browse_todos', { action: 'list', project_id: 7 }],
    ['browse_issues', { action: 'list' }],
  ])('passes the results of %s %j through', (tool, args) => {
    const result = [{ path_with_namespace: 'other/api' }];

    expect(scopedResult(tool, args, result, enforcer)).toBe(result);
  });

  it('passes a result that is not a list through', () => {
    const result = { id: 1 };

    expect(scopedResult('browse_projects', { action: 'search' }, result, enforcer)).toBe(result);
  });
});
