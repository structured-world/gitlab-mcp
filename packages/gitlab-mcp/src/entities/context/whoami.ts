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
 */

import { GITLAB_READ_ONLY_MODE } from '../../config';
import { logInfo, logDebug } from '../../logger';
import { isOAuthEnabled } from '../../oauth/index.js';
import { getGitLabApiUrlFromContext, getTokenContext } from '../../oauth/token-context';
import { ConnectionManager } from '../../services/ConnectionManager';
import { getTokenCreationUrl, getScopeCapabilities } from '../../services/TokenScopeDetector';
import { RegistryManager } from '../../registry-manager';
import { sendToolsListChangedNotification } from '../../server';
import { enhancedFetch, GitLabTimeoutError } from '../../utils/fetch';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { getContextManager } from './context-manager';
import {
  WhoamiResult,
  WhoamiUserInfo,
  WhoamiTokenInfo,
  WhoamiServerInfo,
  WhoamiCapabilities,
  WhoamiContextInfo,
  WhoamiRecommendation,
  WhoamiLookupError,
} from './types';

/**
 * Get GitLab host from API URL
 */
function getHost(): string {
  const apiUrl = getGitLabBaseUrl();
  try {
    const url = new URL(apiUrl);
    return url.hostname;
  } catch {
    return apiUrl;
  }
}

type UserLookup = {
  user: WhoamiUserInfo | null;
  lookup: WhoamiResult['userLookup'];
  error?: WhoamiLookupError;
};

// Node's transport codes are stable; free-form messages can contain credentials or
// provider response excerpts. Only exact known codes cross the diagnostic boundary.
// https://nodejs.org/api/errors.html#errorcode
type LookupTransportKind = Exclude<WhoamiLookupError['kind'], 'http'>;
const LOOKUP_ERROR_KINDS = new Map<string, LookupTransportKind>([
  ...[
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ].map((code): [string, LookupTransportKind] => [code, 'tls']),
  ...['ENOTFOUND', 'EAI_AGAIN'].map((code): [string, LookupTransportKind] => [code, 'dns']),
  ...[
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ].map((code): [string, LookupTransportKind] => [code, 'timeout']),
  ...[
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPIPE',
    'UND_ERR_SOCKET',
  ].map((code): [string, LookupTransportKind] => [code, 'network']),
]);

const LOOKUP_ERROR_MESSAGES = {
  tls: 'TLS certificate verification failed during the GitLab user lookup.',
  dns: 'DNS resolution failed during the GitLab user lookup.',
  timeout: 'The GitLab user lookup timed out.',
  network: 'The GitLab user lookup failed before a usable response was received.',
};

function transportLookupError(
  kind: keyof typeof LOOKUP_ERROR_MESSAGES,
  code?: string,
): WhoamiLookupError {
  return {
    kind,
    ...(code !== undefined && { code }),
    message: LOOKUP_ERROR_MESSAGES[kind],
    ...(kind === 'tls' && {
      hint: 'Check the certificate hostname and validity, and that GITLAB_CA_CERT_PATH or NODE_EXTRA_CA_CERTS trusts the CA chain, including intermediate certificates.',
    }),
  };
}

/** Classify both direct Node errors and Undici's cause without exposing their text. */
function describeLookupError(error: unknown, status?: number): WhoamiLookupError {
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
  const candidates = [error, cause];
  // Inspect codes before timeout types: GitLabTimeoutError retains the native code in its cause.
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || !('code' in candidate)) continue;
    const code = candidate.code;
    if (typeof code !== 'string') continue;
    const kind = LOOKUP_ERROR_KINDS.get(code);
    if (kind) return transportLookupError(kind, code);
  }
  if (
    candidates.some(
      (candidate) =>
        candidate instanceof GitLabTimeoutError ||
        (candidate instanceof Error && candidate.name === 'TimeoutError'),
    )
  ) {
    return transportLookupError('timeout');
  }
  if (status !== undefined) {
    return {
      kind: 'http',
      status,
      message: `Could not read the GitLab user lookup response (HTTP ${status}).`,
    };
  }
  return transportLookupError('network');
}

