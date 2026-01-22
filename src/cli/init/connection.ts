/**
 * Connection testing for init wizard
 */

import { ConnectionTestResult } from "./types";

/**
 * Test GitLab connection with provided credentials
 */
export async function testConnection(
  instanceUrl: string,
  token: string
): Promise<ConnectionTestResult> {
  // Normalize URL: strip trailing slash and /api/v4 suffix if present
  const baseUrl = instanceUrl.replace(/\/$/, "").replace(/\/api\/v4\/?$/, "");
  const apiUrl = `${baseUrl}/api/v4`;

  // 10 second timeout for connection test
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // Test /user endpoint to verify token
    const userResponse = await fetch(`${apiUrl}/user`, {
      headers: {
        "PRIVATE-TOKEN": token,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!userResponse.ok) {
      if (userResponse.status === 401) {
        return {
          success: false,
          error: "Invalid token - authentication failed",
        };
      }
      if (userResponse.status === 403) {
        return {
          success: false,
          error: "Token lacks required permissions",
        };
      }
      return {
        success: false,
        error: `GitLab API error: ${userResponse.status} ${userResponse.statusText}`,
      };
    }

    const userData = (await userResponse.json()) as {
      username?: string;
      email?: string;
      is_admin?: boolean;
    };

    // Get GitLab version (with same timeout)
    let gitlabVersion: string | undefined;
    try {
      const versionResponse = await fetch(`${apiUrl}/version`, {
        headers: {
          "PRIVATE-TOKEN": token,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (versionResponse.ok) {
        const versionData = (await versionResponse.json()) as { version?: string };
        gitlabVersion = versionData.version;
      }
    } catch {
      // Version endpoint may not be available, continue without it
    }

    return {
      success: true,
      username: userData.username,
      email: userData.email,
      isAdmin: userData.is_admin,
      gitlabVersion,
    };
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: `Connection timeout - ${instanceUrl} did not respond within 10 seconds`,
      };
    }
    // Handle network errors
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return {
        success: false,
        error: `Cannot connect to ${instanceUrl} - check URL and network`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validate GitLab URL format
 */
export function validateGitLabUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: "URL is required" };
  }

  // Must start with https:// or http://
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    return { valid: false, error: "URL must start with https:// or http://" };
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return { valid: false, error: "Invalid URL hostname" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * Check if URL is GitLab SaaS (gitlab.com)
 * Uses strict hostname matching to avoid false positives from URLs like:
 * - notgitlab.com (contains "gitlab.com" as substring)
 * - gitlab.company.com (contains "gitlab.com" as substring)
 */
export function isGitLabSaas(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    // Strict match: exactly gitlab.com or subdomain of gitlab.com
    return hostname === "gitlab.com" || hostname.endsWith(".gitlab.com");
  } catch {
    return false;
  }
}

/**
 * Generate PAT creation URL for GitLab instance
 * Uses least-privilege scopes based on read-only mode
 */
export function getPatCreationUrl(instanceUrl: string, readOnly = false): string {
  const baseUrl = instanceUrl.replace(/\/$/, "");
  // Use minimal scopes for read-only mode, full api for write access
  const scopes = readOnly ? "read_api,read_user" : "api,read_user";
  return `${baseUrl}/-/user_settings/personal_access_tokens?name=gitlab-mcp&scopes=${scopes}`;
}
