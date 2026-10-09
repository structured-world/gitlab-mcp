/**
 * OAuth Token Revocation Endpoint (RFC 7009)
 *
 * Disconnects an account: revoking either the MCP access token or the refresh token ends
 * the whole session on every replica, and the linked GitLab grant is revoked as well.
 */

import { Request, Response } from 'express';
import { loadOAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import { oauthAppFor } from '../instance-app';
import { revokeGitLabToken } from '../gitlab-device-flow';
import { logInfo, logWarn, logError, truncateId } from '../../logger';
import { OAuthErrorResponse } from '../types';

function sendError(res: Response, status: number, error: string, description: string): void {
  const response: OAuthErrorResponse = { error, error_description: description };
  res.status(status).json(response);
}

/**
 * Revocation endpoint handler
 *
 * Handles POST /revoke with `token`, optional `token_type_hint` and the public client's
 * `client_id`.
 */
export async function revokeHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendError(res, 500, 'server_error', 'OAuth not configured');
    return;
  }

  const { token, client_id } = req.body as { token?: string; client_id?: string };
  if (!token) {
    sendError(res, 400, 'invalid_request', 'Missing token');
    return;
  }
  // RFC 7009 section 2.1: the client identifies itself; a public client sends client_id.
  if (!client_id) {
    sendError(res, 400, 'invalid_request', 'Missing client_id');
    return;
  }

  let session;
  try {
    // token_type_hint only orders the lookup (RFC 7009 2.1); both kinds are checked.
    session =
      (await sessionStore.getSessionByRefreshToken(token)) ??
      (await sessionStore.getSessionByToken(token));
  } catch (error: unknown) {
    logError('Token revocation lookup failed', { err: error as Error });
    // RFC 7009 section 2.2.1: the client retries after a 503.
    sendError(res, 503, 'temporarily_unavailable', 'Revocation is temporarily unavailable');
    return;
  }

  // RFC 7009 section 2.2: an unknown or already revoked token is answered with 200.
  if (!session) {
    res.status(200).end();
    return;
  }

  // RFC 7009 section 2.1: only the client the token was issued to may revoke it.
  if (session.clientId !== client_id) {
    sendError(res, 400, 'invalid_request', 'Token was issued to another client');
    return;
  }

  // Revoking a refresh token revokes the access tokens of the same grant (RFC 7009
  // section 2.1), so the session goes away with both. Backends throw when the delete
  // fails; false only means a concurrent revocation removed the session first, which is
  // the same outcome.
  try {
    await sessionStore.deleteSession(session.id);
  } catch (error: unknown) {
    logError('Token revocation failed', { err: error as Error });
    sendError(res, 503, 'temporarily_unavailable', 'Revocation is temporarily unavailable');
    return;
  }

  // Disconnecting also ends GitLab access; the MCP side is already revoked if this fails.
  try {
    const app = await oauthAppFor(config, session.gitlabApiUrl);
    if (app) {
      await revokeGitLabToken(session.gitlabAccessToken, config, app);
    }
  } catch (error: unknown) {
    logWarn('GitLab token revocation failed', { err: error as Error });
  }

  logInfo('OAuth session revoked', { sessionId: truncateId(session.id) });
  res.status(200).end();
}
