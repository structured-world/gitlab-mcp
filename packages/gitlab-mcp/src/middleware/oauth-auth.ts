/**
 * OAuth Authentication Middleware
 *
 * Validates Bearer tokens on MCP endpoints and sets up the token context
 * for per-request GitLab API access.
 *
 * This middleware:
 * 1. Extracts and validates the Bearer token from Authorization header
 * 2. Verifies the JWT signature and expiration
 * 3. Loads the associated session
 * 4. Refreshes GitLab token if needed
 * 5. Sets up token context for the request
 */

import { Request, Response, NextFunction } from 'express';
import { loadOAuthConfig } from '../oauth/config';
import { sessionStore } from '../oauth/session-store';
import { verifyMCPToken, isTokenExpiringSoon, calculateTokenExpiry } from '../oauth/token-utils';
import { refreshGitLabToken } from '../oauth/gitlab-device-flow';
import { oauthAppFor } from '../oauth/instance-app';
import { getBaseUrl } from '../oauth/endpoints/metadata';
import {
  MCP_SCOPES,
  isProtectedResource,
  resourceForPath,
  resourceMetadataUrl,
} from '../oauth/resource';
import { logWarn, logError, logDebug, truncateId } from '../logger';
import { MCPTokenPayload, OAuthErrorResponse } from '../oauth/types';
import { getMinimalRequestContext } from '../utils/request-logger';
import { GITLAB_BASE_URL } from '../config';

/**
 * OAuth authentication middleware for Express
 *
 * Apply this middleware to routes that require OAuth authentication.
 * It validates the Bearer token and sets up the token context.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export async function oauthAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendUnauthorized(req, res, 'server_error', 'OAuth not configured');
    return;
  }

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    sendUnauthorized(req, res, 'unauthorized', 'Missing Authorization header');
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    sendUnauthorized(
      req,
      res,
      'unauthorized',
      'Invalid Authorization header format. Expected: Bearer <token>',
    );
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!token) {
    sendUnauthorized(req, res, 'unauthorized', 'Empty Bearer token');
    return;
  }

  // Verify JWT token
  const payload = verifyMCPToken(token, config.sessionSecret);
  if (!payload) {
    sendUnauthorized(req, res, 'invalid_token', 'Token is invalid or expired');
    return;
  }

  if (!isIssuedForThisServer(config.issuer, payload)) {
    sendUnauthorized(req, res, 'invalid_token', 'Token was not issued for this server');
    return;
  }

  // Get session from token
  const sessionId = payload.sid;
  const session = sessionStore.getSession(sessionId);

  if (!session) {
    sendUnauthorized(req, res, 'invalid_token', 'Session not found or expired');
    return;
  }

  // Verify token matches session
  if (session.mcpAccessToken !== token) {
    // Token might have been rotated
    sendUnauthorized(req, res, 'invalid_token', 'Token has been superseded');
    return;
  }

  if (!hasGrantedScope(payload.scope, session.scopes)) {
    sendInsufficientScope(req, res);
    return;
  }

  // Refresh GitLab token if it's expiring soon (5 minute buffer)
  if (isTokenExpiringSoon(session.gitlabTokenExpiry)) {
    try {
      // Refresh with the application of the session's instance, never another one.
      const app = await oauthAppFor(config, session.gitlabApiUrl);
      if (!app) {
        throw new Error('GitLab instance is no longer configured');
      }
      const newTokens = await refreshGitLabToken(session.gitlabRefreshToken, config, app);

      sessionStore.updateSession(sessionId, {
        gitlabAccessToken: newTokens.access_token,
        gitlabRefreshToken: newTokens.refresh_token,
        gitlabTokenExpiry: calculateTokenExpiry(newTokens.expires_in),
        // RFC 6749 section 6: omitted scope retains the original grant.
        // https://www.rfc-editor.org/rfc/rfc6749#section-6
        ...(newTokens.scope !== undefined && {
          gitlabScopes: newTokens.scope.split(/\s+/).filter(Boolean),
        }),
      });

      logDebug('GitLab token refreshed during request', {
        sessionId: truncateId(sessionId),
      });
    } catch (error: unknown) {
      logError('Failed to refresh GitLab token during request', { err: error as Error });
      sendUnauthorized(
        req,
        res,
        'invalid_token',
        'GitLab token refresh failed. Please re-authenticate.',
      );
      return;
    }
  }

  // Get potentially updated session
  const updatedSession = sessionStore.getSession(sessionId);
  if (!updatedSession) {
    sendUnauthorized(req, res, 'invalid_token', 'Session lost during token refresh');
    return;
  }

  // Store OAuth session info in res.locals for route handlers
  // This is used by:
  // 1. Transport handlers to associate MCP sessions with OAuth sessions
  // 2. Route handlers to set up token context around transport.handleRequest()
  //
  // NOTE: We do NOT use runWithTokenContext here because middleware's next() chain
  // breaks AsyncLocalStorage propagation to MCP SDK's internal handlers.
  // Instead, route handlers must wrap transport.handleRequest() with runWithTokenContext()
  // using the data stored here.
  res.locals.oauthSessionId = updatedSession.id;
  res.locals.gitlabToken = updatedSession.gitlabAccessToken;
  res.locals.gitlabUserId = updatedSession.gitlabUserId;
  res.locals.gitlabUsername = updatedSession.gitlabUsername;
  res.locals.gitlabScopes = updatedSession.gitlabScopes;
  // Multi-instance support: use session's API URL or fallback to global config
  res.locals.gitlabApiUrl = updatedSession.gitlabApiUrl ?? GITLAB_BASE_URL;
  res.locals.instanceLabel = updatedSession.instanceLabel;
  res.locals.mcpResource = resourceForPath(config.issuer, req.path);

  logDebug('OAuth session validated, passing to route handler', {
    sessionId: truncateId(updatedSession.id),
    method: req.method,
    path: req.path,
  });

  // Continue to route handler - token context will be set up there
  next();
}

/**
 * Create OAuth middleware for specific routes
 *
 * Returns the middleware function configured for OAuth authentication.
 * Use this when you need to programmatically apply the middleware.
 */
