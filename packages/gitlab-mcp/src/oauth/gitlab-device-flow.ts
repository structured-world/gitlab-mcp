/**
 * GitLab Device Flow Client
 *
 * Implements the OAuth 2.0 Device Authorization Grant (RFC 8628) for GitLab.
 * This allows authentication on devices without browser access by having
 * users authenticate on a separate device.
 *
 * GitLab Device Flow documentation: https://docs.gitlab.com/api/oauth2/#device-authorization-grant
 */

import { GITLAB_BASE_URL } from '../config';
import { OAuthConfig } from './config';
import { GitLabDeviceResponse, GitLabTokenResponse, GitLabUserInfo } from './types';
import { logInfo, logWarn, logError, logDebug } from '../logger';
import { enhancedFetch, type FetchWithRetryOptions } from '../utils/fetch';
import { defaultOAuthApp, type GitLabOAuthApp } from './oauth-app';

/** Throw a descriptive error if the GitLab OAuth response indicates failure */
async function throwOnHttpError(response: Response, operation: string): Promise<void> {
  if (!response.ok) {
    const rawText = await response.text();
    // Truncate to prevent unbounded HTML/proxy error pages from bloating logs
    const details = rawText.trim().slice(0, 500) || response.statusText;
    logError(`Failed to ${operation}`, { status: response.status, error: details });
    throw new Error(`Failed to ${operation}: ${response.status} ${details}`);
  }
}

/**
 * Shared options for OAuth endpoint calls — no retry, no rate limiting,
 * no ambient auth injection.
 *
 * skipAuth suppresses auto-injected credentials (PAT from env, cookies) so OAuth
 * endpoints only receive explicitly provided auth (Bearer token in headers or
 * client_id/secret in POST body). Caller-supplied headers are never stripped.
 *
 * rateLimitBaseUrl is set even with rate limiting disabled so enhancedFetch can
 * consistently select the correct per-instance dispatcher. Without it, OAuth paths
 * like /oauth/token don't match extractBaseUrl()'s /api/v4|/api/graphql stripping,
 * causing fallback to the global dispatcher (missing per-instance TLS settings).
 */
const OAUTH_FETCH_OPTS: Pick<
  FetchWithRetryOptions,
  'retry' | 'rateLimit' | 'rateLimitBaseUrl' | 'skipAuth'
> = {
  retry: false,
  rateLimit: false,
  rateLimitBaseUrl: GITLAB_BASE_URL,
  skipAuth: true,
};

/** OAuth fetch options bound to the instance the call goes to (its dispatcher and TLS). */
function oauthFetchOpts(baseUrl: string): typeof OAUTH_FETCH_OPTS {
  return { ...OAUTH_FETCH_OPTS, rateLimitBaseUrl: baseUrl };
}

/** Application credentials for a token request; the secret only for confidential apps. */
function clientParams(app: GitLabOAuthApp): Record<string, string> {
  return app.clientSecret
    ? { client_id: app.clientId, client_secret: app.clientSecret }
    : { client_id: app.clientId };
}

/**
 * Device flow error types from GitLab
 */
type DeviceFlowError =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'invalid_grant'
  | 'invalid_request';

/**
 * Device flow error response from GitLab
 */
interface DeviceFlowErrorResponse {
  error: DeviceFlowError;
  error_description?: string;
}

/**
 * Initiate the device authorization flow with GitLab
 *
 * This starts the device flow by requesting a device code and user code
 * from GitLab. The user must then visit the verification URI and enter
 * the user code to authorize the application.
 *
 * @param config - OAuth configuration
 * @param app - Instance and application to sign in with (default: OAUTH_CLIENT_ID on GITLAB_API_URL)
 * @returns Device authorization response with codes and URIs
 * @throws Error if the request fails
 */
export async function initiateDeviceFlow(
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<GitLabDeviceResponse> {
  const url = `${app.baseUrl}/oauth/authorize_device`;

  logDebug('Initiating GitLab device flow', { url, clientId: app.clientId });

  // Convert comma-separated scopes to space-separated (GitLab requirement)
  const scopes = app.scopes.replace(/,/g, ' ');

  const response = await enhancedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: app.clientId,
      scope: scopes,
    }),
    ...oauthFetchOpts(app.baseUrl),
  });

  await throwOnHttpError(response, 'initiate device flow');

  const data = (await response.json()) as GitLabDeviceResponse;

  logInfo('Device flow initiated', {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
  });

  return data;
}

