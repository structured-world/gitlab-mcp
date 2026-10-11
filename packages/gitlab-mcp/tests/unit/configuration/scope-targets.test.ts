/**
 * Under a working scope, listing and search calls that name no project or group are
 * narrowed to it: the scope becomes the call's filter where the tool has one, otherwise
 * the results outside it are left out.
 */

import {
  isFilteredListing,
  scopedArgs,
  scopedResult,
  scopeProjectsOnly,
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

  // The caller's narrower choice stays; a scope without subgroups excludes them whatever
  // the caller asked, as the results outside it are filtered anyway.
  it.each([
    [group, false, false],
    [group, true, true],
    [groupOnly, true, false],
  ])('lists the scope group %j with subgroups %s as %s', (scope, requested, expected) => {
    expect(
      scopedArgs('browse_projects', { action: 'list', include_subgroups: requested }, scope),
    ).toEqual({ action: 'list', group_id: 'team', include_subgroups: expected });
  });

  // Without a namespace GitLab creates the project in the user's own namespace.
  it('creates a project without a namespace in the scope group', () => {
    expect(scopedArgs('manage_project', { action: 'create', name: 'app' }, group)).toEqual({
      action: 'create',
      name: 'app',
      namespace: 'team',
    });
  });

  // Without a target namespace GitLab forks into the user's own namespace.
  it('forks into the scope group when no target namespace is named', () => {
    expect(scopedArgs('manage_project', { action: 'fork', project_id: 'team/app' }, group)).toEqual(
      { action: 'fork', project_id: 'team/app', namespace_path: 'team' },
    );
  });

  // A vulnerability listing without a target is instance-wide.
  it.each([
    [group, { action: 'list', group_id: 'team' }],
    [project, { action: 'list', project_id: 'team/app' }],
  ])('lists the vulnerabilities of the scope %j', (scope, expected) => {
    expect(scopedArgs('browse_vulnerabilities', { action: 'list' }, scope)).toEqual(expected);
  });

  // The caller's own activity spans every project.
  it('shows the activity of the scope project instead of all activity', () => {
    expect(scopedArgs('browse_events', { action: 'user', sort: 'desc' }, project)).toEqual({
      action: 'project',
      project_id: 'team/app',
      sort: 'desc',
    });
  });

  // Instance-wide administrator listings read the scope's own project or group instead.
  it.each([
    [
      'browse_deploy_keys',
      { action: 'list', per_page: 5 },
      project,
      { action: 'list', per_page: 5, project_id: 'team/app' },
    ],
    [
      'browse_runners',
      { action: 'list_all', status: 'ONLINE' },
      project,
      { action: 'list_project', status: 'ONLINE', project_id: 'team/app' },
    ],
    [
      'browse_runners',
      { action: 'list_owned' },
      groupOnly,
      { action: 'list_group', group_id: 'team' },
    ],
    [
      'browse_audit_events',
      { action: 'list_instance', created_after: '2026-01-01' },
      project,
      { action: 'list_project', created_after: '2026-01-01', project_id: 'team/app' },
    ],
  ])('reads %s %j under %j as %j', (tool, args, scope, expected) => {
    expect(scopedArgs(tool, args, scope)).toEqual(expected);
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
    ['browse_vulnerabilities', { action: 'list', project_id: 'team/app' }, group],
    ['browse_vulnerabilities', { action: 'get', id: 'gid://x' }, group],
    ['manage_project', { action: 'create', name: 'app', namespace: 'team/sub' }, group],
    ['manage_project', { action: 'delete', project_id: 'team/app' }, group],
    ['manage_project', { action: 'create', name: 'app' }, project],
    ['browse_events', { action: 'project', project_id: 'team/app' }, project],
    ['browse_events', { action: 'user' }, group],
    ['browse_deploy_keys', { action: 'list', project_id: 'team/app' }, project],
    ['browse_deploy_keys', { action: 'list', public: true }, project],
    ['browse_deploy_keys', { action: 'list' }, group],
    ['browse_runners', { action: 'list_project', project_id: 'team/app' }, project],
    ['browse_audit_events', { action: 'list_group', group_id: 'team' }, project],
    ['browse_audit_events', { action: 'list_instance' }, group],
    ['browse_audit_events', { action: 'list_instance', entity_type: 'User' }, project],
    ['browse_audit_events', { action: 'list_instance', entity_id: 3 }, project],
  ])('leaves %s %j under %j as it is', (tool, args, scope) => {
    expect(scopedArgs(tool, args, scope)).toBe(args);
  });
});

