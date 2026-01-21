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
  // Normalize URL
  const baseUrl = instanceUrl.replace(/\/$/, "");
  const apiUrl = `${baseUrl}/api/v4`;

  try {
    // Test /user endpoint to verify token
    const userResponse = await fetch(`${apiUrl}/user`, {
      headers: {
        "PRIVATE-TOKEN": token,
        Accept: "application/json",
      },
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

    // Get GitLab version
    let gitlabVersion: string | undefined;
    try {
      const versionResponse = await fetch(`${apiUrl}/version`, {
        headers: {
          "PRIVATE-TOKEN": token,
          Accept: "application/json",
        },
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
 * Check if URL looks like GitLab SaaS
 */
export function isGitLabSaas(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes("gitlab.com");
}

/**
 * Generate PAT creation URL for GitLab instance
 */
export function getPatCreationUrl(instanceUrl: string): string {
  const baseUrl = instanceUrl.replace(/\/$/, "");
  return `${baseUrl}/-/user_settings/personal_access_tokens?name=gitlab-mcp&scopes=api,read_user`;
}
