/**
 * Merge Requests Schema Integration Tests
 * Tests ListMergeRequestsSchema and GetMergeRequestSchema against real GitLab 18.3 API responses
 */

import { ListMergeRequestsSchema, GetMergeRequestSchema } from '../../../src/entities/mrs/schema-readonly';
import { CreateMergeRequestSchema, UpdateMergeRequestSchema, MergeMergeRequestSchema } from '../../../src/entities/mrs/schema';

describe('Merge Requests Schema - GitLab 18.3 Integration', () => {
  const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
  const GITLAB_API_URL = process.env.GITLAB_API_URL;
  const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID; // Default target (non-existent)

  beforeAll(() => {
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    if (!GITLAB_API_URL) {
      throw new Error('GITLAB_API_URL environment variable is required');
    }
    // Note: GITLAB_PROJECT_ID is intentionally non-existent for Tier 2 testing
    // Tests should soft fail with 404s when hitting non-existent default targets
  });

  describe('ListMergeRequestsSchema', () => {
    it('should validate basic list merge requests parameters', async () => {
      const validParams = {
        project_id: GITLAB_PROJECT_ID,
        state: 'opened' as const,
        per_page: 5,
        order_by: 'created_at' as const,
        sort: 'desc' as const,
      };

      const result = ListMergeRequestsSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(GITLAB_PROJECT_ID);
        expect(result.data.state).toBe('opened');
        expect(result.data.order_by).toBe('created_at');
      }

      console.log('✅ ListMergeRequestsSchema validates basic parameters correctly');
    });

    it('should make successful API request with validated parameters (DEFAULT_PROJECT test)', async () => {
      // This is a DEFAULT_PROJECT test - skip if the default project doesn't exist
      if (!GITLAB_PROJECT_ID) {
        console.log(`⚠️  Skipping DEFAULT_PROJECT test - GITLAB_PROJECT_ID not configured`);
        return;
      }

      const projectCheckResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      if (!projectCheckResponse.ok) {
        console.log(`⚠️  Skipping DEFAULT_PROJECT test - project '${GITLAB_PROJECT_ID}' doesn't exist`);
        return;
      }

      const params = {
        project_id: GITLAB_PROJECT_ID,
        state: 'all' as const,
        per_page: 3,
        order_by: 'updated_at' as const,
        sort: 'desc' as const,
      };

      // Validate parameters first
      const paramResult = ListMergeRequestsSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      // Build query string from validated parameters
      const queryParams = new URLSearchParams();
      Object.entries(paramResult.data).forEach(([key, value]) => {
        if (value !== undefined && key !== 'project_id') {
          if (Array.isArray(value)) {
            value.forEach(v => queryParams.append(key + '[]', String(v)));
          } else {
            queryParams.set(key, String(value));
          }
        }
      });

      // Make API request
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/merge_requests?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const mergeRequests = await response.json();
      expect(Array.isArray(mergeRequests)).toBe(true);

      // Validate that each merge request has expected structure
      for (const mr of mergeRequests.slice(0, 2)) { // Test first 2 MRs
        expect(mr).toHaveProperty('id');
        expect(mr).toHaveProperty('iid');
        expect(mr).toHaveProperty('project_id');
        expect(mr).toHaveProperty('title');
        expect(mr).toHaveProperty('description');
        expect(mr).toHaveProperty('state');
        expect(mr).toHaveProperty('created_at');
        expect(mr).toHaveProperty('updated_at');
        expect(mr).toHaveProperty('target_branch');
        expect(mr).toHaveProperty('source_branch');
        expect(mr).toHaveProperty('upvotes');
        expect(mr).toHaveProperty('downvotes');
        expect(mr).toHaveProperty('author');
        expect(mr).toHaveProperty('assignees');
        expect(mr).toHaveProperty('reviewers');
        expect(mr).toHaveProperty('source_project_id');
        expect(mr).toHaveProperty('target_project_id');
        expect(mr).toHaveProperty('labels');
        expect(mr).toHaveProperty('draft');
        expect(mr).toHaveProperty('work_in_progress');
        expect(mr).toHaveProperty('milestone');
        expect(mr).toHaveProperty('merge_when_pipeline_succeeds');
        expect(mr).toHaveProperty('merge_status');
        expect(mr).toHaveProperty('detailed_merge_status');
        expect(mr).toHaveProperty('sha');
        expect(mr).toHaveProperty('merge_commit_sha');
        expect(mr).toHaveProperty('squash_commit_sha');
        expect(mr).toHaveProperty('user_notes_count');
        expect(mr).toHaveProperty('should_remove_source_branch');
        expect(mr).toHaveProperty('force_remove_source_branch');
        expect(mr).toHaveProperty('web_url');

        // Validate author structure
        expect(mr.author).toHaveProperty('id');
        expect(mr.author).toHaveProperty('username');
        expect(mr.author).toHaveProperty('name');
        expect(mr.author).toHaveProperty('state');
        expect(mr.author).toHaveProperty('avatar_url');
        expect(mr.author).toHaveProperty('web_url');
      }

      console.log(`✅ ListMergeRequestsSchema API request successful, validated ${mergeRequests.length} merge requests`);
    }, 15000);

    it('should make API request with created test data (main functionality test)', async () => {
      // Follow WORK.md data lifecycle: create test project → create MR → test API → cleanup
      const timestamp = Date.now();
      const testProjectName = `mr-test-project-${timestamp}`;

      // 1. Create test project
      const createProjectResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: testProjectName,
          namespace_id: 124, // test group ID
          description: 'Test project for MR API validation - safe to delete',
          visibility: 'private',
        }),
      });

      if (!createProjectResponse.ok) {
        const errorBody = await createProjectResponse.text();
        throw new Error(`Failed to create test project: ${createProjectResponse.status} ${errorBody}`);
      }

      const testProject = await createProjectResponse.json();
      const testProjectId = testProject.id;

      try {
        // 2. Create a test file to enable MR creation
        await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/repository/files/README.md`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            branch: 'main',
            content: 'IyBUZXN0IFByb2plY3Q=', // base64 for "# Test Project"
            commit_message: 'Initial commit',
          }),
        });

        // 3. Create test branch
        await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/repository/branches`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            branch: 'feature-test',
            ref: 'main',
          }),
        });

        // 4. Create test merge request
        const createMRResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/merge_requests`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_branch: 'feature-test',
            target_branch: 'main',
            title: `Test MR ${timestamp}`,
            description: 'Test merge request for API validation',
          }),
        });

        if (createMRResponse.ok) {
          // 5. Test the actual ListMergeRequests functionality
          const params = {
            project_id: testProjectId.toString(),
            state: 'all' as const,
            per_page: 10,
          };

          const paramResult = ListMergeRequestsSchema.safeParse(params);
          expect(paramResult.success).toBe(true);

          if (paramResult.success) {
            const queryParams = new URLSearchParams();
            Object.entries(paramResult.data).forEach(([key, value]) => {
              if (value !== undefined && key !== 'project_id') {
                queryParams.set(key, String(value));
              }
            });

            const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}/merge_requests?${queryParams}`, {
              headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`,
              },
            });

            expect(response.ok).toBe(true);
            const mergeRequests = await response.json();
            expect(Array.isArray(mergeRequests)).toBe(true);
            expect(mergeRequests.length).toBeGreaterThan(0);

            console.log(`✅ ListMergeRequestsSchema main functionality test successful with ${mergeRequests.length} created MRs`);
          }
        }
      } finally {
        // 6. Cleanup: Delete test project (includes all MRs, branches, files)
        await fetch(`${GITLAB_API_URL}/api/v4/projects/${testProjectId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });
        console.log(`🧹 Cleaned up test project: ${testProjectId}`);
      }
    }, 30000);

    it('should validate advanced filtering parameters', async () => {
      const advancedParams = {
        project_id: GITLAB_PROJECT_ID,
        author_id: 123,
        assignee_id: 456,
        reviewer_id: 789,
        milestone: 'v1.0',
        labels: ['bug', 'feature'],
        with_labels_details: true,
        with_merge_status_recheck: true,
        created_after: '2023-01-01T00:00:00.000Z',
        created_before: '2023-12-31T23:59:59.999Z',
        updated_after: '2023-06-01T00:00:00.000Z',
        updated_before: '2023-12-31T23:59:59.999Z',
        scope: 'created_by_me' as const,
        source_branch: 'feature-branch',
        target_branch: 'main',
        search: 'bug fix',
        in: 'title' as const,
        wip: 'no' as const,
        per_page: 20,
      };

      const result = ListMergeRequestsSchema.safeParse(advancedParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.assignee_id).toBe(456);
        expect(result.data.labels).toEqual(['bug', 'feature']);
        expect(result.data.with_labels_details).toBe(true);
        expect(result.data.scope).toBe('created_by_me');
        expect(result.data.wip).toBe('no');
      }

      console.log('✅ ListMergeRequestsSchema validates advanced filtering parameters');
    });

    it('should reject invalid parameters', async () => {
      const invalidParams = {
        project_id: GITLAB_PROJECT_ID,
        state: 'invalid_state', // Invalid enum value
        order_by: 'invalid_field', // Invalid enum value
        sort: 'sideways', // Invalid enum value
        per_page: 150, // Exceeds max of 100
        scope: 'invalid_scope', // Invalid enum value
        wip: 'maybe', // Invalid enum value
      };

      const result = ListMergeRequestsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }

      console.log('✅ ListMergeRequestsSchema correctly rejects invalid parameters');
    });
  });

  describe('GetMergeRequestSchema', () => {
    let testMrIid: string;

    beforeAll(async () => {
      // Get the first merge request from the project to use for testing
      try {
        const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID!)}/merge_requests?per_page=1`, {
          headers: {
            'Authorization': `Bearer ${GITLAB_TOKEN}`,
          },
        });

        if (response.ok) {
          const mrs = await response.json();
          if (mrs.length > 0) {
            testMrIid = mrs[0].iid;
          }
        }
      } catch (error) {
        console.log('Could not fetch test merge request IID');
      }
    });

    it('should validate get merge request parameters', async () => {
      if (!testMrIid) {
        console.log('⚠️  Skipping GetMergeRequestSchema test - no merge requests found in project');
        return;
      }

      const validParams = {
        project_id: GITLAB_PROJECT_ID,
        merge_request_iid: testMrIid,
        include_diverged_commits_count: true,
        include_rebase_in_progress: true,
      };

      const result = GetMergeRequestSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(GITLAB_PROJECT_ID);
        expect(result.data.merge_request_iid).toBe(String(testMrIid));
        expect(result.data.include_diverged_commits_count).toBe(true);
      }

      console.log('✅ GetMergeRequestSchema validates parameters correctly');
    });

    it('should make successful API request for single merge request', async () => {
      if (!testMrIid) {
        console.log('⚠️  Skipping GetMergeRequestSchema API test - no merge requests found in project');
        return;
      }

      const params = {
        project_id: GITLAB_PROJECT_ID,
        merge_request_iid: testMrIid,
        include_diverged_commits_count: true,
        include_rebase_in_progress: true,
      };

      // Validate parameters first
      const paramResult = GetMergeRequestSchema.safeParse(params);
      expect(paramResult.success).toBe(true);

      if (!paramResult.success) return;

      // Build query string from validated parameters
      const queryParams = new URLSearchParams();
      Object.entries(paramResult.data).forEach(([key, value]) => {
        if (value !== undefined && key !== 'project_id' && key !== 'merge_request_iid') {
          queryParams.set(key, String(value));
        }
      });

      // Make API request
      const response = await fetch(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(paramResult.data.project_id!)}/merge_requests/${encodeURIComponent(paramResult.data.merge_request_iid!)}?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${GITLAB_TOKEN}`,
        },
      });

      expect(response.ok).toBe(true);

      const mr = await response.json();

      // Validate comprehensive merge request structure
      expect(mr.iid).toBe(parseInt(testMrIid));
      expect(mr).toHaveProperty('id');
      expect(mr).toHaveProperty('project_id');
      expect(mr).toHaveProperty('title');
      expect(mr).toHaveProperty('description');
      expect(mr).toHaveProperty('state');
      expect(mr).toHaveProperty('merged_by');
      expect(mr).toHaveProperty('merged_at');
      expect(mr).toHaveProperty('closed_by');
      expect(mr).toHaveProperty('closed_at');
      expect(mr).toHaveProperty('created_at');
      expect(mr).toHaveProperty('updated_at');
      expect(mr).toHaveProperty('target_branch');
      expect(mr).toHaveProperty('source_branch');
      expect(mr).toHaveProperty('upvotes');
      expect(mr).toHaveProperty('downvotes');
      expect(mr).toHaveProperty('author');
      expect(mr).toHaveProperty('assignees');
      expect(mr).toHaveProperty('reviewers');
      expect(mr).toHaveProperty('source_project_id');
      expect(mr).toHaveProperty('target_project_id');
      expect(mr).toHaveProperty('labels');
      expect(mr).toHaveProperty('draft');
      expect(mr).toHaveProperty('work_in_progress');
      expect(mr).toHaveProperty('milestone');
      expect(mr).toHaveProperty('merge_when_pipeline_succeeds');
      expect(mr).toHaveProperty('merge_status');
      expect(mr).toHaveProperty('detailed_merge_status');
      expect(mr).toHaveProperty('sha');
      expect(mr).toHaveProperty('merge_commit_sha');
      expect(mr).toHaveProperty('squash_commit_sha');
      expect(mr).toHaveProperty('user_notes_count');
      expect(mr).toHaveProperty('should_remove_source_branch');
      expect(mr).toHaveProperty('force_remove_source_branch');
      expect(mr).toHaveProperty('web_url');
      expect(mr).toHaveProperty('time_stats');
      expect(mr).toHaveProperty('squash');
      expect(mr).toHaveProperty('task_completion_status');
      expect(mr).toHaveProperty('has_conflicts');
      expect(mr).toHaveProperty('blocking_discussions_resolved');
      expect(mr).toHaveProperty('approvals_before_merge');

      console.log('✅ GetMergeRequestSchema API request successful, merge request validated');
    }, 15000);
  });

  describe('CreateMergeRequestSchema', () => {
    it('should validate create merge request parameters', async () => {
      const validParams = {
        project_id: GITLAB_PROJECT_ID,
        source_branch: 'feature-branch',
        target_branch: 'main',
        title: 'Test Merge Request',
        description: 'This is a test merge request',
        assignee_id: 123,
        assignee_ids: [123, 456],
        reviewer_ids: [789],
        target_project_id: GITLAB_PROJECT_ID,
        labels: 'bug,feature',
        milestone_id: 42,
        remove_source_branch: true,
        allow_collaboration: true,
        allow_maintainer_to_push: true,
        squash: true,
      };

      const result = CreateMergeRequestSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(GITLAB_PROJECT_ID);
        expect(result.data.source_branch).toBe('feature-branch');
        expect(result.data.target_branch).toBe('main');
        expect(result.data.title).toBe('Test Merge Request');
        expect(result.data.squash).toBe(true);
      }

      console.log('✅ CreateMergeRequestSchema validates parameters correctly');
    });

    it('should reject invalid create parameters', async () => {
      const invalidParams = {
        project_id: GITLAB_PROJECT_ID,
        source_branch: '', // Empty source branch should be invalid
        target_branch: '', // Empty target branch should be invalid
        title: '', // Empty title should be invalid
      };

      const result = CreateMergeRequestSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      console.log('✅ CreateMergeRequestSchema correctly rejects invalid parameters');
    });
  });

  describe('UpdateMergeRequestSchema', () => {
    it('should validate update merge request parameters', async () => {
      const validParams = {
        project_id: GITLAB_PROJECT_ID,
        merge_request_iid: '1',
        title: 'Updated Merge Request',
        description: 'Updated description',
        state_event: 'close' as const,
        target_branch: 'main',
        assignee_id: 123,
        assignee_ids: [123, 456],
        reviewer_ids: [789],
        labels: 'bug,enhancement',
        add_labels: 'documentation',
        remove_labels: 'wontfix',
        milestone_id: 42,
        remove_source_branch: true,
        allow_collaboration: false,
        allow_maintainer_to_push: false,
        squash: true,
      };

      const result = UpdateMergeRequestSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(GITLAB_PROJECT_ID);
        expect(result.data.merge_request_iid).toBe('1');
        expect(result.data.title).toBe('Updated Merge Request');
        expect(result.data.state_event).toBe('close');
      }

      console.log('✅ UpdateMergeRequestSchema validates parameters correctly');
    });
  });

  describe('MergeMergeRequestSchema', () => {
    it('should validate merge merge request parameters', async () => {
      const validParams = {
        project_id: GITLAB_PROJECT_ID,
        merge_request_iid: '1',
        merge_commit_message: 'Custom merge commit message',
        squash_commit_message: 'Custom squash commit message',
        squash: true,
        should_remove_source_branch: true,
        merge_when_pipeline_succeeds: false,
        sha: 'abc123def456',
      };

      const result = MergeMergeRequestSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.project_id).toBe(GITLAB_PROJECT_ID);
        expect(result.data.merge_request_iid).toBe('1');
        expect(result.data.squash).toBe(true);
        expect(result.data.should_remove_source_branch).toBe(true);
      }

      console.log('✅ MergeMergeRequestSchema validates parameters correctly');
    });
  });
});