/**
 * Exchange of the single-use authorization code GitLab sends to the callback.
 */

import type { OAuthConfig } from './config';
import type { GitLabOAuthApp } from './oauth-app';
import type { AuthCodeFlowState, GitLabTokenResponse } from './types';
import { sessionStore } from './session-store';
import { keepIssuedTokens } from './issued-tokens';
import { exchangeGitLabAuthCode } from './gitlab-device-flow';

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
  await keepIssuedTokens(() =>
    sessionStore.storeAuthCodeFlow(state, { ...flow, gitlabTokens: tokens }),
  );
  return tokens;
}
