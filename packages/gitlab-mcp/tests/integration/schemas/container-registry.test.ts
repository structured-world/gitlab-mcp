/**
 * Container Registry Schema Integration Tests
 *
 * Backed by the GitLab GraphQL Container Registry API. The test instance usually
 * has no pushed images, so the lifecycle (tags, deletes) is environment-adaptive:
 * it exercises list_repositories end-to-end and only drills into a repository when
 * one actually exists. Destructive actions are never run against real data here.
 */

import { BrowseRegistrySchema } from '../../../src/entities/container_registry/schema-readonly';
import { ManageRegistrySchema } from '../../../src/entities/container_registry/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';

describe('Container Registry Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;
  let testProjectPath: string | undefined;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();

    const projects = (await helper.listProjects({ search: 'test', per_page: 5 })) as {
      path_with_namespace: string;
    }[];
    const inTestGroup = projects.find((p) => p.path_with_namespace.startsWith('test/'));
    testProjectPath = (inTestGroup ?? projects[0])?.path_with_namespace;
  });

  describe('schema validation', () => {
    it('validates browse_registry actions', () => {
      for (const params of [
        { action: 'list_repositories', project_id: 'g/p', first: 10 },
        { action: 'get_repository', repository_id: 1 },
        { action: 'list_tags', repository_id: 1, name: 'v' },
        { action: 'get_tag', repository_id: 1, tag_name: 'latest' },
      ]) {
        expect(BrowseRegistrySchema.safeParse(params).success).toBe(true);
      }
    });

    it('validates manage_registry actions', () => {
      for (const params of [
        { action: 'delete_repository', repository_id: 1 },
        { action: 'delete_tag', repository_id: 1, tag_name: 'old' },
        {
          action: 'delete_tags_bulk',
          repository_id: 1,
          name_regex_delete: '.*',
          keep_n: 5,
          older_than: '7d',
        },
      ]) {
        expect(ManageRegistrySchema.safeParse(params).success).toBe(true);
      }
    });

    it('rejects a malformed older_than duration', () => {
      const result = ManageRegistrySchema.safeParse({
        action: 'delete_tags_bulk',
        repository_id: 1,
        name_regex_delete: '.*',
        older_than: '7days',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('list_repositories (end-to-end)', () => {
    it('returns a repository connection for a real project', async () => {
      if (!testProjectPath) {
        console.log('No test project available; skipping');
        return;
      }

      const result = (await helper.executeTool('browse_registry', {
        action: 'list_repositories',
        project_id: testProjectPath,
        first: 5,
      })) as { nodes: { id: number; name: string | null }[]; pageInfo: { hasNextPage: boolean } };

      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.pageInfo).toBeDefined();
      console.log(`  ${testProjectPath} has ${result.nodes.length} container repositories`);
    }, 15000);

    it('drills into a repository and its tags when one exists', async () => {
      if (!testProjectPath) {
        console.log('No test project available; skipping');
        return;
      }

      const list = (await helper.executeTool('browse_registry', {
        action: 'list_repositories',
        project_id: testProjectPath,
        first: 1,
      })) as { nodes: { id: number }[] };

      if (list.nodes.length === 0) {
        console.log('  No container images pushed; skipping repository/tags drill-down');
        return;
      }

      const repoId = list.nodes[0].id;
      const repo = (await helper.executeTool('browse_registry', {
        action: 'get_repository',
        repository_id: repoId,
      })) as { id: number };
      expect(repo.id).toBe(repoId);

      const tags = (await helper.executeTool('browse_registry', {
        action: 'list_tags',
        repository_id: repoId,
        first: 5,
      })) as { nodes: unknown[] };
      expect(Array.isArray(tags.nodes)).toBe(true);
      console.log(`  repository ${repoId} has ${tags.nodes.length} tags`);
    }, 20000);
  });
});
