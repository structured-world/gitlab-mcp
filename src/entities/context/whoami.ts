/**
 * Whoami - Token introspection and capability discovery
 *
 * Provides comprehensive information about:
 * - Current user identity
 * - Token capabilities and scopes
 * - Server configuration
 * - Available tools and filtering statistics
 * - Actionable recommendations for access issues
 *
 * Key feature: Dynamic token refresh
 * When called, whoami re-introspects the token to detect any permission changes.
 * If the token scopes have changed (e.g., user added new scopes), the tool registry
 * is automatically refreshed and a tools/list_changed notification is sent to the client.
 * This enables users to update their token permissions and immediately access new tools
 * without restarting the MCP server.
 *
 * @author Pavel Oliynyk <pavel@structured.world>
 */

import { GITLAB_BASE_URL, GITLAB_READ_ONLY_MODE } from "../../config";
import { logger } from "../../logger";
import { ConnectionManager } from "../../services/ConnectionManager";
import { getTokenCreationUrl } from "../../services/TokenScopeDetector";
import { RegistryManager } from "../../registry-manager";
import { sendToolsListChangedNotification } from "../../server";
import { enhancedFetch } from "../../utils/fetch";
import { getContextManager } from "./context-manager";
import {
  WhoamiResult,
  WhoamiUserInfo,
  WhoamiTokenInfo,
  WhoamiServerInfo,
  WhoamiCapabilities,
  WhoamiContextInfo,
  WhoamiRecommendation,
  RuntimeScope,
} from "./types";

/**
 * Check if OAuth mode is enabled
 */
function isOAuthMode(): boolean {
  return process.env.OAUTH_ENABLED === "true";
}

/**
 * Get GitLab host from API URL
 */
function getHost(): string {
  try {
    const url = new URL(GITLAB_BASE_URL);
    return url.hostname;
  } catch {
    return GITLAB_BASE_URL;
  }
}

/**
 * Fetch current user information from GitLab API
 * Works with any valid token including read_user scope
 */
async function fetchCurrentUser(): Promise<WhoamiUserInfo | null> {
  try {
    const response = await enhancedFetch(`${GITLAB_BASE_URL}/api/v4/user`, {
      retry: false,
    });

    if (!response.ok) {
      logger.debug({ status: response.status }, "Failed to fetch current user");
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      username: string;
      name: string;
      email?: string;
      avatar_url?: string;
      is_admin?: boolean;
      state: string;
    };

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      email: data.email,
      avatarUrl: data.avatar_url,
      isAdmin: data.is_admin,
      state: data.state as "active" | "blocked" | "deactivated",
    };
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "Error fetching current user"
    );
    return null;
  }
}

/**
 * Build token info from ConnectionManager's detected token scopes
 */
function buildTokenInfo(): WhoamiTokenInfo | null {
  try {
    const connectionManager = ConnectionManager.getInstance();
    const tokenScopeInfo = connectionManager.getTokenScopeInfo();

    if (!tokenScopeInfo) {
      // In OAuth mode or when token detection failed
      if (isOAuthMode()) {
        return {
          type: "oauth",
          name: null,
          scopes: [],
          expiresAt: null,
          daysUntilExpiry: null,
          isValid: true, // Assume valid in OAuth mode
          hasGraphQLAccess: true, // OAuth typically has full access
          hasWriteAccess: true,
        };
      }
      return null;
    }

    return {
      type: tokenScopeInfo.tokenType,
      name: tokenScopeInfo.name,
      scopes: tokenScopeInfo.scopes,
      expiresAt: tokenScopeInfo.expiresAt,
      daysUntilExpiry: tokenScopeInfo.daysUntilExpiry,
      isValid: tokenScopeInfo.active,
      hasGraphQLAccess: tokenScopeInfo.hasGraphQLAccess,
      hasWriteAccess: tokenScopeInfo.hasWriteAccess,
    };
  } catch {
    return null;
  }
}

/**
 * Build server info from ConnectionManager and config
 */
