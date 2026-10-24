/**
 * Exchange of the single-use authorization code GitLab sends to the callback.
 */

import type { OAuthConfig } from './config';
import type { GitLabOAuthApp } from './oauth-app';
import type { AuthCodeFlowState, GitLabTokenResponse } from './types';
import { sessionStore } from './session-store';
import { keepIssuedTokens } from './issued-tokens';
import { exchangeGitLabAuthCode } from './gitlab-device-flow';

/** A late or competing grant is retained for cleanup, never used for another callback. */
export class AccountLinkFlowUnavailableError extends Error {
  constructor() {
    super('The account-link flow is no longer available for this grant');
  }
}

/**
 * Exchange GitLab's single-use code and keep the tokens with the flow before anything
 * else can fail. When a concurrent callback already spent the code, its stored tokens are
 * used instead.
 */
export async function exchangeFlowCode(
  state: string,
  flow: AuthCodeFlowState,
  code: string,
  config: OAuthConfig,
  app: GitLabOAuthApp,
): Promise<GitLabTokenResponse> {
  let tokens: GitLabTokenResponse;
  try {
    tokens = await exchangeGitLabAuthCode(code, flow.callbackUri, config, app);
  } catch (error: unknown) {
    const current = await sessionStore.getAuthCodeFlow(state);
    if (current?.gitlabTokens) return current.gitlabTokens;
    throw error;
  }
  if (flow.link) {
    let active: boolean | undefined;
    await keepIssuedTokens(async () => {
      active = await sessionStore.cacheLinkedFlowTokens(flow, tokens);
    });
    if (active === false) throw new AccountLinkFlowUnavailableError();
  } else {
    await keepIssuedTokens(() =>
      sessionStore.storeAuthCodeFlow(state, { ...flow, gitlabTokens: tokens }),
    );
  }
  return tokens;
}
