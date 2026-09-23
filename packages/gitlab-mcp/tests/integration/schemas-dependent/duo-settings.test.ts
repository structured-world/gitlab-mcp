/**
 * GitLab Duo settings through manage_project / manage_namespace update, against
 * a real instance.
 *
 * Whether GitLab applies a Duo setting depends on add-ons and feature flags the
 * test instance may or may not have, so the tests assert an instance-independent
 * invariant instead of a fixed outcome: every requested setting is either
 * confirmed by an independent read or reported in `not_applied`, and a reported
 * setting really is unchanged. A silently dropped setting fails the test.
 */

import { ManageNamespaceSchema, ManageProjectSchema } from '../../../src/entities/core/schema';
import { BrowseProjectsSchema } from '../../../src/entities/core/schema-readonly';
import { coreToolRegistry } from '../../../src/entities/core/registry';
import { GROUP_DUO_SETTINGS, PROJECT_DUO_SETTINGS } from '../../../src/entities/core/duo-settings';
import { ConnectionManager } from '../../../src/services/ConnectionManager';
import { getRestrictedParameters } from '../../../src/services/InstanceCapabilities';
import { enhancedFetch } from '../../../src/utils/fetch';
import { getTestGroup, getTestProject } from '../../setup/testConfig';
import { IntegrationTestHelper, initIntegrationHelper } from '../helpers/registry-helper';

type Entity = Record<string, unknown> & {
  id: number;
  not_applied?: Array<{ setting: string; requested: unknown; current?: unknown }>;
};

/** Settings the tool catalog offers on this instance (tier/version gating applied). */
function offeredSettings(toolName: string, tracked: Readonly<Record<string, string>>): string[] {
  const info = ConnectionManager.getInstance().getInstanceInfo();
  const restricted = getRestrictedParameters(coreToolRegistry.get(toolName)!.requirements, {
    version: info.version,
    tier: info.tier,
  });
  return Object.keys(tracked).filter((name) => !restricted.includes(name));
}

/**
 * For each requested setting: confirmed by the fresh read, or listed in
 * not_applied with the fresh read still showing a different value.
 */
function expectAppliedOrReported(
  requested: Record<string, boolean>,
  updated: Entity,
  fresh: Record<string, unknown>,
): void {
  const reported = new Map((updated.not_applied ?? []).map((entry) => [entry.setting, entry]));
  for (const [setting, value] of Object.entries(requested)) {
    const entry = reported.get(setting);
    if (entry) {
      expect(entry.requested).toBe(value);
      expect(fresh[setting]).not.toBe(value);
    } else {
      expect(fresh[setting]).toBe(value);
    }
  }
}

describe('GitLab Duo settings - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    helper = await initIntegrationHelper();
  });

  it('applies or reports every offered project Duo setting', async () => {
    const offered = offeredSettings('manage_project', PROJECT_DUO_SETTINGS);
    if (offered.length === 0) {
      console.log('Instance tier/version offers no project Duo settings - nothing to verify');
      return;
    }
    const projectId = String(getTestProject()!.id);
    const getProject = async () =>
      (await helper.executeTool(
        'browse_projects',
        BrowseProjectsSchema.parse({ action: 'get', project_id: projectId }),
      )) as Record<string, unknown>;

    // Flip every offered setting so an unchanged value cannot pass as "applied".
    const before = await getProject();
    const requested = Object.fromEntries(offered.map((name) => [name, before[name] !== true]));

    const updated = (await helper.executeTool(
      'manage_project',
      ManageProjectSchema.parse({ action: 'update', project_id: projectId, ...requested }),
    )) as Entity;
    console.log(
      `Project Duo settings not applied on this instance: ${JSON.stringify(updated.not_applied ?? [])}`,
    );

    expectAppliedOrReported(requested, updated, await getProject());
  }, 60000);

  it('applies or reports group automatic Duo code review', async () => {
    const offered = offeredSettings('manage_namespace', GROUP_DUO_SETTINGS);
    if (offered.length === 0) {
      console.log('Instance tier/version offers no group Duo settings - nothing to verify');
      return;
    }
    const groupId = String(getTestGroup()!.id);
    // No tool reads a group's settings (browse_namespaces reads /namespaces), so
    // the independent read goes to the groups endpoint directly.
    const getGroup = async () => {
      const response = await enhancedFetch(
        `${process.env.GITLAB_API_URL}/api/v4/groups/${groupId}?with_projects=false`,
      );
      expect(response.ok).toBe(true);
      return (await response.json()) as Record<string, unknown>;
    };

    const before = await getGroup();
    const requested = Object.fromEntries(offered.map((name) => [name, before[name] !== true]));

    const updated = (await helper.executeTool(
      'manage_namespace',
      ManageNamespaceSchema.parse({ action: 'update', group_id: groupId, ...requested }),
    )) as Entity;
    console.log(
      `Group Duo settings not applied on this instance: ${JSON.stringify(updated.not_applied ?? [])}`,
    );

    expectAppliedOrReported(requested, updated, await getGroup());
  }, 60000);
});
