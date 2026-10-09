/**
 * OAuth Types for gitlab-mcp
 *
 * These types define the data structures used throughout the OAuth implementation
 * for Claude Custom Connector support with GitLab Device Flow authentication.
 */

/**
 * Namespace tier information for feature availability checks
 * Tier is per-NAMESPACE, not per-instance! On gitlab.com, one user can access
 * Free group and Ultimate group simultaneously.
 */
export interface NamespaceTierInfo {
  /** Tier level (free, premium, ultimate) */
  tier: 'free' | 'premium' | 'ultimate';
  /** Available features for this tier */
  features: Record<string, boolean>;
  /** Cache timestamp */
  cachedAt: Date;
}

/**
 * OAuth session representing an authenticated user
 * Stores both MCP tokens (issued by gitlab-mcp) and GitLab tokens (from GitLab OAuth)
 */
export interface OAuthSession {
  /** Unique session identifier (UUID) */
  id: string;

  // MCP tokens (issued by gitlab-mcp to Claude)
  /** JWT access token for MCP requests */
  mcpAccessToken: string;
  /** Refresh token for obtaining new MCP access tokens */
  mcpRefreshToken: string;
  /** MCP token expiry timestamp (milliseconds since epoch) */
  mcpTokenExpiry: number;

  // GitLab tokens (obtained from GitLab OAuth)
  /** GitLab OAuth access token for API calls */
  gitlabAccessToken: string;
  /** GitLab OAuth refresh token */
  gitlabRefreshToken: string;
  /** GitLab token expiry timestamp (milliseconds since epoch) */
  gitlabTokenExpiry: number;
  /** Granted GitLab scopes, distinct from MCP scopes; absent for legacy unknown grants. */
  gitlabScopes?: string[];

  // User info from GitLab
  /** GitLab user ID */
  gitlabUserId: number;
  /** GitLab username */
  gitlabUsername: string;

  // Multi-instance support
  /** GitLab instance base URL (e.g., https://gitlab.com). Optional for backward compatibility. */
  gitlabApiUrl?: string;
  /** Human-readable instance label for UI display */
  instanceLabel?: string;

  // Session metadata
  /** OAuth client ID that created this session */
  clientId: string;
  /** Granted scopes */
  scopes: string[];
  /** RFC 8707 resource the tokens are issued for; absent in sessions persisted by older servers. */
  resource?: string;
  /** Session creation timestamp (milliseconds since epoch) */
  createdAt: number;
  /** Last update timestamp (milliseconds since epoch) */
  updatedAt: number;
}

/**
 * OAuth client registered through Dynamic Client Registration (RFC 7591)
 */
export interface RegisteredOAuthClient {
  /** Issued client identifier */
  clientId: string;
  /** Issued secret, only for confidential clients */
  clientSecret?: string;
  /** Redirect URIs the client may use */
  redirectUris: string[];
  /** Human-readable client name */
  clientName?: string;
  /** Token endpoint authentication method */
  tokenEndpointAuthMethod: string;
  /** Grant types the client registered */
  grantTypes: string[];
  /** Response types the client registered */
  responseTypes: string[];
  /** Registration timestamp (milliseconds since epoch) */
  createdAt: number;
}

/**
 * State for tracking an in-progress Authorization Code Flow
 * Used when redirect_uri is provided (web-based OAuth like Claude.ai)
 */
export interface AuthCodeFlowState {
  /** Scopes sent to GitLab at flow creation; absent in flows persisted by older servers. */
  requestedGitlabScopes?: string[];
  /** OAuth client ID */
  clientId: string;
  /** PKCE code challenge */
  codeChallenge: string;
  /** PKCE code challenge method (S256) */
  codeChallengeMethod: string;
  /** OAuth state parameter for CSRF protection (original from client) */
  clientState: string;
  /** Internal state for GitLab callback */
  internalState: string;
  /** Client's redirect URI (where to redirect after GitLab auth) */
  clientRedirectUri: string;
  /** Our callback URI (registered in GitLab OAuth app) */
  callbackUri: string;
  /** Expiry timestamp (milliseconds since epoch) */
  expiresAt: number;
  /** Selected GitLab instance URL for multi-instance support */
  selectedInstance?: string;
  /** Selected instance label */
  selectedInstanceLabel?: string;
  /** MCP scopes granted to this authorization; absent means the full default set. */
  scopes?: string[];
  /** RFC 8707 resource requested at /authorize; absent means the `/mcp` resource. */
  resource?: string;
}

/**
 * State for tracking an in-progress device authorization flow
 */