function buildServerInfo(): WhoamiServerInfo {
  let version = "unknown";
  let tier: "free" | "premium" | "ultimate" | "unknown" = "unknown";
  // Edition cannot be reliably determined from tier alone.
  // Both CE and EE can have "free" tier (EE without license behaves like CE).
  // Premium/Ultimate tiers indicate EE, but we set to "unknown" for consistency.
  const edition: "EE" | "CE" | "unknown" = "unknown";

  try {
    const connectionManager = ConnectionManager.getInstance();
    const instanceInfo = connectionManager.getInstanceInfo();
    version = instanceInfo.version;
    tier = instanceInfo.tier;
  } catch {
    // Connection not initialized - use defaults
  }

  return {
    host: getHost(),
    apiUrl: GITLAB_BASE_URL,
    version,
    tier,
    edition,
    readOnlyMode: GITLAB_READ_ONLY_MODE,
    oauthEnabled: isOAuthMode(),
  };
}

/**
 * Build capabilities info from RegistryManager
 */
function buildCapabilities(tokenInfo: WhoamiTokenInfo | null): WhoamiCapabilities {
  const registryManager = RegistryManager.getInstance();
  const filterStats = registryManager.getFilterStats();

  const canBrowse =
    tokenInfo === null ||
    tokenInfo.scopes.length === 0 ||
    tokenInfo.scopes.some(s => ["api", "read_api", "read_user"].includes(s));

  const canManage = tokenInfo?.hasWriteAccess ?? false;
  const canAccessGraphQL = tokenInfo?.hasGraphQLAccess ?? false;

  return {
    canBrowse,
    canManage,
    canAccessGraphQL,
    availableToolCount: filterStats.available,
    totalToolCount: filterStats.total,
    filteredByScopes: filterStats.filteredByScopes,
    filteredByReadOnly: filterStats.filteredByReadOnly,
    filteredByTier: filterStats.filteredByTier,
    filteredByDeniedRegex: filterStats.filteredByDeniedRegex,
    filteredByActionDenial: filterStats.filteredByActionDenial,
  };
}

/**
 * Build current context info from ContextManager
 */
function buildContextInfo(): WhoamiContextInfo {
  const contextManager = getContextManager();
  const context = contextManager.getContext();

  let scope: RuntimeScope | null = null;
  if (context.scope) {
    scope = context.scope;
  }

  return {
    activePreset: context.presetName ?? null,
    activeProfile: context.profileName ?? null,
    scope,
  };
}

/**
 * Generate warnings based on current state
 */