/**
 * Fetch current user information from GitLab API
 * Works with any valid token including read_user scope
 */
async function fetchCurrentUser(): Promise<UserLookup> {
  let status: number | undefined;
  try {
    const response = await enhancedFetch(`${getGitLabBaseUrl()}/api/v4/user`, {
      retry: false,
    });
    status = response.status;

    if (!response.ok) {
      logDebug('Failed to fetch current user', { status: response.status });
      // Only these mean the credentials were refused; any other status says nothing about them.
      const refused = response.status === 401 || response.status === 403;
      return {
        user: null,
        lookup: refused ? 'rejected' : 'failed',
        error: { kind: 'http', status, message: `GitLab user lookup returned HTTP ${status}.` },
      };
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
      user: {
        id: data.id,
        username: data.username,
        name: data.name,
        email: data.email,
        avatarUrl: data.avatar_url,
        isAdmin: data.is_admin,
        state: data.state as 'active' | 'blocked' | 'deactivated',
      },
      lookup: 'ok',
    };
  } catch (error) {
    const diagnostic = describeLookupError(error, status);
    logDebug('Error fetching current user', { ...diagnostic });
    return { user: null, lookup: 'failed', error: diagnostic };
  }
}

/**
 * Build token info from ConnectionManager's detected token scopes
 */
