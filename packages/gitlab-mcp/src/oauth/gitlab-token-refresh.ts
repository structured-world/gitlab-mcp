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
import { refreshGitLabToken, revokeGitLabToken, GitLabOAuthHttpError } from './gitlab-device-flow';
import { oauthAppFor } from './instance-app';
import type { GitLabOAuthApp } from './oauth-app';
import { calculateTokenExpiry, isTokenExpiringSoon } from './token-utils';
import type { OAuthSession } from './types';
import { GITLAB_REQUEST_MAX_MS } from './gitlab-request-bound';
import { logDebug, logWarn, truncateId } from '../logger';

/** Time left after the GitLab call for storing the new tokens (with retries). */
const STORE_BUDGET_MS = 15_000;
/**
 * How long a replica holds the refresh token. It outlasts the longest GitLab call the
 * request timeouts allow, so no other replica can claim the token while this one may
 * still be spending it.
 */
const REFRESH_LEASE_MS = GITLAB_REQUEST_MAX_MS + STORE_BUDGET_MS;
/** How often a replica waiting for another replica's refresh re-reads the session. */
const LEASE_POLL_MS = 200;
/** First delay before retrying a failed write of refreshed tokens; doubles each time. */
const STORE_RETRY_MS = 200;

/**
 * The account cannot be refreshed any more: GitLab refused the grant (RFC 6749 section 5.2
 * invalid_grant) or the session's instance was removed. Any other failure is temporary and
 * leaves the account usable.
 */
export class GitLabGrantRevokedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitLabGrantRevokedError';
  }
}

/**
 * RFC 6749 section 5.2: invalid_grant is the only error about the refresh token itself.
 * invalid_client and the others concern the application or the request, and a body
 * without a code comes from a proxy; none of them ends the account's link. GitLab can
 * answer invalid_grant for a refresh token issued moments earlier while a database replica
 * lags (gitlab-org/gitlab#599181); the tokens refreshed here are as old as an access token
 * lifetime, long past any replica lag.
 */
function isGrantRejection(error: unknown): boolean {
  return error instanceof GitLabOAuthHttpError && error.oauthError === 'invalid_grant';
}

// Coalesces concurrent refreshes in this process; the backend stays the source of truth.
const inflight = new Map<string, Promise<OAuthSession | undefined>>();

function releaseLease(sessionId: string, leaseUntil: number): Promise<void> {
  // A lease that cannot be released expires on its own.
  return sessionStore.releaseGitLabRefresh(sessionId, leaseUntil).catch((error: unknown) => {
    logWarn('Failed to release GitLab refresh lease', { err: error as Error });
  });
}

/**
 * Store tokens GitLab just issued; false when the session no longer exists. GitLab has
 * already spent the old refresh token, so losing them disconnects the account: a failed
 * write is retried while this replica still holds the lease (no other replica can spend
 * the old token meanwhile), with backoff.
 */
async function storeRefreshedTokens(
  sessionId: string,
  updates: Partial<OAuthSession>,
  leaseUntil: number,
  delay = STORE_RETRY_MS,
): Promise<boolean> {
  try {
    return await sessionStore.updateSession(sessionId, updates);
  } catch (error) {
    if (Date.now() + delay >= leaseUntil) throw error;
    logWarn('Storing refreshed GitLab tokens failed, retrying', { err: error as Error });
    await sleep(delay);
    return storeRefreshedTokens(sessionId, updates, leaseUntil, delay * 2);
  }
}

/** Revoke tokens issued for a session that was removed meanwhile; best effort. */
async function revokeOrphanedTokens(
  accessToken: string,
  config: OAuthConfig,
  app: GitLabOAuthApp,
): Promise<void> {
  try {
    await revokeGitLabToken(accessToken, config, app);
  } catch (error: unknown) {
    logWarn('Failed to revoke GitLab tokens of a removed session', { err: error as Error });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Spend the leased refresh token at GitLab and store the new tokens. */
async function refreshHoldingLease(
  session: OAuthSession,
  spentToken: string,
  config: OAuthConfig,
  leaseUntil: number,
): Promise<OAuthSession | undefined> {
  let tokens;
  let app: GitLabOAuthApp | undefined;
  try {
    // Refresh with the application of the session's instance, never another one.
    app = await oauthAppFor(config, session.gitlabApiUrl);
    if (!app) {
      throw new GitLabGrantRevokedError('GitLab instance is no longer configured');
    }
    tokens = await refreshGitLabToken(spentToken, config, app);
  } catch (error) {
    await releaseLease(session.id, leaseUntil);
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
    if (!(await storeRefreshedTokens(session.id, updates, leaseUntil))) {
      // Disconnected while GitLab issued them: nothing holds these tokens any more.
      await revokeOrphanedTokens(tokens.access_token, config, app);
      return undefined;
    }
  } finally {
    await releaseLease(session.id, leaseUntil);
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
  return claimOrWait(session, spentToken, config, deadline);
}

/** Claim the refresh lease, or wait for the replica holding it to store new tokens. */
async function claimOrWait(
  session: OAuthSession,
  spentToken: string,
  config: OAuthConfig,
  deadline: number,
): Promise<OAuthSession | undefined> {
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
  await sleep(LEASE_POLL_MS);
  return claimOrWait(session, spentToken, config, deadline);
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