describe('scopeProjectsOnly', () => {
  it.each([
    [{ project: 'team/app' }, ['team/app']],
    [{ projects: ['team/app', 'team/api'] }, ['team/app', 'team/api']],
    [{ project: 'team/app', projects: ['team/api'] }, ['team/app', 'team/api']],
    [{}, null],
    [{ group: 'team' }, null],
    [{ projects: ['team/app'], groups: ['ops'] }, null],
  ])('reads %j as the projects %j', (scope, expected) => {
    expect(scopeProjectsOnly(scope)).toEqual(expected);
  });
});

describe('isFilteredListing', () => {
  it.each([
    ['browse_projects', { action: 'search' }, true],
    ['browse_merge_requests', { action: 'list' }, true],
    ['browse_merge_requests', { action: 'list', project_id: 'team/app' }, false],
    ['browse_todos', { action: 'list' }, true],
    ['browse_todos', { action: 'list', project_id: 7 }, false],
    ['browse_issues', { action: 'list' }, false],
  ])('%s %j is filtered: %s', (tool, args, expected) => {
    expect(isFilteredListing(tool, args)).toBe(expected);
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
    ['manage_project', { action: 'fork', project_id: 'team/app' }, project],
    ['manage_namespace', { action: 'create', name: 'Team', path: 'team2' }, group],
  ])('refuses %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toMatch(/outside the working scope/);
  });

  // Events carry only a numeric project id, which a group scope cannot be matched against.
  it.each([group, several])('refuses the caller activity feed under %j', (scope) => {
    expect(targetlessRestriction('browse_events', { action: 'user' }, scope)).toMatch(
      /activity cannot be limited/,
    );
  });

  // GitLab lists deploy keys per project and audit events per project or per group alone,
  // and the instance-wide public key listing has no per-project form.
  it.each([
    ['browse_deploy_keys', { action: 'list' }, group, /deploy keys/],
    ['browse_deploy_keys', { action: 'list' }, several, /deploy keys/],
    ['browse_deploy_keys', { action: 'list', public: true }, project, /public deploy keys/],
    ['browse_runners', { action: 'list_all' }, several, /runners/],
    ['browse_audit_events', { action: 'list_instance' }, group, /audit events/],
    [
      'browse_audit_events',
      { action: 'list_instance', entity_type: 'User', entity_id: 4 },
      project,
      /audit events/,
    ],
  ])('refuses the instance listing %s %j under %j', (tool, args, scope, reason) => {
    expect(targetlessRestriction(tool, args, scope)).toMatch(reason);
  });

  it.each([
    ['browse_deploy_keys', { action: 'list' }, project],
    ['browse_deploy_keys', { action: 'list', project_id: 'team/app' }, several],
    ['browse_runners', { action: 'list_all' }, group],
    ['browse_runners', { action: 'list_project', project_id: 'team/app' }, several],
    ['browse_audit_events', { action: 'list_instance' }, project],
    ['browse_audit_events', { action: 'list_group', group_id: 'team' }, several],
    ['browse_deploy_keys', { action: 'get', project_id: 'team/app', key_id: 1 }, group],
    ['browse_events', { action: 'project', project_id: 'team/app' }, group],
  ])('allows the listing %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toBeNull();
  });

  // GitLab searches snippet titles only across the whole instance.
  it.each([group, project])('refuses a snippet title search under %j', (scope) => {
    expect(
      targetlessRestriction(
        'browse_search',
        { action: 'global', scope: 'snippet_titles', search: 'x' },
        scope,
      ),
    ).toMatch(/snippet titles/);
  });

  it('refuses a vulnerability listing a scope of several targets cannot narrow', () => {
    expect(targetlessRestriction('browse_vulnerabilities', { action: 'list' }, several)).toMatch(
      /list them for one of them/,
    );
  });

  // A group's vulnerability list always covers its subgroups.
  it('refuses a vulnerability listing under a group scope without subgroups', () => {
    expect(targetlessRestriction('browse_vulnerabilities', { action: 'list' }, groupOnly)).toMatch(
      /subgroups/,
    );
  });

  it.each([
    ['browse_search', { action: 'global' }, group],
    ['browse_search', { action: 'group', group_id: 'team' }, several],
    ['browse_projects', { action: 'list' }, several],
    ['manage_project', { action: 'create', name: 'app' }, group],
    ['manage_project', { action: 'create', name: 'app', namespace: 'team/sub' }, project],
    ['manage_project', { action: 'fork', project_id: 'team/app', namespace_path: 'x' }, project],
    ['manage_project', { action: 'fork', project_id: 'team/app' }, group],
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
