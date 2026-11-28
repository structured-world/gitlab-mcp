import { GITLAB_ALLOWED_PROJECT_IDS } from '../../../src/config';
import {
  descendantsInCallScope,
  namespaceInCallScope,
  projectInCallScope,
  runInCallScope,
} from '../../../src/configuration/call-scope';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { gitlab } from '../../../src/utils/gitlab-api';

const paths: Record<string, string> = {
  'projects/71': 'team/app',
  'projects/72': 'other/secret',
};
// Projects looked up by path, as a namespace a saved view reaches is.
const ids: Record<string, number> = {
  [`projects/${encodeURIComponent('team/app')}`]: 71,
  [`projects/${encodeURIComponent('other/secret')}`]: 72,
};
const original = [...GITLAB_ALLOWED_PROJECT_IDS];
const allow = (...entries: string[]) =>
  GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, ...entries);
let read: jest.SpyInstance;
beforeEach(() => {
  // Each test starts unrestricted, whatever operator list the process was started with.
  allow();
  read = jest.spyOn(gitlab, 'get').mockImplementation(async (path: string) => {
    if (ids[path] !== undefined) return { id: ids[path] };
    const found = paths[path];
    if (found === undefined) throw new Error('GitLab API error: 404 Not Found');
    return { path_with_namespace: found };
  });
});
afterEach(() => {
  read.mockRestore();
  allow(...original);
});

// A project a tool reaches on its own (a downstream pipeline's) is held to the operator's
// project list and the caller's working scope, as the projects a call names are.
describe('projectInCallScope', () => {
  // Nothing restricted: every project, without a GitLab lookup.
  it('allows any project without restrictions', async () => {
    expect(await projectInCallScope('72')).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  // A numeric operator list decides by ID alone.
  it('checks the operator list by ID', async () => {
    allow('71');
    expect(await projectInCallScope('71')).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(await projectInCallScope('72')).toBe(false);
  });

  // An operator list of paths decides by the path the ID stands for, in any letter case.
  it('checks the operator list by path', async () => {
    allow('Team/App');
    expect(await projectInCallScope('71')).toBe(true);
    expect(await projectInCallScope('72')).toBe(false);
  });

  // The working scope applies on its own and on top of the operator list.
  it('checks the working scope', async () => {
    const scope = new ScopeEnforcer({ groups: ['team'] });
    expect(await runInCallScope(scope, () => projectInCallScope('71'))).toBe(true);
    expect(await runInCallScope(scope, () => projectInCallScope('72'))).toBe(false);
    allow('72');
    expect(await runInCallScope(scope, () => projectInCallScope('72'))).toBe(false);
  });

  // A project GitLab does not show cannot be shown to be in scope.
  it('refuses a project GitLab does not show', async () => {
    allow('team/app');
    expect(await projectInCallScope('99')).toBe(false);
  });
});

// A namespace a tool reaches by path, such as the group a saved view filters on, is held
// to the working scope and the operator's project list.
describe('namespaceInCallScope', () => {
  it('allows any namespace without restrictions, without a GitLab lookup', async () => {
    expect(await namespaceInCallScope('other', 'group')).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks the working scope by the kind of namespace', async () => {
    const scope = new ScopeEnforcer({ group: 'team' });
    expect(await runInCallScope(scope, () => namespaceInCallScope('team/sub', 'group'))).toBe(true);
    expect(await runInCallScope(scope, () => namespaceInCallScope('team/app', 'project'))).toBe(
      true,
    );
    expect(await runInCallScope(scope, () => namespaceInCallScope('other', 'group'))).toBe(false);
  });

  it('refuses a subgroup under a group scope without subgroups', async () => {
    // The path of a subgroup looks like that of a project directly in the group; checked
    // as a project it would pass.
    const direct = new ScopeEnforcer({ group: 'team', includeSubgroups: false });
    expect(await runInCallScope(direct, () => namespaceInCallScope('team/sub', 'group'))).toBe(
      false,
    );
    expect(await runInCallScope(direct, () => namespaceInCallScope('team/app', 'project'))).toBe(
      true,
    );
  });

  it('allows a project the operator lists by path without a lookup', async () => {
    allow('Team/App');
    expect(await namespaceInCallScope('team/app', 'project')).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('looks up the ID of a path for an operator list of IDs', async () => {
    allow('71');
    expect(await namespaceInCallScope('team/app', 'project')).toBe(true);
    expect(await namespaceInCallScope('other/secret', 'project')).toBe(false);
  });

  it('refuses a project GitLab does not show or answers without an ID', async () => {
    allow('71');
    expect(await namespaceInCallScope('team/gone', 'project')).toBe(false);
    read.mockResolvedValueOnce({ path_with_namespace: 'team/app' });
    expect(await namespaceInCallScope('team/app', 'project')).toBe(false);
  });

  it('fails with the GitLab error when the lookup itself fails', async () => {
    // A rejected token must reach the reauthorization challenge, not read as a project
    // outside the operator's list.
    allow('71');
    read.mockRejectedValueOnce(new Error('GitLab API error: 401 Unauthorized'));
    await expect(namespaceInCallScope('team/app', 'project')).rejects.toThrow('401');
  });

  it('passes on a lookup failure that is not an Error', async () => {
    allow('71');
    read.mockRejectedValueOnce('connection reset');
    await expect(namespaceInCallScope('team/app', 'project')).rejects.toBe('connection reset');
  });

  it('refuses a group under an operator list, without a lookup', async () => {
    // The operator lists projects; a group is not one of them.
    allow('team/app');
    expect(await namespaceInCallScope('team/app', 'group')).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('descendantsInCallScope', () => {
  it('covers every descendant without restrictions', () => {
    expect(descendantsInCallScope('team')).toBe(true);
  });

  it('follows whether the working scope includes subgroups', () => {
    const withSubgroups = new ScopeEnforcer({ group: 'team' });
    const direct = new ScopeEnforcer({ group: 'team', includeSubgroups: false });
    expect(runInCallScope(withSubgroups, () => descendantsInCallScope('team'))).toBe(true);
    expect(runInCallScope(direct, () => descendantsInCallScope('team'))).toBe(false);
    expect(runInCallScope(withSubgroups, () => descendantsInCallScope('other'))).toBe(false);
  });

  it('covers no descendants under an operator list of projects', () => {
    allow('71');
    expect(descendantsInCallScope('team')).toBe(false);
  });
});