/** Outcome of one device token request. */
export type DeviceFlowPollStep =
  | { status: 'complete'; tokens: GitLabTokenResponse }
  | { status: 'pending' }
  | { status: 'slow_down' };

/**
 * Poll GitLab once, distinguishing `slow_down` from `authorization_pending` so the caller
 * can increase its interval (RFC 8628 section 3.5).
 *
 * @throws Error for terminal errors (expired, denied, etc.)
 */
export async function pollDeviceFlowStep(
  deviceCode: string,
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<DeviceFlowPollStep> {
  const url = `${app.baseUrl}/oauth/token`;

  const response = await enhancedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      ...clientParams(app),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    ...oauthFetchOpts(app.baseUrl),
  });

  if (response.ok) {
    const tokens = (await response.json()) as GitLabTokenResponse;
    logInfo('Device flow authorization completed successfully');
    return { status: 'complete', tokens };
  }

  const error = (await response.json()) as DeviceFlowErrorResponse;

  switch (error.error) {
    case 'authorization_pending':
      return { status: 'pending' };

    case 'slow_down':
      logDebug('Device flow: slow_down received, increasing poll interval');
      return { status: 'slow_down' };

    case 'expired_token':
      throw new Error('Device code expired. Please start a new authorization.');

    case 'access_denied':
      throw new Error('User denied the authorization request.');

    case 'invalid_grant':
      throw new Error('Invalid device code or grant.');

    default:
      throw new Error(`Device flow error: ${error.error_description ?? error.error}`);
  }
}

/**
 * Poll GitLab for device authorization completion (single attempt)
 *
 * Makes a single poll request to check if the user has completed authorization.
 * Returns the token response if authorized, null if still pending.
 *
 * @param deviceCode - Device code from initiateDeviceFlow
 * @param config - OAuth configuration
 * @param app - Application the device code was issued for
 * @returns Token response if authorized, null if pending
 * @throws Error for terminal errors (expired, denied, etc.)
 */
export async function pollDeviceFlowOnce(
  deviceCode: string,
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<GitLabTokenResponse | null> {
  const step = await pollDeviceFlowStep(deviceCode, config, app);
  // pending and slow_down both mean "not yet"; callers that back off use pollDeviceFlowStep.
  return step.status === 'complete' ? step.tokens : null;
}

/**
 * Poll GitLab for device authorization completion (with retries)
 *
 * Continuously polls GitLab until the user completes authorization,
 * the device code expires, or the user denies the request.
 *
 * @param deviceCode - Device code from initiateDeviceFlow
 * @param config - OAuth configuration
 * @param onPending - Optional callback called on each pending poll
 * @param app - Application the device code was issued for
 * @returns Token response when authorized
 * @throws Error on timeout, expiration, or denial
 */
export async function pollForToken(
  deviceCode: string,
  config: OAuthConfig,
  onPending?: () => void,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<GitLabTokenResponse> {
  const startTime = Date.now();
  const timeout = config.deviceTimeout * 1000;
  let interval = config.devicePollInterval * 1000;

  while (Date.now() - startTime < timeout) {
    // Wait before polling
    await sleep(interval);

    try {
      const step = await pollDeviceFlowStep(deviceCode, config, app);

      if (step.status === 'complete') {
        return step.tokens;
      }
      // RFC 8628 section 3.5: slow_down adds 5 seconds to every later interval.
      if (step.status === 'slow_down') {
        interval += 5000;
      }

      // Still pending
      onPending?.();
    } catch (error) {
      // Re-throw terminal errors
      if (error instanceof Error) {
        if (
          error.message.includes('expired') ||
          error.message.includes('denied') ||
          error.message.includes('invalid')
        ) {
          throw error;
        }
      }

      // Log but continue for transient errors
      logWarn('Device flow poll error, will retry', { err: error as Error });
    }
  }

  throw new Error(`Device flow timeout after ${config.deviceTimeout} seconds`);
}

/**
 * Refresh a GitLab OAuth token
 *
 * Uses the refresh token to obtain a new access token when the current
 * one is expired or about to expire.
 *
 * @param refreshToken - GitLab refresh token
 * @param config - OAuth configuration
 * @param app - Application that issued the refresh token
 * @returns New token response
 * @throws Error if refresh fails
 */
export async function refreshGitLabToken(
  refreshToken: string,
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<GitLabTokenResponse> {
  const url = `${app.baseUrl}/oauth/token`;

  const params: Record<string, string> = {
    ...clientParams(app),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };

  logDebug('Refreshing GitLab token');

  const response = await enhancedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
    ...oauthFetchOpts(app.baseUrl),
  });

  await throwOnHttpError(response, 'refresh token');

  const data = (await response.json()) as GitLabTokenResponse;
  logInfo('GitLab token refreshed successfully');
  return data;
}

/**
 * Get the current GitLab user's information
 *
 * Uses the access token to fetch the authenticated user's profile.
 *
 * @param accessToken - GitLab access token
 * @param baseUrl - Instance that issued the token (default: GITLAB_API_URL)
 * @returns User information (id and username)
 * @throws Error if the request fails
 */
export async function getGitLabUser(
  accessToken: string,
  baseUrl: string = GITLAB_BASE_URL,
): Promise<GitLabUserInfo> {
  const url = `${baseUrl}/api/v4/user`;

  const response = await enhancedFetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    ...oauthFetchOpts(baseUrl),
  });

  await throwOnHttpError(response, 'get GitLab user info');

  const user = (await response.json()) as GitLabUserInfo;

  logDebug('Retrieved GitLab user info', { userId: user.id, username: user.username });

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
  };
}

