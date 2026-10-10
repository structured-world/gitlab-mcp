/**
 * OAuth Token Endpoint
 *
 * Handles token requests for:
 * - authorization_code: Exchange authorization code for tokens
 * - refresh_token: Refresh expired access tokens
 *
 * This endpoint issues MCP tokens (JWTs) to clients after successful
 * GitLab authentication.
 */

import { Request, Response } from 'express';
import { loadOAuthConfig, OAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import {
  verifyCodeChallenge,
  createJWT,
  generateRefreshToken,
  calculateTokenExpiry,
  generateUUID,
} from '../token-utils';
import { withFreshGitLabToken, GitLabGrantRevokedError } from '../gitlab-token-refresh';
import { MCP_SCOPES, defaultResource, resourceParameter } from '../resource';
import { singleValuedParams } from '../request-params';
import { logInfo, logWarn, logError, truncateId } from '../../logger';
import { MCPTokenResponse, OAuthErrorResponse, OAuthSession } from '../types';
import { getIpAddress } from '../../utils/request-logger';

/**
 * Token endpoint handler
 *
 * Handles POST /token requests for token operations.
 *
 * Supported grant types:
 * - authorization_code: Exchange code for tokens (requires code_verifier for PKCE)
 * - refresh_token: Refresh access token
 */
export async function tokenHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendError(req, res, 500, 'server_error', 'OAuth not configured');
    return;
  }

  // Parameters are checked before anything is consumed: a malformed request must not
  // spend the code or refresh token a valid retry needs.
  // `resource` may repeat (RFC 8707 section 2) and is read separately.
  const params = singleValuedParams(req.body, TOKEN_PARAMS);
  if (typeof params === 'string') {
    sendError(req, res, 400, 'invalid_request', `${params} must not be repeated`);
    return;
  }
  const resource = resourceParameter(
    config.issuer,
    (req.body as { resource?: unknown } | undefined)?.resource,
  );
  if (resource === null) {
    sendError(req, res, 400, 'invalid_target', 'resource must name one resource of this server');
    return;
  }

  try {
    switch (params.grant_type) {
      case 'authorization_code':
        await handleAuthorizationCode(req, res, config, params, resource);
        break;

      case 'refresh_token':
        await handleRefreshToken(req, res, config, params, resource);
        break;

      default:
        sendError(
          req,
          res,
          400,
          'unsupported_grant_type',
          `Grant type "${params.grant_type}" is not supported`,
        );
    }
  } catch (error: unknown) {
    // Storage failures must not look like a granted or a refused token.
    logError('Token request failed', { err: error as Error });
    sendError(req, res, 500, 'server_error', 'Token service is temporarily unavailable');
  }
}

const TOKEN_PARAMS = [
  'grant_type',
  'code',
  'code_verifier',
  'redirect_uri',
  'client_id',
  'refresh_token',
  'scope',
] as const;
type TokenParams = Partial<Record<(typeof TOKEN_PARAMS)[number], string>>;

/**
 * Handle authorization code grant
 *
 * Exchanges an authorization code for access and refresh tokens.
 * Requires PKCE code_verifier to match the original code_challenge.
 */
