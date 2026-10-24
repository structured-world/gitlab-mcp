/**
 * Ending the GitLab grant of a session that is being removed: revoking the session in
 * this server stops MCP access, revoking the grant stops GitLab access too.
 */

import type { OAuthConfig } from './config';
import { oauthAppFor } from './instance-app';
import { refreshGitLabToken, revokeGitLabToken } from './gitlab-device-flow';
import { claimSessionLease, withFreshGitLabToken } from './gitlab-token-refresh';
import { sessionStore } from './session-store';
import type { AuthCodeFlowState, OAuthSession } from './types';
import type { AbandonedFlowGrantHandler } from './storage/types';
import { GITLAB_REQUEST_MAX_MS } from './gitlab-request-bound';
import { logWarn } from '../logger';

/**
 * The session's GitLab access token, refreshed when due: GitLab does not revoke an expired
 * access token while its refresh token stays usable, so the revocation must reach a live one.
 */
export async function liveGitLabAccessToken(
  session: OAuthSession,
  config: OAuthConfig,
): Promise<string> {
  try {
    return (
      (await withFreshGitLabToken(session, config))?.gitlabAccessToken ?? session.gitlabAccessToken
    );
  } catch (error: unknown) {
    logWarn('Could not refresh the GitLab grant before revoking it', { err: error as Error });
    return session.gitlabAccessToken;
  }
}

/**
 * Revoke the grant behind `accessToken` (RFC 7009 section 2.1: the grant's other tokens go
 * with it) at the session's instance. Best effort: the session is already removed here.
 */
export async function revokeGitLabGrant(
  session: OAuthSession,
  accessToken: string,
  config: OAuthConfig,
): Promise<void> {
  try {
    const app = await oauthAppFor(config, session.gitlabApiUrl);
    if (app) await revokeGitLabToken(accessToken, config, app);
  } catch (error: unknown) {
    logWarn('GitLab token revocation failed', { err: error as Error });
  }
}

/** How long a removal holds the session: a read of its linked accounts and a delete. */
const REMOVAL_LEASE_MS = 15_000;

/** Give the session back after a failed removal; a lease left behind expires on its own. */
function releaseRemovalLease(sessionId: string, leaseUntil: number): Promise<void> {
  return sessionStore.releaseGitLabRefresh(sessionId, leaseUntil).catch(() => undefined);
}

type SessionGrant = { session: OAuthSession; accessToken: string };

/**
 * The grants a removal of the session ends: its own and its linked accounts', with live
 * tokens. Read while holding the session's lease, which stays held until the delete: a link
 * that stores an account after the read finds the lease held or the session gone, and ends
 * its own grant. The lease is returned for the caller to release if the delete fails.
 */
async function grantsToEnd(
  session: OAuthSession,
  config: OAuthConfig,
): Promise<{ grants: SessionGrant[]; leaseUntil?: number }> {
  const links = sessionStore.linksAccounts();
  // Live tokens first: a refresh of the session needs the lease this removal holds next.
  const before = links ? await sessionStore.getLinkedSessions(session.id) : [];
  const known = await Promise.all(
    [session, ...before].map(async (account) => ({
      session: account,
      accessToken: await liveGitLabAccessToken(account, config),
    })),
  );
  const leaseUntil = await claimSessionLease(session.id, REMOVAL_LEASE_MS);
  const current = leaseUntil === undefined ? undefined : await sessionStore.getSession(session.id);
  // Removed meanwhile (a concurrent removal, cleanup): the grants known still end.
  if (!current || leaseUntil === undefined) return { grants: known };
  try {
    const linked = links ? await sessionStore.getLinkedSessions(session.id) : [];
    // Tokens as stored now: refreshed above, or a grant a link stored since, issued just now.
    const grants = [current, ...linked].map((account) => ({
      session: account,
      accessToken: account.gitlabAccessToken,
    }));
    return { grants, leaseUntil };
  } catch (error: unknown) {
    await releaseRemovalLease(session.id, leaseUntil);
    throw error;
  }
}

/**
 * Remove a session with its linked accounts and end every one of their GitLab grants.
 * Rejects, leaving the session in place, when storage fails before the delete; the grants
 * are ended after the delete, best effort.
 */