function buildTokenInfo(): WhoamiTokenInfo | null {
  try {
    const connectionManager = ConnectionManager.getInstance();
    const tokenScopeInfo = connectionManager.getTokenScopeInfo(getGitLabApiUrlFromContext());

    if (!tokenScopeInfo) {
      // In OAuth mode or when token detection failed
      if (isOAuthEnabled()) {
        const scopes = getTokenContext()?.gitlabScopes;
        if (scopes === undefined) return null;
        return {
          type: 'oauth',
          name: null,
          scopes: [...scopes],
          expiresAt: null,
          daysUntilExpiry: null,
          isValid: true, // Assume valid in OAuth mode
          hasGraphQLAccess: scopes.some((scope) => scope === 'api' || scope === 'read_api'),
          hasWriteAccess: scopes.includes('api'),
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
  let version = 'unknown';
  let tier: 'free' | 'premium' | 'ultimate' | 'unknown' = 'unknown';
  // Edition cannot be reliably determined from tier alone.
  // Both CE and EE can have "free" tier (EE without license behaves like CE).
  // Premium/Ultimate tiers indicate EE, but we set to "unknown" for consistency.
  const edition: 'EE' | 'CE' | 'unknown' = 'unknown';

  try {
    const connectionManager = ConnectionManager.getInstance();
    const instanceInfo = connectionManager.getInstanceInfo(getGitLabApiUrlFromContext());
    version = instanceInfo.version;
    tier = instanceInfo.tier;
  } catch {
    // Connection not initialized - use defaults
  }

  return {
    host: getHost(),
    apiUrl: getGitLabBaseUrl(),
    version,
    tier,
    edition,
    readOnlyMode: GITLAB_READ_ONLY_MODE,
    oauthEnabled: isOAuthEnabled(),
  };
}

/**
 * Build capabilities info from RegistryManager
 */
function buildCapabilities(tokenInfo: WhoamiTokenInfo | null): WhoamiCapabilities {
  const registryManager = RegistryManager.getInstance();
  const filterStats = registryManager.getFilterStats();

  const { canBrowse, canManage } =
    tokenInfo === null
      ? { canBrowse: true, canManage: false }
      : getScopeCapabilities(tokenInfo.scopes);
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
    filteredByAdmin: filterStats.filteredByAdmin,
  };
}

/**
 * Build current context info from ContextManager
 */
async function buildContextInfo(): Promise<WhoamiContextInfo> {
  const contextManager = getContextManager();
  const context = await contextManager.getContext();

  return {
    activePreset: context.presetName ?? null,
    scope: context.scope ?? null,
  };
}

/**
 * Generate warnings based on current state
 */
function generateWarnings(
  tokenInfo: WhoamiTokenInfo | null,
  capabilities: WhoamiCapabilities,
  isAdmin: boolean | undefined,
): string[] {
  const warnings: string[] = [];

  // Token expiry warnings
  if (tokenInfo && tokenInfo.daysUntilExpiry !== null) {
    const days = tokenInfo.daysUntilExpiry;
    if (days < 0) {
      warnings.push(`Token has expired (${Math.abs(days)} days ago)`);
    } else if (days === 0) {
      warnings.push('Token expires today!');
    } else if (days <= 7) {
      warnings.push(`Token expires in ${days} day(s)`);
    }
  }

  // Token validity warning
  if (tokenInfo && !tokenInfo.isValid) {
    warnings.push('Token is invalid or revoked - authentication may fail');
  }

  // Scope limitation warnings
  if (capabilities.filteredByScopes > 0) {
    const pct = Math.round((capabilities.filteredByScopes / capabilities.totalToolCount) * 100);
    warnings.push(
      `Limited token scopes: ${capabilities.availableToolCount} of ${capabilities.totalToolCount} tools available (${pct}% filtered)`,
    );

    if (!capabilities.canAccessGraphQL) {
      warnings.push('No GraphQL access - project/MR/issue operations unavailable');
    }
    if (!capabilities.canManage) {
      warnings.push('No write access - all manage_* operations blocked');
    }
  }

  // Read-only mode warning
  if (capabilities.filteredByReadOnly > 0) {
    warnings.push(
      `Read-only mode enabled: ${capabilities.filteredByReadOnly} write tools disabled`,
    );
  }

  // Tier restriction warning
  if (capabilities.filteredByTier > 0) {
    warnings.push(
      `GitLab tier restrictions: ${capabilities.filteredByTier} tools unavailable for current tier`,
    );
  }

  // Admin-gated tools warning. filteredByAdmin > 0 means admin-mode elevation is
  // known inactive, which happens both for a non-admin account (no role) and for an
  // admin without active elevation. Word each case accurately: a non-admin cannot
  // elevate, so don't tell them to.
  if (capabilities.filteredByAdmin > 0) {
    warnings.push(
      isAdmin === false
        ? `Administrator privileges required: ${capabilities.filteredByAdmin} admin-only tools unavailable for this account`
        : `Admin-mode elevation inactive: ${capabilities.filteredByAdmin} admin-only tools unavailable`,
    );
  }

  // Denied tools regex warning
  if (capabilities.filteredByDeniedRegex > 0) {
    warnings.push(
      `Tool access restrictions: ${capabilities.filteredByDeniedRegex} tools blocked by configuration`,
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
  serverInfo: WhoamiServerInfo,
  isAdmin: boolean | undefined,
): WhoamiRecommendation[] {
  const recommendations: WhoamiRecommendation[] = [];

  // Token expired - high priority renewal
  if (tokenInfo && tokenInfo.daysUntilExpiry !== null && tokenInfo.daysUntilExpiry < 0) {
    recommendations.push({
      action: 'renew_token',
      message: 'Your token has expired. Create a new token to restore access.',
      url: getTokenCreationUrl(serverInfo.apiUrl, ['api', 'read_user']),
      priority: 'high',
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
      action: 'renew_token',
      message: `Your token expires in ${tokenInfo.daysUntilExpiry} day(s). Renew soon to avoid service interruption.`,
      url: getTokenCreationUrl(serverInfo.apiUrl, ['api', 'read_user']),
      priority: 'medium',
    });
  }

  // Limited scopes - recommend full access token
  // This covers both write access and GraphQL access issues
  const needsNewToken = capabilities.filteredByScopes > 0 && !capabilities.canManage;
  if (needsNewToken) {
    recommendations.push({
      action: 'create_new_token',
      message: "Create a token with 'api' scope for full GitLab functionality",
      url: getTokenCreationUrl(serverInfo.apiUrl, ['api', 'read_user']),
      priority: 'high',
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
      action: 'add_scope',
      message: "Add 'api' or 'read_api' scope to enable project, issue, and MR operations",
      url: getTokenCreationUrl(serverInfo.apiUrl, ['api', 'read_user']),
      priority: 'high',
    });
  }

  // Tier restrictions
  if (capabilities.filteredByTier > 0 && serverInfo.tier === 'free') {
    recommendations.push({
      action: 'contact_admin',
      message:
        'Some features require GitLab Premium or Ultimate. Contact your administrator for tier upgrade.',
      priority: 'low',
    });
  }

  // Admin-mode elevation: distinct from a tier upgrade. Only suggest it when the
  // account actually has the admin role (or the role is unknown under OAuth) — a
  // confirmed non-admin cannot enable admin mode, so the action would be a dead end.
  if (capabilities.filteredByAdmin > 0 && isAdmin !== false) {
    recommendations.push({
      action: 'enable_admin_mode',
      message:
        'Some tools require an active admin-mode session. If you are an instance admin, enable admin mode to use them.',
      priority: 'medium',
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
      logInfo('Token scopes changed - refreshing tool registry');
      RegistryManager.getInstance().refreshCache();
      await sendToolsListChangedNotification();
    }
  } catch (error) {
    logDebug('Failed to refresh token scopes', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 2: Fetch all information (AFTER refresh so we get updated data)
  const [{ user: userInfo, lookup: userLookup, error: userLookupError }, tokenInfo] =
    await Promise.all([fetchCurrentUser(), Promise.resolve(buildTokenInfo())]);

  // Enrich identity with admin-mode elevation from the session probe. The role
  // flag (isAdmin) alone is misleading: an admin without active elevation still
  // gets 403 on admin endpoints. adminModeActive stays undefined under OAuth.
  //
  // The probe's isAdmin is the authoritative role flag for admin guidance:
  // /user may omit is_admin (leaving userInfo.isAdmin undefined), which the
  // guidance path would otherwise read as maybe-admin and wrongly offer admin-mode
  // elevation to a non-admin. Prefer the probe value when present.
  let effectiveIsAdmin = userInfo?.isAdmin;
  if (userInfo) {
    try {
      const adminInfo = ConnectionManager.getInstance().getAdminInfo(getGitLabApiUrlFromContext());
      if (adminInfo) {
        effectiveIsAdmin = adminInfo.isAdmin;
        userInfo.isAdmin = adminInfo.isAdmin;
        userInfo.adminModeActive = adminInfo.adminModeActive;
      }
    } catch {
      // Capabilities unavailable (uninitialized) - leave role-only isAdmin.
    }
  }

  const serverInfo = buildServerInfo();
  const capabilities = buildCapabilities(tokenInfo);
  const contextInfo = await buildContextInfo();
  const warnings = generateWarnings(tokenInfo, capabilities, effectiveIsAdmin);
  if (userLookupError) {
    warnings.push(userLookupError.message);
    if (userLookupError.hint) warnings.push(userLookupError.hint);
  }

  // Honest admin signal: role present but elevation inactive means admin tools
  // will 403 at call time, so surface it instead of implying admin access works.
  if (userInfo?.isAdmin && userInfo.adminModeActive === false) {
    warnings.push(
      'Admin role detected but admin mode is not active - admin-only endpoints will return 403. ' +
        'Re-authenticate with admin mode enabled (OAuth tokens cannot elevate).',
    );
  }
  const recommendations = generateRecommendations(
    tokenInfo,
    capabilities,
    serverInfo,
    effectiveIsAdmin,
  );

  logDebug('Whoami executed', {
    hasUser: userInfo !== null,
    hasToken: tokenInfo !== null,
    availableTools: capabilities.availableToolCount,
    warnings: warnings.length,
    recommendations: recommendations.length,
    scopesRefreshed,
  });

  return {
    user: userInfo,
    userLookup,
    ...(userLookupError && { userLookupError }),
    token: tokenInfo,
    server: serverInfo,
    capabilities,
    context: contextInfo,
    warnings,
    recommendations,
    scopesRefreshed,
  };
}
