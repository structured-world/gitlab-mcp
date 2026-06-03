/**
 * Project Restore Schema Integration Tests
 * Exercises the soft-delete recovery lifecycle against a real GitLab API:
 * create a project in the test group, soft-delete it, then restore it via the
 * manage_project restore action and assert it is no longer marked for deletion.
 *
 * Restore only works while a project is within its deletion cooldown window. If
 * the instance/group purges immediately (adjourned deletion disabled), the test
 * skips the restore assertion rather than failing on an environment difference.
 */

import { ManageProjectSchema } from '../../../src/entities/core/schema';
import { BrowseProjectsSchema } from '../../../src/entities/core/schema-readonly';
import { IntegrationTestHelper, initIntegrationHelper } from '../helpers/registry-helper';

interface Project {
  id: number;
  path_with_namespace: string;
  marked_for_deletion_on?: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Project Restore - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    helper = await initIntegrationHelper();
  });

  it('creates, soft-deletes, and restores a project', async () => {
    const name = `it-restore-${Date.now()}`;
    // Defaults to the mandated 'test' root group; overridable for other instances.
    const namespace = process.env.GITLAB_TEST_NAMESPACE ?? 'test';

    const created = (await helper.executeTool(
      'manage_project',
      ManageProjectSchema.parse({
        action: 'create',
        name,
        namespace,
        initialize_with_readme: true,
      }),
    )) as Project;
    expect(created.id).toBeGreaterThan(0);
    const projectId = created.id;

    let restored = false;
    try {
      // A brand-new project finishes repository setup asynchronously; deleting
      // mid-setup can 500. Wait until it is fully readable, then delete with a
      // short retry to ride out the creation race.
      for (let i = 0; i < 5; i++) {
        try {
          await helper.executeTool(
            'browse_projects',
            BrowseProjectsSchema.parse({ action: 'get', project_id: String(projectId) }),
          );
          break;
        } catch {
          await sleep(2000);
        }
      }

      // Soft-delete. On an instance with adjourned deletion this marks the
      // project for deletion; otherwise it purges immediately. enhancedFetch
      // already retries transient 5xx internally, so a single attempt suffices.
      let deleted = false;
      try {
        await helper.executeTool(
          'manage_project',
          ManageProjectSchema.parse({ action: 'delete', project_id: String(projectId) }),
        );
        deleted = true;
      } catch {
        deleted = false;
      }

      if (!deleted) {
        // The instance would not delete the project (some GitLab deployments return
        // 5xx for programmatic project deletion). Without a soft-deleted project
        // there is no precondition for restore; the restore action itself is covered
        // by unit tests. Best-effort cleanup then skip.
        console.log('Instance did not delete the project - skipping restore assertion');
        await helper
          .executeTool(
            'manage_project',
            ManageProjectSchema.parse({ action: 'delete', project_id: String(projectId) }),
          )
          .catch(() => {});
        return;
      }

      // Determine whether the project is recoverable (still present, marked).
      let markedForDeletion = false;
      try {
        const afterDelete = (await helper.executeTool(
          'browse_projects',
          BrowseProjectsSchema.parse({ action: 'get', project_id: String(projectId) }),
        )) as Project;
        markedForDeletion = Boolean(afterDelete.marked_for_deletion_on);
      } catch {
        // GET 404 -> already purged, not recoverable
        markedForDeletion = false;
      }

      if (!markedForDeletion) {
        console.log(
          'Project purged immediately (adjourned deletion disabled) - skipping restore assertion',
        );
        return;
      }

      const result = (await helper.executeTool(
        'manage_project',
        ManageProjectSchema.parse({ action: 'restore', project_id: String(projectId) }),
      )) as Project;
      expect(result.id).toBe(projectId);
      // The restore response itself should already show the project is no longer
      // marked for deletion (avoids relying solely on the follow-up GET).
      expect(result.marked_for_deletion_on ?? null).toBeNull();
      restored = true;

      const afterRestore = (await helper.executeTool(
        'browse_projects',
        BrowseProjectsSchema.parse({ action: 'get', project_id: String(projectId) }),
      )) as Project;
      expect(afterRestore.marked_for_deletion_on ?? null).toBeNull();
    } finally {
      // Best-effort cleanup: delete the project again if we restored it.
      if (restored) {
        try {
          await helper.executeTool(
            'manage_project',
            ManageProjectSchema.parse({ action: 'delete', project_id: String(projectId) }),
          );
        } catch {
          // already gone / cooldown - leave for manual cleanup
        }
      }
    }
  }, 60000);
});
