/**
 * Refresh of a session's GitLab tokens
 *
 * GitLab rotates refresh tokens: a refresh token works once. Concurrent requests of one
 * account (parallel tool calls, several replicas) must therefore not each spend it. In this
 * process concurrent refreshes of a session share one GitLab call; across replicas the
 * loser of the race finds the tokens the winner stored instead of failing.
 */

import type { OAuthConfig } from './config';
import { sessionStore } from './session-store';
import { refreshGitLabToken, GitLabOAuthHttpError } from './gitlab-device-flow';
import { oauthAppFor } from './instance-app';
import { calculateTokenExpiry, isTokenExpiringSoon } from './token-utils';
import type { OAuthSession } from './types';
import { logDebug, truncateId } from '../logger';

/**
 * The account cannot be refreshed any more: GitLab refused the grant (RFC 6749 section 5.2
 * errors come with 400 or 401) or the session's instance was removed. Any other failure
 * is temporary and leaves the account usable.
 */
export class GitLabGrantRevokedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitLabGrantRevokedError';
  }
}

function isGrantRejection(error: unknown): boolean {
  return error instanceof GitLabOAuthHttpError && (error.status === 400 || error.status === 401);
}

// Coalesces concurrent refreshes in this process; the backend stays the source of truth.
const inflight = new Map<string, Promise<OAuthSession | undefined>>();

async function refreshSession(
  session: OAuthSession,
  config: OAuthConfig,
): Promise<OAuthSession | undefined> {
  try {
    // Refresh with the application of the session's instance, never another one.
    const app = await oauthAppFor(config, session.gitlabApiUrl);
    if (!app) {
      throw new GitLabGrantRevokedError('GitLab instance is no longer configured');
    }
    const tokens = await refreshGitLabToken(session.gitlabRefreshToken, config, app);
    await sessionStore.updateSession(session.id, {
      gitlabAccessToken: tokens.access_token,
      gitlabRefreshToken: tokens.refresh_token,
      gitlabTokenExpiry: calculateTokenExpiry(tokens.expires_in),
      // RFC 6749 section 6: omitted scope retains the original grant.
      // https://www.rfc-editor.org/rfc/rfc6749#section-6
      ...(tokens.scope !== undefined && {
        gitlabScopes: tokens.scope.split(/\s+/).filter(Boolean),
      }),
    });
    logDebug('GitLab token refreshed', { sessionId: truncateId(session.id) });
  } catch (error) {
    // Another replica may have spent this refresh token first and stored the result.
    const current = await sessionStore.getSession(session.id);
    if (
      current &&
      current.gitlabRefreshToken !== session.gitlabRefreshToken &&
      !isTokenExpiringSoon(current.gitlabTokenExpiry)
    ) {
      return current;
    }
    if (isGrantRejection(error)) {
      throw new GitLabGrantRevokedError('GitLab refused the refresh token', { cause: error });
    }
    throw error;
  }
  return sessionStore.getSession(session.id);
}

/**
 * Return the session with GitLab tokens that are not about to expire, refreshing them
 * when needed. Resolves to undefined when the session no longer exists.
 *
 * @throws GitLabGrantRevokedError when the account can no longer be refreshed
 * @throws Error on a temporary failure (network, GitLab 5xx); the account stays usable
 */
export async function withFreshGitLabToken(
  session: OAuthSession,
  config: OAuthConfig,
): Promise<OAuthSession | undefined> {
  if (!isTokenExpiringSoon(session.gitlabTokenExpiry)) {
    return session;
  }
  let pending = inflight.get(session.id);
  if (!pending) {
    pending = refreshSession(session, config).finally(() => inflight.delete(session.id));
    inflight.set(session.id, pending);
  }
  return pending;
}
