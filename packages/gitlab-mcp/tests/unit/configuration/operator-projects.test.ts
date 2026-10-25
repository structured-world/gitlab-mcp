import { GITLAB_ALLOWED_PROJECT_IDS } from '../../../src/config';
import {
  findOperatorProjectTargets,
  operatorProjectRejection,
  withOperatorProjects,
} from '../../../src/configuration/operator-projects';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { gitlab } from '../../../src/utils/gitlab-api';
import type { EffectivePolicy } from '../../../src/configuration/policy';

const base = (): EffectivePolicy => ({
  readOnly: false,
  disabledGroups: new Set(),
  deniedActions: new Map(),
});
const project = {
  id: 71,
  path_with_namespace: 'team/app',
  name_with_namespace: 'Team / Application',
};
const original = [...GITLAB_ALLOWED_PROJECT_IDS];
afterEach(() =>
  GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, ...original),
);

describe('operator projects', () => {
  // The production reader must resolve the configured identity on the active API client.
  it('uses the default GitLab reader for operator verification', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const read = jest.spyOn(gitlab, 'get').mockResolvedValue(project);
    try {
      expect((await withOperatorProjects(base())).operatorProjectIds).toEqual(
        new Set([String(project.id)]),
      );
      expect(read.mock.calls).toEqual([['projects/71']]);
    } finally {
      read.mockRestore();
    }
  });

  // An unconfigured allowlist must add no GitLab calls or policy changes.
  it('keeps an unrestricted policy without a lookup', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0);
    const policy = base();
    const read = jest.fn();
    expect(await withOperatorProjects(policy, read)).toBe(policy);
    expect(read).not.toHaveBeenCalled();
    expect(operatorProjectRejection({ project_id: '999' })).toBeNull();
  });

  // Numeric mismatches are known without resolving either project through GitLab.
  it('rejects an explicitly different numeric project without metadata', () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    expect(operatorProjectRejection({ project_id: project.id })).toBeNull();
    expect(operatorProjectRejection({ target_project_id: '999' })).toContain(
      'GITLAB_ALLOWED_PROJECT_IDS',
    );
  });

  // IDs and full paths identify the same project, while a user's group can only narrow it.
  it('intersects the operator list with the working scope', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const read = jest.fn().mockResolvedValue(project);
    const policy = await withOperatorProjects(
      { ...base(), scope: { group: 'team' }, scopeEnforcer: new ScopeEnforcer({ group: 'team' }) },
      read,
    );
    expect(policy.operatorProjectIds).toEqual(new Set([String(project.id)]));
    expect(policy.scope).toEqual({ projects: [project.path_with_namespace] });
    expect(policy.scopeEnforcer?.isAllowed(String(project.id))).toBe(true);
    expect(policy.scopeEnforcer?.isAllowed('team%2Fapp')).toBe(true);
    expect(policy.scopeEnforcer?.isAllowed('team/other')).toBe(false);
  });

  // Configured ID/path aliases must not duplicate a scoped feed or its metadata targets.
  it('keeps one verified target for two aliases of the same project', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(
      0,
      GITLAB_ALLOWED_PROJECT_IDS.length,
      String(project.id),
      project.path_with_namespace,
    );
    const policy = await withOperatorProjects(base(), jest.fn().mockResolvedValue(project));
    expect(policy.scope?.projects).toEqual([project.path_with_namespace]);
  });

  // A direct call must not fetch every unrelated configured project to prove one owner.
  it('resolves only explicit targets for a numeric operator list', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(
      0,
      GITLAB_ALLOWED_PROJECT_IDS.length,
      String(project.id),
      '72',
      '73',
    );
    const read = jest.fn().mockResolvedValue(project);
    const policy = await withOperatorProjects(base(), read, undefined, ['team%2Fapp']);
    expect(read.mock.calls).toEqual([['projects/team%2Fapp']]);
    expect(policy.operatorProjectIds).toEqual(new Set([String(project.id)]));
    read.mockResolvedValue({ ...project, id: 74, path_with_namespace: 'other/app' });
    expect(
      (await withOperatorProjects(base(), read, undefined, ['other/app'])).operatorProjectIds?.size,
    ).toBe(0);
  });

  // An empty intersection must remain an explicit denial, never an unrestricted empty scope.
  it('retains an empty mandatory set when the user chooses another group', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const policy = await withOperatorProjects(
      {
        ...base(),
        scope: { group: 'other' },
        scopeEnforcer: new ScopeEnforcer({ group: 'other' }),
      },
      jest.fn().mockResolvedValue(project),
    );
    expect(policy.operatorProjectIds?.size).toBe(0);
  });

  // Choosing a new chat scope may search only the operator's accessible projects.
  it('offers only matching allowed projects in the settings picker', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(
      0,
      GITLAB_ALLOWED_PROJECT_IDS.length,
      'team%2Fapp',
      'missing',
    );
    const read = jest.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('/missing')) throw new Error('GitLab API error: 404 Not Found');
      return project;
    });
    expect(await findOperatorProjectTargets('APPLICATION', read)).toEqual([
      { type: 'project', path: project.path_with_namespace, name: project.name_with_namespace },
    ]);
    expect(read.mock.calls.map((call) => call[0])).toEqual([
      'projects/team%2Fapp',
      'projects/missing',
    ]);
    expect(await findOperatorProjectTargets('unrelated', read)).toEqual([]);
  });

  // Missing identity or unavailable storage/authentication must fail rather than expand access.
  it('refuses unverifiable project identities and propagates lookup failures', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    await expect(
      withOperatorProjects(base(), jest.fn().mockResolvedValue({ id: project.id })),
    ).rejects.toThrow('verifiable');
    await expect(
      withOperatorProjects(
        base(),
        jest.fn().mockRejectedValue(new Error('GitLab API error: 401 Unauthorized')),
      ),
    ).rejects.toThrow('401');
    await expect(
      findOperatorProjectTargets('app', jest.fn().mockResolvedValue({ ...project, id: 0 })),
    ).rejects.toThrow('invalid');
  });

  // Per-call memoization avoids duplicate identity reads without caching another caller's token.
  it('shares an identity read within one call and refreshes it for the next call', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const read = jest.fn().mockResolvedValue(project);
    const configured = {
      ...base(),
      scope: { project: String(project.id) },
      scopeEnforcer: new ScopeEnforcer({ project: String(project.id) }),
    };
    await withOperatorProjects(configured, read);
    expect(read).toHaveBeenCalledTimes(1);
    await withOperatorProjects(configured, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  // A timed-out metadata lookup cannot start another verification or authorize execution.
  it('checks the call deadline before and after metadata reads', async () => {
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const read = jest.fn().mockResolvedValue(project);
    await expect(withOperatorProjects(base(), read, () => true)).rejects.toThrow('expired');
    expect(read).not.toHaveBeenCalled();
    let expired = false;
    await expect(
      withOperatorProjects(
        base(),
        async () => {
          expired = true;
          return project;
        },
        () => expired,
      ),
    ).rejects.toThrow('expired');
  });
});
