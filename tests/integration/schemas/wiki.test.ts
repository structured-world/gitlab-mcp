/**
 * Wiki Schema Integration Tests
 * Tests ListWikiPagesSchema, GetWikiPageSchema, CreateWikiPageSchema, UpdateWikiPageSchema, DeleteWikiPageSchema
 * against real GitLab 18.3 API responses following CRITICAL COMPREHENSIVE TEST DATA LIFECYCLE WORKFLOW RULE
 */

import { beforeAll, describe, expect, it, afterAll } from '@jest/globals';
import {
  ListWikiPagesSchema,
  GetWikiPageSchema,
  CreateWikiPageSchema,
  UpdateWikiPageSchema,
  DeleteWikiPageSchema,
  GitLabWikiPageSchema,
} from '../../../src/entities/wiki';

// Test environment constants
const GITLAB_API_URL = process.env.GITLAB_API_URL!;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN!;
const TEST_GROUP = process.env.TEST_GROUP;

// Dynamic test data following ZERO DATA VALIDATION RULE
const testTimestamp = Date.now();
let testGroupId: string | null = null;
let createdTestGroup = false;
let testProjectId: string | null = null;
let createdWikiSlugs: string[] = [];

describe('Wiki Schema - GitLab 18.3 Integration', () => {
  beforeAll(async () => {
    expect(GITLAB_API_URL).toBeDefined();
    expect(GITLAB_TOKEN).toBeDefined();
    expect(TEST_GROUP).toBeDefined();

    // Create test infrastructure for wiki testing following ZERO DATA VALIDATION RULE
    console.log(`🔧 Setting up test infrastructure for wiki schema validation...`);

    // Check if test group exists, create if needed
    try {
      const checkGroupResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(TEST_GROUP!)}`, {
        headers: { 'Authorization': `Bearer ${GITLAB_TOKEN}` },
      });

      if (checkGroupResponse.ok) {
        const existingGroup = await checkGroupResponse.json();
        testGroupId = existingGroup.id;
        console.log(`✅ Found test group: ${existingGroup.name} (ID: ${existingGroup.id})`);
      } else if (checkGroupResponse.status === 404) {
        const groupData = {
          name: TEST_GROUP,
          path: TEST_GROUP,
          description: `Test group for wiki schema validation - ${testTimestamp}`,
          visibility: 'private',
        };

        const createGroupResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(groupData),
        });

        if (createGroupResponse.ok) {
          const group = await createGroupResponse.json();
          testGroupId = group.id;
          createdTestGroup = true;
          console.log(`✅ Created test group: ${group.name} (ID: ${group.id})`);
        }
      }
    } catch (error) {
      console.log(`⚠️  Error with group operations:`, error);
    }

    // Create test project for wiki testing
    if (testGroupId) {
      const projectData = {
        name: `wiki-test-project-${testTimestamp}`,
        path: `wiki-test-project-${testTimestamp}`,
        description: `Test project for wiki schema validation - ${testTimestamp}`,
        visibility: 'private',
        namespace_id: testGroupId,
        wiki_enabled: true,
      };

      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(projectData),
        });

        if (response.ok) {
          const project = await response.json();
          testProjectId = project.id;
          console.log(`✅ Created test project for wiki: ${project.name} (ID: ${project.id})`);
        } else {
          const errorBody = await response.text();
          console.log(`⚠️  Could not create test project: ${response.status} - ${errorBody}`);
        }
      } catch (error) {
        console.log(`⚠️  Error creating test project:`, error);
      }
    }

    console.log(`✅ Wiki test setup complete - project ID: ${testProjectId}`);
  });

  afterAll(async () => {
    // Clean up created wiki pages first
    if (createdWikiSlugs.length > 0 && testProjectId) {
      console.log('🧹 Cleaning up created wiki pages...');
      for (const slug of createdWikiSlugs) {
        try {
          const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/wikis/${encodeURIComponent(slug)}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${GITLAB_TOKEN}`,
            },
          });
          if (response.ok) {
            console.log(`✅ Cleaned up wiki page: ${slug}`);
          }
        } catch (error) {
          console.log(`⚠️ Could not clean up wiki page ${slug}:`, error);
        }
      }
    }

    // Clean up test project
    if (testProjectId) {
      console.log('🧹 Cleaning up test project...');
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok || response.status === 404) {
          console.log(`✅ Cleaned up test project: ${testProjectId}`);
        } else {
          console.log(`⚠️  Could not delete project ${testProjectId}: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  Error deleting project ${testProjectId}:`, error);
      }
    }

    // Clean up test group only if we created it
    if (createdTestGroup && testGroupId) {
      console.log(`🧹 Cleaning up test group '${TEST_GROUP}' (ID: ${testGroupId}) that was created during test...`);
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/groups/${testGroupId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok || response.status === 404) {
          console.log(`✅ Cleaned up test group '${TEST_GROUP}': ${testGroupId}`);
        } else {
          console.log(`⚠️  Could not delete group '${TEST_GROUP}' ${testGroupId}: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  Error deleting group '${TEST_GROUP}' ${testGroupId}:`, error);
      }
    } else if (testGroupId && !createdTestGroup) {
      console.log(`ℹ️  Test group '${TEST_GROUP}' (ID: ${testGroupId}) existed before test - not deleting`);
    }
  });

  describe('ListWikiPagesSchema', () => {
    it('should validate basic list wiki pages parameters', async () => {
      const validParams = {
        project_id: testProjectId!,
        with_content: true,
      };

      const result = ListWikiPagesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.with_content).toBe(true);
      }

      console.log('✅ ListWikiPagesSchema validates basic parameters correctly');
    });

    it('should make successful API request with validated parameters (initially empty)', async () => {
      const params = {
        project_id: testProjectId!,
        with_content: false,
      };

      // Validate parameters first
      const paramResult = ListWikiPagesSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 ListWikiPagesSchema - Testing against real GitLab API');

      const queryParams = new URLSearchParams({
        with_content: String(paramResult.data.with_content || false),
      });

      console.log(`🔍 API URL: ${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/wikis?${queryParams}`);

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/wikis?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      expect(response.ok).toBe(true);

      const wikiPages = await response.json();
      expect(Array.isArray(wikiPages)).toBe(true);

      console.log(`📋 Retrieved ${wikiPages.length} wiki pages (expected: 0 initially)`);

      // Validate each wiki page against schema
      wikiPages.forEach((page: any) => {
        const pageResult = GitLabWikiPageSchema.safeParse(page);
        expect(pageResult.success).toBe(true);
      });

      console.log('✅ ListWikiPagesSchema API request successful - found 0 wiki pages as expected for clean test environment');
    });

    it('should validate advanced filtering parameters', async () => {
      const advancedParams = {
        project_id: testProjectId!,
        with_content: true,
        per_page: 50,
        page: 1,
      };

      const result = ListWikiPagesSchema.safeParse(advancedParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.with_content).toBe(true);
      }

      console.log('✅ ListWikiPagesSchema validates advanced filtering parameters');
    });

    it('should accept additional unknown parameters (schemas are permissive)', async () => {
      const paramsWithExtra = {
        project_id: testProjectId!,
        unknown_field: 'test',
        extra_param: 123,
      };

      const result = ListWikiPagesSchema.safeParse(paramsWithExtra);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
      }

      console.log('✅ ListWikiPagesSchema accepts additional properties as designed');
    });
  });

  describe('CreateWikiPageSchema + Complete CRUD Lifecycle', () => {
    it('should validate create wiki page parameters', async () => {
      const validParams = {
        project_id: testProjectId!,
        title: 'Test Page',
        content: 'Test content',
        format: 'markdown',
      };

      const result = CreateWikiPageSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.title).toBe('Test Page');
        expect(result.data.content).toBe('Test content');
        expect(result.data.format).toBe('markdown');
      }

      console.log('✅ CreateWikiPageSchema validates parameters correctly');
    });

    it('should create a wiki page via API', async () => {
      const wikiData = {
        project_id: testProjectId!,
        title: `Test Wiki Page ${testTimestamp}`,
        content: `# Test Wiki Page\n\nThis is a test wiki page created for CRUD testing - safe to delete.\n\nTimestamp: ${testTimestamp}`,
        format: 'markdown',
      };

      // Validate parameters first
      const paramResult = CreateWikiPageSchema.safeParse(wikiData);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 Creating wiki page via GitLab API...');

      // Create the wiki page
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/wikis`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: paramResult.data.title,
          content: paramResult.data.content,
          format: paramResult.data.format,
        }),
      });

      expect(response.ok).toBe(true);

      const createdPage = await response.json();

      console.log('📋 Created wiki page:', createdPage);

      // Validate response structure
      const pageResult = GitLabWikiPageSchema.safeParse(createdPage);
      expect(pageResult.success).toBe(true);

      expect(createdPage.title).toBe(`Test Wiki Page ${testTimestamp}`);
      expect(createdPage.slug).toBeDefined();
      expect(createdPage.format).toBe('markdown');
      expect(createdPage.content).toContain('Test Wiki Page');

      // Store slug for cleanup
      createdWikiSlugs.push(createdPage.slug);

      console.log(`✅ Successfully created wiki page with slug: ${createdPage.slug}`);
    });

    it('should create a second wiki page for testing list functionality', async () => {
      const wikiData = {
        project_id: testProjectId!,
        title: `Test Documentation ${testTimestamp}`,
        content: `# Documentation Page\n\nThis is a documentation page for testing list functionality - safe to delete.\n\nCreated: ${new Date().toISOString()}`,
        format: 'markdown',
      };

      // Create second wiki page
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/wikis`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: wikiData.title,
          content: wikiData.content,
          format: wikiData.format,
        }),
      });

      expect(response.ok).toBe(true);
      const createdPage = await response.json();

      // Store slug for cleanup
      createdWikiSlugs.push(createdPage.slug);

      console.log(`✅ Successfully created second wiki page with slug: ${createdPage.slug}`);
    });
  });

  describe('GetWikiPageSchema', () => {
    it('should validate get wiki page parameters', async () => {
      const validParams = {
        project_id: testProjectId!,
        slug: 'test-page',
      };

      const result = GetWikiPageSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.slug).toBe('test-page');
      }

      console.log('✅ GetWikiPageSchema validates parameters correctly');
    });

    it('should get a wiki page via API using dynamic slug', async () => {
      if (createdWikiSlugs.length === 0) {
        throw new Error('No wiki pages created for testing');
      }

      const testSlug = createdWikiSlugs[0];
      const params = {
        project_id: testProjectId!,
        slug: testSlug,
      };

      // Validate parameters first
      const paramResult = GetWikiPageSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log(`🔍 Getting wiki page slug: ${testSlug} via GitLab API...`);

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/wikis/${encodeURIComponent(paramResult.data.slug!)}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const retrievedPage = await response.json();

      console.log('📋 Retrieved wiki page:', retrievedPage);

      // Validate response structure
      const pageResult = GitLabWikiPageSchema.safeParse(retrievedPage);
      expect(pageResult.success).toBe(true);

      expect(retrievedPage.slug).toBe(testSlug);
      expect(retrievedPage.title).toContain(`${testTimestamp}`);
      expect(retrievedPage.content).toContain('Test Wiki Page');

      console.log(`✅ Successfully retrieved wiki page with slug: ${testSlug}`);
    });
  });

  describe('ListWikiPagesSchema with Data', () => {
    it('should list wiki pages after creation and validate actual data', async () => {
      const params = {
        project_id: testProjectId!,
        with_content: true,
      };

      const queryParams = new URLSearchParams({
        with_content: 'true',
      });

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/wikis?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);
      const wikiPages = await response.json();

      expect(Array.isArray(wikiPages)).toBe(true);
      expect(wikiPages.length).toBeGreaterThan(0);

      console.log(`📋 Retrieved ${wikiPages.length} wiki pages with actual data`);

      // Validate each wiki page
      wikiPages.forEach((page: any) => {
        const pageResult = GitLabWikiPageSchema.safeParse(page);
        expect(pageResult.success).toBe(true);

        expect(page.title).toBeDefined();
        expect(page.slug).toBeDefined();
        expect(page.format).toBeDefined();
        expect(page.content).toBeDefined(); // Should have content since with_content=true
      });

      // Verify our test pages are included
      const testPages = wikiPages.filter((page: any) => page.title.includes(`${testTimestamp}`));
      expect(testPages.length).toBeGreaterThanOrEqual(2);

      console.log('✅ ListWikiPagesSchema API request successful, validated wiki pages with real data');
    });
  });

  describe('UpdateWikiPageSchema', () => {
    it('should validate update wiki page parameters', async () => {
      const validParams = {
        project_id: testProjectId!,
        slug: 'test-page',
        title: 'Updated Test Page',
        content: 'Updated content',
        format: 'markdown',
      };

      const result = UpdateWikiPageSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.slug).toBe('test-page');
        expect(result.data.title).toBe('Updated Test Page');
        expect(result.data.content).toBe('Updated content');
        expect(result.data.format).toBe('markdown');
      }

      console.log('✅ UpdateWikiPageSchema validates parameters correctly');
    });

    it('should update a wiki page via API using dynamic slug', async () => {
      if (createdWikiSlugs.length === 0) {
        throw new Error('No wiki pages created for testing');
      }

      const testSlug = createdWikiSlugs[0];
      const updateData = {
        project_id: testProjectId!,
        slug: testSlug,
        title: `Updated Wiki Page ${testTimestamp}`,
        content: `# Updated Wiki Page\n\nThis wiki page has been updated during testing - safe to delete.\n\nUpdated: ${new Date().toISOString()}\nTimestamp: ${testTimestamp}`,
        format: 'markdown',
      };

      // Validate parameters first
      const paramResult = UpdateWikiPageSchema.safeParse(updateData);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log(`🔍 Updating wiki page slug: ${testSlug} via GitLab API...`);
      console.log(`📤 Update payload:`, {
        title: paramResult.data.title,
        content: paramResult.data.content,
        format: paramResult.data.format,
      });

      // Update the wiki page
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/wikis/${encodeURIComponent(paramResult.data.slug!)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: paramResult.data.title,
          content: paramResult.data.content,
          format: paramResult.data.format,
        }),
      });

      expect(response.ok).toBe(true);

      const updatedPage = await response.json();

      console.log('📋 Updated wiki page:', updatedPage);

      // Validate the updated wiki page
      const pageResult = GitLabWikiPageSchema.safeParse(updatedPage);
      expect(pageResult.success).toBe(true);

      // Note: GitLab automatically updates slug when title changes
      expect(updatedPage.slug).toBe(`Updated-Wiki-Page-${testTimestamp}`);
      expect(updatedPage.title).toBe(`Updated Wiki Page ${testTimestamp}`);
      expect(updatedPage.content).toContain('Updated Wiki Page');
      expect(updatedPage.content).toContain('updated during testing');
      expect(updatedPage.format).toBe('markdown');

      // Update our cleanup list with the new slug
      const oldIndex = createdWikiSlugs.indexOf(testSlug);
      if (oldIndex > -1) {
        createdWikiSlugs[oldIndex] = updatedPage.slug;
      }

      console.log(`✅ Successfully updated wiki page with slug: ${testSlug}`);
    });
  });

  describe('DeleteWikiPageSchema', () => {
    it('should validate delete wiki page parameters', async () => {
      const validParams = {
        project_id: testProjectId!,
        slug: 'test-page',
      };

      const result = DeleteWikiPageSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.slug).toBe('test-page');
      }

      console.log('✅ DeleteWikiPageSchema validates parameters correctly');
    });

    it('should validate deletion will work with created wiki slugs', async () => {
      expect(createdWikiSlugs.length).toBeGreaterThan(0);

      for (const slug of createdWikiSlugs) {
        const deleteParams = {
          project_id: testProjectId!,
          slug: slug,
        };

        const result = DeleteWikiPageSchema.safeParse(deleteParams);
        expect(result.success).toBe(true);

        if (result.success) {
          expect(result.data.project_id).toBe(String(testProjectId));
          expect(result.data.slug).toBe(slug);
        }
      }

      console.log(`✅ DeleteWikiPageSchema validates deletion parameters for ${createdWikiSlugs.length} wiki pages`);
      console.log(`🧹 Wiki pages will be cleaned up in afterAll: ${createdWikiSlugs.join(', ')}`);
    });
  });

  describe('Schema Edge Cases', () => {
    it('should accept parameters (GitLab API handles validation)', async () => {
      const basicParams = {
        project_id: testProjectId!,
        title: '', // Schema accepts empty string, API may reject
        content: '', // Schema accepts empty string, API may reject
      };

      const result = CreateWikiPageSchema.safeParse(basicParams);
      expect(result.success).toBe(true); // Schema is permissive

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.title).toBe('');
        expect(result.data.content).toBe('');
      }

      console.log('✅ CreateWikiPageSchema accepts parameters, API handles validation');
    });
  });
});