export function createOAuthMiddleware(): typeof oauthAuthMiddleware {
  return oauthAuthMiddleware;
}

/**
 * Optional OAuth middleware
 *
 * Like oauthAuthMiddleware, but doesn't require authentication.
 * If a valid token is provided, sets up res.locals with session info.
 * If no token or invalid token, continues without setting res.locals.
 *
 * Useful for endpoints that work with or without authentication.
 */
export async function optionalOAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    // OAuth not configured, continue without context
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    // No token provided, continue without context
    next();
    return;
  }

  const token = authHeader.slice(7);
  if (!token) {
    next();
    return;
  }

  // Try to validate token
  const payload = verifyMCPToken(token, config.sessionSecret);
  if (!payload || !isIssuedForThisServer(config.issuer, payload)) {
    // Invalid token, but this is optional auth, so continue
    next();
    return;
  }

  const session = sessionStore.getSession(payload.sid);
  if (session?.mcpAccessToken !== token || !hasGrantedScope(payload.scope, session.scopes)) {
    next();
    return;
  }

  // Valid token - store session info in res.locals for route handler
  res.locals.oauthSessionId = session.id;
  res.locals.gitlabToken = session.gitlabAccessToken;
  res.locals.gitlabUserId = session.gitlabUserId;
  res.locals.gitlabUsername = session.gitlabUsername;
  res.locals.gitlabScopes = session.gitlabScopes;
  // Multi-instance support: use session's API URL or fallback to global config
  res.locals.gitlabApiUrl = session.gitlabApiUrl ?? GITLAB_BASE_URL;
  res.locals.instanceLabel = session.instanceLabel;
  res.locals.mcpResource = resourceForPath(config.issuer, req.path);

  next();
}

/** `iss` is our issuer and `aud` one of our resources (RFC 9068 section 4). */
function isIssuedForThisServer(issuer: string, payload: MCPTokenPayload): boolean {
  return payload.iss === issuer && isProtectedResource(issuer, payload.aud);
}

/**
 * The token carries at least one MCP scope and nothing beyond the session's grant, so a
 * token minted before a narrower grant cannot outlive it.
 */
function hasGrantedScope(tokenScope: string, grantedScopes: string[]): boolean {
  const scopes = tokenScope.split(' ').filter(Boolean);
  return (
    scopes.some((scope) => MCP_SCOPES.includes(scope)) &&
    scopes.every((scope) => grantedScopes.includes(scope))
  );
}

/** RFC 6750 section 3.1: a valid token without the needed scope gets 403. */
function sendInsufficientScope(req: Request, res: Response): void {
  logWarn('Authentication rejected', {
    event: 'auth_rejected',
    ...getMinimalRequestContext(req),
    reason: 'insufficient_scope',
  });
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="gitlab-mcp", error="insufficient_scope", scope="${MCP_SCOPES.join(' ')}"`,
  );
  const response: OAuthErrorResponse = {
    error: 'insufficient_scope',
    error_description: 'Token lacks the scope this server requires',
  };
  res.status(403).json(response);
}

/**
 * Send unauthorized response with OAuth error format
 *
 * Includes WWW-Authenticate header with resource parameter (RFC 9470)
 * to help clients discover the authorization server.
 *
 * Also logs the auth rejection for debugging and security monitoring.
 */
function sendUnauthorized(req: Request, res: Response, error: string, description: string): void {
  // Log auth rejection with structured context
  logWarn('Authentication rejected', {
    event: 'auth_rejected',
    ...getMinimalRequestContext(req),
    reason: error,
    description,
  });

  const response: OAuthErrorResponse = {
    error,
    error_description: description,
  };

  // resource_metadata points at the metadata of the endpoint that was called (RFC 9728
  // section 5.1), built from the configured issuer rather than request headers.
  const config = loadOAuthConfig();
  const metadataUrl = config
    ? resourceMetadataUrl(resourceForPath(config.issuer, req.path))
    : `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;

  // Set WWW-Authenticate header with resource_metadata parameter
  // Points to Protected Resource Metadata document per MCP spec. A rejected token also
  // names the error (RFC 6750 section 3); a request without credentials does not
  // (RFC 6750 section 3.1).
  const tokenError =
    error === 'invalid_token' ? `, error="invalid_token", error_description="${description}"` : '';
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="gitlab-mcp", resource_metadata="${metadataUrl}"${tokenError}`,
  );
  res.status(401).json(response);
}