async function handleAuthorizationCode(
  req: Request,
  res: Response,
  config: OAuthConfig,
  params: TokenParams,
  resource: string | undefined,
): Promise<void> {
  const { code, code_verifier, redirect_uri, client_id } = params;

  // Validate required parameters
  if (!code) {
    sendError(req, res, 400, 'invalid_request', 'Missing authorization code');
    return;
  }

  if (!code_verifier) {
    sendError(req, res, 400, 'invalid_request', 'Missing code_verifier (PKCE required)');
    return;
  }

  // RFC 6749 section 4.1.3: a public client identifies itself on the code exchange.
  if (!client_id) {
    sendError(req, res, 400, 'invalid_request', 'Missing client_id');
    return;
  }

  // Consume before any check so a code is presented at most once, whatever the outcome
  // (RFC 6749 section 4.1.2); of concurrent exchanges on any replica only one gets it.
  const authCode = await sessionStore.consumeAuthCode(code);
  if (!authCode) {
    sendError(req, res, 400, 'invalid_grant', 'Invalid or expired authorization code');
    return;
  }

  // Check if code has expired
  if (Date.now() > authCode.expiresAt) {
    sendError(req, res, 400, 'invalid_grant', 'Authorization code has expired');
    return;
  }

  // RFC 6749 section 4.1.3: the code must have been issued to this client.
  if (client_id !== authCode.clientId) {
    sendError(req, res, 400, 'invalid_grant', 'Authorization code was issued to another client');
    return;
  }

  // Verify PKCE code challenge
  if (!verifyCodeChallenge(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
    sendError(req, res, 400, 'invalid_grant', 'Invalid code_verifier');
    return;
  }

  // Verify redirect_uri matches (if it was provided in authorization)
  if (authCode.redirectUri && redirect_uri !== authCode.redirectUri) {
    sendError(req, res, 400, 'invalid_grant', 'redirect_uri does not match');
    return;
  }

  // Get the session created during device flow
  const session = await sessionStore.getSession(authCode.sessionId);
  if (!session) {
    sendError(req, res, 400, 'invalid_grant', 'Session not found');
    return;
  }

  const audience = resolveResource(config, session, resource);
  if (!audience) {
    sendError(req, res, 400, 'invalid_target', 'resource does not match the authorization');
    return;
  }

  // Generate MCP tokens
  const accessToken = mintAccessToken(config, session, audience, session.scopes);

  const refreshToken = generateRefreshToken();

  // Update session with MCP tokens
  const stored = await sessionStore.updateSession(session.id, {
    mcpAccessToken: accessToken,
    mcpRefreshToken: refreshToken,
    mcpTokenExpiry: calculateTokenExpiry(config.tokenTtl),
    resource: audience,
  });
  if (!stored) {
    sendError(req, res, 400, 'invalid_grant', 'Session not found');
    return;
  }

  logInfo('MCP tokens issued via authorization_code grant', {
    sessionId: truncateId(session.id),
    userId: session.gitlabUserId,
  });

  // The client completed an authorization: its registration no longer expires. Missing
  // the mark only lets an unused-looking registration expire later, so it does not fail
  // the token response.
  await sessionStore.markClientUsed(session.clientId).catch((error: unknown) => {
    logWarn('Failed to record client use', { err: error as Error });
  });

  // Return token response
  const response: MCPTokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtl,
    refresh_token: refreshToken,
    scope: session.scopes.join(' '),
  };

  res.json(response);
}

/**
 * Handle refresh token grant
 *
 * Issues new access and refresh tokens using a valid refresh token.
 * Also refreshes the underlying GitLab token if needed.
 */
