/** Read-only allowlist checks use the shared lifecycle fixtures; the suite runs serially. */
import { GITLAB_ALLOWED_PROJECT_IDS } from '../../../src/config';
import { buildPolicy } from '../../../src/configuration/policy';
import { withOperatorProjects } from '../../../src/configuration/operator-projects';
import { assertOperatorOwnership } from '../../../src/configuration/operator-ownership';
import { executeScoped } from '../../../src/configuration/scoped-execution';
import { requireTestData } from '../../setup/testConfig';
import { IntegrationTestHelper } from '../helpers/registry-helper';

describe('Operator projects - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  const original = [...GITLAB_ALLOWED_PROJECT_IDS];
  beforeAll(async () => {
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });
  afterEach(() =>
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, ...original),
  );

  // A real metadata lookup must prove ID/path equivalence and narrow a targetless listing.
  it('resolves an encoded path and lists only the allowed project', async () => {
    const { project } = requireTestData();
    GITLAB_ALLOWED_PROJECT_IDS.splice(
      0,
      GITLAB_ALLOWED_PROJECT_IDS.length,
      encodeURIComponent(project.path_with_namespace),
    );
    const policy = await withOperatorProjects(buildPolicy(undefined, {}, {}));
    expect(policy.operatorProjectIds).toEqual(new Set([String(project.id)]));
    expect(policy.scopeEnforcer?.isAllowed(String(project.id))).toBe(true);
    const rows = (await executeScoped(
      (tool, args) => helper.executeTool(tool, args),
      'browse_projects',
      { action: 'list' },
      policy,
    )) as Array<{ id: number }>;
    expect(rows.map((row) => String(row.id))).toEqual([String(project.id)]);
  }, 60000);

  // The minimal ownership query must work against GitLab and deny an unpermitted owner.
  it('verifies the project of a real global work item ID', async () => {
    const { project } = requireTestData();
    GITLAB_ALLOWED_PROJECT_IDS.splice(0, GITLAB_ALLOWED_PROJECT_IDS.length, String(project.id));
    const policy = await withOperatorProjects(buildPolicy(undefined, {}, {}));
    const rows = (await helper.executeTool('browse_work_items', {
      action: 'list',
      namespace: project.path_with_namespace,
      first: 1,
    })) as { items: Array<{ id: string }> };
    expect(rows.items.length).toBeGreaterThan(0);
    const args = { action: 'get', id: rows.items[0].id };
    await expect(
      assertOperatorOwnership('browse_work_items', args, policy, () => false),
    ).resolves.toBeUndefined();
    await expect(
      assertOperatorOwnership(
        'browse_work_items',
        args,
        { ...policy, operatorProjectIds: new Set() },
        () => false,
      ),
    ).rejects.toThrow('not owned');
  }, 60000);
});
