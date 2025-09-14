/**
 * Milestones Schema Integration Tests
 * Tests all milestone-related schemas against real GitLab 18.3 API responses
 * Following CRITICAL COMPREHENSIVE TEST DATA LIFECYCLE WORKFLOW RULE
 */

import { beforeAll, describe, expect, it, afterAll } from '@jest/globals';
import {
  ListProjectMilestonesSchema,
  GetProjectMilestoneSchema,
  CreateProjectMilestoneSchema,
  EditProjectMilestoneSchema,
  DeleteProjectMilestoneSchema,
  PromoteProjectMilestoneSchema,
  GetMilestoneIssuesSchema,
  GetMilestoneMergeRequestsSchema,
  GetMilestoneBurndownEventsSchema,
  GitLabMilestonesSchema,
} from '../../../src/entities/milestones';

// Test environment constants
const GITLAB_API_URL = process.env.GITLAB_API_URL!;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN!;
const TEST_GROUP = process.env.TEST_GROUP!;

// Dynamic test data
const testTimestamp = Date.now();
let testProjectId: number | null = null;
let testGroupId: number | null = null;
let createdTestGroup = false;
let createdMilestoneIds: string[] = [];

describe('Milestones Schema - GitLab 18.3 Integration', () => {
  beforeAll(async () => {
    expect(GITLAB_API_URL).toBeDefined();
    expect(GITLAB_TOKEN).toBeDefined();
    expect(TEST_GROUP).toBeDefined();

    console.log('🔧 Setting up test infrastructure for milestones schema validation...');

    // Check if test group exists, create if needed
    const checkGroupResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups/${encodeURIComponent(TEST_GROUP!)}`, {
      headers: { 'Authorization': `Bearer ${GITLAB_TOKEN}` },
    });

    if (checkGroupResponse.ok) {
      const existingGroup = await checkGroupResponse.json();
      testGroupId = existingGroup.id;
      console.log(`✅ Found existing test group: ${existingGroup.name} (ID: ${existingGroup.id})`);
    } else if (checkGroupResponse.status === 404) {
      // Create test group
      console.log(`🔧 Creating test group '${TEST_GROUP}' for milestone testing...`);
      const createGroupResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Test Group ${testTimestamp}`,
          path: TEST_GROUP,
          visibility: 'private',
          description: `Test group for milestone schema validation - ${testTimestamp}`,
        }),
      });

      if (createGroupResponse.ok) {
        const group = await createGroupResponse.json();
        testGroupId = group.id;
        createdTestGroup = true;
        console.log(`✅ Created test group: ${group.name} (ID: ${group.id})`);
      } else {
        const errorBody = await createGroupResponse.text();
        console.log(`⚠️  Could not create group: ${createGroupResponse.status} - ${errorBody}`);
      }
    }

    // Create test project for milestones
    if (testGroupId) {
      console.log(`🔧 Creating test project for milestone validation...`);
      const createProjectResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Milestone Test Project ${testTimestamp}`,
          path: `milestone-test-project-${testTimestamp}`,
          namespace_id: testGroupId,
          visibility: 'private',
          description: `Test project for milestone schema validation - ${testTimestamp}`,
          initialize_with_readme: true,
        }),
      });

      if (createProjectResponse.ok) {
        const project = await createProjectResponse.json();
        testProjectId = project.id;
        console.log(`✅ Created test project: ${project.name} (ID: ${project.id})`);
      } else {
        const errorBody = await createProjectResponse.text();
        console.log(`⚠️  Could not create project: ${createProjectResponse.status} - ${errorBody}`);
      }
    }

    console.log(`✅ Milestones test setup complete - project ID: ${testProjectId}`);
  });

  afterAll(async () => {
    console.log('🧹 Cleaning up test infrastructure...');

    // Clean up created milestones
    if (createdMilestoneIds.length > 0 && testProjectId) {
      console.log('🧹 Cleaning up created milestones...');
      for (const milestoneId of createdMilestoneIds) {
        try {
          const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/milestones/${milestoneId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${GITLAB_TOKEN}`,
            },
          });
          if (response.ok) {
            console.log(`✅ Cleaned up milestone ID: ${milestoneId}`);
          }
        } catch (error) {
          console.log(`⚠️ Could not clean up milestone ${milestoneId}:`, error);
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
        if (response.ok) {
          console.log(`✅ Cleaned up test project: ${testProjectId}`);
        }
      } catch (error) {
        console.log(`⚠️ Could not clean up project ${testProjectId}:`, error);
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
        if (response.ok) {
          console.log(`✅ Cleaned up test group '${TEST_GROUP}': ${testGroupId}`);
        }
      } catch (error) {
        console.log(`⚠️ Could not clean up group ${testGroupId}:`, error);
      }
    } else if (testGroupId) {
      console.log(`ℹ️  Test group '${TEST_GROUP}' (ID: ${testGroupId}) existed before test - not deleting`);
    }
  });

  describe('ListProjectMilestonesSchema', () => {
    it('should validate basic list project milestones parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        state: 'active' as const,
        per_page: 20,
      };

      const result = ListProjectMilestonesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.state).toBe('active');
        expect(result.data.per_page).toBe(20);
      }

      console.log('✅ ListProjectMilestonesSchema validates basic parameters correctly');
    });

    it('should make successful API request with validated parameters (initially empty)', async () => {
      if (!testProjectId) {
        console.log('⚠️  Skipping API test - no test project created');
        return;
      }

      const params = {
        project_id: String(testProjectId),
        state: 'active' as const,
      };

      // Validate parameters first
      const paramResult = ListProjectMilestonesSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 ListProjectMilestonesSchema - Testing against real GitLab API');

      const queryParams = new URLSearchParams({
        state: paramResult.data.state || 'active',
      });

      console.log(`🔍 API URL: ${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/milestones?${queryParams}`);

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/milestones?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      expect(response.ok).toBe(true);

      const milestones = await response.json();
      expect(Array.isArray(milestones)).toBe(true);

      console.log(`📋 Retrieved ${milestones.length} milestones (expected: 0+ initially)`);

      // Validate each milestone against schema
      milestones.forEach((milestone: any) => {
        const milestoneResult = GitLabMilestonesSchema.safeParse(milestone);
        expect(milestoneResult.success).toBe(true);
      });

      console.log('✅ ListProjectMilestonesSchema API request successful');
    });

    it('should validate advanced filtering parameters', async () => {
      const advancedParams = {
        project_id: String(testProjectId),
        state: 'closed' as const,
        title: 'Test Milestone',
        search: 'search term',
        per_page: 50,
        page: 1,
      };

      const result = ListProjectMilestonesSchema.safeParse(advancedParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.state).toBe('closed');
        expect(result.data.title).toBe('Test Milestone');
        expect(result.data.search).toBe('search term');
      }

      console.log('✅ ListProjectMilestonesSchema validates advanced filtering parameters');
    });

    it('should accept additional unknown parameters (schemas are permissive)', async () => {
      const paramsWithExtra = {
        project_id: String(testProjectId),
        unknown_field: 'test',
        extra_param: 123,
      };

      const result = ListProjectMilestonesSchema.safeParse(paramsWithExtra);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
      }

      console.log('✅ ListProjectMilestonesSchema accepts additional properties as designed');
    });
  });

  describe('CreateProjectMilestoneSchema + Complete CRUD Lifecycle', () => {
    it('should validate create project milestone parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        title: 'Test Milestone',
        description: 'Test description',
        due_date: '2024-12-31',
        start_date: '2024-01-01',
      };

      const result = CreateProjectMilestoneSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.title).toBe('Test Milestone');
        expect(result.data.description).toBe('Test description');
        expect(result.data.due_date).toBe('2024-12-31');
        expect(result.data.start_date).toBe('2024-01-01');
      }

      console.log('✅ CreateProjectMilestoneSchema validates parameters correctly');
    });

    it('should create a project milestone via API', async () => {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const dueDate = nextMonth.toISOString().split('T')[0]; // YYYY-MM-DD format

      const startDate = new Date().toISOString().split('T')[0];

      const milestoneData = {
        project_id: String(testProjectId),
        title: `Test Sprint ${testTimestamp}`,
        description: `Sprint milestone created for CRUD testing - safe to delete.\n\nTimestamp: ${testTimestamp}`,
        due_date: dueDate,
        start_date: startDate,
      };

      // Validate parameters first
      const paramResult = CreateProjectMilestoneSchema.safeParse(milestoneData);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log('🔍 Creating milestone via GitLab API...');

      // Create the milestone
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/milestones`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: paramResult.data.title,
          description: paramResult.data.description,
          due_date: paramResult.data.due_date,
          start_date: paramResult.data.start_date,
        }),
      });

      expect(response.ok).toBe(true);

      const createdMilestone = await response.json();

      console.log('📋 Created milestone:', createdMilestone);

      // Validate response structure
      const milestoneResult = GitLabMilestonesSchema.safeParse(createdMilestone);
      expect(milestoneResult.success).toBe(true);

      expect(createdMilestone.title).toBe(`Test Sprint ${testTimestamp}`);
      expect(createdMilestone.id).toBeDefined();
      expect(createdMilestone.state).toBe('active');
      expect(createdMilestone.description).toContain('CRUD testing');

      // Store ID for cleanup
      createdMilestoneIds.push(String(createdMilestone.id));

      console.log(`✅ Successfully created milestone with ID: ${createdMilestone.id}`);
    });

    it('should create a second milestone for testing list functionality', async () => {
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      const dueDate = nextYear.toISOString().split('T')[0];

      const milestoneData = {
        project_id: String(testProjectId),
        title: `Test Release ${testTimestamp}`,
        description: `Release milestone for testing list functionality - safe to delete.\n\nCreated: ${new Date().toISOString()}`,
        due_date: dueDate,
      };

      // Create second milestone
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(String(testProjectId))}/milestones`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: milestoneData.title,
          description: milestoneData.description,
          due_date: milestoneData.due_date,
        }),
      });

      expect(response.ok).toBe(true);
      const createdMilestone = await response.json();

      // Store ID for cleanup
      createdMilestoneIds.push(String(createdMilestone.id));

      console.log(`✅ Successfully created second milestone with ID: ${createdMilestone.id}`);
    });
  });

  describe('GetProjectMilestoneSchema', () => {
    it('should validate get project milestone parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
      };

      const result = GetProjectMilestoneSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
      }

      console.log('✅ GetProjectMilestoneSchema validates parameters correctly');
    });

    it('should get a project milestone via API using dynamic milestone ID', async () => {
      if (createdMilestoneIds.length === 0) {
        throw new Error('No milestones created for testing');
      }

      const testMilestoneId = createdMilestoneIds[0];
      const params = {
        project_id: String(testProjectId),
        milestone_id: testMilestoneId,
      };

      // Validate parameters first
      const paramResult = GetProjectMilestoneSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log(`🔍 Getting milestone ID: ${testMilestoneId} via GitLab API...`);

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/milestones/${paramResult.data.milestone_id!}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const retrievedMilestone = await response.json();

      console.log('📋 Retrieved milestone:', retrievedMilestone);

      // Validate response structure
      const milestoneResult = GitLabMilestonesSchema.safeParse(retrievedMilestone);
      expect(milestoneResult.success).toBe(true);

      expect(retrievedMilestone.id).toBe(parseInt(testMilestoneId));
      expect(retrievedMilestone.title).toContain(`${testTimestamp}`);
      expect(retrievedMilestone.description).toContain('CRUD testing');

      console.log(`✅ Successfully retrieved milestone with ID: ${testMilestoneId}`);
    });
  });

  describe('ListProjectMilestonesSchema with Data', () => {
    it('should list project milestones after creation and validate actual data', async () => {
      const params = {
        project_id: String(testProjectId),
        state: 'active' as const,
      };

      const queryParams = new URLSearchParams({
        state: 'active',
      });

      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(String(testProjectId))}/milestones?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);
      const milestones = await response.json();

      expect(Array.isArray(milestones)).toBe(true);
      expect(milestones.length).toBeGreaterThan(0);

      console.log(`📋 Retrieved ${milestones.length} milestones with actual data`);

      // Validate each milestone
      milestones.forEach((milestone: any) => {
        const milestoneResult = GitLabMilestonesSchema.safeParse(milestone);
        expect(milestoneResult.success).toBe(true);

        expect(milestone.title).toBeDefined();
        expect(milestone.id).toBeDefined();
        expect(milestone.state).toBeDefined();
      });

      // Verify our test milestones are included
      const testMilestones = milestones.filter((milestone: any) => milestone.title.includes(`${testTimestamp}`));
      expect(testMilestones.length).toBeGreaterThanOrEqual(2);

      console.log('✅ ListProjectMilestonesSchema API request successful, validated milestones with real data');
    });
  });

  describe('EditProjectMilestoneSchema', () => {
    it('should validate edit project milestone parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
        title: 'Updated Milestone',
        description: 'Updated description',
        state_event: 'close' as const,
      };

      const result = EditProjectMilestoneSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
        expect(result.data.title).toBe('Updated Milestone');
        expect(result.data.description).toBe('Updated description');
        expect(result.data.state_event).toBe('close');
      }

      console.log('✅ EditProjectMilestoneSchema validates parameters correctly');
    });

    it('should update a project milestone via API using dynamic milestone ID', async () => {
      if (createdMilestoneIds.length === 0) {
        throw new Error('No milestones created for testing');
      }

      const testMilestoneId = createdMilestoneIds[0];
      const updateData = {
        project_id: String(testProjectId),
        milestone_id: testMilestoneId,
        title: `Updated Sprint ${testTimestamp}`,
        description: `Sprint milestone has been updated during testing - safe to delete.\n\nUpdated: ${new Date().toISOString()}\nTimestamp: ${testTimestamp}`,
      };

      // Validate parameters first
      const paramResult = EditProjectMilestoneSchema.safeParse(updateData);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      console.log(`🔍 Updating milestone ID: ${testMilestoneId} via GitLab API...`);
      console.log(`📤 Update payload:`, {
        title: paramResult.data.title,
        description: paramResult.data.description,
      });

      // Update the milestone
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/milestones/${paramResult.data.milestone_id!}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: paramResult.data.title,
          description: paramResult.data.description,
        }),
      });

      expect(response.ok).toBe(true);

      const updatedMilestone = await response.json();

      console.log('📋 Updated milestone:', updatedMilestone);

      // Validate the updated milestone
      const milestoneResult = GitLabMilestonesSchema.safeParse(updatedMilestone);
      expect(milestoneResult.success).toBe(true);

      expect(updatedMilestone.id).toBe(parseInt(testMilestoneId));
      expect(updatedMilestone.title).toBe(`Updated Sprint ${testTimestamp}`);
      expect(updatedMilestone.description).toContain('updated during testing');

      console.log(`✅ Successfully updated milestone with ID: ${testMilestoneId}`);
    });
  });

  describe('Related Milestone Operations', () => {
    it('should validate get milestone issues parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
      };

      const result = GetMilestoneIssuesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
      }

      console.log('✅ GetMilestoneIssuesSchema validates parameters correctly');
    });

    it('should validate get milestone merge requests parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
        per_page: 20,
      };

      const result = GetMilestoneMergeRequestsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
        expect(result.data.per_page).toBe(20);
      }

      console.log('✅ GetMilestoneMergeRequestsSchema validates parameters correctly');
    });

    it('should validate get milestone burndown events parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
        per_page: 50,
      };

      const result = GetMilestoneBurndownEventsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
        expect(result.data.per_page).toBe(50);
      }

      console.log('✅ GetMilestoneBurndownEventsSchema validates parameters correctly');
    });
  });

  describe('DeleteProjectMilestoneSchema', () => {
    it('should validate delete project milestone parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
      };

      const result = DeleteProjectMilestoneSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
      }

      console.log('✅ DeleteProjectMilestoneSchema validates parameters correctly');
    });

    it('should validate deletion will work with created milestone IDs', async () => {
      expect(createdMilestoneIds.length).toBeGreaterThan(0);

      for (const milestoneId of createdMilestoneIds) {
        const deleteParams = {
          project_id: String(testProjectId),
          milestone_id: milestoneId,
        };

        const result = DeleteProjectMilestoneSchema.safeParse(deleteParams);
        expect(result.success).toBe(true);

        if (result.success) {
          expect(result.data.project_id).toBe(String(testProjectId));
          expect(result.data.milestone_id).toBe(milestoneId);
        }
      }

      console.log(`✅ DeleteProjectMilestoneSchema validates deletion parameters for ${createdMilestoneIds.length} milestones`);
      console.log(`🧹 Milestones will be cleaned up in afterAll: ${createdMilestoneIds.join(', ')}`);
    });
  });

  describe('PromoteProjectMilestoneSchema', () => {
    it('should validate promote project milestone parameters', async () => {
      const validParams = {
        project_id: String(testProjectId),
        milestone_id: '123',
      };

      const result = PromoteProjectMilestoneSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.milestone_id).toBe('123');
      }

      console.log('✅ PromoteProjectMilestoneSchema validates parameters correctly');
    });
  });

  describe('Schema Edge Cases', () => {
    it('should accept parameters (GitLab API handles validation)', async () => {
      const basicParams = {
        project_id: String(testProjectId),
        title: '', // Schema accepts empty string, API may reject
        description: '', // Schema accepts empty string, API may reject
      };

      const result = CreateProjectMilestoneSchema.safeParse(basicParams);
      expect(result.success).toBe(true); // Schema is permissive

      if (result.success) {
        expect(result.data.project_id).toBe(String(testProjectId));
        expect(result.data.title).toBe('');
        expect(result.data.description).toBe('');
      }

      console.log('✅ CreateProjectMilestoneSchema accepts parameters, API handles validation');
    });
  });
});