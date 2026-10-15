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
  singleTarget,
  targetlessRestriction,
} from '../../../src/configuration/scope-targets';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';

const group = { group: 'team', includeSubgroups: true };
const groupOnly = { group: 'team', includeSubgroups: false };
const project = { project: 'team/app' };
const several = { projects: ['team/app', 'other/api'] };

describe('scopedArgs', () => {
  // Once two targets exist, deciding single versus multiple must not traverse/copy a wide preset.
  it('stops single-target detection after the second configured target', () => {
    const projects = ['team/a', 'team/b'];
    Object.defineProperty(projects, 2, {
      get: () => {
        throw new Error('unnecessary third target read');
      },
    });
    expect(singleTarget({ projects })).toBeUndefined();
  });
  // public=false is the instance endpoint's default and must not prevent scope emulation.
  it.each([group, project])('accepts explicit public=false under %j', (scope) => {
    const args = { action: 'list', public: false };
    expect(targetlessRestriction('browse_deploy_keys', args, scope)).toBeNull();
    if (scope === project)
      expect(scopedArgs('browse_deploy_keys', args, scope)).toEqual({
        action: 'list',
        project_id: 'team/app',
      });
  });
  it.each([
    [group, { action: 'group', group_id: 'team', search: 'x', scope: 'issues' }],
    [project, { action: 'project', project_id: 'team/app', search: 'x', scope: 'issues' }],
  ])('turns a global search under %j into a search of the scope', (scope, expected) => {
    expect(
      scopedArgs('browse_search', { action: 'global', search: 'x', scope: 'issues' }, scope),
    ).toEqual(expected);
  });

  // A plain listing lists active projects; the group listing applies that only when asked,
  // so the default is kept when the scope's group is filled in.
  it.each([
    [group, { action: 'list', group_id: 'team', include_subgroups: true, active: true }],
    [groupOnly, { action: 'list', group_id: 'team', include_subgroups: false, active: true }],
  ])('lists the active projects of the scope group %j', (scope, expected) => {
    expect(scopedArgs('browse_projects', { action: 'list' }, scope)).toEqual(expected);
  });

  // The caller's own choice of active or archived projects stays as asked.
  it.each([[{ active: false }], [{ archived: true }]])(
    'keeps the requested %j filter when listing the scope group',
    (filter) => {
      expect(scopedArgs('browse_projects', { action: 'list', ...filter }, group)).toEqual({
        action: 'list',
        ...filter,
        group_id: 'team',
        include_subgroups: true,
      });
    },
  );

  // The caller's narrower choice stays; a scope without subgroups excludes them whatever
  // the caller asked, as the results outside it are filtered anyway.
  it.each([
    [group, false, false],
    [group, true, true],
    [groupOnly, true, false],
  ])('lists the scope group %j with subgroups %s as %s', (scope, requested, expected) => {
    expect(
      scopedArgs('browse_projects', { action: 'list', include_subgroups: requested }, scope),
    ).toEqual({ action: 'list', group_id: 'team', include_subgroups: expected, active: true });
  });

  // A preset may name its one project or group in a list, or as a namespace (which always
  // covers its subgroups); either is that single target.
  it.each([
    [{ projects: ['team/app'] }, { action: 'project', project_id: 'team/app' }],
    [{ groups: ['team'] }, { action: 'group', group_id: 'team' }],
    [{ namespace: 'team' }, { action: 'group', group_id: 'team' }],
  ])('searches the single target of the preset scope %j', (scope, expected) => {
    expect(
      scopedArgs('browse_search', { action: 'global', search: 'x', scope: 'issues' }, scope),
    ).toEqual({ ...expected, search: 'x', scope: 'issues' });
  });

  it.each([
    [{ groups: ['team'], includeSubgroups: false }, false],
    [{ namespace: 'team', includeSubgroups: false }, true],
  ])('lists the projects of the preset scope %j with subgroups %s', (scope, subgroups) => {
    expect(scopedArgs('browse_projects', { action: 'list' }, scope)).toEqual({
      action: 'list',
      group_id: 'team',
      include_subgroups: subgroups,
      active: true,
    });
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
    // A project's snippets listed without naming the project are the scope project's.
    [
      'browse_snippets',
      { action: 'list', scope: 'project' },
      project,
      { action: 'list', scope: 'project', projectId: 'team/app' },
    ],
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
      { action: 'list_all' },
      groupOnly,
      { action: 'list_group', group_id: 'team' },
    ],
    [
      'browse_audit_events',
      { action: 'list_instance', created_after: '2026-01-01' },
      project,
      { action: 'list_project', created_after: '2026-01-01', project_id: 'team/app' },
    ],
    // A group's own trail lacks its projects' events; scoped execution composes them.
    ['browse_audit_events', { action: 'list_instance' }, group, { action: 'list_instance' }],
  ])('reads %s %j under %j as %j', (tool, args, scope, expected) => {
    expect(scopedArgs(tool, args, scope)).toEqual(expected);
  });

  // The targetless listing shows the caller's own merge requests by default; a project's or
  // group's shows everyone's, so the narrowed call keeps that default unless one is named.
  it('lists the merge requests of the scope project', () => {
    expect(
      scopedArgs('browse_merge_requests', { action: 'list', state: 'opened' }, project),
    ).toEqual({ action: 'list', state: 'opened', project_id: 'team/app', scope: 'created_by_me' });
  });

  it('lists the merge requests of the scope group with the scope the call names', () => {
    expect(scopedArgs('browse_merge_requests', { action: 'list', scope: 'all' }, group)).toEqual({
      action: 'list',
      scope: 'all',
      group_id: 'team',
    });
  });

  // A call that names its target is checked against the scope, not rewritten.
  it.each([
    ['browse_projects', { action: 'list', group_id: 'team/sub' }, group],
    ['browse_merge_requests', { action: 'list', project_id: 'team/app' }, project],
    ['browse_search', { action: 'project', project_id: 'team/app' }, project],
    ['browse_projects', { action: 'list' }, project],
    ['browse_merge_requests', { action: 'list', group_id: 'team' }, group],
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
    // The caller's own runners keep their own feed; they are filtered to the scope instead.
    ['browse_runners', { action: 'list_owned' }, project],
    ['browse_audit_events', { action: 'list_group', group_id: 'team' }, project],
    ['browse_audit_events', { action: 'list_instance', entity_type: 'User' }, project],
    ['browse_audit_events', { action: 'list_instance', entity_id: 3 }, project],
    ['browse_snippets', { action: 'get', id: 1 }, project],
    ['browse_snippets', { action: 'list', scope: 'personal' }, project],
    ['browse_snippets', { action: 'list', scope: 'project', projectId: 'team/app' }, project],
    ['browse_snippets', { action: 'list', scope: 'project' }, group],
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
    ['browse_todos', { action: 'list', group_id: 'team' }, true],
    ['browse_todos', { action: 'list', project_id: 7 }, false],
    ['browse_issues', { action: 'list' }, false],
    ['browse_namespaces', { action: 'list' }, true],
    ['browse_namespaces', { action: 'get', namespace_id: 'team' }, false],
  ])('%s %j is filtered: %s', (tool, args, expected) => {
    expect(isFilteredListing(tool, args)).toBe(expected);
  });
});