async function handleRefreshToken(
  req: Request,
  res: Response,
  config: OAuthConfig,
  params: TokenParams,
  resource: string | undefined,
): Promise<void> {
  const { refresh_token, client_id, scope } = params;

  if (!refresh_token) {
    sendError(req, res, 400, 'invalid_request', 'Missing refresh_token');
    return;
  }

  // A public client identifies itself on refresh (OAuth 2.1 section 4.3.1).
  if (!client_id) {
    sendError(req, res, 400, 'invalid_request', 'Missing client_id');
    return;
  }

  // Find session by refresh token
  const session = await sessionStore.getSessionByRefreshToken(refresh_token);
  if (!session) {
    sendError(req, res, 400, 'invalid_grant', 'Invalid refresh token');
    return;
  }

  // RFC 6749 section 6: the refresh token is bound to the client it was issued to.
  if (client_id !== session.clientId) {
    sendError(req, res, 400, 'invalid_grant', 'Refresh token was issued to another client');
    return;
  }

  const audience = resolveResource(config, session, resource);
  if (!audience) {
    sendError(req, res, 400, 'invalid_target', 'resource does not match the authorization');
    return;
  }

  // RFC 6749 section 6: a refresh may narrow the scope, never widen it. Values this server
  // does not grant (openid, offline_access) are ignored as at /authorize, and a request of
  // only such values keeps the original grant.
  const requested = (scope ?? '').split(' ').filter((s) => MCP_SCOPES.includes(s));
  const tokenScopes = requested.length === 0 ? session.scopes : [...new Set(requested)];
  if (!tokenScopes.every((s) => session.scopes.includes(s))) {
    sendError(req, res, 400, 'invalid_scope', 'scope exceeds the original grant');
    return;
  }

  // GitLab first: until the rotation below commits, the client's refresh token stays
  // valid, so a GitLab outage costs a retry rather than the account.
  let updatedSession: OAuthSession | undefined;
  try {
    updatedSession = await withFreshGitLabToken(session, config);
  } catch (error: unknown) {
    logError('Failed to refresh GitLab token', { err: error as Error });
    if (error instanceof GitLabGrantRevokedError) {
      sendError(
        req,
        res,
        400,
        'invalid_grant',
        'GitLab no longer accepts this account; sign in again',
      );
    } else {
      sendError(
        req,
        res,
        503,
        'temporarily_unavailable',
        'GitLab is temporarily unavailable; retry the refresh',
      );
    }
    return;
  }
  if (!updatedSession) {
    sendError(req, res, 400, 'invalid_grant', 'Session lost during refresh');
    return;
  }

  const accessToken = mintAccessToken(config, updatedSession, audience, tokenScopes);
  const newRefreshToken = generateRefreshToken();

  // The refresh token is spent exactly once, by the caller whose compare-and-set wins on
  // any replica (OAuth 2.1 section 4.3.1 rotation).
  const rotated = await sessionStore.rotateSession(session.id, refresh_token, {
    mcpAccessToken: accessToken,
    mcpRefreshToken: newRefreshToken,
    mcpTokenExpiry: calculateTokenExpiry(config.tokenTtl),
    resource: audience,
  });
  if (!rotated) {
    sendError(req, res, 400, 'invalid_grant', 'Invalid refresh token');
    return;
  }

  logInfo('MCP tokens refreshed via refresh_token grant', {
    sessionId: truncateId(updatedSession.id),
    userId: updatedSession.gitlabUserId,
  });

  // Return token response
  const response: MCPTokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtl,
    refresh_token: newRefreshToken,
    scope: tokenScopes.join(' '),
  };

  res.json(response);
}

/**
 * Audience for a token request: the resource the authorization was bound to, which a
 * `resource` parameter may repeat but not change (RFC 8707 section 2.2). Undefined when
 * the parameter names another resource of this server.
 */
function resolveResource(
  config: OAuthConfig,
  session: OAuthSession,
  requested: string | undefined,
): string | undefined {
  const bound = session.resource;
  if (requested === undefined) {
    return bound ?? defaultResource(config.issuer);
  }
  return bound === undefined || bound === requested ? requested : undefined;
}

/** Sign an MCP access token for the session (claims per RFC 9068 section 2.2). */
function mintAccessToken(
  config: OAuthConfig,
  session: OAuthSession,
  audience: string,
  scopes: string[],
): string {
  return createJWT(
    {
      iss: config.issuer,
      sub: session.gitlabUserId.toString(),
      aud: audience,
      client_id: session.clientId,
      jti: generateUUID(),
      sid: session.id,
      scope: scopes.join(' '),
      gitlab_user: session.gitlabUsername,
    },
    config.sessionSecret,
    config.tokenTtl,
  );
}

/**
 * Send an OAuth error response
 *
 * Logs the error before sending the response for debugging and monitoring.
 */
function sendError(
  req: Request,
  res: Response,
  status: number,
  error: string,
  description: string,
): void {
  // Log OAuth error with structured context
  logWarn('OAuth token request failed', {
    event: 'oauth_error',
    endpoint: '/token',
    ip: getIpAddress(req),
    error,
    description,
  });

  const response: OAuthErrorResponse = {
    error,
    error_description: description,
  };
  res.status(status).json(response);
}
