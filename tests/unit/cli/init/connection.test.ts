/**
 * Unit tests for connection.ts
 * Tests GitLab connection validation and testing
 */

import {
  validateGitLabUrl,
  getPatCreationUrl,
  isGitLabSaas,
  testConnection,
} from "../../../../src/cli/init/connection";

// Mock fetch for testConnection
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("connection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateGitLabUrl", () => {
    it("should accept valid HTTPS URL", () => {
      const result = validateGitLabUrl("https://gitlab.example.com");

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept valid HTTP URL", () => {
      const result = validateGitLabUrl("http://gitlab.local");

      expect(result.valid).toBe(true);
    });

    it("should accept URL with port", () => {
      const result = validateGitLabUrl("https://gitlab.example.com:8443");

      expect(result.valid).toBe(true);
    });

    it("should accept URL with path", () => {
      const result = validateGitLabUrl("https://example.com/gitlab");

      expect(result.valid).toBe(true);
    });

    it("should reject empty URL", () => {
      const result = validateGitLabUrl("");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("URL is required");
    });

    it("should reject URL without protocol", () => {
      const result = validateGitLabUrl("gitlab.example.com");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("https://");
    });

    it("should reject invalid URL format", () => {
      const result = validateGitLabUrl("https://");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject file:// protocol", () => {
      const result = validateGitLabUrl("file:///etc/passwd");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("https://");
    });
  });

  describe("getPatCreationUrl", () => {
    it("should return PAT creation URL for GitLab.com", () => {
      const result = getPatCreationUrl("https://gitlab.com");

      expect(result).toContain("https://gitlab.com/-/user_settings/personal_access_tokens");
      expect(result).toContain("name=gitlab-mcp");
      expect(result).toContain("scopes=api,read_user");
    });

    it("should return PAT creation URL for self-hosted", () => {
      const result = getPatCreationUrl("https://gitlab.example.com");

      expect(result).toContain("https://gitlab.example.com/-/user_settings/personal_access_tokens");
    });

    it("should handle URL with trailing slash", () => {
      const result = getPatCreationUrl("https://gitlab.example.com/");

      expect(result).toContain("https://gitlab.example.com/-/user_settings/personal_access_tokens");
      // Should not have double slashes
      expect(result).not.toContain("//user_settings");
    });
  });

  describe("isGitLabSaas", () => {
    it("should return true for gitlab.com", () => {
      expect(isGitLabSaas("https://gitlab.com")).toBe(true);
    });

    it("should return true for gitlab.com with path", () => {
      expect(isGitLabSaas("https://gitlab.com/group/project")).toBe(true);
    });

    it("should return true for gitlab.com subdomains", () => {
      // GitLab SaaS subdomains like customers, about, etc.
      expect(isGitLabSaas("https://about.gitlab.com")).toBe(true);
    });

    it("should return false for self-hosted", () => {
      expect(isGitLabSaas("https://gitlab.example.com")).toBe(false);
    });

    it("should return false for self-hosted with gitlab in name", () => {
      expect(isGitLabSaas("https://mygitlab.internal")).toBe(false);
      expect(isGitLabSaas("https://git.example.com")).toBe(false);
    });

    it("should return false for hosts that contain gitlab.com as substring", () => {
      // Security: prevent matching hosts like notgitlab.com
      expect(isGitLabSaas("https://notgitlab.com")).toBe(false);
      expect(isGitLabSaas("https://fakegitlab.com")).toBe(false);
    });

    it("should return false for hosts ending with gitlab.com substring", () => {
      // Security: prevent matching hosts like gitlab.company.com
      expect(isGitLabSaas("https://gitlab.company.com")).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(isGitLabSaas("https://GITLAB.COM")).toBe(true);
      expect(isGitLabSaas("https://GitLab.Com")).toBe(true);
    });

    it("should return false for invalid URLs", () => {
      expect(isGitLabSaas("not-a-url")).toBe(false);
      expect(isGitLabSaas("")).toBe(false);
    });
  });

  describe("testConnection", () => {
    it("should return success for valid connection", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          username: "testuser",
          email: "test@example.com",
          is_admin: false,
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "16.5.0",
        }),
      });

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(true);
      expect(result.username).toBe("testuser");
      expect(result.email).toBe("test@example.com");
      expect(result.gitlabVersion).toBe("16.5.0");
    });

    it("should return error for 401 unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await testConnection("https://gitlab.example.com", "invalid-token");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid token");
    });

    it("should return error for 403 forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(false);
      expect(result.error).toContain("permissions");
    });

    it("should return error for other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    it("should return error for network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should handle missing version endpoint gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          username: "testuser",
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(true);
      expect(result.username).toBe("testuser");
      expect(result.gitlabVersion).toBeUndefined();
    });

    it("should handle version endpoint throwing error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          username: "testuser",
        }),
      });
      mockFetch.mockRejectedValueOnce(new Error("Version error"));

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(true);
      expect(result.username).toBe("testuser");
      expect(result.gitlabVersion).toBeUndefined();
    });

    it("should include admin status in result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          username: "admin",
          is_admin: true,
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "16.0.0" }),
      });

      const result = await testConnection("https://gitlab.example.com", "glpat-xxx");

      expect(result.success).toBe(true);
      expect(result.isAdmin).toBe(true);
    });

    it("should normalize URL by removing trailing slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: "testuser" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "16.0.0" }),
      });

      await testConnection("https://gitlab.example.com/", "glpat-xxx");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/user",
        expect.any(Object)
      );
    });
  });
});
