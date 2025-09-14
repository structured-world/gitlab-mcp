/**
 * GitLab Users API Integration Tests
 * Tests the GetUsersSchema against GitLab 18.3 API
 */

import { GetUsersSchema } from "../../../src/entities/core/schema-readonly";

const GITLAB_API_URL = process.env.GITLAB_API_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN_TEST || process.env.GITLAB_TOKEN;

describe("GitLab Users API - GetUsersSchema", () => {
  const shouldSkip = !GITLAB_TOKEN;

  beforeAll(() => {
    if (!GITLAB_TOKEN) {
      console.warn("⚠️  Skipping GitLab Users API tests: GITLAB_TOKEN required");
    }
  });

  (shouldSkip ? it.skip : it)(
    "should validate GetUsersSchema parameters against GitLab API",
    async () => {
      // Test with various parameter combinations
      const testCases = [
        // Basic query
        {},
        // Single username search
        { username: "root" },
        // Search with pagination
        { search: "admin", page: 1, per_page: 5 },
        // Filter active users
        { active: true, per_page: 10 },
        // Filter with multiple parameters
        {
          humans: true,
          exclude_internal: true,
          without_project_bots: true,
          per_page: 20,
        },
        // Date range filtering
        {
          created_after: "2023-01-01T00:00:00Z",
          created_before: "2024-12-31T23:59:59Z",
          per_page: 5,
        },
      ];

      for (const params of testCases) {
        // Validate request schema
        const validationResult = GetUsersSchema.safeParse(params);
        expect(validationResult.success).toBe(true);

        if (validationResult.success) {
          // Build query string
          const queryParams = new URLSearchParams();
          Object.entries(validationResult.data).forEach(([key, value]) => {
            if (value !== undefined) {
              queryParams.append(key, String(value));
            }
          });

          // Make API request
          const url = `${GITLAB_API_URL}/api/v4/users${
            queryParams.toString() ? `?${queryParams.toString()}` : ""
          }`;

          const response = await fetch(url, {
            headers: {
              "PRIVATE-TOKEN": GITLAB_TOKEN!,
              "Content-Type": "application/json",
            },
          });

          // Validate response
          expect(response.ok).toBe(true);
          expect([200, 304]).toContain(response.status);

          const data = await response.json();
          expect(Array.isArray(data)).toBe(true);

          // Validate response structure if we have results
          if (data.length > 0) {
            const user = data[0];
            // Required fields as per GitLab 18.3 documentation
            expect(user).toHaveProperty("id");
            expect(user).toHaveProperty("username");
            expect(user).toHaveProperty("name");
            expect(user).toHaveProperty("state");
            expect(user).toHaveProperty("avatar_url");
            expect(user).toHaveProperty("web_url");

            // Validate types
            expect(typeof user.id).toBe("number");
            expect(typeof user.username).toBe("string");
            expect(typeof user.name).toBe("string");
            expect(typeof user.state).toBe("string");
            expect(["active", "blocked", "deactivated"]).toContain(user.state);
          }

          // Check pagination headers
          const totalPages = response.headers.get("X-Total-Pages");
          const totalCount = response.headers.get("X-Total");
          const perPage = response.headers.get("X-Per-Page");
          const page = response.headers.get("X-Page");

          if (params.per_page) {
            expect(perPage).toBe(String(params.per_page));
          }
          if (params.page) {
            expect(page).toBe(String(params.page));
          }
        }
      }
    },
    30000 // 30 second timeout for multiple API calls
  );

  (shouldSkip ? it.skip : it)(
    "should handle invalid parameters correctly",
    async () => {
      const invalidCases = [
        // Invalid types
        { page: "not-a-number" },
        { per_page: -1 },
        { per_page: 101 }, // Exceeds max
        { active: "not-a-boolean" },
        // Invalid date format (should be ISO 8601)
        { created_after: "invalid-date" },
      ];

      for (const params of invalidCases) {
        const validationResult = GetUsersSchema.safeParse(params);
        expect(validationResult.success).toBe(false);
      }
    }
  );

  (shouldSkip ? it.skip : it)(
    "should correctly handle all filter parameters",
    async () => {
      // Test that all documented parameters are accepted
      const allParams = {
        username: "test",
        public_email: "test@example.com",
        search: "test",
        active: true,
        external: false,
        blocked: false,
        humans: true,
        created_after: "2023-01-01T00:00:00Z",
        created_before: "2024-01-01T00:00:00Z",
        exclude_active: false,
        exclude_external: false,
        exclude_humans: false,
        exclude_internal: true,
        without_project_bots: true,
        page: 1,
        per_page: 50,
      };

      const validationResult = GetUsersSchema.safeParse(allParams);
      expect(validationResult.success).toBe(true);

      // Ensure all parameters are preserved
      if (validationResult.success) {
        expect(Object.keys(validationResult.data).length).toBe(Object.keys(allParams).length);
      }
    }
  );
});