export async function endSession(session: OAuthSession, config: OAuthConfig): Promise<void> {
  const { grants, leaseUntil } = await grantsToEnd(session, config);
  // Without the lease the session is already gone: only its grants are left to end.
  if (leaseUntil !== undefined) {
    try {
      // Backends throw when the delete fails; false only means a concurrent removal took
      // the session first, which is the same outcome.
      await sessionStore.deleteSession(session.id);
    } catch (error: unknown) {
      await releaseRemovalLease(session.id, leaseUntil);
      throw error;
    }
  }
  await Promise.all(
    grants.map(({ session: account, accessToken }) =>
      revokeGitLabGrant(account, accessToken, config),
    ),
  );
}

/** How long a discard holds the link's session: one read of its linked accounts. */
const OWNERSHIP_CHECK_LEASE_MS = 5_000;
/** A bounded ownership check, refresh, durable write, and revocation. */
const FLOW_STORE_BUDGET_MS = 15_000;
const FLOW_CLEANUP_LEASE_MS =
  OWNERSHIP_CHECK_LEASE_MS + 2 * GITLAB_REQUEST_MAX_MS + FLOW_STORE_BUDGET_MS;

/** Slow storage reads must not let an expired lease holder spend a refresh token. */
function assertCleanupLease(leaseUntil: number | undefined, requiredMs: number): void {
  if (leaseUntil !== undefined && Date.now() + requiredMs > leaseUntil) {
    throw new Error('Authorization-flow cleanup lease has insufficient time remaining');
  }
}

/**
 * Whether an account link stored the flow's grant with the account: that grant is the
 * account's, not the flow's. A link completes under its session's lease, from the check
 * that its flow is unspent until it is spent, so this reads under the same lease: a callback
 * that got the flow first has stored the account, and one that comes after finds the flow
 * already taken away by the discard and stores nothing.
 */
async function linkedAccountHolds(flow: AuthCodeFlowState): Promise<boolean> {
  const tokens = flow.gitlabTokens;
  if (!tokens || flow.link?.stage !== 'connect' || !sessionStore.linksAccounts()) return false;
  const sessionId = flow.link.sessionId;
  const turn = await claimSessionLease(
    sessionId,
    OWNERSHIP_CHECK_LEASE_MS,
    Date.now() + OWNERSHIP_CHECK_LEASE_MS,
  );
  // The session is gone, and its linked accounts with it: nothing holds the grant.
  if (turn === undefined) return false;
  try {
    const linked = await sessionStore.getLinkedSessions(sessionId);
    return linked.some(
      (account) =>
        account.gitlabAccessToken === tokens.access_token ||
        account.gitlabRefreshToken === tokens.refresh_token,
    );
  } finally {
    await sessionStore.releaseGitLabRefresh(sessionId, turn).catch(() => undefined);
  }
}

/**
 * End the grant an authorization flow cached after exchanging GitLab's code, when the flow
 * is discarded unfinished: nothing else holds those tokens, unless a link stored them with
 * its account first. Rejects when the grant could not be ended, so the caller keeps the
 * flow (its only copy) for a retry; a flow whose instance is no longer configured has no
 * application to end it with and counts as done.
 */
