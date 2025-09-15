/**
 * Data Lifecycle Integration Tests
 *
 * This file orchestrates the complete data lifecycle for GitLab integration testing.
 * Tests are dependency-chained to build up infrastructure progressively:
 *
 * Chain: Create Group → Create Project → Initialize Repository → Create Work Items → Create MRs → Test All Features → Cleanup
 *
 * CRITICAL RULES:
 * - Tests MUST run in order (Jest --runInBand)
 * - Each test depends on previous test data
 * - Individual tests cannot run standalone
 * - Cleanup only happens at the very end
 * - All other test files import this shared data
 */

import { GITLAB_TOKEN, GITLAB_API_URL, TestDataState, updateTestData } from '../setup/testConfig';

// Global test data state - shared across all tests
const TEST_DATA: TestDataState = {};

describe('🔄 Data Lifecycle - Complete Infrastructure Setup', () => {
  const timestamp = Date.now();
  const baseTestName = `lifecycle-test-${timestamp}`;

  beforeAll(async () => {
    if (!GITLAB_TOKEN || !GITLAB_API_URL) {
      throw new Error('GITLAB_TOKEN and GITLAB_API_URL are required for lifecycle tests');
    }
    console.log(`🚀 Starting data lifecycle chain with timestamp: ${timestamp}`);
  });

  afterAll(async () => {
    // Only cleanup happens here - at the very end of the entire test suite
    console.log('🧹 Final cleanup: Deleting all test infrastructure...');

    if (TEST_DATA.group?.id) {
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/groups/${TEST_DATA.group.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok) {
          console.log(`✅ Cleaned up test group: ${TEST_DATA.group.id} (includes all projects, MRs, work items)`);
        } else {
          console.log(`⚠️  Could not delete test group ${TEST_DATA.group.id}: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  Error deleting test group:`, error);
      }
    }

    console.log('✅ Data lifecycle cleanup complete');
  });

  describe('📁 Step 1: Group Infrastructure', () => {
    it('should create test group (foundation for all tests)', async () => {
      console.log('🔧 Creating test group...');

      const createResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Test Group ${baseTestName}`,
          path: baseTestName,
          description: `Integration test group created at ${new Date().toISOString()} - contains all test infrastructure`,
          visibility: 'private',
        }),
      });

      expect(createResponse.ok).toBe(true);
      TEST_DATA.group = await createResponse.json();

      expect(TEST_DATA.group).toHaveProperty('id');
      expect(TEST_DATA.group).toHaveProperty('path', baseTestName);

      // Update shared test data
      updateTestData({ group: TEST_DATA.group });

      console.log(`✅ Created test group: ${TEST_DATA.group.id} (${TEST_DATA.group.path})`);
    });
  });

  describe('📦 Step 2: Project Infrastructure', () => {
    it('should create test project (depends on group)', async () => {
      expect(TEST_DATA.group?.id).toBeDefined();
      console.log('🔧 Creating test project in group...');

      const createResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Test Project ${baseTestName}`,
          namespace_id: TEST_DATA.group.id,
          description: `Integration test project - contains repository, MRs, work items for testing`,
          visibility: 'private',
          initialize_with_readme: false,
        }),
      });

      expect(createResponse.ok).toBe(true);
      TEST_DATA.project = await createResponse.json();

      expect(TEST_DATA.project).toHaveProperty('id');
      expect(TEST_DATA.project).toHaveProperty('namespace');
      expect(TEST_DATA.project.namespace.id).toBe(TEST_DATA.group.id);

      // Update shared test data
      updateTestData({ project: TEST_DATA.project });

      console.log(`✅ Created test project: ${TEST_DATA.project.id} in group ${TEST_DATA.group.id}`);
    });
  });

  describe('🌳 Step 3: Repository Infrastructure', () => {
    it('should initialize repository with files (depends on project)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Initializing repository...');

      TEST_DATA.repository = { branches: [], files: [], tags: [] };

      // Create initial files
      const initialFiles = [
        { path: 'README.md', content: 'IyBUZXN0IFByb2plY3Q=', message: 'Initial README' },
        { path: 'src/main.js', content: 'Y29uc29sZS5sb2coImhlbGxvIik=', message: 'Add main.js' },
        { path: 'docs/guide.md', content: 'IyBHdWlkZQ==', message: 'Add documentation' },
        { path: '.gitignore', content: 'bm9kZV9tb2R1bGVzLw==', message: 'Add gitignore' },
      ];

      for (const file of initialFiles) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/repository/files/${encodeURIComponent(file.path)}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            branch: 'main',
            content: file.content,
            commit_message: file.message,
          }),
        });

        if (response.ok) {
          const fileData = await response.json();
          TEST_DATA.repository.files.push(fileData);
        }
      }

      expect(TEST_DATA.repository.files.length).toBeGreaterThan(0);

      // Update shared test data
      updateTestData({ repository: TEST_DATA.repository });

      console.log(`✅ Initialized repository with ${TEST_DATA.repository.files.length} files`);
    });

    it('should create feature branches (depends on repository)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Creating feature branches...');

      const branches = ['feature/user-auth', 'feature/api-endpoints', 'hotfix/security-patch'];

      for (const branchName of branches) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/repository/branches`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            branch: branchName,
            ref: 'main',
          }),
        });

        if (response.ok) {
          const branch = await response.json();
          TEST_DATA.repository!.branches.push(branch);
        }
      }

      expect(TEST_DATA.repository!.branches.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.repository!.branches.length} feature branches`);
    });

    it('should create repository tags (depends on repository)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Creating repository tags...');

      const tags = [
        { name: `v1.0.0-${timestamp}`, ref: 'main', message: 'Release 1.0.0' },
        { name: `v1.1.0-${timestamp}`, ref: 'main', message: 'Release 1.1.0' },
      ];

      for (const tagData of tags) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/repository/tags`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tag_name: tagData.name,
            ref: tagData.ref,
            message: tagData.message,
          }),
        });

        if (response.ok) {
          const tag = await response.json();
          TEST_DATA.repository!.tags.push(tag);
        }
      }

      expect(TEST_DATA.repository!.tags.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.repository!.tags.length} repository tags`);
    });
  });

  describe('🏷️ Step 4: Project Metadata', () => {
    it('should create labels (depends on project)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Creating project labels...');

      TEST_DATA.labels = [];
      const labels = [
        { name: 'bug', color: '#ff0000', description: 'Bug reports' },
        { name: 'feature', color: '#00ff00', description: 'New features' },
        { name: 'enhancement', color: '#0000ff', description: 'Improvements' },
      ];

      for (const labelData of labels) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/labels`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(labelData),
        });

        if (response.ok) {
          const label = await response.json();
          TEST_DATA.labels.push(label);
        }
      }

      expect(TEST_DATA.labels.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.labels.length} project labels`);
    });

    it('should create milestones (depends on project)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Creating project milestones...');

      TEST_DATA.milestones = [];
      const milestones = [
        {
          title: `Sprint 1 - ${timestamp}`,
          description: 'First sprint milestone',
          due_date: '2025-12-31',
          start_date: '2025-09-15'
        },
        {
          title: `Release 1.0 - ${timestamp}`,
          description: 'Major release milestone',
          due_date: '2025-11-30'
        },
      ];

      for (const milestoneData of milestones) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/milestones`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(milestoneData),
        });

        if (response.ok) {
          const milestone = await response.json();
          TEST_DATA.milestones.push(milestone);
        }
      }

      expect(TEST_DATA.milestones.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.milestones.length} project milestones`);
    });
  });

  describe('📋 Step 5: Work Items Infrastructure', () => {
    it('should create work items (depends on project + labels + milestones)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      console.log('🔧 Creating work items...');

      TEST_DATA.workItems = [];

      // Create different types of work items
      const workItemsData = [
        {
          title: `Test Issue ${timestamp}`,
          description: 'Test issue for API validation',
          workItemTypeId: 'gid://gitlab/WorkItems::Type/1', // Issue
        },
        {
          title: `Test Epic ${timestamp}`,
          description: 'Test epic for feature development',
          workItemTypeId: 'gid://gitlab/WorkItems::Type/7', // Epic
        },
        {
          title: `Test Task ${timestamp}`,
          description: 'Test task for development work',
          workItemTypeId: 'gid://gitlab/WorkItems::Type/4', // Task
        },
      ];

      for (const workItemData of workItemsData) {
        try {
          // Use REST API for work item creation as GraphQL might have different requirements
          const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/issues`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GITLAB_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: workItemData.title,
              description: workItemData.description,
              labels: TEST_DATA.labels?.[0]?.name || undefined,
              milestone_id: TEST_DATA.milestones?.[0]?.id || undefined,
            }),
          });

          if (response.ok) {
            const workItem = await response.json();
            TEST_DATA.workItems.push(workItem);
          }
        } catch (error) {
          console.log(`⚠️  Could not create work item: ${workItemData.title}`);
        }
      }

      expect(TEST_DATA.workItems.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.workItems.length} work items`);
    });
  });

  describe('🔀 Step 6: Merge Requests Infrastructure', () => {
    it('should create merge requests (depends on branches + work items)', async () => {
      expect(TEST_DATA.project?.id).toBeDefined();
      expect(TEST_DATA.repository?.branches.length).toBeGreaterThan(0);
      console.log('🔧 Creating merge requests...');

      TEST_DATA.mergeRequests = [];

      // Create MRs from feature branches
      for (let i = 0; i < Math.min(2, TEST_DATA.repository!.branches.length); i++) {
        const branch = TEST_DATA.repository!.branches[i];

        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${TEST_DATA.project.id}/merge_requests`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_branch: branch.name,
            target_branch: 'main',
            title: `Merge ${branch.name} - ${timestamp}`,
            description: `Test merge request from ${branch.name} branch`,
            labels: TEST_DATA.labels?.[0]?.name || undefined,
            milestone_id: TEST_DATA.milestones?.[0]?.id || undefined,
          }),
        });

        if (response.ok) {
          const mr = await response.json();
          TEST_DATA.mergeRequests.push(mr);
        }
      }

      expect(TEST_DATA.mergeRequests.length).toBeGreaterThan(0);
      console.log(`✅ Created ${TEST_DATA.mergeRequests.length} merge requests`);
    });
  });

  describe('✅ Step 7: Infrastructure Validation', () => {
    it('should validate complete test infrastructure is ready', async () => {
      console.log('🔍 Validating complete test infrastructure...');

      // Validate all components exist
      expect(TEST_DATA.group).toBeDefined();
      expect(TEST_DATA.project).toBeDefined();
      expect(TEST_DATA.repository).toBeDefined();
      expect(TEST_DATA.workItems?.length).toBeGreaterThan(0);
      expect(TEST_DATA.mergeRequests?.length).toBeGreaterThan(0);
      expect(TEST_DATA.labels?.length).toBeGreaterThan(0);
      expect(TEST_DATA.milestones?.length).toBeGreaterThan(0);

      console.log('📊 Test Infrastructure Summary:');
      console.log(`  🏢 Group: ${TEST_DATA.group?.id} (${TEST_DATA.group?.path})`);
      console.log(`  📦 Project: ${TEST_DATA.project?.id}`);
      console.log(`  📁 Files: ${TEST_DATA.repository?.files?.length || 0}`);
      console.log(`  🌿 Branches: ${TEST_DATA.repository?.branches?.length || 0}`);
      console.log(`  🏷️  Tags: ${TEST_DATA.repository?.tags?.length || 0}`);
      console.log(`  📋 Work Items: ${TEST_DATA.workItems?.length || 0}`);
      console.log(`  🔀 Merge Requests: ${TEST_DATA.mergeRequests?.length || 0}`);
      console.log(`  🏷️  Labels: ${TEST_DATA.labels?.length || 0}`);
      console.log(`  🎯 Milestones: ${TEST_DATA.milestones?.length || 0}`);

      console.log('✅ Complete test infrastructure ready for all schema validation tests');
    });
  });
});