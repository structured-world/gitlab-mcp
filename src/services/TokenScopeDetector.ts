/**
 * Token Scope Detection Service
 *
 * Detects token scopes at startup via GET /api/v4/personal_access_tokens/self
 * and determines which capabilities are available. This allows the server to:
 * - Skip GraphQL introspection when scopes are insufficient
 * - Register only tools that will work with the current token
 * - Show clean, actionable messages instead of error stack traces
 */

import { logger } from "../logger";
import { GITLAB_BASE_URL, GITLAB_TOKEN } from "../config";
import { enhancedFetch } from "../utils/fetch";

/**
 * GitLab token types that can be detected
 */
export type GitLabTokenType =
  | "personal_access_token"
  | "project_access_token"
  | "group_access_token"
  | "oauth"
  | "unknown";

/**
 * Known GitLab token scopes
 */
export type GitLabScope =
  | "api"
  | "read_api"
  | "read_user"
  | "read_repository"
  | "write_repository"
  | "read_registry"
  | "write_registry"
  | "sudo"
  | "admin_mode"
  | "create_runner"
  | "manage_runner"
  | "ai_features"
  | "k8s_proxy";

/**
 * Result of token scope detection
 */
export interface TokenScopeInfo {
  /** Token name (e.g. "gitlab-mcp") */
  name: string;
  /** Detected scopes */
  scopes: GitLabScope[];
  /** Token expiration date (null if never expires) */
  expiresAt: string | null;
  /** Whether the token is currently active */
  active: boolean;
  /** Token type (PAT, project, group, etc.) */
  tokenType: GitLabTokenType;
  /** Whether GraphQL API access is available (requires api or read_api) */
  hasGraphQLAccess: boolean;
  /** Whether the token has full write access (api scope) */
  hasWriteAccess: boolean;
  /** Number of days until token expires (null if no expiry) */
  daysUntilExpiry: number | null;
}

/**
 * Scope requirements for each tool.
 * A tool is available if the token has ANY of the listed scopes.
 */
const TOOL_SCOPE_REQUIREMENTS: Record<string, GitLabScope[]> = {
  // Core tools - require api or read_api for most, read_user for user-related
  browse_projects: ["api", "read_api"],
  browse_namespaces: ["api", "read_api"],
  browse_commits: ["api", "read_api"],
  browse_events: ["api", "read_api", "read_user"],
  browse_users: ["api", "read_api", "read_user"],
  browse_todos: ["api", "read_api"],
  manage_project: ["api"],
  manage_namespace: ["api"],
  manage_todos: ["api"],
  manage_context: ["api", "read_api", "read_user"],

  // Labels
  browse_labels: ["api", "read_api"],
  manage_label: ["api"],

  // Merge requests
  browse_merge_requests: ["api", "read_api"],
  browse_mr_discussions: ["api", "read_api"],
  manage_merge_request: ["api"],
  manage_mr_discussion: ["api"],
  manage_draft_notes: ["api"],

  // Files - also works with repository scopes
  browse_files: ["api", "read_api", "read_repository"],
  manage_files: ["api", "write_repository"],

  // Milestones
  browse_milestones: ["api", "read_api"],
  manage_milestone: ["api"],

  // Pipelines
  browse_pipelines: ["api", "read_api"],
  manage_pipeline: ["api"],
  manage_pipeline_job: ["api"],

  // Variables
  browse_variables: ["api", "read_api"],
  manage_variable: ["api"],

  // Wiki
  browse_wiki: ["api", "read_api"],
  manage_wiki: ["api"],

  // Work items
  browse_work_items: ["api", "read_api"],
  manage_work_item: ["api"],

  // Snippets
  browse_snippets: ["api", "read_api"],
  manage_snippet: ["api"],

  // Webhooks
  browse_webhooks: ["api", "read_api"],
  manage_webhook: ["api"],

  // Integrations
  browse_integrations: ["api", "read_api"],
  manage_integration: ["api"],

  // Releases
  browse_releases: ["api", "read_api"],
  manage_release: ["api"],

  // Refs (branches, tags)
  browse_refs: ["api", "read_api"],
  manage_ref: ["api"],

  // Members
  browse_members: ["api", "read_api"],
  manage_member: ["api"],

  // Search
  browse_search: ["api", "read_api"],

  // Iterations
  browse_iterations: ["api", "read_api"],
};

/**
 * Detect token scopes by calling GET /api/v4/personal_access_tokens/self
 *
 * This endpoint works with:
 * - Personal access tokens (PAT) - returns full token info
 * - Project/Group access tokens - returns full token info
 *
 * Does NOT work with:
 * - OAuth tokens - use OAuth introspection instead
 * - Job tokens - have different scope model
 *
 * @returns TokenScopeInfo or null if detection fails
 */
