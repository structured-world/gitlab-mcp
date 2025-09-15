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

import { GITLAB_TOKEN, GITLAB_API_URL, updateTestData, getTestData } from '../setup/testConfig';

describe('🔄 Data Lifecycle - Complete Infrastructure Setup', () => {
  const timestamp = Date.now();
  const baseTestName = `lifecycle-test-${timestamp}`;

  beforeAll(async () => {
    if (!GITLAB_TOKEN || !GITLAB_API_URL) {
      throw new Error('GITLAB_TOKEN and GITLAB_API_URL are required for lifecycle tests');
    }
    console.log(`🚀 Starting data lifecycle chain with timestamp: ${timestamp}`);
  });

  // Note: Cleanup moved to globalTeardown.js to run after ALL tests complete

  describe('👤 Step 0: User Infrastructure', () => {
    it('should create test user (for assignment and collaboration testing)', async () => {
      console.log('🔧 Creating test user...');

      // Note: User creation typically requires admin privileges
      // If not admin, this will be skipped gracefully but logged for tracking
      try {
        const createResponse = await fetch(`${GITLAB_API_URL}/api/v4/users`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Test User ${baseTestName}`,
            username: `testuser-${baseTestName}`,
            email: `testuser-${baseTestName}@example.com`,
            password: `Xy9#mK8$pQ2!vN7&${timestamp}`, // Strong password meeting GitLab policy
            skip_confirmation: true,
          }),
        });

        if (createResponse.ok) {
          const user = await createResponse.json();
          updateTestData({ user });
          console.log(`✅ Created test user: ${user.id} (${user.username})`);
        } else if (createResponse.status === 403) {
          console.log('⚠️  User creation requires admin privileges - skipping user tests');
          updateTestData({ user: null }); // Mark as intentionally skipped
        } else {
          console.log(`⚠️  Could not create user: ${createResponse.status} ${createResponse.statusText}`);
          updateTestData({ user: null });
        }
      } catch (error) {
        console.log('⚠️  User creation failed:', error);
        updateTestData({ user: null });
      }
    });
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
      const group = await createResponse.json();

      expect(group).toHaveProperty('id');
      expect(group).toHaveProperty('path', baseTestName);

      // Update shared test data
      updateTestData({ group });

      console.log(`✅ Created test group: ${group.id} (${group.path})`);
    });
  });

  describe('📦 Step 2: Project Infrastructure', () => {
    it('should create test project (depends on group)', async () => {
      const testData = getTestData();
      expect(testData.group?.id).toBeDefined();
      console.log('🔧 Creating test project in group...');

      const createResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Test Project ${baseTestName}`,
          namespace_id: testData.group!.id,
          description: `Integration test project - contains repository, MRs, work items for testing`,
          visibility: 'private',
          initialize_with_readme: false,
          owner_id: testData.user?.id || undefined, // Set test user as project owner if available
        }),
      });

      expect(createResponse.ok).toBe(true);
      const project = await createResponse.json();

      expect(project).toHaveProperty('id');
      expect(project).toHaveProperty('namespace');
      expect(project.namespace.id).toBe(testData.group!.id);

      // Update shared test data
      updateTestData({ project });

      console.log(`✅ Created test project: ${project.id} in group ${testData.group!.id}`);
    });
  });

  describe('🌳 Step 3: Repository Infrastructure', () => {
    it('should initialize repository with files (depends on project)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Initializing repository...');

      const repository: { branches: any[]; files: any[]; tags: any[] } = { branches: [], files: [], tags: [] };

      // Create initial files
      const initialFiles = [
        { path: 'README.md', content: 'IyBUZXN0IFByb2plY3Q=', message: 'Initial README' },
        { path: 'src/main.js', content: 'Y29uc29sZS5sb2coImhlbGxvIik=', message: 'Add main.js' },
        { path: 'docs/guide.md', content: 'IyBHdWlkZQ==', message: 'Add documentation' },
        { path: '.gitignore', content: 'bm9kZV9tb2R1bGVzLw==', message: 'Add gitignore' },
      ];

      for (const file of initialFiles) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/repository/files/${encodeURIComponent(file.path)}`, {
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
          repository.files.push(fileData);
        }
      }

      expect(repository.files.length).toBeGreaterThan(0);

      // Update shared test data
      updateTestData({ repository });

      console.log(`✅ Initialized repository with ${repository.files.length} files`);
    });

    it('should create feature branches (depends on repository)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Creating feature branches...');

      const branches = ['feature/user-auth', 'feature/api-endpoints', 'hotfix/security-patch'];
      const createdBranches: any[] = [];

      for (const branchName of branches) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/repository/branches`, {
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
          createdBranches.push(branch);
        }
      }

      // Update repository with branches
      const currentRepo = testData.repository || { branches: [], files: [], tags: [] };
      currentRepo.branches = createdBranches;
      updateTestData({ repository: currentRepo });

      expect(createdBranches.length).toBeGreaterThan(0);
      console.log(`✅ Created ${createdBranches.length} feature branches`);
    });

    it('should create repository tags (depends on repository)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Creating repository tags...');

      const tags = [
        { name: `v1.0.0-${timestamp}`, ref: 'main', message: 'Release 1.0.0' },
        { name: `v1.1.0-${timestamp}`, ref: 'main', message: 'Release 1.1.0' },
      ];
      const createdTags: any[] = [];

      for (const tagData of tags) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/repository/tags`, {
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
          createdTags.push(tag);
        }
      }

      // Update repository with tags
      const currentRepo = getTestData().repository || { branches: [], files: [], tags: [] };
      currentRepo.tags = createdTags;
      updateTestData({ repository: currentRepo });

      expect(createdTags.length).toBeGreaterThan(0);
      console.log(`✅ Created ${createdTags.length} repository tags`);
    });
  });

  describe('🏷️ Step 4: Project Metadata', () => {
    it('should create labels (depends on project)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Creating project labels...');

      const labels = [
        { name: 'bug', color: '#ff0000', description: 'Bug reports' },
        { name: 'feature', color: '#00ff00', description: 'New features' },
        { name: 'enhancement', color: '#0000ff', description: 'Improvements' },
      ];
      const createdLabels: any[] = [];

      for (const labelData of labels) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/labels`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(labelData),
        });

        if (response.ok) {
          const label = await response.json();
          createdLabels.push(label);
        }
      }

      updateTestData({ labels: createdLabels });

      expect(createdLabels.length).toBeGreaterThan(0);
      console.log(`✅ Created ${createdLabels.length} project labels`);
    });

    it('should create milestones (depends on project)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Creating project milestones...');

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
      const createdMilestones: any[] = [];

      for (const milestoneData of milestones) {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/milestones`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(milestoneData),
        });

        if (response.ok) {
          const milestone = await response.json();
          createdMilestones.push(milestone);
        }
      }

      updateTestData({ milestones: createdMilestones });

      expect(createdMilestones.length).toBeGreaterThan(0);
      console.log(`✅ Created ${createdMilestones.length} project milestones`);
    });
  });

  describe('📋 Step 5: Work Items Infrastructure', () => {
    it('should create work items (depends on project + labels + milestones)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      console.log('🔧 Creating work items...');

      const createdWorkItems: any[] = [];

      // Create different types of work items (with user assignment if available)
      const workItemsData = [
        {
          title: `Test Issue ${timestamp}`,
          description: 'Test issue for API validation',
          workItemTypeId: 'gid://gitlab/WorkItems::Type/1', // Issue
          assignee_ids: testData.user ? [testData.user.id] : undefined,
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
          assignee_ids: testData.user ? [testData.user.id] : undefined,
        },
      ];

      for (const workItemData of workItemsData) {
        try {
          // Use REST API for work item creation as GraphQL might have different requirements
          const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/issues`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GITLAB_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: workItemData.title,
              description: workItemData.description,
              labels: testData.labels?.[0]?.name || undefined,
              milestone_id: testData.milestones?.[0]?.id || undefined,
            }),
          });

          if (response.ok) {
            const workItem = await response.json();
            createdWorkItems.push(workItem);
          }
        } catch (error) {
          console.log(`⚠️  Could not create work item: ${workItemData.title}`);
        }
      }

      updateTestData({ workItems: createdWorkItems });

      expect(createdWorkItems.length).toBeGreaterThan(0);
      console.log(`✅ Created ${createdWorkItems.length} work items`);
    });
  });

  describe('🔀 Step 6: Merge Requests Infrastructure', () => {
    it('should create merge requests (depends on branches + work items)', async () => {
      const testData = getTestData();
      expect(testData.project?.id).toBeDefined();
      expect(testData.repository?.branches.length).toBeGreaterThan(0);
      console.log('🔧 Creating merge requests...');

      const mergeRequests: any[] = [];

      // Create MRs from feature branches
      for (let i = 0; i < Math.min(2, testData.repository!.branches.length); i++) {
        const branch = testData.repository!.branches[i];

        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testData.project!.id}/merge_requests`, {
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
            labels: testData.labels?.[0]?.name || undefined,
            milestone_id: testData.milestones?.[0]?.id || undefined,
            assignee_id: testData.user?.id || undefined,
            reviewer_ids: testData.user ? [testData.user.id] : undefined,
          }),
        });

        if (response.ok) {
          const mr = await response.json();
          mergeRequests.push(mr);
        }
      }

      // Update test data
      updateTestData({ mergeRequests });

      expect(mergeRequests.length).toBeGreaterThan(0);
      console.log(`✅ Created ${mergeRequests.length} merge requests`);
    });
  });

  describe('✅ Step 7: Infrastructure Validation', () => {
    it('should validate complete test infrastructure is ready', async () => {
      console.log('🔍 Validating complete test infrastructure...');

      const testData = getTestData();

      // Validate all components exist
      expect(testData.group).toBeDefined();
      expect(testData.project).toBeDefined();
      expect(testData.repository).toBeDefined();
      expect(testData.workItems?.length).toBeGreaterThan(0);
      expect(testData.mergeRequests?.length).toBeGreaterThan(0);
      expect(testData.labels?.length).toBeGreaterThan(0);
      expect(testData.milestones?.length).toBeGreaterThan(0);

      console.log('📊 Test Infrastructure Summary:');
      console.log(`  👤 User: ${testData.user?.id ? `${testData.user.id} (${testData.user.username})` : 'N/A (no admin privileges)'}`);
      console.log(`  🏢 Group: ${testData.group?.id} (${testData.group?.path})`);
      console.log(`  📦 Project: ${testData.project?.id}`);
      console.log(`  📁 Files: ${testData.repository?.files?.length || 0}`);
      console.log(`  🌿 Branches: ${testData.repository?.branches?.length || 0}`);
      console.log(`  🏷️  Tags: ${testData.repository?.tags?.length || 0}`);
      console.log(`  📋 Work Items: ${testData.workItems?.length || 0}`);
      console.log(`  🔀 Merge Requests: ${testData.mergeRequests?.length || 0}`);
      console.log(`  🏷️  Labels: ${testData.labels?.length || 0}`);
      console.log(`  🎯 Milestones: ${testData.milestones?.length || 0}`);

      console.log('✅ Complete test infrastructure ready for all schema validation tests');
    });
  });
});