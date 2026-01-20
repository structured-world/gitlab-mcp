/**
 * Unit tests for error-handler.ts
 */

import {
  handleGitLabError,
  createMissingFieldsError,
  createInvalidActionError,
  createTypeMismatchError,
  createValidationError,
  StructuredToolError,
  isStructuredToolError,
  GitLabApiErrorResponse,
} from "../../../src/utils/error-handler";

describe("Error Handler", () => {
  describe("handleGitLabError", () => {
    describe("403 Forbidden - Tier Restricted", () => {
      it("should create tier-restricted error for Premium features", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "403 Forbidden",
        };

        const result = handleGitLabError(error, "browse_protected_branches", "list");

        expect(result.error_code).toBe("TIER_RESTRICTED");
        expect(result.tool).toBe("browse_protected_branches");
        expect(result.action).toBe("list");
        if (result.error_code === "TIER_RESTRICTED") {
          expect(result.http_status).toBe(403);
          expect(result.tier_required).toBe("Premium");
          expect(result.feature_name).toBe("Protected Branches API");
          expect(result.docs_url).toContain("protected_branches");
          expect(result.upgrade_url).toBe("https://about.gitlab.com/pricing/");
        }
      });

      it("should create tier-restricted error for Ultimate features", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "403 Forbidden",
        };

        const result = handleGitLabError(error, "browse_code_owners", "get");

        expect(result.error_code).toBe("TIER_RESTRICTED");
        if (result.error_code === "TIER_RESTRICTED") {
          expect(result.tier_required).toBe("Ultimate");
          expect(result.feature_name).toBe("Code Owners");
        }
      });

      it("should include alternatives in tier-restricted error", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "403 Forbidden",
        };

        const result = handleGitLabError(error, "browse_protected_branches", "list");

        expect(result.error_code).toBe("TIER_RESTRICTED");
        if (result.error_code === "TIER_RESTRICTED") {
          expect(result.alternatives).toBeDefined();
          expect(result.alternatives!.length).toBeGreaterThan(0);
          expect(result.alternatives![0]).toHaveProperty("action");
          expect(result.alternatives![0]).toHaveProperty("description");
          expect(result.alternatives![0]).toHaveProperty("available_on");
        }
      });
    });

    describe("403 Forbidden - Permission Denied", () => {
      it("should create permission-denied error for non-tier-restricted tools", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "403 Forbidden - you don't have access",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("PERMISSION_DENIED");
        expect(result.tool).toBe("browse_merge_requests");
        expect(result.action).toBe("list");
        if (result.error_code === "PERMISSION_DENIED") {
          expect(result.http_status).toBe(403);
        }
        expect(result.message).toContain("permission");
        expect(result.suggested_fix).toBeDefined();
      });

      it("should include GitLab message in suggested_fix when available", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "You must be a project member to perform this action",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("PERMISSION_DENIED");
        expect(result.suggested_fix).toContain("GitLab message:");
        expect(result.suggested_fix).toContain("project member");
      });

      it("should not include GitLab message in suggested_fix for generic 403 messages", () => {
        const error: GitLabApiErrorResponse = {
          status: 403,
          message: "403 Forbidden",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("PERMISSION_DENIED");
        // Should not include "GitLab message:" for generic 403 errors
        expect(result.suggested_fix).not.toContain("GitLab message:");
      });
    });

    describe("404 Not Found", () => {
      it("should create not-found error", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Project Not Found",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "get");

        expect(result.error_code).toBe("NOT_FOUND");
        if (result.error_code === "NOT_FOUND") {
          expect(result.http_status).toBe(404);
        }
        expect(result.message).toContain("not found");
        expect(result.suggested_fix).toBeDefined();
      });

      it("should extract resource type from message", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Merge Request Not Found",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "get");

        expect(result.error_code).toBe("NOT_FOUND");
        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("merge_request");
        }
      });

      it("should extract project resource type", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Project Not Found",
        };

        const result = handleGitLabError(error, "get_project", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("project");
        }
      });

      it("should extract numeric resource ID from message", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Project 12345 Not Found",
        };

        const result = handleGitLabError(error, "get_project", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_id).toBe("12345");
        }
      });

      it("should extract path-like resource ID from message", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Project 'my-group/my-project' Not Found",
        };

        const result = handleGitLabError(error, "get_project", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_id).toBe("my-group/my-project");
        }
      });

      it("should detect branch resource type", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Branch Not Found",
        };

        const result = handleGitLabError(error, "browse_branches", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("branch");
        }
      });

      it("should detect user resource type", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 User Not Found",
        };

        const result = handleGitLabError(error, "get_users", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("user");
        }
      });

      it("should detect issue resource type", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Issue Not Found",
        };

        const result = handleGitLabError(error, "browse_issues", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("issue");
        }
      });

      it("should detect pipeline resource type", () => {
        const error: GitLabApiErrorResponse = {
          status: 404,
          message: "404 Pipeline Not Found",
        };

        const result = handleGitLabError(error, "browse_pipelines", "get");

        if (result.error_code === "NOT_FOUND") {
          expect(result.resource_type).toBe("pipeline");
        }
      });
    });

    describe("429 Rate Limited", () => {
      it("should create rate-limited error", () => {
        const error: GitLabApiErrorResponse = {
          status: 429,
          message: "Rate limit exceeded",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("RATE_LIMITED");
        if (result.error_code === "RATE_LIMITED") {
          expect(result.http_status).toBe(429);
        }
        expect(result.message).toContain("Rate limit");
        expect(result.suggested_fix).toContain("Wait");
      });
    });

    describe("5xx Server Errors", () => {
      it("should create server-error for 500", () => {
        const error: GitLabApiErrorResponse = {
          status: 500,
          message: "Internal Server Error",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("SERVER_ERROR");
        if (result.error_code === "SERVER_ERROR") {
          expect(result.http_status).toBe(500);
        }
        expect(result.message).toContain("server error");
      });

      it("should create server-error for 502", () => {
        const error: GitLabApiErrorResponse = {
          status: 502,
          message: "Bad Gateway",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("SERVER_ERROR");
        if (result.error_code === "SERVER_ERROR") {
          expect(result.http_status).toBe(502);
        }
      });

      it("should create server-error for 503", () => {
        const error: GitLabApiErrorResponse = {
          status: 503,
          message: "Service Unavailable",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("SERVER_ERROR");
        if (result.error_code === "SERVER_ERROR") {
          expect(result.http_status).toBe(503);
        }
      });
    });

    describe("Generic API Errors", () => {
      it("should create api-error for 400", () => {
        const error: GitLabApiErrorResponse = {
          status: 400,
          message: "Bad Request - invalid parameter",
        };

        const result = handleGitLabError(error, "manage_merge_request", "create");

        expect(result.error_code).toBe("API_ERROR");
        if (result.error_code === "API_ERROR") {
          expect(result.http_status).toBe(400);
        }
        expect(result.message).toContain("invalid parameter");
      });

      it("should create api-error for 422", () => {
        const error: GitLabApiErrorResponse = {
          status: 422,
          message: "Unprocessable Entity",
        };

        const result = handleGitLabError(error, "manage_merge_request", "create");

        expect(result.error_code).toBe("API_ERROR");
        if (result.error_code === "API_ERROR") {
          expect(result.http_status).toBe(422);
        }
      });

      it("should handle error with error field instead of message", () => {
        const error: GitLabApiErrorResponse = {
          status: 400,
          error: "Invalid parameter value",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("API_ERROR");
        expect(result.message).toBe("Invalid parameter value");
      });

      it("should handle error with error_description", () => {
        const error: GitLabApiErrorResponse = {
          status: 401,
          error_description: "Token has expired",
        };

        const result = handleGitLabError(error, "browse_merge_requests", "list");

        expect(result.error_code).toBe("API_ERROR");
        if (result.error_code === "API_ERROR") {
          expect(result.http_status).toBe(401);
        }
        expect(result.message).toBe("Token has expired");
      });
    });
  });

  describe("Validation Error Helpers", () => {
    describe("createMissingFieldsError", () => {
      it("should create error with missing fields", () => {
        const result = createMissingFieldsError("manage_merge_request", "create", [
          "project_id",
          "source_branch",
          "title",
        ]);

        expect(result.error_code).toBe("MISSING_REQUIRED_FIELD");
        expect(result.tool).toBe("manage_merge_request");
        expect(result.action).toBe("create");
        expect(result.missing_fields).toEqual(["project_id", "source_branch", "title"]);
        expect(result.message).toContain("project_id");
        expect(result.suggested_fix).toContain("project_id");
      });

      it("should include action_required_fields when provided", () => {
        const requiredFields = {
          create: ["project_id", "source_branch", "target_branch", "title"],
          update: ["project_id", "merge_request_iid"],
        };

        const result = createMissingFieldsError(
          "manage_merge_request",
          "create",
          ["title"],
          requiredFields
        );

        expect(result.action_required_fields).toEqual(requiredFields);
      });
    });

    describe("createInvalidActionError", () => {
      it("should create error with valid actions list", () => {
        const result = createInvalidActionError("manage_merge_request", "invalid_action", [
          "create",
          "update",
          "merge",
        ]);

        expect(result.error_code).toBe("INVALID_ACTION");
        expect(result.action).toBe("invalid_action");
        expect(result.valid_actions).toEqual(["create", "update", "merge"]);
        expect(result.message).toContain("invalid_action");
        expect(result.message).toContain("create");
      });
    });

    describe("createTypeMismatchError", () => {
      it("should create error with field type information", () => {
        const result = createTypeMismatchError(
          "manage_merge_request",
          "create",
          "merge_request_iid",
          "number",
          "string"
        );

        expect(result.error_code).toBe("TYPE_MISMATCH");
        expect(result.invalid_fields).toHaveLength(1);
        expect(result.invalid_fields![0]).toEqual({
          field: "merge_request_iid",
          expected: "number",
          received: "string",
        });
        expect(result.suggested_fix).toContain("number");
      });
    });

    describe("createValidationError", () => {
      it("should create generic validation error", () => {
        const result = createValidationError(
          "browse_merge_requests",
          "list",
          "Invalid date format for created_after"
        );

        expect(result.error_code).toBe("VALIDATION_ERROR");
        expect(result.message).toBe("Invalid date format for created_after");
        expect(result.suggested_fix).toContain("documentation");
      });
    });
  });

  describe("StructuredToolError", () => {
    it("should create error with structured data", () => {
      const structuredError = {
        error_code: "API_ERROR" as const,
        tool: "browse_merge_requests",
        action: "list",
        http_status: 400,
        message: "Bad request",
        suggested_fix: "Check parameters",
      };

      const error = new StructuredToolError(structuredError);

      expect(error.message).toBe("Bad request");
      expect(error.name).toBe("StructuredToolError");
      expect(error.structuredError).toEqual(structuredError);
    });

    it("should serialize to JSON correctly", () => {
      const structuredError = {
        error_code: "NOT_FOUND" as const,
        tool: "browse_merge_requests",
        action: "get",
        http_status: 404,
        message: "Not found",
        suggested_fix: "Check ID",
      };

      const error = new StructuredToolError(structuredError);
      const json = error.toJSON();

      expect(json).toEqual(structuredError);
    });

    it("should be an instance of Error", () => {
      const error = new StructuredToolError({
        error_code: "API_ERROR",
        tool: "test",
        action: "test",
        http_status: 400,
        message: "Test error",
      });

      expect(error instanceof Error).toBe(true);
      expect(error instanceof StructuredToolError).toBe(true);
    });
  });

  describe("isStructuredToolError", () => {
    it("should return true for StructuredToolError instances", () => {
      const error = new StructuredToolError({
        error_code: "API_ERROR",
        tool: "test",
        action: "test",
        http_status: 400,
        message: "Test error",
      });

      expect(isStructuredToolError(error)).toBe(true);
    });

    it("should return false for regular Error instances", () => {
      const error = new Error("Regular error");
      expect(isStructuredToolError(error)).toBe(false);
    });

    it("should return false for non-error values", () => {
      expect(isStructuredToolError(null)).toBe(false);
      expect(isStructuredToolError(undefined)).toBe(false);
      expect(isStructuredToolError("string")).toBe(false);
      expect(isStructuredToolError({})).toBe(false);
    });
  });
});
