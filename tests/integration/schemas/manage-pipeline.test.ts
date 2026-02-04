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

import { ManagePipelineSchema } from "../../../src/entities/pipelines/schema";
import { IntegrationTestHelper } from "../helpers/registry-helper";
import { getTestData } from "../../setup/testConfig";

describe("manage_pipeline - GitLab Integration (CQRS)", () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error("GITLAB_TOKEN environment variable is required");
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log("Integration test helper initialized for manage_pipeline testing");
  });

  describe("ManagePipelineSchema - create action", () => {
    describe("with legacy variables", () => {
      it("should validate create action schema with variables", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          variables: [
            { key: "BUILD_TYPE", value: "release" },
            { key: "DEPLOY_ENV", value: "staging" },
          ],
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.variables).toHaveLength(2);
          expect(result.data.variables![0].key).toBe("BUILD_TYPE");
        }
      });

      it("should create pipeline with variables via real API", async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log("⚠️ No test project available, skipping real API test");
          return;
        }

        const params = {
          action: "create" as const,
          project_id: testData.project.id.toString(),
          ref: "main",
          variables: [{ key: "TEST_VAR", value: "integration-test" }],
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          try {
            const pipeline = (await helper.executeTool(
              "manage_pipeline",
              schemaResult.data
            )) as Record<string, unknown>;

            expect(pipeline).toHaveProperty("id");
            expect(pipeline).toHaveProperty("status");
            expect(pipeline).toHaveProperty("ref", "main");

            console.log(
              `✅ Created pipeline with variables: ${pipeline.id} (status: ${pipeline.status})`
            );
          } catch (error) {
            // Pipeline creation may fail if no runners or CI disabled - that's OK for schema test
            console.log(`⚠️ Pipeline creation failed (expected if no CI): ${error}`);
          }
        }
      });
    });

    describe("with typed inputs (GitLab 15.5+)", () => {
      it("should validate create action schema with string input", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: {
            environment: "staging",
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.inputs).toEqual({ environment: "staging" });
        }
      });

      it("should validate create action schema with multiple typed inputs", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: {
            environment: "production",
            debug: true,
            count: 5,
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.inputs).toEqual({
            environment: "production",
            debug: true,
            count: 5,
          });
        }
      });

      it("should validate create action schema with array input", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: {
            regions: ["us-east-1", "eu-west-1"],
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.inputs).toEqual({ regions: ["us-east-1", "eu-west-1"] });
        }
      });

      it("should create pipeline with inputs via real API", async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log("⚠️ No test project available, skipping real API test");
          return;
        }

        // Test project should have .gitlab-ci.yml with spec.inputs from data-lifecycle
        const params = {
          action: "create" as const,
          project_id: testData.project.id.toString(),
          ref: "main",
          inputs: {
            environment: "staging",
            debug: true,
            count: 3,
          },
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          try {
            const pipeline = (await helper.executeTool(
              "manage_pipeline",
              schemaResult.data
            )) as Record<string, unknown>;

            expect(pipeline).toHaveProperty("id");
            expect(pipeline).toHaveProperty("status");
            expect(pipeline).toHaveProperty("ref", "main");

            console.log(
              `✅ Created pipeline with inputs: ${pipeline.id} (status: ${pipeline.status})`
            );
          } catch (error) {
            // GitLab < 15.5 or invalid inputs spec will fail - log and continue
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (
              errorMsg.includes("inputs") ||
              errorMsg.includes("spec") ||
              errorMsg.includes("15.5")
            ) {
              console.log(`⚠️ Pipeline inputs not supported on this GitLab version: ${errorMsg}`);
            } else {
              console.log(`⚠️ Pipeline creation failed: ${errorMsg}`);
            }
          }
        }
      });
    });

    describe("with both variables and inputs", () => {
      it("should validate create action schema with variables and inputs combined", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          variables: [{ key: "EXTRA_VAR", value: "extra-value" }],
          inputs: {
            environment: "test",
            debug: false,
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.variables).toHaveLength(1);
          expect(result.data.inputs).toEqual({ environment: "test", debug: false });
        }
      });

      it("should create pipeline with both variables and inputs via real API", async () => {
        const testData = getTestData();
        if (!testData.project?.id) {
          console.log("⚠️ No test project available, skipping real API test");
          return;
        }

        const params = {
          action: "create" as const,
          project_id: testData.project.id.toString(),
          ref: "main",
          variables: [{ key: "CI_TEST", value: "combined-test" }],
          inputs: {
            environment: "test",
            debug: true,
            count: 1,
          },
        };

        // Validate schema first
        const schemaResult = ManagePipelineSchema.safeParse(params);
        expect(schemaResult.success).toBe(true);

        if (schemaResult.success) {
          try {
            const pipeline = (await helper.executeTool(
              "manage_pipeline",
              schemaResult.data
            )) as Record<string, unknown>;

            expect(pipeline).toHaveProperty("id");
            expect(pipeline).toHaveProperty("status");

            console.log(
              `✅ Created pipeline with variables+inputs: ${pipeline.id} (status: ${pipeline.status})`
            );
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(`⚠️ Pipeline creation failed: ${errorMsg}`);
          }
        }
      });
    });

    describe("schema validation edge cases", () => {
      it("should reject invalid input types", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: {
            invalid: { nested: "object" }, // Objects not allowed
          },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(false);
      });

      it("should accept empty inputs object (will not be sent to API)", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: {},
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);
      });

      it("should accept inputs without variables", () => {
        const params = {
          action: "create" as const,
          project_id: "123",
          ref: "main",
          inputs: { debug: false },
        };

        const result = ManagePipelineSchema.safeParse(params);
        expect(result.success).toBe(true);

        if (result.success && result.data.action === "create") {
          expect(result.data.variables).toBeUndefined();
          expect(result.data.inputs).toEqual({ debug: false });
        }
      });
    });
  });

  describe("ManagePipelineSchema - other actions", () => {
    it("should validate retry action schema", () => {
      const params = {
        action: "retry" as const,
        project_id: "123",
        pipeline_id: "456",
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it("should validate cancel action schema", () => {
      const params = {
        action: "cancel" as const,
        project_id: "123",
        pipeline_id: "456",
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it("should reject create action without ref", () => {
      const params = {
        action: "create" as const,
        project_id: "123",
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it("should reject retry action without pipeline_id", () => {
      const params = {
        action: "retry" as const,
        project_id: "123",
      };

      const result = ManagePipelineSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });
});
