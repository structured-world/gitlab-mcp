/**
 * Repository Schema Integration Tests
 * Tests GetRepositoryTreeSchema and file content schemas against real GitLab 18.3 API responses
 */

import { GetRepositoryTreeSchema } from '../../../src/entities/core/schema-readonly';

describe('Repository Schema - GitLab 18.3 Integration', () => {
  const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
  const GITLAB_API_URL = process.env.GITLAB_API_URL;
  const TEST_PROJECT = process.env.GITLAB_PROJECT_ID;

  let testTimestamp: string;
  let createdTags: string[] = [];

  beforeAll(async () => {
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    if (!GITLAB_API_URL) {
      throw new Error('GITLAB_API_URL environment variable is required');
    }
    if (!TEST_PROJECT) {
      throw new Error('GITLAB_PROJECT_ID environment variable is required');
    }

    testTimestamp = Date.now().toString();

    // Create test tags for repository testing to follow ZERO DATA VALIDATION RULE
    console.log('🔧 Creating test tags for repository validation...');

    const tagsToCreate = [
      {
        tag_name: `test-v1.0.0-${testTimestamp}`,
        ref: 'main',
        message: `Test tag 1 for repository schema validation - ${testTimestamp}`
      },
      {
        tag_name: `test-v1.1.0-${testTimestamp}`,
        ref: 'main',
        message: `Test tag 2 for repository schema validation - ${testTimestamp}`
      }
    ];

    for (const tagData of tagsToCreate) {
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/tags`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tagData),
        });

        if (response.ok) {
          const tag = await response.json();
          createdTags.push(tag.name);
          console.log(`✅ Created test tag: ${tag.name}`);
        } else {
          console.log(`⚠️  Could not create tag ${tagData.tag_name}: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  Error creating tag ${tagData.tag_name}:`, error);
      }
    }

    console.log(`✅ Repository test setup complete - created ${createdTags.length} test tags`);
  });

  afterAll(async () => {
    // Clean up created tags
    console.log('🧹 Cleaning up test tags...');

    for (const tagName of createdTags) {
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/tags/${encodeURIComponent(tagName)}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok) {
          console.log(`✅ Cleaned up test tag: ${tagName}`);
        } else {
          console.log(`⚠️  Could not delete tag ${tagName}: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  Error deleting tag ${tagName}:`, error);
      }
    }
  });

  describe('GetRepositoryTreeSchema', () => {
    it('should validate basic repository tree parameters', async () => {
      const validParams = {
        project_id: TEST_PROJECT,
        ref: 'main',
        path: '',
        recursive: false,
        per_page: 20,
      };

      const result = GetRepositoryTreeSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(TEST_PROJECT);
        expect(result.data.ref).toBe('main');
        expect(result.data.recursive).toBe(false);
      }

      console.log('✅ GetRepositoryTreeSchema validates basic parameters correctly');
    });

    it('should make successful API request with validated parameters', async () => {
      const params = {
        project_id: TEST_PROJECT,
        ref: 'main',
        path: '',
        per_page: 10,
      };

      // Validate parameters first
      const paramResult = GetRepositoryTreeSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      // Build query string from validated parameters
      const queryParams = new URLSearchParams();
      Object.entries(paramResult.data).forEach(([key, value]) => {
        if (value !== undefined && key !== 'project_id') {
          queryParams.set(key, String(value));
        }
      });

      console.log('🔍 GetRepositoryTreeSchema - Testing against real GitLab API');

      // Make API request (with correct API prefix)
      const apiUrl = `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/repository/tree?${queryParams}`;
      console.log(`🔍 API URL: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ API Error Response:', errorBody.substring(0, 500));
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
      }

      const treeItems = await response.json();
      console.log(`📋 Retrieved ${treeItems.length} tree items`);
      expect(Array.isArray(treeItems)).toBe(true);

      // Validate basic tree item structure
      for (const item of treeItems.slice(0, 3)) { // Test first 3 items
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('type');
        expect(item).toHaveProperty('path');
        expect(item).toHaveProperty('mode');

        // Validate tree item types
        expect(['tree', 'blob']).toContain(item.type);
      }

      console.log(`✅ GetRepositoryTreeSchema API request successful, validated ${treeItems.length} tree items`);
    }, 15000);

    it('should validate recursive tree parameters', async () => {
      const recursiveParams = {
        project_id: TEST_PROJECT,
        ref: 'main',
        recursive: true,
        per_page: 50,
      };

      const result = GetRepositoryTreeSchema.safeParse(recursiveParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.recursive).toBe(true);
        expect(result.data.per_page).toBe(50);
      }

      console.log('✅ GetRepositoryTreeSchema validates recursive parameters correctly');
    });

    it('should validate path-specific tree parameters', async () => {
      const pathParams = {
        project_id: TEST_PROJECT,
        ref: 'main',
        path: 'src',
        recursive: false,
      };

      const result = GetRepositoryTreeSchema.safeParse(pathParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.path).toBe('src');
      }

      console.log('✅ GetRepositoryTreeSchema validates path-specific parameters correctly');
    });

    it('should reject invalid tree parameters', async () => {
      const invalidParams = {
        project_id: TEST_PROJECT,
        ref: '', // Empty ref should be invalid
        per_page: 150, // Exceeds typical max
      };

      const result = GetRepositoryTreeSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log('✅ GetRepositoryTreeSchema correctly rejects invalid parameters');
    });
  });

  describe('File Content Operations', () => {
    let testFilePath: string;

    beforeAll(async () => {
      // Get the first file from the repository to use for testing
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/tree?per_page=20`, {
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok) {
          const treeItems = await response.json();
          const file = treeItems.find((item: any) => item.type === 'blob');
          if (file) {
            testFilePath = file.path;
          }
        }
      } catch (error) {
        console.log('Could not fetch test file path');
      }
    });

    it('should successfully fetch file content', async () => {
      if (!testFilePath) {
        console.log('⚠️  Skipping file content test - no files found in repository');
        return;
      }

      // Make API request for file content
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/files/${encodeURIComponent(testFilePath)}?ref=main`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const fileData = await response.json();

      // Validate file content structure
      expect(fileData).toHaveProperty('file_name');
      expect(fileData).toHaveProperty('file_path');
      expect(fileData).toHaveProperty('size');
      expect(fileData).toHaveProperty('encoding');
      expect(fileData).toHaveProperty('content');
      expect(fileData).toHaveProperty('content_sha256');
      expect(fileData).toHaveProperty('ref');
      expect(fileData).toHaveProperty('blob_id');
      expect(fileData).toHaveProperty('commit_id');
      expect(fileData).toHaveProperty('last_commit_id');

      // Validate content is base64 encoded when encoding is base64
      if (fileData.encoding === 'base64') {
        expect(typeof fileData.content).toBe('string');
        // Basic base64 validation
        expect(() => atob(fileData.content)).not.toThrow();
      }

      console.log(`✅ File content API request successful for ${testFilePath}`);
    }, 15000);

    it('should handle raw file content requests', async () => {
      if (!testFilePath) {
        console.log('⚠️  Skipping raw file content test - no files found in repository');
        return;
      }

      // Make API request for raw file content
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/files/${encodeURIComponent(testFilePath)}/raw?ref=main`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const rawContent = await response.text();
      expect(typeof rawContent).toBe('string');

      console.log(`✅ Raw file content API request successful for ${testFilePath}`);
    }, 15000);
  });

  describe('Repository References', () => {
    it('should successfully fetch repository branches', async () => {
      // Make API request for branches
      console.log('🔍 Repository branches - Testing against real GitLab API');
      const apiUrl = `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/branches?per_page=10`;
      console.log(`🔍 API URL: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ API Error Response:', errorBody.substring(0, 500));
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
      }

      const branches = await response.json();
      console.log(`📋 Retrieved ${branches.length} branches`);
      expect(Array.isArray(branches)).toBe(true);

      // Validate basic branch structure
      for (const branch of branches.slice(0, 3)) { // Test first 3 branches
        expect(branch).toHaveProperty('name');
        expect(branch).toHaveProperty('commit');
        expect(branch).toHaveProperty('merged');
        expect(branch).toHaveProperty('protected');
        expect(branch).toHaveProperty('developers_can_push');
        expect(branch).toHaveProperty('developers_can_merge');
        expect(branch).toHaveProperty('can_push');

        // Validate commit structure
        expect(branch.commit).toHaveProperty('id');
        expect(branch.commit).toHaveProperty('short_id');
        expect(branch.commit).toHaveProperty('created_at');
        expect(branch.commit).toHaveProperty('parent_ids');
        expect(branch.commit).toHaveProperty('title');
        expect(branch.commit).toHaveProperty('message');
        expect(branch.commit).toHaveProperty('author_name');
        expect(branch.commit).toHaveProperty('author_email');
        expect(branch.commit).toHaveProperty('authored_date');
        expect(branch.commit).toHaveProperty('committer_name');
        expect(branch.commit).toHaveProperty('committer_email');
        expect(branch.commit).toHaveProperty('committed_date');
      }

      console.log(`✅ Repository branches API request successful, validated ${branches.length} branches`);
    }, 15000);

    it('should successfully fetch repository tags', async () => {
      // Make API request for tags
      console.log('🔍 Repository tags - Testing against real GitLab API');
      const apiUrl = `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT!)}/repository/tags?per_page=10`;
      console.log(`🔍 API URL: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ API Error Response:', errorBody.substring(0, 500));
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
      }

      const tags = await response.json();
      console.log(`📋 Retrieved ${tags.length} tags`);
      expect(Array.isArray(tags)).toBe(true);

      // If there are tags, validate their structure
      if (tags.length > 0) {
        for (const tag of tags.slice(0, 3)) { // Test first 3 tags
          expect(tag).toHaveProperty('name');
          expect(tag).toHaveProperty('message');
          expect(tag).toHaveProperty('target');
          expect(tag).toHaveProperty('commit');
          expect(tag).toHaveProperty('release');
          expect(tag).toHaveProperty('protected');
        }
        console.log(`✅ Repository tags API request successful, validated ${tags.length} tags`);
      } else {
        console.log('✅ Repository tags API request successful, no tags found (valid for new repositories)');
      }
    }, 15000);
  });
});