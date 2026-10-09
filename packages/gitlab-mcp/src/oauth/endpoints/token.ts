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
  isTokenExpiringSoon,
  generateUUID,
} from '../token-utils';
import { refreshGitLabToken } from '../gitlab-device-flow';
import { defaultResource, matchProtectedResource } from '../resource';
import { oauthAppFor } from '../instance-app';
import { logInfo, logDebug, logWarn, logError, truncateId } from '../../logger';
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

  const { grant_type } = req.body as { grant_type?: string };

  switch (grant_type) {
    case 'authorization_code':
      await handleAuthorizationCode(req, res, config);
      break;

    case 'refresh_token':
      await handleRefreshToken(req, res, config);
      break;

    default:
      sendError(
        req,
        res,
        400,
        'unsupported_grant_type',
        `Grant type "${grant_type}" is not supported`,
      );
  }
}

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
): Promise<void> {
  const { code, code_verifier, redirect_uri, client_id, resource } = req.body as {
    code?: string;
    code_verifier?: string;
    redirect_uri?: string;
    client_id?: string;
    resource?: string;
  };

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

  // Look up authorization code
  const authCode = sessionStore.getAuthCode(code);
  if (!authCode) {
    sendError(req, res, 400, 'invalid_grant', 'Invalid or expired authorization code');
    return;
  }

  // Consume before any check so a code is presented at most once, whatever the outcome
  // (RFC 6749 section 4.1.2); only the caller that removed it may continue.
  if (!sessionStore.deleteAuthCode(code)) {
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
  const session = sessionStore.getSession(authCode.sessionId);
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
  sessionStore.updateSession(session.id, {
    mcpAccessToken: accessToken,
    mcpRefreshToken: refreshToken,
    mcpTokenExpiry: calculateTokenExpiry(config.tokenTtl),
    resource: audience,
  });

  logInfo('MCP tokens issued via authorization_code grant', {
    sessionId: truncateId(session.id),
    userId: session.gitlabUserId,
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
async function handleRefreshToken(req: Request, res: Response, config: OAuthConfig): Promise<void> {
  const { refresh_token, client_id, resource, scope } = req.body as {
    refresh_token?: string;
    client_id?: string;
    resource?: string;
    scope?: string;
  };

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
  const session = sessionStore.getSessionByRefreshToken(refresh_token);
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

  // RFC 6749 section 6: a refresh may narrow the scope, never widen it.
  const tokenScopes = scope === undefined ? session.scopes : scope.split(' ').filter(Boolean);
  if (tokenScopes.length === 0 || !tokenScopes.every((s) => session.scopes.includes(s))) {
    sendError(req, res, 400, 'invalid_scope', 'scope exceeds the original grant');
    return;
  }

  // Refresh GitLab token if it's expiring soon (5 minute buffer)
  let updatedSession: OAuthSession = session;

  if (isTokenExpiringSoon(session.gitlabTokenExpiry)) {
    try {
      // Refresh with the application of the session's instance, never another one.
      const app = await oauthAppFor(config, session.gitlabApiUrl);
      if (!app) {
        throw new Error('GitLab instance is no longer configured');
      }
      const newTokens = await refreshGitLabToken(session.gitlabRefreshToken, config, app);

      sessionStore.updateSession(session.id, {
        gitlabAccessToken: newTokens.access_token,
        gitlabRefreshToken: newTokens.refresh_token,
        gitlabTokenExpiry: calculateTokenExpiry(newTokens.expires_in),
        // RFC 6749 section 6: omitted scope retains the original grant.
        // https://www.rfc-editor.org/rfc/rfc6749#section-6
        ...(newTokens.scope !== undefined && {
          gitlabScopes: newTokens.scope.split(/\s+/).filter(Boolean),
        }),
      });

      // Get updated session
      const refreshedSession = sessionStore.getSession(session.id);
      if (!refreshedSession) {
        sendError(req, res, 400, 'invalid_grant', 'Session lost during refresh');
        return;
      }
      updatedSession = refreshedSession;

      logDebug('GitLab token refreshed', { sessionId: truncateId(session.id) });
    } catch (error: unknown) {
      logError('Failed to refresh GitLab token', { err: error as Error });
      sendError(req, res, 400, 'invalid_grant', 'Failed to refresh underlying GitLab token');
      return;
    }
  }

  // Generate new MCP tokens
  const accessToken = mintAccessToken(config, updatedSession, audience, tokenScopes);

  const newRefreshToken = generateRefreshToken();

  // Update session with new MCP tokens
  sessionStore.updateSession(updatedSession.id, {
    mcpAccessToken: accessToken,
    mcpRefreshToken: newRefreshToken,
    mcpTokenExpiry: calculateTokenExpiry(config.tokenTtl),
    resource: audience,
  });

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
 * the parameter names another resource.
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
  const match = matchProtectedResource(config.issuer, requested);
  return match && (bound === undefined || bound === match) ? match : undefined;
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
