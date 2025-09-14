/**
 * GitLab API Integration Tests
 *
 * These tests validate that the GitLab API connection works properly.
 * They require GITLAB_TOKEN and TEST_PROJECT_ID environment variables.
 */

// Use global fetch instead of node-fetch for tests

const GITLAB_API_URL = process.env.GITLAB_API_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN_TEST || process.env.GITLAB_TOKEN;
const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID;

describe("GitLab API Validation", () => {
  beforeAll(() => {
    if (!GITLAB_TOKEN || !TEST_PROJECT_ID) {
      console.warn("⚠️  Skipping GitLab API tests: GITLAB_TOKEN and TEST_PROJECT_ID required");
    }
  });

  const shouldSkipProjectTests = !GITLAB_TOKEN || !TEST_PROJECT_ID;
  const shouldSkipUserTests = !GITLAB_TOKEN;

  (shouldSkipProjectTests ? it.skip : it)(
    "should fetch project information",
    async () => {
      const response = await fetch(
        `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT_ID!)}`,
        {
          headers: {
            "PRIVATE-TOKEN": GITLAB_TOKEN!,
            "Content-Type": "application/json",
          },
        }
      );

      expect(response.ok).toBe(true);

      const data = (await response.json()) as { id: number; name: string };
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("name");
      expect(typeof data.id).toBe("number");
      expect(typeof data.name).toBe("string");
    },
    10000
  );

  (shouldSkipProjectTests ? it.skip : it)(
    "should fetch project issues",
    async () => {
      const response = await fetch(
        `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT_ID!)}/issues`,
        {
          headers: {
            "PRIVATE-TOKEN": GITLAB_TOKEN!,
            "Content-Type": "application/json",
          },
        }
      );

      expect(response.ok).toBe(true);

      const data = (await response.json()) as Array<{ id: number; title: string }>;
      expect(Array.isArray(data)).toBe(true);

      if (data.length > 0) {
        expect(data[0]).toHaveProperty("id");
        expect(data[0]).toHaveProperty("title");
      }
    },
    10000
  );

  (shouldSkipProjectTests ? it.skip : it)(
    "should fetch project merge requests",
    async () => {
      const response = await fetch(
        `${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(TEST_PROJECT_ID!)}/merge_requests`,
        {
          headers: {
            "PRIVATE-TOKEN": GITLAB_TOKEN!,
            "Content-Type": "application/json",
          },
        }
      );

      expect(response.ok).toBe(true);

      const data = (await response.json()) as Array<{ id: number; title: string }>;
      expect(Array.isArray(data)).toBe(true);

      if (data.length > 0) {
        expect(data[0]).toHaveProperty("id");
        expect(data[0]).toHaveProperty("title");
      }
    },
    10000
  );

  (shouldSkipUserTests ? it.skip : it)(
    "should fetch current user information",
    async () => {
      const response = await fetch(`${GITLAB_API_URL}/api/v4/user`, {
        headers: {
          "PRIVATE-TOKEN": GITLAB_TOKEN!,
          "Content-Type": "application/json",
        },
      });

      expect(response.ok).toBe(true);

      const data = (await response.json()) as { id: number; username: string; name: string };
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("username");
      expect(data).toHaveProperty("name");
    },
    10000
  );
});
