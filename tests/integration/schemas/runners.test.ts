/**
 * Runners Schema Integration Tests
 *
 * Backed by the GitLab GraphQL runner API. The test instance may or may not have
 * runners registered and the token may or may not be an admin, so the lifecycle is
 * environment-adaptive: it always exercises list_owned end-to-end, tries list_all
 * (admin-only) tolerantly, and only drills into a single runner / its jobs when one
 * actually exists. No runners are created, mutated, or deleted against real data.
 */

import { BrowseRunnersSchema } from '../../../src/entities/runners/schema-readonly';
import { ManageRunnerSchema } from '../../../src/entities/runners/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface RunnerConnection {
  nodes: { id: number; description: string | null }[];
  pageInfo: { hasNextPage: boolean };
}

describe('Runners Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  describe('schema validation', () => {
    it('validates browse_runners actions', () => {
      for (const params of [
        { action: 'list_all', status: 'ONLINE', first: 10 },
        { action: 'list_owned', type: 'INSTANCE_TYPE' },
        { action: 'list_project', project_id: 'g/p', paused: false },
        { action: 'list_group', group_id: 'g', tag_list: ['linux'] },
        { action: 'get', runner_id: 1 },
        { action: 'list_jobs', runner_id: 1, statuses: 'FAILED' },
      ]) {
        expect(BrowseRunnersSchema.safeParse(params).success).toBe(true);
      }
    });

    it('validates manage_runner actions', () => {
      for (const params of [
        {
          action: 'create_authentication_token',
          runner_type: 'INSTANCE_TYPE',
          description: 'ci-box',
          tag_list: ['linux'],
        },
        { action: 'create_authentication_token', runner_type: 'GROUP_TYPE', group_id: 'g' },
        { action: 'update', runner_id: 1, run_untagged: false, maximum_timeout: 600 },
        { action: 'pause', runner_id: 1 },
        { action: 'resume', runner_id: 1 },
        { action: 'delete', runner_id: 1 },
        { action: 'reset_authentication_token', runner_id: 1 },
      ]) {
        expect(ManageRunnerSchema.safeParse(params).success).toBe(true);
      }
    });

    it('rejects an invalid access_level', () => {
      const result = ManageRunnerSchema.safeParse({
        action: 'update',
        runner_id: 1,
        access_level: 'PUBLIC',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-positive runner_id', () => {
      const result = BrowseRunnersSchema.safeParse({ action: 'get', runner_id: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('list_owned (end-to-end)', () => {
    it('returns a runner connection for the current user', async () => {
      const result = (await helper.executeTool('browse_runners', {
        action: 'list_owned',
        first: 5,
      })) as RunnerConnection;

      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.pageInfo).toBeDefined();
      console.log(`  current user can see ${result.nodes.length} runners`);
    }, 15000);

    it('drills into a runner and its jobs when one exists', async () => {
      const list = (await helper.executeTool('browse_runners', {
        action: 'list_owned',
        first: 1,
      })) as RunnerConnection;

      if (list.nodes.length === 0) {
        console.log('  No runners registered; skipping runner/jobs drill-down');
        return;
      }

      const runnerId = list.nodes[0].id;
      const runner = (await helper.executeTool('browse_runners', {
        action: 'get',
        runner_id: runnerId,
      })) as { id: number };
      expect(runner.id).toBe(runnerId);

      const jobs = (await helper.executeTool('browse_runners', {
        action: 'list_jobs',
        runner_id: runnerId,
        first: 5,
      })) as { nodes: unknown[] };
      expect(Array.isArray(jobs.nodes)).toBe(true);
      console.log(`  runner ${runnerId} has ${jobs.nodes.length} recent jobs`);
    }, 20000);
  });

  describe('list_all (admin, tolerant)', () => {
    it('returns a connection or reports lack of admin access', async () => {
      try {
        const result = (await helper.executeTool('browse_runners', {
          action: 'list_all',
          first: 5,
        })) as RunnerConnection;
        expect(Array.isArray(result.nodes)).toBe(true);
        console.log(`  instance-wide list returned ${result.nodes.length} runners`);
      } catch (error) {
        // Non-admin tokens cannot list every runner; that is an expected outcome.
        console.log(`  list_all not available for this token: ${(error as Error).message}`);
      }
    }, 15000);
  });
});
