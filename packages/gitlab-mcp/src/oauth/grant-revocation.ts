/**
 * Ending the GitLab grant of a session that is being removed: revoking the session in
 * this server stops MCP access, revoking the grant stops GitLab access too.
 */

import type { OAuthConfig } from './config';
import { oauthAppFor } from './instance-app';
import { revokeGitLabToken } from './gitlab-device-flow';
import { withFreshGitLabToken } from './gitlab-token-refresh';
import type { OAuthSession } from './types';
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
