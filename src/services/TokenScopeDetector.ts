/**
 * Token Scope Detection Service
 *
 * Detects token scopes at startup via GET /api/v4/personal_access_tokens/self
 * and determines which capabilities are available. This allows the server to:
 * - Skip GraphQL introspection when scopes are insufficient
 * - Register only tools that will work with the current token
 * - Show clean, actionable messages instead of error stack traces
 */

import { z } from 'zod';
import { logInfo, logWarn, logDebug } from '../logger';
import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { enhancedFetch } from '../utils/fetch';
import { normalizeInstanceUrl } from '../utils/url';

/**
 * GitLab token types that can be detected
 */
export type GitLabTokenType =
  | 'personal_access_token'
  | 'project_access_token'
  | 'group_access_token'
  | 'oauth'
  | 'unknown';

/**
 * Known GitLab token scopes
 */
const GITLAB_SCOPES = [
  'api',
  'read_api',
  'read_user',
  'read_repository',
  'write_repository',
  'read_registry',
  'write_registry',
  'sudo',
  'admin_mode',
  'create_runner',
  'manage_runner',
  'ai_features',
  'k8s_proxy',
] as const;

const GitLabScopeSchema = z.enum(GITLAB_SCOPES);
export type GitLabScope = z.infer<typeof GitLabScopeSchema>;

/**
 * Zod schema for the /api/v4/personal_access_tokens/self response.
 * Validates shape and types; filters scopes to known values only.
 */
const TokenSelfResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  scopes: z
    .array(z.string())
    .transform((arr) =>
      arr.filter((s): s is GitLabScope => GitLabScopeSchema.safeParse(s).success),
    ),
  expires_at: z.string().nullable(),
  active: z.boolean(),
  revoked: z.boolean(),
});

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
  browse_projects: ['api', 'read_api'],
  browse_namespaces: ['api', 'read_api'],
  browse_commits: ['api', 'read_api'],
  browse_events: ['api', 'read_api', 'read_user'],
  browse_users: ['api', 'read_api', 'read_user'],
  browse_todos: ['api', 'read_api'],
  manage_project: ['api'],
  manage_namespace: ['api'],
  manage_todos: ['api'],
  // manage_context is intentionally excluded — it manages local session state
  // and never calls GitLab API, so it's available with any token scope.

  // Labels
  browse_labels: ['api', 'read_api'],
  manage_label: ['api'],

  // Merge requests
  browse_merge_requests: ['api', 'read_api'],
  browse_mr_discussions: ['api', 'read_api'],
  manage_merge_request: ['api'],
  manage_mr_discussion: ['api'],
  manage_draft_notes: ['api'],

  // Files - also works with repository scopes
  browse_files: ['api', 'read_api', 'read_repository'],
  manage_files: ['api', 'write_repository'],

  // Milestones
  browse_milestones: ['api', 'read_api'],
  manage_milestone: ['api'],

  // Pipelines
  browse_pipelines: ['api', 'read_api'],
  manage_pipeline: ['api'],
  manage_pipeline_job: ['api'],

  // Variables
  browse_variables: ['api', 'read_api'],
  manage_variable: ['api'],

  // Wiki
  browse_wiki: ['api', 'read_api'],
  manage_wiki: ['api'],

  // Work items
  browse_work_items: ['api', 'read_api'],
  manage_work_item: ['api'],

  // Snippets
  browse_snippets: ['api', 'read_api'],
  manage_snippet: ['api'],

  // Webhooks
  browse_webhooks: ['api', 'read_api'],
  manage_webhook: ['api'],

  // Integrations
  browse_integrations: ['api', 'read_api'],
  manage_integration: ['api'],

  // Releases
  browse_releases: ['api', 'read_api'],
  manage_release: ['api'],

  // Refs (branches, tags)
  browse_refs: ['api', 'read_api'],
  manage_ref: ['api'],

  // Members
  browse_members: ['api', 'read_api'],
  manage_member: ['api'],

  // Search
  browse_search: ['api', 'read_api'],

  // Iterations
  browse_iterations: ['api', 'read_api'],
};

/** Log the appropriate message for a non-OK token self-introspection status. */
function logTokenSelfIntrospectionError(status: number, url: string): void {
  if (status === 404) {
    logDebug('Token self-introspection endpoint not available (older GitLab version)', { url });
  } else if (status === 401) {
    logInfo('Token is invalid or expired', { url });
  } else if (status === 403) {
    logDebug('Token self-introspection not permitted for this token type', { url });
  } else {
    logDebug('Unexpected response from token self-introspection', { status, url });
  }
}

