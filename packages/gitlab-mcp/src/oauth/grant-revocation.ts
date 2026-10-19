/**
 * Ending the GitLab grant of a session that is being removed: revoking the session in
 * this server stops MCP access, revoking the grant stops GitLab access too.
 */

import type { OAuthConfig } from './config';
import { oauthAppFor } from './instance-app';
import { revokeGitLabToken } from './gitlab-device-flow';
import { withFreshGitLabToken } from './gitlab-token-refresh';
import { sessionStore } from './session-store';
import type { AuthCodeFlowState, OAuthSession } from './types';
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

/**
 * End the grant an authorization flow cached after exchanging GitLab's code, when the flow
 * is discarded unfinished: nothing else holds those tokens. Best effort.
 */
export async function revokeAbandonedFlowGrant(
  flow: AuthCodeFlowState,
  config: OAuthConfig,
): Promise<void> {
  if (!flow.gitlabTokens) return;
  try {
    const app = await oauthAppFor(config, flow.selectedInstance);
    if (app) await revokeGitLabToken(flow.gitlabTokens.access_token, config, app);
  } catch (error: unknown) {
    logWarn('Failed to revoke the GitLab grant of an abandoned authorization', {
      err: error as Error,
    });
  }
}

/**
 * Discard an authorization flow that will not finish, ending the grant it cached. A failed
 * removal is left to storage cleanup, which ends the grant too (revocation is idempotent).
 */
export async function discardAuthCodeFlow(
  state: string,
  flow: AuthCodeFlowState,
  config: OAuthConfig,
): Promise<void> {
  await revokeAbandonedFlowGrant(flow, config);
  await sessionStore.deleteAuthCodeFlow(state).catch(() => false);
}
