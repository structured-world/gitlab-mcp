/**
 * OAuth Token Revocation Endpoint (RFC 7009)
 *
 * Disconnects an account: revoking either the MCP access token or the refresh token ends
 * the whole session on every replica, and the linked GitLab grant is revoked as well.
 */

import { Request, Response } from 'express';
import { loadOAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import { liveGitLabAccessToken, revokeGitLabGrant } from '../grant-revocation';
import { logInfo, logError, truncateId } from '../../logger';
import type { OAuthErrorResponse, OAuthSession } from '../types';
import { singleValuedParams } from '../request-params';
import { authenticateClient } from '../client-auth';

function sendError(res: Response, status: number, error: string, description: string): void {
  const response: OAuthErrorResponse = { error, error_description: description };
  res.status(status).json(response);
}

/**
 * Revocation endpoint handler
 *
 * Handles POST /revoke with `token`, optional `token_type_hint` and the client's
 * credentials (`client_id` of a public client, or a confidential client's secret).
 */
export async function revokeHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendError(res, 500, 'server_error', 'OAuth not configured');
    return;
  }

  const params = singleValuedParams(req.body, [
    'token',
    'token_type_hint',
    'client_id',
    'client_secret',
  ]);
  if (typeof params === 'string') {
    sendError(res, 400, 'invalid_request', `${params} must not be repeated`);
    return;
  }
  const { token } = params;
  if (!token) {
    sendError(res, 400, 'invalid_request', 'Missing token');
    return;
  }

  let session;
  let client_id: string | undefined;
  try {
    // RFC 7009 section 2.1: the client authenticates as at the token endpoint; a public
    // client identifies itself with client_id.
    const client = await authenticateClient(req, params);
    if (!client.authenticated) {
      if (client.challenge) res.set('WWW-Authenticate', 'Basic realm="gitlab-mcp"');
      sendError(res, client.status, client.error, client.description);
      return;
    }
    client_id = client.clientId;
    if (!client_id) {
      sendError(res, 400, 'invalid_request', 'Missing client_id');
      return;
    }

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

  // The accounts linked to the session go with it; their grants are ended like its own.
  let grants: Array<{ session: OAuthSession; accessToken: string }>;
  try {
    const linked = sessionStore.linksAccounts()
      ? await sessionStore.getLinkedSessions(session.id)
      : [];
    grants = await Promise.all(
      [session, ...linked].map(async (account) => ({
        session: account,
        accessToken: await liveGitLabAccessToken(account, config),
      })),
    );
  } catch (error: unknown) {
    logError('Token revocation lookup failed', { err: error as Error });
    sendError(res, 503, 'temporarily_unavailable', 'Revocation is temporarily unavailable');
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
  await Promise.all(
    grants.map(({ session: account, accessToken }) =>
      revokeGitLabGrant(account, accessToken, config),
    ),
  );

  logInfo('OAuth session revoked', { sessionId: truncateId(session.id) });
  res.status(200).end();
}
