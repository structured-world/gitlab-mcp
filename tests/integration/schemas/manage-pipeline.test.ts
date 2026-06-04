/**
 * manage_pipeline Integration Tests - Create Pipeline with Variables and Inputs
 *
 * Tests the manage_pipeline CQRS tool with real GitLab API:
 * - create action with legacy variables
 * - create action with typed inputs (GitLab 15.5+)
 * - create action with both variables and inputs
 *
 * Prerequisites:
 * - Test project from data-lifecycle.test.ts with .gitlab-ci.yml containing spec.inputs
 * - GitLab 15.5+ for inputs support
 */

import { z } from 'zod';
import { ManagePipelineSchema } from '../../../src/entities/pipelines/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData, buildCiConfigBase64 } from '../../setup/testConfig';

// Validate the created pipeline shape instead of casting the tool's external output.
const PipelineResponseSchema = z.object({
  id: z.number(),
  status: z.string(),
  ref: z.string(),
});

/**
 * Create a pipeline via manage_pipeline and assert the returned shape. Shared by
 * the create tests so the validate/assert logic lives in one place.
 */
async function createPipelineAndAssert(
  helper: IntegrationTestHelper,
  params: unknown,
  label: string,
): Promise<void> {
  // No error swallowing: beforeAll re-seeds a valid spec:inputs .gitlab-ci.yml and
  // the test instance is GitLab 15.5+, so creation must succeed. A failure here is
  // a real regression and must surface. (Typed inputs require 15.5+, documented in
  // the file header; on older GitLab the CI config fails to parse, which correctly
  // signals the unmet prerequisite rather than being silently skipped.)
  const pipeline = PipelineResponseSchema.parse(
    await helper.executeTool('manage_pipeline', params),
  );
  expect(pipeline.ref).toBe('main');
  console.log(`✅ Created pipeline with ${label}: ${pipeline.id} (status: ${pipeline.status})`);
}

describe('manage_pipeline - GitLab Integration (CQRS)', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log('Integration test helper initialized for manage_pipeline testing');

    // Ensure the shared test project has a valid .gitlab-ci.yml on main before
    // creating pipelines. The cross-file test data may point at a project seeded
    // by an earlier run whose CI config predates the current format, so re-seed
    // it here (overwrite=true) to keep pipeline creation deterministic instead of
    // depending on test-file ordering. A unique marker guarantees the overwrite
    // always commits a change.
    const project = getTestData().project as { id: number } | undefined;
    if (project?.id) {
      await helper.executeTool('manage_files', {
        action: 'single',
        project_id: project.id.toString(),
        file_path: '.gitlab-ci.yml',
        branch: 'main',
        content: buildCiConfigBase64(`manage_pipeline fixture ${Date.now()}`),
        encoding: 'base64',
        commit_message: 'Refresh CI config for pipeline tests',
        overwrite: true,
      });
    }
  });

  describe('ManagePipelineSchema - create action', () => {
    describe('with legacy variables', () => {
      it('should validate create action schema with variables', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          variables: [
            { key: 'BUILD_TYPE', value: 'release' },
            { key: 'DEPLOY_ENV', value: 'staging' },
          ],
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.variables).toHaveLength(2);
          expect(result.data.variables![0].key).toBe('BUILD_TYPE');
        }
      });

      it('should create pipeline with variables via real API', async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log('⚠️ No test project available, skipping real API test');
          return;
        }

        const params = {
          action: 'create' as const,
          project_id: testData.project.id.toString(),
          ref: 'main',
          variables: [{ key: 'TEST_VAR', value: 'integration-test' }],
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          await createPipelineAndAssert(helper, schemaResult.data, 'variables');
        }
      });
    });

    describe('with typed inputs (GitLab 15.5+)', () => {
      it('should validate create action schema with string input', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: {
            environment: 'staging',
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.inputs).toEqual({ environment: 'staging' });
        }
      });

      it('should validate create action schema with multiple typed inputs', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: {
            environment: 'production',
            debug: true,
            count: 5,
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.inputs).toEqual({
            environment: 'production',
            debug: true,
            count: 5,
          });
        }
      });

      it('should validate create action schema with array input', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: {
            regions: ['us-east-1', 'eu-west-1'],
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.inputs).toEqual({ regions: ['us-east-1', 'eu-west-1'] });
        }
      });

      it('should create pipeline with inputs via real API', async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log('⚠️ No test project available, skipping real API test');
          return;
        }

        // Test project should have .gitlab-ci.yml with spec.inputs from data-lifecycle
        const params = {
          action: 'create' as const,
          project_id: testData.project.id.toString(),
          ref: 'main',
          inputs: {
            environment: 'staging',
            debug: true,
            count: 3,
          },
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          await createPipelineAndAssert(helper, schemaResult.data, 'inputs');
        }
      });
    });

    describe('with both variables and inputs', () => {
      it('should validate create action schema with variables and inputs combined', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          variables: [{ key: 'EXTRA_VAR', value: 'extra-value' }],
          inputs: {
            environment: 'test',
            debug: false,
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.variables).toHaveLength(1);
          expect(result.data.inputs).toEqual({ environment: 'test', debug: false });
        }
      });

      it('should create pipeline with both variables and inputs via real API', async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log('⚠️ No test project available, skipping real API test');
          return;
        }

        const params = {
          action: 'create' as const,
          project_id: testData.project.id.toString(),
          ref: 'main',
          variables: [{ key: 'CI_TEST', value: 'combined-test' }],
          inputs: {
            environment: 'test',
            debug: true,
            count: 1,
          },
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          await createPipelineAndAssert(helper, schemaResult.data, 'variables+inputs');
        }
      });
    });

    describe('schema validation edge cases', () => {
      it('should reject invalid input types', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: {
            invalid: { nested: 'object' }, // Objects not allowed
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(false);
      });

      it('should accept empty inputs object (will not be sent to API)', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: {},
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);
      });

      it('should accept inputs without variables', () => {
        const params = {
          action: 'create' as const,
          project_id: '123',
          ref: 'main',
          inputs: { debug: false },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === 'create') {
          expect(result.data.variables).toBeUndefined();
          expect(result.data.inputs).toEqual({ debug: false });
        }
      });
    });
  });

  describe('ManagePipelineSchema - other actions', () => {
    it('should validate retry action schema', () => {
      const params = {
        action: 'retry' as const,
        project_id: '123',
        pipeline_id: '456',
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should validate cancel action schema', () => {
      const params = {
        action: 'cancel' as const,
        project_id: '123',
        pipeline_id: '456',
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should reject create action without ref', () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject retry action without pipeline_id', () => {
      const params = {
        action: 'retry' as const,
        project_id: '123',
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });
});
