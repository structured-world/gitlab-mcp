/**
 * OAuth Configuration for gitlab-mcp
 *
 * Handles OAuth mode detection and configuration validation.
 * Uses Zod for runtime validation of external (env-sourced) configuration.
 */

import { z } from 'zod';
import { logDebug, logInfo } from '../logger';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Canonical external URL of this server: the OAuth issuer and the base of the
 * protected resource identifiers. It comes from configuration because deriving it
 * from request headers would let any client choose the issuer and audience that
 * tokens are minted for.
 */
const IssuerSchema = z
  .string({ error: 'OAUTH_ISSUER is required (the public URL clients connect to)' })
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'OAUTH_ISSUER must be an absolute URL' });
      return z.NEVER;
    }
    // RFC 8414 section 2: no query or fragment; https except for loopback.
    if (url.search || url.hash || url.username || url.password) {
      ctx.addIssue({
        code: 'custom',
        message: 'OAUTH_ISSUER must not contain credentials, a query or a fragment',
      });
      return z.NEVER;
    }
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'OAUTH_ISSUER must use https (http is allowed only for localhost)',
      });
      return z.NEVER;
    }
    // MCP authorization, canonical server URI: no trailing slash.
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    return `${url.origin}${path}`;
  });

/** Why `value` is not an acceptable OAUTH_ISSUER, or undefined when the server accepts it. */
export function issuerValidationError(value: string): string | undefined {
  const parsed = IssuerSchema.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

/**
 * Zod schema for OAuth configuration
 * All OAuth-specific environment variables are validated here
 */
const OAuthConfigSchema = z.object({
  /** Whether OAuth mode is enabled */
  enabled: z.literal(true),
  /** Canonical issuer and protected resource base URL */
  issuer: IssuerSchema,
  /** Secret for signing MCP JWT tokens (minimum 32 characters) */
  sessionSecret: z.string().min(32, 'OAUTH_SESSION_SECRET must be at least 32 characters'),
  /** GitLab OAuth application client ID */
  gitlabClientId: z.string().min(1, 'OAUTH_CLIENT_ID is required'),
  /** GitLab OAuth application client secret (optional, for confidential apps) */
  gitlabClientSecret: z.string().optional(),
  /** OAuth scopes to request from GitLab */
  gitlabScopes: z.string().default('api,read_user'),
  /** MCP access token TTL in seconds */
  tokenTtl: z.number().positive().default(3600),
  /** MCP refresh token TTL in seconds */
  refreshTokenTtl: z.number().positive().default(604800),
  /** Device flow polling interval in seconds */
  devicePollInterval: z.number().positive().default(5),
  /** Device flow timeout in seconds */
  deviceTimeout: z.number().positive().default(300),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

/**
 * Cached OAuth configuration (loaded once at startup)
 */
let cachedOAuthConfig: OAuthConfig | null | undefined = undefined;

/**
 * Load and validate OAuth configuration from environment variables
 *
 * Returns null if OAuth is not enabled (OAUTH_ENABLED !== 'true')
 * Throws an error if OAuth is enabled but configuration is invalid
 *
 * @returns OAuthConfig if OAuth mode is enabled, null otherwise
 */
export function loadOAuthConfig(): OAuthConfig | null {
  // Return cached config if already loaded
  if (cachedOAuthConfig !== undefined) {
    return cachedOAuthConfig;
  }

  // Check if OAuth mode is enabled
  if (process.env.OAUTH_ENABLED !== 'true') {
    cachedOAuthConfig = null;
    logDebug("OAuth mode disabled (OAUTH_ENABLED !== 'true')");
    return null;
  }

  // safeParse (not parse) so invalid config surfaces as a handled error path
  const result = OAuthConfigSchema.safeParse({
    enabled: true as const,
    issuer: process.env.OAUTH_ISSUER,
    sessionSecret: process.env.OAUTH_SESSION_SECRET,
    gitlabClientId: process.env.OAUTH_CLIENT_ID,
    gitlabClientSecret: process.env.OAUTH_CLIENT_SECRET,
    gitlabScopes: process.env.OAUTH_SCOPES ?? 'api,read_user',
    tokenTtl: parseInt(process.env.OAUTH_TOKEN_TTL ?? '3600', 10),
    refreshTokenTtl: parseInt(process.env.OAUTH_REFRESH_TOKEN_TTL ?? '604800', 10),
    devicePollInterval: parseInt(process.env.OAUTH_DEVICE_POLL_INTERVAL ?? '5', 10),
    deviceTimeout: parseInt(process.env.OAUTH_DEVICE_TIMEOUT ?? '300', 10),
  });

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid OAuth configuration: ${errorMessages}`);
  }

  cachedOAuthConfig = result.data;
  logInfo('OAuth mode enabled with valid configuration');
  return result.data;
}

/**
 * Error thrown when required startup configuration is missing.
 * Carries a user-facing guidance message that the entrypoint can display
 * without a stack trace.
 */
export class ConfigurationError extends Error {
  public readonly guidance: string;

  constructor(guidance: string) {
    super('Missing required configuration');
    this.name = 'ConfigurationError';
    this.guidance = guidance;
  }
}

/** User-friendly guidance shown when GITLAB_TOKEN is not configured */
const MISSING_TOKEN_GUIDANCE = `
┌──────────────────────────────────────────────────────────────────────┐
│  GitLab MCP — no authentication configured                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Quick setup (interactive):                                          │
│    npx @structured-world/gitlab-mcp setup                            │
│                                                                      │
│  Manual setup:                                                       │
│    export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"                   │
│    Required scopes: api,read_user (or read_api,read_user read-only)  │
│                                                                      │
│  For self-hosted GitLab, also set:                                    │
│    export GITLAB_API_URL="https://your-gitlab.example.com"            │
│                                                                      │
│  Docs: https://gitlab-mcp.sw.foundation/guide/quick-start            │
└──────────────────────────────────────────────────────────────────────┘
`;

/**
 * Validate static token configuration (used when OAuth is disabled)
 *
 * Throws ConfigurationError with user-friendly guidance if GITLAB_TOKEN is not set.
 * The entrypoint (main.ts) catches this and displays the guidance without a stack trace.
 */
export function validateStaticConfig(): void {
  if (!process.env.GITLAB_TOKEN) {
    throw new ConfigurationError(MISSING_TOKEN_GUIDANCE);
  }
  logDebug('Static token mode: GITLAB_TOKEN configured');
}

/**
 * Check if the server is running in OAuth mode
 *
 * @returns true if OAuth mode is enabled
 */
export function isOAuthEnabled(): boolean {
  return loadOAuthConfig() !== null;
}

/**
 * Reset cached configuration (for testing purposes)
 */
export function resetOAuthConfigCache(): void {
  cachedOAuthConfig = undefined;
}

/**
 * Get the authentication mode description
 *
 * @returns Human-readable description of the current auth mode
 */
export function getAuthModeDescription(): string {
  if (isOAuthEnabled()) {
    return 'OAuth mode (per-user authentication via GitLab Device Flow)';
  }
  if (process.env.GITLAB_TOKEN) {
    return 'Static token mode (shared GITLAB_TOKEN)';
  }
  return 'Unauthenticated mode (tools/list only, tool calls require GITLAB_TOKEN)';
}

/**
 * Check if static token authentication is configured
 *
 * @returns true if GITLAB_TOKEN is set
 */
export function isStaticTokenConfigured(): boolean {
  return !!process.env.GITLAB_TOKEN;
}

/**
 * Check if any authentication method is available (OAuth or static token)
 *
 * @returns true if server can authenticate to GitLab
 */
export function isAuthenticationConfigured(): boolean {
  return isOAuthEnabled() || isStaticTokenConfigured();
}