export async function endAbandonedFlowGrant(
  flow: AuthCodeFlowState,
  config: OAuthConfig,
  persistTokens: Parameters<AbandonedFlowGrantHandler>[1],
  leaseUntil?: number,
): Promise<void> {
  if (!flow.gitlabTokens || (await linkedAccountHolds(flow))) return;
  const app = await oauthAppFor(config, flow.selectedInstance);
  if (!app) return;
  let tokens = flow.gitlabTokens;
  // RFC 7009 section 2.2 also permits HTTP 200 for an invalid token:
  // https://www.rfc-editor.org/rfc/rfc7009#section-2.2
  // Doorkeeper 5.6.6 checks accessible? and skips expired tokens:
  // https://github.com/doorkeeper-gem/doorkeeper/blob/v5.6.6/app/controllers/doorkeeper/tokens_controller.rb#L104-L108
  // Refresh early enough that the revocation request can reach a live token.
  if ((tokens.created_at + tokens.expires_in) * 1000 <= Date.now() + GITLAB_REQUEST_MAX_MS) {
    assertCleanupLease(leaseUntil, 2 * GITLAB_REQUEST_MAX_MS + FLOW_STORE_BUDGET_MS);
    tokens = await refreshGitLabToken(tokens.refresh_token, config, app);
    flow.gitlabTokens = tokens;
    const deadline = Date.now() + FLOW_STORE_BUDGET_MS;
    for (let delay = 200; ; delay *= 2) {
      try {
        await persistTokens(tokens);
        break;
      } catch (error: unknown) {
        if (Date.now() + delay >= deadline) {
          // Storage cannot keep the rotated grant: end it now rather than leave
          // only the spent refresh token behind. A failed revoke still rejects.
          await revokeGitLabToken(tokens.access_token, config, app);
          return;
        }
        logWarn('Could not persist refreshed abandoned-flow tokens, retrying', {
          err: error as Error,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  assertCleanupLease(leaseUntil, GITLAB_REQUEST_MAX_MS);
  await revokeGitLabToken(tokens.access_token, config, app);
}

/**
 * End a spent flow's grant; keep an expired recovery record if ending it fails.
 * Expiry prevents a replayed callback from finishing with the retained credentials.
 */
export async function revokeAbandonedFlowGrant(
  flow: AuthCodeFlowState,
  config: OAuthConfig,
): Promise<void> {
  const pending = { ...flow, expiresAt: Math.min(flow.expiresAt, Date.now() - 1) };
  let persisted = false;
  try {
    await endAbandonedFlowGrant(pending, config, async (tokens) => {
      pending.gitlabTokens = tokens;
      await sessionStore.storeAuthCodeFlow(pending.internalState, pending);
      persisted = true;
    });
    if (persisted) await sessionStore.deleteAuthCodeFlow(pending.internalState);
  } catch (error: unknown) {
    logWarn('Failed to revoke the GitLab grant of an abandoned authorization', {
      err: error as Error,
    });
    await sessionStore
      .storeAuthCodeFlow(pending.internalState, pending)
      .catch((restoreError: unknown) => {
        logWarn('Could not keep an abandoned authorization for cleanup', {
          err: restoreError as Error,
          expiresAt: pending.expiresAt,
        });
      });
  }
}

/**
 * Initialize the session store with the cleanups that end grants (of abandoned flows and
 * of sessions past their age limit), and run cleanup once now: sessions that expired while
 * the server was stopped still hold grants. Authentication refuses those sessions (token
 * lookups and the bearer check alike), so the server need not wait for it.
 */
export async function startSessionStore(config: OAuthConfig): Promise<void> {
  await sessionStore.initialize();
  sessionStore.onAbandonedFlowGrant(
    (flow, persistTokens, leaseUntil) =>
      endAbandonedFlowGrant(flow, config, persistTokens, leaseUntil),
    FLOW_CLEANUP_LEASE_MS,
  );
  sessionStore.onExpiredSession((session) => endSession(session, config));
  sessionStore.cleanup().catch((error: unknown) => {
    logWarn('Startup session cleanup failed', { err: error as Error });
  });
}

/**
 * Discard an authorization flow that will not finish, ending the grant it cached. The flow is
 * taken out of its callbacks' reach first, as storage cleanup does: a retry that comes after
 * finds it spent and stores nothing, so it cannot store the grant being ended. A flow whose
 * grant could not be ended goes back for storage cleanup, which ends the grant once it
 * expires (revocation is idempotent).
 */
export async function discardAuthCodeFlow(
  state: string,
  flow: AuthCodeFlowState,
  config: OAuthConfig,
): Promise<void> {
  const taken = await sessionStore.consumeAuthCodeFlow(state).catch((error: unknown) => {
    // Not taken, so not this call's grant to end: the flow stays stored and storage cleanup
    // ends its grant once it expires.
    logWarn('Could not take an abandoned authorization out of reach; cleanup ends its grant', {
      err: error as Error,
      expiresAt: flow.expiresAt,
    });
    return undefined;
  });
  // Spent or discarded already: whoever took it decided its grant.
  if (!taken) return;
  await revokeAbandonedFlowGrant({ ...taken, internalState: state }, config);
}
