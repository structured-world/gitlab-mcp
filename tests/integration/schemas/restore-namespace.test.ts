/**
 * Group (namespace) Restore Schema Integration Tests
 * Exercises the soft-delete recovery lifecycle for groups against a real GitLab
 * API: create a subgroup under the test group, soft-delete it, then restore it
 * via the manage_namespace restore action.
 *
 * Group restore requires GitLab 18.0+ (GA 18.9). The test skips on older
 * instances, and (like the project restore test) skips the restore assertion
 * when the instance purges immediately instead of soft-deleting.
 */

import { ManageNamespaceSchema } from '../../../src/entities/core/schema';
import { parseVersion } from '../../../src/utils/version';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface Group {
  id: number;
  full_path: string;
  marked_for_deletion_on?: string | null;
}

describe('Group Restore - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  it('creates, soft-deletes, and restores a group', async () => {
    const ctx = (await helper.executeTool('manage_context', { action: 'whoami' })) as {
      server?: { version?: string };
    };
    const version = ctx.server?.version ?? 'unknown';
    if (version === 'unknown' || parseVersion(version) < parseVersion('18.0')) {
      console.log(`  Skipping group restore: requires GitLab 18.0+, instance is ${version}`);
      return;
    }

    // Find the mandated 'test' root group to host the throwaway subgroup.
    const testGroup = (await helper
      .executeTool('browse_namespaces', {
        action: 'get',
        namespace_id: 'test',
      })
      .catch(() => null)) as { id?: number } | null;
    if (!testGroup?.id) {
      console.log('  Skipping group restore: test root group not found');
      return;
    }

    const suffix = Date.now();
    const created = (await helper.executeTool(
      'manage_namespace',
      ManageNamespaceSchema.parse({
        action: 'create',
        name: `it-restore-grp-${suffix}`,
        path: `it-restore-grp-${suffix}`,
        parent_id: testGroup.id,
      }),
    )) as Group;
    expect(created.id).toBeGreaterThan(0);
    const groupId = created.id;

    let restored = false;
    try {
      // Soft-delete. On an instance with adjourned deletion this marks the group
      // for deletion; otherwise it purges immediately. enhancedFetch retries
      // transient 5xx internally, so a single attempt suffices.
      let deleted = false;
      try {
        await helper.executeTool(
          'manage_namespace',
          ManageNamespaceSchema.parse({ action: 'delete', group_id: String(groupId) }),
        );
        deleted = true;
      } catch {
        deleted = false;
      }

      if (!deleted) {
        console.log('  Instance did not delete the group - skipping restore assertion');
        return;
      }

      // Determine whether the group is recoverable (still present, marked).
      let markedForDeletion = false;
      try {
        const afterDelete = (await helper.executeTool('browse_namespaces', {
          action: 'get',
          namespace_id: String(groupId),
        })) as Group;
        markedForDeletion = Boolean(afterDelete.marked_for_deletion_on);
      } catch {
        markedForDeletion = false;
      }

      if (!markedForDeletion) {
        console.log('  Group purged immediately - skipping restore assertion');
        return;
      }

      const result = (await helper.executeTool(
        'manage_namespace',
        ManageNamespaceSchema.parse({ action: 'restore', group_id: String(groupId) }),
      )) as Group;
      expect(result.id).toBe(groupId);
      expect(result.marked_for_deletion_on ?? null).toBeNull();
      restored = true;
    } finally {
      if (restored) {
        await helper
          .executeTool(
            'manage_namespace',
            ManageNamespaceSchema.parse({ action: 'delete', group_id: String(groupId) }),
          )
          .catch(() => {});
      }
    }
  }, 60000);
});