/** Parse YYYY-MM-DD expiry date to days remaining (UTC). Returns null on invalid input. */
function computeDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const [yearStr, monthStr, dayStr] = expiresAt.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Validate calendar-correctness: Date.UTC normalizes invalid dates (e.g. Feb 31 → Mar 3),
  // so roundtrip-check that the constructed date matches the input components.
  const expiry = new Date(Date.UTC(year, month - 1, day));
  if (
    expiry.getUTCFullYear() !== year ||
    expiry.getUTCMonth() !== month - 1 ||
    expiry.getUTCDate() !== day
  ) {
    return null;
  }
  const expiryUtcMs = expiry.getTime();
  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((expiryUtcMs - todayUtcMs) / (1000 * 60 * 60 * 24));
}

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
export async function detectTokenScopes(baseUrl?: string): Promise<TokenScopeInfo | null> {
  const url = normalizeInstanceUrl(baseUrl ?? GITLAB_BASE_URL);
  if (!url || !GITLAB_TOKEN) {
    return null;
  }

  try {
    const response = await enhancedFetch(`${url}/api/v4/personal_access_tokens/self`, {
      headers: {
        'PRIVATE-TOKEN': GITLAB_TOKEN,
        Accept: 'application/json',
      },
      retry: false,
    });

    if (!response.ok) {
      logTokenSelfIntrospectionError(response.status, url);
      return null;
    }

    const raw: unknown = await response.json();
    const parsed = TokenSelfResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logDebug('Token self-introspection response validation failed', {
        url,
        error: parsed.error.message,
      });
      return null;
    }
    const data = parsed.data;

    const scopes = data.scopes;
    const hasGraphQLAccess = scopes.some((s) => s === 'api' || s === 'read_api');
    const hasWriteAccess = scopes.includes('api');

    return {
      name: data.name,
      scopes,
      expiresAt: data.expires_at,
      active: data.active && !data.revoked,
      tokenType: 'unknown',
      hasGraphQLAccess,
      hasWriteAccess,
      daysUntilExpiry: computeDaysUntilExpiry(data.expires_at),
    };
  } catch (error) {
    logDebug('Token scope detection failed (network error)', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
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
  return requiredScopes.some((required) => scopes.includes(required));
}

/**
 * Get the list of tools available for given scopes
 */
export function getToolsForScopes(scopes: GitLabScope[]): string[] {
  return Object.keys(TOOL_SCOPE_REQUIREMENTS).filter((toolName) =>
    isToolAvailableForScopes(toolName, scopes),
  );
}

/**
 * Get all known tool scope requirements.
 * Returns a deep clone so callers can safely mutate the returned
 * arrays without affecting the internal TOOL_SCOPE_REQUIREMENTS map.
 */
export function getToolScopeRequirements(): Record<string, GitLabScope[]> {
  return Object.fromEntries(
    Object.entries(TOOL_SCOPE_REQUIREMENTS).map(([toolName, scopes]) => [toolName, [...scopes]]),
  );
}

/**
 * Generate an actionable URL for creating a new token with correct scopes
 */
export function getTokenCreationUrl(
  baseUrl: string,
  scopes: string[] = ['api', 'read_user'],
): string {
  try {
    const url = new URL(baseUrl);
    // Preserve any existing subpath (e.g. https://host/gitlab) and append PAT settings path
    const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    url.pathname = `${basePath}/-/user_settings/personal_access_tokens`;
    url.searchParams.set('name', 'gitlab-mcp');
    url.searchParams.set('scopes', scopes.join(','));
    return url.toString();
  } catch {
    // baseUrl lacks a scheme or is otherwise unparseable — fall back to string concat
    const base = baseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      name: 'gitlab-mcp',
      scopes: scopes.join(','),
    });
    return `${base}/-/user_settings/personal_access_tokens?${params.toString()}`;
  }
}

/**
 * Log a clean, user-friendly startup message about token scopes
 */
export function logTokenScopeInfo(
  info: TokenScopeInfo,
  totalTools: number,
  baseUrl: string = GITLAB_BASE_URL,
): void {
  const availableTools = getToolsForScopes(info.scopes);
  const scopeList = info.scopes.join(', ');

  // Token expiry warning (< 7 days)
  if (info.daysUntilExpiry !== null && info.daysUntilExpiry <= 7) {
    if (info.daysUntilExpiry < 0) {
      logWarn(`Token "${info.name}" has expired! Please create a new token.`, {
        tokenName: info.name,
        expiresAt: info.expiresAt,
      });
    } else if (info.daysUntilExpiry === 0) {
      logWarn(`Token "${info.name}" expires today!`, {
        tokenName: info.name,
        expiresAt: info.expiresAt,
      });
    } else {
      logWarn(`Token "${info.name}" expires in ${info.daysUntilExpiry} day(s)`, {
        tokenName: info.name,
        daysUntilExpiry: info.daysUntilExpiry,
        expiresAt: info.expiresAt,
      });
    }
  }

  if (info.hasWriteAccess) {
    // Full access (api scope) - brief message
    logInfo(`Token "${info.name}" detected`, {
      tokenName: info.name,
      scopes: scopeList,
      expiresAt: info.expiresAt ?? 'never',
    });
  } else {
    // Limited access - explain what's available and how to fix
    logInfo(
      `Token "${info.name}" has limited scopes - ${availableTools.length} of ${totalTools} scope-gated tools available`,
      {
        tokenName: info.name,
        scopes: scopeList,
        availableTools: availableTools.length,
        totalTools,
      },
    );

    if (!info.hasGraphQLAccess) {
      logInfo("GraphQL introspection skipped (requires 'api' or 'read_api' scope)");
    }

    const fixUrl = getTokenCreationUrl(normalizeInstanceUrl(baseUrl));
    logInfo(`For full functionality, create a token with 'api' scope: ${fixUrl}`, { url: fixUrl });
  }
}