export async function detectTokenScopes(): Promise<TokenScopeInfo | null> {
  if (!GITLAB_BASE_URL || !GITLAB_TOKEN) {
    return null;
  }

  try {
    const response = await enhancedFetch(`${GITLAB_BASE_URL}/api/v4/personal_access_tokens/self`, {
      headers: {
        "PRIVATE-TOKEN": GITLAB_TOKEN,
        Accept: "application/json",
      },
      retry: false, // Don't retry scope detection - it runs at startup
    });

    if (!response.ok) {
      // 401 = invalid token, 403 = insufficient permissions, 404 = endpoint not available
      if (response.status === 404) {
        logger.debug("Token self-introspection endpoint not available (older GitLab version)");
        return null;
      }
      if (response.status === 401) {
        logger.info("Token is invalid or expired");
        return null;
      }
      if (response.status === 403) {
        // Some token types (e.g. deploy tokens) can't self-introspect
        logger.debug("Token self-introspection not permitted for this token type");
        return null;
      }
      logger.debug(
        { status: response.status },
        "Unexpected response from token self-introspection"
      );
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      name: string;
      scopes: string[];
      expires_at: string | null;
      active: boolean;
      revoked: boolean;
    };

    const scopes = data.scopes as GitLabScope[];
    const hasGraphQLAccess = scopes.some(s => s === "api" || s === "read_api");
    const hasWriteAccess = scopes.includes("api");

    // Calculate days until expiry using UTC dates to avoid timezone off-by-one errors.
    // expires_at is a date-only string (YYYY-MM-DD) — parse as UTC midnight.
    let daysUntilExpiry: number | null = null;
    if (data.expires_at) {
      const [yearStr, monthStr, dayStr] = data.expires_at.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);

      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        const expiryUtcMs = Date.UTC(year, month - 1, day);
        const now = new Date();
        const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        daysUntilExpiry = Math.ceil((expiryUtcMs - todayUtcMs) / (1000 * 60 * 60 * 24));
      }
    }

    // Determine token type from the endpoint response
    // /personal_access_tokens/self works for PAT, project, and group tokens
    let tokenType: GitLabTokenType = "personal_access_token";
    if (data.name?.startsWith("project_")) {
      tokenType = "project_access_token";
    } else if (data.name?.startsWith("group_")) {
      tokenType = "group_access_token";
    }

    return {
      name: data.name,
      scopes,
      expiresAt: data.expires_at,
      active: data.active && !data.revoked,
      tokenType,
      hasGraphQLAccess,
      hasWriteAccess,
      daysUntilExpiry,
    };
  } catch (error) {
    // Network errors, DNS failures, etc. - don't block startup
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "Token scope detection failed (network error)"
    );
    return null;
  }
}

/**
 * Check if a tool is available given the detected token scopes
 */
export function isToolAvailableForScopes(toolName: string, scopes: GitLabScope[]): boolean {
  const requiredScopes = TOOL_SCOPE_REQUIREMENTS[toolName];

  // Tool not in scope map - allow it (might be a new tool without mapping)
  if (!requiredScopes) {
    return true;
  }

  // Tool is available if the token has ANY of the required scopes
  return requiredScopes.some(required => scopes.includes(required));
}

/**
 * Get the list of tools available for given scopes
 */
export function getToolsForScopes(scopes: GitLabScope[]): string[] {
  return Object.keys(TOOL_SCOPE_REQUIREMENTS).filter(toolName =>
    isToolAvailableForScopes(toolName, scopes)
  );
}

/**
 * Get all known tool scope requirements
 */
export function getToolScopeRequirements(): Record<string, GitLabScope[]> {
  return { ...TOOL_SCOPE_REQUIREMENTS };
}

/**
 * Generate an actionable URL for creating a new token with correct scopes
 */
export function getTokenCreationUrl(
  baseUrl: string,
  scopes: string[] = ["api", "read_user"]
): string {
  const url = new URL("/-/user_settings/personal_access_tokens", baseUrl);
  url.searchParams.set("name", "gitlab-mcp");
  url.searchParams.set("scopes", scopes.join(","));
  return url.toString();
}

/**
 * Log a clean, user-friendly startup message about token scopes
 */
export function logTokenScopeInfo(info: TokenScopeInfo, totalTools: number): void {
  const availableTools = getToolsForScopes(info.scopes);
  const scopeList = info.scopes.join(", ");

  // Token expiry warning (< 7 days)
  if (info.daysUntilExpiry !== null && info.daysUntilExpiry <= 7) {
    if (info.daysUntilExpiry <= 0) {
      logger.warn(
        { tokenName: info.name, expiresAt: info.expiresAt },
        `Token "${info.name}" has expired! Please create a new token.`
      );
    } else {
      logger.warn(
        { tokenName: info.name, daysUntilExpiry: info.daysUntilExpiry, expiresAt: info.expiresAt },
        `Token "${info.name}" expires in ${info.daysUntilExpiry} day(s)`
      );
    }
  }

  if (info.hasWriteAccess) {
    // Full access (api scope) - brief message
    logger.info(
      {
        tokenName: info.name,
        scopes: scopeList,
        expiresAt: info.expiresAt ?? "never",
      },
      `Token "${info.name}" detected (scopes: ${scopeList})`
    );
  } else {
    // Limited access - explain what's available and how to fix
    logger.info(
      {
        tokenName: info.name,
        scopes: scopeList,
        availableTools: availableTools.length,
        totalTools,
      },
      `Token "${info.name}" has limited scopes - ${availableTools.length} of ${totalTools} tools available`
    );

    if (!info.hasGraphQLAccess) {
      logger.info("GraphQL introspection skipped (requires 'api' or 'read_api' scope)");
    }

    const fixUrl = getTokenCreationUrl(GITLAB_BASE_URL);
    logger.info(
      { url: fixUrl },
      `For full functionality, create a token with 'api' scope: ${fixUrl}`
    );
  }
}