export interface DeviceFlowState {
  /** Scopes sent to GitLab at flow creation; absent in flows persisted by older servers. */
  requestedGitlabScopes?: string[];
  /** Device code returned by GitLab */
  deviceCode: string;
  /** User code to display to the user */
  userCode: string;
  /** URL where user should enter the code */
  verificationUri: string;
  /** Optional complete URL with code pre-filled */
  verificationUriComplete?: string;
  /** Expiry timestamp (milliseconds since epoch) */
  expiresAt: number;
  /** Polling interval in seconds */
  interval: number;
  /** Earliest time GitLab may be polled again (milliseconds since epoch, RFC 8628 3.5) */
  nextPollAt?: number;
  /** OAuth client ID */
  clientId: string;
  /** PKCE code challenge */
  codeChallenge: string;
  /** PKCE code challenge method (S256) */
  codeChallengeMethod: string;
  /** OAuth state parameter for CSRF protection */
  state: string;
  /** Redirect URI for completion */
  redirectUri?: string;
  /** Selected GitLab instance URL for multi-instance support */
  selectedInstance?: string;
  /** Selected instance label */
  selectedInstanceLabel?: string;
  /** MCP scopes granted to this authorization; absent means the full default set. */
  scopes?: string[];
  /** RFC 8707 resource requested at /authorize; absent means the `/mcp` resource. */
  resource?: string;
  /**
   * Tokens GitLab issued when the user approved; GitLab hands them out once, so they are
   * kept until the account is set up and a failed attempt is retried without them lost.
   */
  gitlabTokens?: GitLabTokenResponse;
}

/**
 * Authorization code for OAuth code exchange
 */
export interface AuthorizationCode {
  /** The authorization code string */
  code: string;
  /** Associated session ID */
  sessionId: string;
  /** OAuth client ID */
  clientId: string;
  /** PKCE code challenge for verification */
  codeChallenge: string;
  /** PKCE code challenge method */
  codeChallengeMethod: string;
  /** Redirect URI (must match on exchange) */
  redirectUri?: string;
  /** Expiry timestamp (milliseconds since epoch) */
  expiresAt: number;
}

/**
 * GitLab OAuth token response
 */
export interface GitLabTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  created_at: number;
  scope?: string;
}

/**
 * GitLab device authorization response
 */
export interface GitLabDeviceResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

/**
 * Token context for request processing
 * Available via AsyncLocalStorage during OAuth-authenticated requests
 */
export interface TokenContext {
  /** Verified upstream grants for this account, never shared through instance caches. */
  gitlabScopes?: readonly string[];
  /** GitLab access token for API calls */
  gitlabToken: string;
  /** GitLab user ID */
  gitlabUserId: number;
  /** GitLab username */
  gitlabUsername: string;
  /** Session ID for tracking */
  sessionId: string;
  /** GitLab instance base URL (e.g., https://gitlab.com) */
  apiUrl: string;
  /** Human-readable instance label for UI display */
  instanceLabel?: string;
  /** Protected resource the request was sent to; reauthorization challenges point at its metadata. */
  resource?: string;
  /** MCP scopes of the access token the request presented (e.g. `mcp:tools`). */
  mcpScopes?: readonly string[];
}

/**
 * GitLab user info response
 */
export interface GitLabUserInfo {
  id: number;
  username: string;
  name?: string;
  email?: string;
}

/**
 * MCP token response (returned to Claude)
 */
export interface MCPTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * OAuth error response
 */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Device flow poll status
 */
export type DeviceFlowPollStatus = 'pending' | 'complete' | 'failed' | 'expired';

/**
 * Device flow poll response
 */
export interface DeviceFlowPollResponse {
  status: DeviceFlowPollStatus;
  redirect_uri?: string;
  code?: string;
  state?: string;
  /** Issuer to append to the redirect (RFC 9207 section 2) */
  iss?: string;
  /** Seconds to wait before the next poll while pending */
  interval?: number;
  error?: string;
}

/**
 * JWT payload for MCP access tokens
 */
export interface MCPTokenPayload {
  /** Issuer (OAUTH_ISSUER) */
  iss: string;
  /** Subject (GitLab user ID) */
  sub: string;
  /** Audience: the RFC 8707 resource the token is issued for */
  aud: string;
  /** OAuth client the token was issued to (RFC 9068 section 2.2) */
  client_id?: string;
  /** Unique token identifier (RFC 9068 section 2.2) */
  jti?: string;
  /** Session ID */
  sid: string;
  /** Granted scopes */
  scope: string;
  /** GitLab username */
  gitlab_user: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
}
