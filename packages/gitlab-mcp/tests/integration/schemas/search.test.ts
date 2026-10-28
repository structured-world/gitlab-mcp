import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

describe('Search - GitLab integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  // These scopes remain available per project even without a cross-project search backend.
  it.each(['blobs', 'commits', 'notes', 'wiki_blobs'])(
    'searches the lifecycle project for %s',
    async (scope) => {
      const project = getTestData().project;
      if (!project?.path_with_namespace.startsWith('test/')) {
        throw new Error('Search tests require a suite-owned project under test/');
      }
      const result = (await helper.executeTool('browse_search', {
        action: 'project',
        project_id: project.path_with_namespace,
        scope,
        search: 'integration',
      })) as { project_id: string; scope: string; count: number; results: unknown[] };
      expect(result.project_id).toBe(project.path_with_namespace);
      expect(result.scope).toBe(scope);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.count).toBe(result.results.length);
    },
  );
});
