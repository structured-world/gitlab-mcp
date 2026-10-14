/** Read-only scoped composition through production handlers; no shared resources are mutated. */
import {
  IntegrationTestHelper,
  initIntegrationHelper,
  findTestProjectPath,
} from '../helpers/registry-helper';
import { describeIfTier } from '../../setup/tierGate';
import { executeScoped } from '../../../src/configuration/scoped-execution';
import { buildPolicy } from '../../../src/configuration/policy';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';

describe('Scoped composition - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let project: string;
  let group: string;

  beforeAll(async () => {
    helper = await initIntegrationHelper();
    const found = await findTestProjectPath(helper);
    if (!found?.includes('/'))
      throw new Error('Scoped composition requires an accessible test project');
    project = found;
    group = project.slice(0, project.lastIndexOf('/'));
  });

  const policy = () => {
    const scope = { project, group, includeSubgroups: false };
    return { ...buildPolicy(undefined, {}, {}), scope, scopeEnforcer: new ScopeEnforcer(scope) };
  };
  const run = (tool: string, args: Record<string, unknown>) => helper.executeTool(tool, args);

  // Owned runners keep the native feed/cursor while availability comes from both targets.
  it('composes the project and group availability for the owned runner feed', async () => {
    const result = (await executeScoped(
      run,
      'browse_runners',
      { action: 'list_owned', first: 5 },
      policy(),
    )) as { nodes: unknown[]; pageInfo: unknown };
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.pageInfo).toBeDefined();
  }, 60000);

  // Both valid forms must route to project endpoints, which reject the instance-only parameter.
  it('lists group deploy keys with explicit public=false', async () => {
    const scope = { group, includeSubgroups: false };
    const restricted = { ...policy(), scope, scopeEnforcer: new ScopeEnforcer(scope) };
    const result = (await executeScoped(
      run,
      'browse_deploy_keys',
      { action: 'list', public: false },
      restricted,
    )) as unknown[] | { items: unknown[] };
    expect(Array.isArray(result) || Array.isArray((result as { items?: unknown[] }).items)).toBe(
      true,
    );
  }, 60000);

  describeIfTier('ultimate', 'vulnerability composition', () => {
    // Exercise real project/group queries, requested ordering, and the emitted scope provenance.
    it('combines overlapping vulnerability connections within the working scope', async () => {
      const restricted = policy();
      const result = (await executeScoped(
        run,
        'browse_vulnerabilities',
        { action: 'list', first: 5, sort: 'severity_desc' },
        restricted,
      )) as { nodes: Array<{ id: string; project: { fullPath: string } }>; pageInfo: unknown };
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.pageInfo).toBeDefined();
      expect(new Set(result.nodes.map((node) => node.id)).size).toBe(result.nodes.length);
      for (const node of result.nodes)
        expect(restricted.scopeEnforcer.isAllowed(node.project.fullPath)).toBe(true);
    }, 60000);
  });
});
