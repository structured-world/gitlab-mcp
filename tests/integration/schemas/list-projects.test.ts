/**
 * List Projects Schema Integration Tests
 * Tests ListProjectsSchema against real GitLab 18.3 API responses using handler functions
 */

import { ListProjectsSchema } from '../../../src/entities/core/schema-readonly';
import { GitLabProjectSchema } from '../../../src/entities/shared';
import { IntegrationTestHelper } from '../helpers/registry-helper';

describe('ListProjectsSchema - GitLab 18.3 Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }

    // Initialize integration test helper
    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log('✅ Integration test helper initialized for list projects testing');
  });

  it('should validate basic list projects parameters', async () => {
    // Test basic parameters that should work with any GitLab instance
    const validParams = {
      per_page: 5,
      page: 1,
      order_by: 'name' as const,
      sort: 'asc' as const,
      visibility: 'private' as const,
    };

    const result = ListProjectsSchema.safeParse(validParams);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.per_page).toBe(5);
      expect(result.data.order_by).toBe('name');
      expect(result.data.sort).toBe('asc');
      expect(result.data.visibility).toBe('private');
    }

    console.log('✅ ListProjectsSchema validates basic parameters correctly');
  });

  it('should make successful API request with validated parameters using handler function', async () => {
    const params = {
      per_page: 3,
      order_by: 'last_activity_at' as const,
      sort: 'desc' as const,
    };

    console.log('🔍 ListProjectsSchema - Testing with handler function');

    // Validate parameters first
    const paramResult = ListProjectsSchema.safeParse(params);
    expect(paramResult.success).toBe(true);

    if (paramResult.success) {
      // Use handler function instead of direct API call
      const projects = await helper.executeTool('list_projects', paramResult.data) as any[];
      console.log(`📋 Retrieved ${projects.length} projects via handler`);
      expect(Array.isArray(projects)).toBe(true);

      // Validate that each project matches our GitLabProjectSchema
      for (const project of projects.slice(0, 2)) { // Test first 2 projects
        const projectResult = GitLabProjectSchema.safeParse(project);
        if (!projectResult.success) {
          console.error('Project validation failed:', projectResult.error);
          throw new Error(`Project schema validation failed for project ${project.id}`);
        }
        expect(projectResult.success).toBe(true);
        console.log(`  ✅ Project validated: ${project.name} (ID: ${project.id})`);
      }

      console.log(`✅ ListProjectsSchema API request successful, validated ${projects.length} projects`);
    }
  }, 15000);

  it('should validate advanced filtering parameters', async () => {
    const advancedParams = {
      archived: false,
      membership: true,
      with_issues_enabled: true,
      with_merge_requests_enabled: true,
      min_access_level: 30, // Developer level
      per_page: 10,
    };

    const result = ListProjectsSchema.safeParse(advancedParams);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.archived).toBe(false);
      expect(result.data.membership).toBe(true);
      expect(result.data.with_issues_enabled).toBe(true);
      expect(result.data.min_access_level).toBe(30);
    }

    console.log('✅ ListProjectsSchema validates advanced filtering parameters');
  });

  it('should reject invalid parameters', async () => {
    const invalidParams = {
      order_by: 'invalid_field', // Invalid enum value
      sort: 'sideways', // Invalid enum value
      per_page: 150, // Exceeds max of 100
      visibility: 'secret', // Invalid enum value
    };

    const result = ListProjectsSchema.safeParse(invalidParams);
    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues).toHaveLength(4); // Should have 4 validation errors
    }

    console.log('✅ ListProjectsSchema correctly rejects invalid parameters');
  });

  it('should handle optional parameters correctly', async () => {
    // Test with minimal required parameters
    const minimalParams = {};

    const result = ListProjectsSchema.safeParse(minimalParams);
    expect(result.success).toBe(true);

    // Test with null/undefined values (should be filtered out)
    const paramsWithUndefined = {
      search: undefined,
      archived: null,
      per_page: 5,
    };

    const resultWithUndefined = ListProjectsSchema.safeParse(paramsWithUndefined);
    expect(resultWithUndefined.success).toBe(true);

    console.log('✅ ListProjectsSchema handles optional parameters correctly');
  });

  it('should validate search functionality using handler function', async () => {
    const searchParams = {
      search: 'test',
      search_namespaces: true,
      per_page: 5,
    };

    console.log('🔍 Testing search functionality with handler');

    const result = ListProjectsSchema.safeParse(searchParams);
    expect(result.success).toBe(true);

    if (result.success) {
      // Use handler function for search instead of direct API call
      const projects = await helper.executeTool('list_projects', result.data) as any[];
      expect(Array.isArray(projects)).toBe(true);

      console.log(`✅ Search via handler works, found ${projects.length} projects matching 'test'`);
    }
  }, 15000);
});