import { GITLAB_ALLOWED_PROJECT_IDS } from '../../../src/config';
import { projectInCallScope, runInCallScope } from '../../../src/configuration/call-scope';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { gitlab } from '../../../src/utils/gitlab-api';

const paths: Record<string, string> = {
  'projects/71': 'team/app',
  'projects/72': 'other/secret',
};
const original = [...GITLAB_ALLOWED_PROJECT_IDS];
const allow = (...entries: string[]) =>
  GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, ...entries);
let read: jest.SpyInstance;
beforeEach(() => {
  // Each test starts unrestricted, whatever operator list the process was started with.
  allow();
  read = jest.spyOn(gitlab, 'get').mockImplementation(async (path: string) => {
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
