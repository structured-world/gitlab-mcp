/**
 * OAuth Callback Endpoint
 *
 * Handles the callback from GitLab after user authorization in Authorization Code Flow.
 * This endpoint receives the GitLab authorization code, exchanges it for tokens,
 * creates a session, and redirects back to the client with an MCP authorization code.
 *
 * Flow:
 * 1. User completes GitLab authorization
 * 2. GitLab redirects to /oauth/callback with code and state
 * 3. We exchange GitLab code for GitLab tokens
 * 4. We create a session with GitLab tokens
 * 5. We generate an MCP authorization code
 * 6. We redirect to client's redirect_uri with MCP code
 */

import { Request, Response } from 'express';
import { loadOAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import { exchangeGitLabAuthCode, getGitLabUser } from '../gitlab-device-flow';
import { generateSessionId, generateAuthorizationCode, calculateTokenExpiry } from '../token-utils';
import { logInfo, logWarn, logError, logDebug, truncateId } from '../../logger';
import { GITLAB_BASE_URL } from '../../config';
import { grantedGitlabScopes } from '../granted-scopes';
import { MCP_SCOPES } from '../resource';
import { authorizationRedirect } from '../authorization-response';
import { oauthAppFor } from '../instance-app';

/**
 * OAuth callback handler
 *
 * Handles GET /oauth/callback from GitLab after user authorization.
 *
 * Query parameters (from GitLab):
 * - code: GitLab authorization code
 * - state: Internal state we sent to GitLab (maps to AuthCodeFlowState)
 *
 * On success, redirects to client's redirect_uri with:
 * - code: MCP authorization code (for /token exchange)
 * - state: Original client state (for CSRF verification)
 */
export async function callbackHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'OAuth not configured',
    });
    return;
  }

  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

  // Handle GitLab error responses
  if (error) {
    logWarn('GitLab authorization error', { error, error_description });
    // Redirect to client with error if we can find the flow state
    if (state) {
      const flow = await sessionStore.consumeAuthCodeFlow(state).catch((err: unknown) => {
        logError('Failed to read authorization flow', { err: err as Error });
        return undefined;
      });
      if (flow) {
        res.redirect(
          authorizationRedirect(flow.clientRedirectUri, config.issuer, {
            error,
            error_description,
            state: flow.clientState,
          }),
        );
        return;
      }
    }
    res.status(400).json({
      error: error,
      error_description: error_description ?? 'GitLab authorization failed',
    });
    return;
  }

  // Validate required parameters
  if (!code) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing authorization code from GitLab',
    });
    return;
  }

  if (!state) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing state parameter',
    });
    return;
  }

  // Take the auth code flow state: a callback is processed once, on whichever replica
  // receives it first.
  let flow;
  try {
    flow = await sessionStore.consumeAuthCodeFlow(state);
  } catch (err: unknown) {
    logError('Failed to read authorization flow', { err: err as Error });
    res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'Authorization storage is unavailable. Please try again.',
    });
    return;
  }
  if (!flow) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid or expired state. Please start authorization again.',
    });
    return;
  }

  // Check if flow has expired
  if (Date.now() > flow.expiresAt) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Authorization flow expired. Please start again.',
    });
    return;
  }

  try {
    // The instance chosen at /authorize; never another one if it is no longer configured.
    const app = await oauthAppFor(config, flow.selectedInstance);
    if (!app) {
      throw new Error('GitLab instance is no longer configured');
    }

    // Exchange GitLab authorization code for tokens
    const gitlabTokens = await exchangeGitLabAuthCode(code, flow.callbackUri, config, app);

    // Get GitLab user info
    const userInfo = await getGitLabUser(gitlabTokens.access_token, app.baseUrl);

    // Create session
    const sessionId = generateSessionId();
    const now = Date.now();

    // Generate MCP authorization code for the client
    const mcpAuthCode = generateAuthorizationCode();

    // Create session with GitLab tokens before the code that references it.
    // MCP tokens will be set when the authorization code is exchanged via /token
    await sessionStore.createSession({
      id: sessionId,
      mcpAccessToken: '', // Set on /token
      mcpRefreshToken: '', // Set on /token
      mcpTokenExpiry: 0, // Set on /token
      gitlabAccessToken: gitlabTokens.access_token,
      gitlabRefreshToken: gitlabTokens.refresh_token,
      gitlabTokenExpiry: calculateTokenExpiry(gitlabTokens.expires_in),
      gitlabScopes: grantedGitlabScopes(gitlabTokens.scope, flow.requestedGitlabScopes),
      gitlabUserId: userInfo.id,
      gitlabUsername: userInfo.username,
      gitlabApiUrl: flow.selectedInstance ?? GITLAB_BASE_URL,
      instanceLabel: flow.selectedInstanceLabel,
      clientId: flow.clientId,
      scopes: flow.scopes ?? [...MCP_SCOPES],
      resource: flow.resource,
      createdAt: now,
      updatedAt: now,
    });

    // Store MCP authorization code (single-use, expires in 10 minutes)
    await sessionStore.storeAuthCode({
      code: mcpAuthCode,
      sessionId,
      clientId: flow.clientId,
      codeChallenge: flow.codeChallenge,
      codeChallengeMethod: flow.codeChallengeMethod,
      redirectUri: flow.clientRedirectUri,
      expiresAt: now + 10 * 60 * 1000, // 10 minutes
    });

    logInfo('Authorization Code Flow completed successfully', {
      sessionId: truncateId(sessionId),
      userId: userInfo.id,
      username: userInfo.username,
    });

    logDebug('Redirecting to client with authorization code', {
      redirectUri: flow.clientRedirectUri,
    });

    // Redirect to client with MCP authorization code
    res.redirect(
      authorizationRedirect(flow.clientRedirectUri, config.issuer, {
        code: mcpAuthCode,
        state: flow.clientState,
      }),
    );
  } catch (error: unknown) {
    logError('Failed to complete authorization code flow', { err: error as Error });

    // The flow was taken above, so a retried callback cannot reuse it.
    // Try to redirect to client with error
    res.redirect(
      authorizationRedirect(flow.clientRedirectUri, config.issuer, {
        error: 'server_error',
        error_description:
          error instanceof Error ? error.message : 'Failed to complete authorization',
        state: flow.clientState,
      }),
    );
  }
}