function generateWarnings(
  tokenInfo: WhoamiTokenInfo | null,
  capabilities: WhoamiCapabilities
): string[] {
  const warnings: string[] = [];

  // Token expiry warnings
  if (tokenInfo && tokenInfo.daysUntilExpiry !== null) {
    const days = tokenInfo.daysUntilExpiry;
    if (days < 0) {
      warnings.push(`Token has expired (${Math.abs(days)} days ago)`);
    } else if (days === 0) {
      warnings.push("Token expires today!");
    } else if (days <= 7) {
      warnings.push(`Token expires in ${days} day(s)`);
    }
  }

  // Token validity warning
  if (tokenInfo && !tokenInfo.isValid) {
    warnings.push("Token is invalid or revoked - authentication may fail");
  }

  // Scope limitation warnings
  if (capabilities.filteredByScopes > 0) {
    const pct = Math.round((capabilities.filteredByScopes / capabilities.totalToolCount) * 100);
    warnings.push(
      `Limited token scopes: ${capabilities.availableToolCount} of ${capabilities.totalToolCount} tools available (${pct}% filtered)`
    );

    if (!capabilities.canAccessGraphQL) {
      warnings.push("No GraphQL access - project/MR/issue operations unavailable");
    }
    if (!capabilities.canManage) {
      warnings.push("No write access - all manage_* operations blocked");
    }
  }

  // Read-only mode warning
  if (capabilities.filteredByReadOnly > 0) {
    warnings.push(
      `Read-only mode enabled: ${capabilities.filteredByReadOnly} write tools disabled`
    );
  }

  // Tier restriction warning
  if (capabilities.filteredByTier > 0) {
    warnings.push(
      `GitLab tier restrictions: ${capabilities.filteredByTier} tools unavailable for current tier`
    );
  }

  // Denied tools regex warning
  if (capabilities.filteredByDeniedRegex > 0) {
    warnings.push(
      `Tool access restrictions: ${capabilities.filteredByDeniedRegex} tools blocked by configuration`
    );
  }

  return warnings;
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(
  tokenInfo: WhoamiTokenInfo | null,
  capabilities: WhoamiCapabilities,
  serverInfo: WhoamiServerInfo
): WhoamiRecommendation[] {
  const recommendations: WhoamiRecommendation[] = [];

  // Token expired - high priority renewal
  if (tokenInfo && tokenInfo.daysUntilExpiry !== null && tokenInfo.daysUntilExpiry < 0) {
    recommendations.push({
      action: "renew_token",
      message: "Your token has expired. Create a new token to restore access.",
      url: getTokenCreationUrl(GITLAB_BASE_URL, ["api", "read_user"]),
      priority: "high",
    });
  }

  // Token expiring soon
  if (
    tokenInfo &&
    tokenInfo.daysUntilExpiry !== null &&
    tokenInfo.daysUntilExpiry >= 0 &&
    tokenInfo.daysUntilExpiry <= 7
  ) {
    recommendations.push({
      action: "renew_token",
      message: `Your token expires in ${tokenInfo.daysUntilExpiry} day(s). Renew soon to avoid service interruption.`,
      url: getTokenCreationUrl(GITLAB_BASE_URL, ["api", "read_user"]),
      priority: "medium",
    });
  }

  // Limited scopes - recommend full access token
  // This covers both write access and GraphQL access issues
  const needsNewToken = capabilities.filteredByScopes > 0 && !capabilities.canManage;
  if (needsNewToken) {
    recommendations.push({
      action: "create_new_token",
      message: "Create a token with 'api' scope for full GitLab functionality",
      url: getTokenCreationUrl(GITLAB_BASE_URL, ["api", "read_user"]),
      priority: "high",
    });
  }

  // No GraphQL access but could have it - only recommend if we haven't already
  // suggested creating a new token (which would also fix GraphQL access)
  if (
    !needsNewToken &&
    !capabilities.canAccessGraphQL &&
    tokenInfo &&
    tokenInfo.scopes.length > 0
  ) {
    recommendations.push({
      action: "add_scope",
      message: "Add 'api' or 'read_api' scope to enable project, issue, and MR operations",
      url: getTokenCreationUrl(GITLAB_BASE_URL, ["api", "read_user"]),
      priority: "high",
    });
  }

  // Tier restrictions
  if (capabilities.filteredByTier > 0 && serverInfo.tier === "free") {
    recommendations.push({
      action: "contact_admin",
      message:
        "Some features require GitLab Premium or Ultimate. Contact your administrator for tier upgrade.",
      priority: "low",
    });
  }

  return recommendations;
}

/**
 * Execute the whoami action
 *
 * Returns comprehensive information about current authentication status,
 * token capabilities, server configuration, and actionable recommendations.
 *
 * Key feature: This action re-introspects the token to detect any permission changes.
 * If scopes have changed since startup (e.g., user added new scopes to their PAT),
 * the tool registry is automatically refreshed and clients are notified via
 * tools/list_changed. This enables hot-reloading of token permissions without restart.
 */
export async function executeWhoami(): Promise<WhoamiResult> {
  // Step 1: Refresh token scopes to pick up any permission changes
  // This enables users to update their token and immediately access new tools
  let scopesRefreshed = false;
  try {
    const connectionManager = ConnectionManager.getInstance();
    scopesRefreshed = await connectionManager.refreshTokenScopes();

    if (scopesRefreshed) {
      // Token scopes changed - refresh the tool registry and notify clients
      logger.info("Token scopes changed - refreshing tool registry");
      RegistryManager.getInstance().refreshCache();
      await sendToolsListChangedNotification();
    }
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to refresh token scopes"
    );
  }

  // Step 2: Fetch all information (AFTER refresh so we get updated data)
  const [userInfo, tokenInfo] = await Promise.all([
    fetchCurrentUser(),
    Promise.resolve(buildTokenInfo()),
  ]);

  const serverInfo = buildServerInfo();
  const capabilities = buildCapabilities(tokenInfo);
  const contextInfo = buildContextInfo();
  const warnings = generateWarnings(tokenInfo, capabilities);
  const recommendations = generateRecommendations(tokenInfo, capabilities, serverInfo);

  logger.debug(
    {
      hasUser: userInfo !== null,
      hasToken: tokenInfo !== null,
      availableTools: capabilities.availableToolCount,
      warnings: warnings.length,
      recommendations: recommendations.length,
      scopesRefreshed,
    },
    "Whoami executed"
  );

  return {
    user: userInfo,
    token: tokenInfo,
    server: serverInfo,
    capabilities,
    context: contextInfo,
    warnings,
    recommendations,
    scopesRefreshed,
  };
}