describe('targetlessRestriction', () => {
  // Multi-project search already has a sorted/paginated emulator; preflight must reach it.
  it('allows the existing project and group search emulators for multiple targets', () => {
    expect(
      targetlessRestriction('browse_search', { action: 'global', scope: 'projects' }, several),
    ).toBeNull();
    expect(
      targetlessRestriction(
        'browse_search',
        { action: 'global', scope: 'groups' },
        { groups: ['team', 'other'] },
      ),
    ).toBeNull();
  });
  // Each group answers a search of projects, and each project of the scope is matched
  // itself, so a scope with groups composes it as well.
  it.each([[{ groups: ['team', 'ops'] }], [{ project: 'other/app', groups: ['team'] }]])(
    'allows a composed projects search under %j',
    (scope) => {
      expect(
        targetlessRestriction('browse_search', { action: 'global', scope: 'projects' }, scope),
      ).toBeNull();
    },
  );
  // Both runner feeds can be intersected with the union of the preset's targets.
  it.each(['list_all', 'list_owned'])('allows composed %s for several targets', (action) => {
    expect(targetlessRestriction('browse_runners', { action }, several)).toBeNull();
  });
  it('refuses a global search under a scope of several projects', () => {
    expect(targetlessRestriction('browse_search', { action: 'global' }, several)).toMatch(
      /search within one of them/,
    );
  });

  // Every target answers these searches itself, so several targets compose them.
  it.each(['issues', 'merge_requests', 'milestones', 'notes', 'commits', 'blobs', 'users'])(
    'allows a composed %s search for several targets',
    (searchScope) => {
      expect(
        targetlessRestriction(
          'browse_search',
          { action: 'global', scope: searchScope },
          { project: 'team/app', groups: ['ops'] },
        ),
      ).toBeNull();
    },
  );

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

  // Scoped execution resolves numeric project IDs and filters the user's own feed.
  it.each([group, several])('allows filtered caller activity under %j', (scope) => {
    expect(targetlessRestriction('browse_events', { action: 'user' }, scope)).toBeNull();
  });

  // The instance-wide public key listing has no per-project form.
  it.each([
    ['browse_deploy_keys', { action: 'list', public: true }, project, /public deploy keys/],
  ])('refuses the instance listing %s %j under %j', (tool, args, scope, reason) => {
    expect(targetlessRestriction(tool, args, scope)).toMatch(reason);
  });

  it.each([
    ['browse_deploy_keys', { action: 'list' }, project],
    // Several targets compose their projects' keys.
    ['browse_deploy_keys', { action: 'list' }, several],
    ['browse_deploy_keys', { action: 'list' }, { project: 'team/app', groups: ['ops', 'dev'] }],
    ['browse_deploy_keys', { action: 'list', project_id: 'team/app' }, several],
    ['browse_runners', { action: 'list_all' }, group],
    ['browse_runners', { action: 'list_project', project_id: 'team/app' }, several],
    ['browse_audit_events', { action: 'list_instance' }, project],
    ['browse_audit_events', { action: 'list_instance' }, group],
    ['browse_audit_events', { action: 'list_group', group_id: 'team' }, several],
    // An entity filter reads the scope's trails of that entity.
    ['browse_audit_events', { action: 'list_instance', entity_type: 'User' }, several],
    [
      'browse_audit_events',
      { action: 'list_instance', entity_type: 'Group', entity_id: 4 },
      project,
    ],
    ['browse_deploy_keys', { action: 'get', project_id: 'team/app', key_id: 1 }, group],
    ['browse_events', { action: 'project', project_id: 'team/app' }, group],
  ])('allows the listing %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toBeNull();
  });

  // GitLab searches snippet titles only across the whole instance; the scope's project snippets
  // answer it instead.
  it.each([group, project, several])('allows a snippet title search under %j', (scope) => {
    expect(
      targetlessRestriction(
        'browse_search',
        { action: 'global', scope: 'snippet_titles', search: 'x' },
        scope,
      ),
    ).toBeNull();
  });

  // Public snippets are listed only across the whole instance; they belong to no project.
  it.each([project, group])('refuses the public snippet listing under %j', (scope) => {
    expect(
      targetlessRestriction('browse_snippets', { action: 'list', scope: 'public' }, scope),
    ).toMatch(/public snippets/);
  });

  // Personal snippets belong to no project either: the account-wide listing would ignore
  // the scope, so it is refused rather than answered from outside it.
  it.each([project, group, several])('refuses the personal snippet listing under %j', (scope) => {
    expect(
      targetlessRestriction('browse_snippets', { action: 'list', scope: 'personal' }, scope),
    ).toMatch(/personal snippets/);
  });

  // An empty entry in a preset's project or group list names no target.
  it('skips empty entries of a preset scope list', () => {
    expect(singleTarget({ projects: ['', 'team/app'], groups: [''] })).toEqual({
      project: 'team/app',
    });
  });

  // Only the snippet listing spans the instance or the account; reading one snippet does not.
  it('allows reading a snippet by ID under a scope', () => {
    expect(targetlessRestriction('browse_snippets', { action: 'get', id: 1 }, project)).toBeNull();
  });

  // A snippet created without a project is a personal one, outside any scope: a project
  // scope creates it in its project, any other scope refuses the call.
  it('creates a targetless snippet in the scope project', () => {
    const args = { action: 'create', title: 't', files: [{ file_path: 'a', content: 'b' }] };
    expect(targetlessRestriction('manage_snippet', args, project)).toBeNull();
    expect(scopedArgs('manage_snippet', args, project)).toEqual({
      ...args,
      projectId: 'team/app',
    });
  });
  it.each([group, groupOnly, several])('refuses a targetless snippet under %j', (scope) => {
    expect(
      targetlessRestriction('manage_snippet', { action: 'create', title: 't' }, scope),
    ).toMatch(/personal snippet/);
  });
  it('keeps a snippet created in a named project', () => {
    const args = { action: 'create', title: 't', projectId: 'team/app' };
    expect(targetlessRestriction('manage_snippet', args, group)).toBeNull();
    expect(scopedArgs('manage_snippet', args, project)).toBe(args);
  });

  // Personal access tokens belong to an account, not a project or group: the account-wide
  // listing would ignore the scope, so it is refused like personal snippets.
  it.each([project, group, several])('refuses the personal token listing under %j', (scope) => {
    expect(
      targetlessRestriction('browse_access_tokens', { action: 'list_personal' }, scope),
    ).toMatch(/personal access tokens/);
  });

  it.each([
    ['browse_access_tokens', { action: 'list_project', project_id: 'team/app' }],
    ['browse_access_tokens', { action: 'list_group', group_id: 'team' }],
  ])('allows the token listing %s %j', (tool, args) => {
    expect(targetlessRestriction(tool, args, group)).toBeNull();
  });

  it.each([
    ['browse_snippets', { action: 'list', scope: 'project', projectId: 'team/app' }, group],
    ['browse_snippets', { action: 'list', scope: 'project' }, project],
    // The scope's projects' snippets are composed under a group or several targets.
    ['browse_snippets', { action: 'list', scope: 'project' }, group],
    ['browse_snippets', { action: 'list', scope: 'project' }, several],
  ])('allows the snippet listing %s %j under %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toBeNull();
  });

  // A search of groups under a scope of projects has no group to find.
  it('refuses a search of groups under a project scope', () => {
    expect(
      targetlessRestriction(
        'browse_search',
        { action: 'global', scope: 'groups', search: 'x' },
        project,
      ),
    ).toMatch(/groups cannot be searched/);
  });

  it('allows a search of groups under a group scope', () => {
    expect(
      targetlessRestriction(
        'browse_search',
        { action: 'global', scope: 'groups', search: 'x' },
        group,
      ),
    ).toBeNull();
  });

  // GitLab lists namespaces across the instance; a scope of projects reaches no group, so
  // there is nothing of it to list.
  it.each([project, several])('refuses a namespace listing under %j', (scope) => {
    expect(targetlessRestriction('browse_namespaces', { action: 'list' }, scope)).toMatch(
      /namespaces cannot be listed/,
    );
  });

  // A preset's one project or group is narrowed to, not refused as several targets.
  it.each([
    ['browse_search', { action: 'global' }, { projects: ['team/app'] }],
    ['browse_vulnerabilities', { action: 'list' }, { groups: ['team'] }],
    ['browse_runners', { action: 'list_all' }, { namespace: 'team' }],
    ['browse_audit_events', { action: 'list_instance' }, { projects: ['team/app'] }],
    ['browse_namespaces', { action: 'list' }, group],
    ['browse_namespaces', { action: 'get', namespace_id: 'team/app' }, project],
  ])('allows %s %j under the scope %j', (tool, args, scope) => {
    expect(targetlessRestriction(tool, args, scope)).toBeNull();
  });

  // The listings of several targets can be composed within a shared request bound.
  it.each([
    ['browse_vulnerabilities', { action: 'list' }],
    ['browse_audit_events', { action: 'list_instance' }],
  ])('allows a targetless %s %j for several targets', (tool, args) => {
    expect(targetlessRestriction(tool, args, several)).toBeNull();
  });

  it.each([
    ['browse_search', { action: 'global' }, group],
    // A group without its subgroups is answered by the group's results, kept to it.
    ['browse_search', { action: 'global' }, groupOnly],
    ['browse_vulnerabilities', { action: 'list' }, groupOnly],
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

  // GitLab's group todo filter covers the group's subgroups too; a scope without them keeps
  // only the group's own todos, also when the call names the group.
  it("keeps only the scope group's own todos when the call names the group", () => {
    const todos = [
      { id: 1, project: { path_with_namespace: 'team/app' } },
      { id: 2, project: { path_with_namespace: 'team/sub/app' } },
    ];

    expect(
      scopedResult(
        'browse_todos',
        { action: 'list', group_id: 'team' },
        todos,
        new ScopeEnforcer(groupOnly),
      ),
    ).toEqual([{ id: 1, project: { path_with_namespace: 'team/app' } }]);
  });

  // User namespaces and namespaces outside the scope are left out, as is a row without a path.
  it('keeps only namespaces of the scope from a namespace listing', () => {
    const namespaces = [
      { kind: 'group', full_path: 'team/sub' },
      { kind: 'group', full_path: 'other' },
      { kind: 'user', full_path: 'alice' },
      { kind: 'group' },
    ];

    expect(scopedResult('browse_namespaces', { action: 'list' }, namespaces, enforcer)).toEqual([
      { kind: 'group', full_path: 'team/sub' },
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
