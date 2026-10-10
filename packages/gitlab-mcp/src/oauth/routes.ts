/**
 * OAuth HTTP routes
 *
 * The routing table of the OAuth endpoints, shared by the server and the HTTP-level
 * tests so both exercise the same handlers on the same paths.
 */

import express, { Express } from 'express';
import {
  metadataHandler,
  protectedResourceHandler,
  authorizeHandler,
  pollHandler,
  callbackHandler,
  tokenHandler,
  registerHandler,
  revokeHandler,
} from './index';
import { loadOAuthConfig } from './config';
import {
  authorizationServerMetadataUrl,
  protectedResources,
  resourceMetadataUrl,
} from './resource';
import { logInfo } from '../logger';

/**
 * Register OAuth endpoints on an Express app
 *
 * Adds:
 * - /.well-known/oauth-authorization-server - OAuth metadata
 * - /.well-known/oauth-protected-resource - Protected resource metadata (RFC 9470)
 * - /authorize - Authorization endpoint (supports both Device Flow and Authorization Code Flow)
 * - /oauth/poll - Device flow polling endpoint
 * - /oauth/callback - Authorization Code Flow callback from GitLab
 * - /token - Token exchange endpoint
 * - /health - Health check endpoint
 *
 * @param app - Express application
 */
export function registerOAuthEndpoints(app: Express): void {
  // NOTE: Rate limiting is applied via rateLimiterMiddleware() BEFORE this function is called.
  // All routes registered here are protected by the global rate limiter middleware.

  // OAuth discovery metadata (no auth required)
  app.get('/.well-known/oauth-authorization-server', metadataHandler);

  // Protected Resource Metadata (RFC 9470) - required by Claude.ai custom connectors
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler);
  // Metadata of the /mcp endpoint (RFC 9728 section 3.1 path-inserted form)
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler);

  // An issuer with a path (a proxy serving this server under a prefix and stripping it)
  // has its metadata at path-inserted URLs on the origin (RFC 8414 section 3.1, RFC 9728
  // section 3.1); the forms above cover the root issuer.
  const issuer = loadOAuthConfig()?.issuer;
  if (issuer && new URL(issuer).pathname !== '/') {
    app.get(new URL(authorizationServerMetadataUrl(issuer)).pathname, metadataHandler);
    for (const resource of protectedResources(issuer)) {
      app.get(new URL(resourceMetadataUrl(resource)).pathname, protectedResourceHandler);
    }
  }

  // Authorization endpoint - supports both flows:
  // - Device Flow (no redirect_uri) - returns HTML page
  // - Authorization Code Flow (with redirect_uri) - redirects to GitLab
  app.get('/authorize', authorizeHandler);

  // Device flow polling endpoint (no auth required)
  app.get('/oauth/poll', pollHandler);

  // Authorization Code Flow callback from GitLab
  // GitLab redirects here after user authorizes, then we redirect to client
  app.get('/oauth/callback', callbackHandler);

  // Token endpoint - exchange code for tokens (no auth required)
  // Uses URL-encoded body as per OAuth spec
  app.post('/token', express.urlencoded({ extended: true }), tokenHandler);

  // Dynamic Client Registration endpoint (RFC 7591) - required by Claude.ai
  app.post('/register', express.json(), registerHandler);

  // Token revocation (RFC 7009): disconnects the account
  app.post('/revoke', express.urlencoded({ extended: true }), revokeHandler);

  // NOTE: /health endpoint is registered globally in startServer() BEFORE OAuth endpoints
  // to avoid access log spam from load balancer health checks. The simple handler there
  // returns {"status": "ok"} which is sufficient for basic liveness/readiness checks.
  // For structured MCP metadata (version, tools, auth mode, instances), use GET /
  // with Accept: application/json header (dashboard endpoint).

  logInfo('OAuth endpoints registered');
}