/**
 * Validate a GitLab access token
 *
 * Checks if the token is still valid by making a lightweight API call.
 *
 * @param accessToken - GitLab access token to validate
 * @param baseUrl - Instance that issued the token (default: GITLAB_API_URL)
 * @returns true if the token is valid, false otherwise
 */
export async function validateGitLabToken(
  accessToken: string,
  baseUrl: string = GITLAB_BASE_URL,
): Promise<boolean> {
  try {
    const url = `${baseUrl}/api/v4/user`;

    const response = await enhancedFetch(url, {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      ...oauthFetchOpts(baseUrl),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Exchange a GitLab authorization code for tokens
 *
 * Used in Authorization Code Flow when GitLab redirects back with a code.
 *
 * @param code - Authorization code from GitLab callback
 * @param redirectUri - The redirect URI that was used in the authorization request
 * @param config - OAuth configuration
 * @param app - Application the authorization was granted to
 * @returns Token response with access and refresh tokens
 * @throws Error if the exchange fails
 */
export async function exchangeGitLabAuthCode(
  code: string,
  redirectUri: string,
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<GitLabTokenResponse> {
  const url = `${app.baseUrl}/oauth/token`;

  const params: Record<string, string> = {
    ...clientParams(app),
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  };

  logDebug('Exchanging GitLab authorization code for tokens', { redirectUri });

  const response = await enhancedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
    ...oauthFetchOpts(app.baseUrl),
  });

  await throwOnHttpError(response, 'exchange authorization code');

  const data = (await response.json()) as GitLabTokenResponse;
  logInfo('GitLab authorization code exchanged successfully');
  return data;
}

/**
 * Revoke a GitLab OAuth token (RFC 7009), ending the grant the token belongs to.
 *
 * @param token - GitLab access or refresh token
 * @param config - OAuth configuration
 * @param app - Application that issued the token
 * @throws Error if GitLab refuses the request
 */
export async function revokeGitLabToken(
  token: string,
  config: OAuthConfig,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): Promise<void> {
  const response = await enhancedFetch(`${app.baseUrl}/oauth/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ ...clientParams(app), token }),
    ...oauthFetchOpts(app.baseUrl),
  });

  await throwOnHttpError(response, 'revoke GitLab token');
  logInfo('GitLab token revoked');
}

/**
 * Build GitLab OAuth authorization URL
 *
 * Used to redirect users to GitLab for authorization in the Authorization Code Flow.
 *
 * @param config - OAuth configuration
 * @param redirectUri - URI to redirect back to after authorization
 * @param state - State parameter for CSRF protection
 * @param app - Instance and application to sign in with
 * @returns Full authorization URL
 */
export function buildGitLabAuthUrl(
  config: OAuthConfig,
  redirectUri: string,
  state: string,
  app: GitLabOAuthApp = defaultOAuthApp(config),
): string {
  // Convert comma-separated scopes to space-separated (GitLab requirement)
  const scopes = app.scopes.replace(/,/g, ' ');

  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: state,
    scope: scopes,
  });

  return `${app.baseUrl}/oauth/authorize?${params.toString()}`;
}

/**
 * Helper function to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
