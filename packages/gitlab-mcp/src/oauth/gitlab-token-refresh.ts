/**
 * Refresh of a session's GitLab tokens
 *
 * GitLab rotates refresh tokens: a refresh token works once. Concurrent requests of one
 * account (parallel tool calls, several replicas) must therefore not each spend it. In this
 * process concurrent refreshes of a session share one GitLab call; across replicas only the
 * holder of the storage lease spends the token, and the others wait for the tokens it
 * stores.
 */

import type { OAuthConfig } from './config';
import { sessionStore } from './session-store';
import { refreshGitLabToken, GitLabOAuthHttpError } from './gitlab-device-flow';
import { oauthAppFor } from './instance-app';
import { calculateTokenExpiry, isTokenExpiringSoon } from './token-utils';
import type { OAuthSession } from './types';
import { logDebug, logWarn, truncateId } from '../logger';

/** How long a replica may hold the refresh token while it calls GitLab. */
const REFRESH_LEASE_MS = 30_000;
/** How often a replica waiting for another replica's refresh re-reads the session. */
const LEASE_POLL_MS = 200;
/** First delay before retrying a failed write of refreshed tokens; doubles each time. */
const STORE_RETRY_MS = 200;

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

function releaseLease(sessionId: string): Promise<void> {
  // A lease that cannot be released expires on its own.
  return sessionStore.releaseGitLabRefresh(sessionId).catch((error: unknown) => {
    logWarn('Failed to release GitLab refresh lease', { err: error as Error });
  });
}

/**
 * Store tokens GitLab just issued. GitLab has already spent the old refresh token, so
 * losing them disconnects the account: a failed write is retried while this replica still
 * holds the lease (no other replica can spend the old token meanwhile), with backoff.
 */
async function storeRefreshedTokens(
  sessionId: string,
  updates: Partial<OAuthSession>,
  leaseUntil: number,
): Promise<void> {
  for (let delay = STORE_RETRY_MS; ; delay *= 2) {
    try {
      await sessionStore.updateSession(sessionId, updates);
      return;
    } catch (error) {
      if (Date.now() + delay >= leaseUntil) throw error;
      logWarn('Storing refreshed GitLab tokens failed, retrying', { err: error as Error });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Spend the leased refresh token at GitLab and store the new tokens. */
async function refreshHoldingLease(
  session: OAuthSession,
  spentToken: string,
  config: OAuthConfig,
  leaseUntil: number,
): Promise<OAuthSession | undefined> {
  let tokens;
  try {
    // Refresh with the application of the session's instance, never another one.
    const app = await oauthAppFor(config, session.gitlabApiUrl);
    if (!app) {
      throw new GitLabGrantRevokedError('GitLab instance is no longer configured');
    }
    tokens = await refreshGitLabToken(spentToken, config, app);
  } catch (error) {
    await releaseLease(session.id);
    // A server that predates the lease may have spent the token and stored the result.
    const current = await sessionStore.getSession(session.id);
    if (
      current &&
      current.gitlabRefreshToken !== spentToken &&
      !isTokenExpiringSoon(current.gitlabTokenExpiry)
    ) {
      return current;
    }
    if (isGrantRejection(error)) {
      throw new GitLabGrantRevokedError('GitLab refused the refresh token', { cause: error });
    }
    throw error;
  }
  const updates: Partial<OAuthSession> = {
    gitlabAccessToken: tokens.access_token,
    gitlabRefreshToken: tokens.refresh_token,
    gitlabTokenExpiry: calculateTokenExpiry(tokens.expires_in),
    // RFC 6749 section 6: omitted scope retains the original grant.
    // https://www.rfc-editor.org/rfc/rfc6749#section-6
    ...(tokens.scope !== undefined && {
      gitlabScopes: tokens.scope.split(/\s+/).filter(Boolean),
    }),
  };
  try {
    await storeRefreshedTokens(session.id, updates, leaseUntil);
  } finally {
    await releaseLease(session.id);
  }
  logDebug('GitLab token refreshed', { sessionId: truncateId(session.id) });
  return sessionStore.getSession(session.id);
}

async function refreshSession(
  session: OAuthSession,
  config: OAuthConfig,
): Promise<OAuthSession | undefined> {
  // Read once: the stored session may change under us while we wait.
  const spentToken = session.gitlabRefreshToken;
  // A lease held elsewhere ends by REFRESH_LEASE_MS at the latest, then this caller claims it.
  const deadline = Date.now() + REFRESH_LEASE_MS + 2 * LEASE_POLL_MS;
  for (;;) {
    const now = Date.now();
    const leaseUntil = now + REFRESH_LEASE_MS;
    if (await sessionStore.claimGitLabRefresh(session.id, spentToken, now, leaseUntil)) {
      return refreshHoldingLease(session, spentToken, config, leaseUntil);
    }
    // Another replica holds the lease or already refreshed: use the tokens it stores.
    const current = await sessionStore.getSession(session.id);
    if (!current) return undefined;
    if (current.gitlabRefreshToken !== spentToken) return current;
    if (Date.now() >= deadline) {
      throw new Error('GitLab token refresh on another replica did not finish');
    }
    await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
  }
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
