import { exchangeFlowCode } from '../../../src/oauth/code-exchange';
import { exchangeGitLabAuthCode } from '../../../src/oauth/gitlab-device-flow';
import { sessionStore } from '../../../src/oauth/session-store';
import type { OAuthConfig } from '../../../src/oauth/config';
import type { GitLabOAuthApp } from '../../../src/oauth/oauth-app';
import type { AuthCodeFlowState, GitLabTokenResponse } from '../../../src/oauth/types';

let mockAfterWrite: () => Promise<void>;

jest.mock('../../../src/oauth/gitlab-device-flow', () => ({ exchangeGitLabAuthCode: jest.fn() }));
jest.mock('../../../src/oauth/issued-tokens', () => {
  const actual = jest.requireActual('../../../src/oauth/issued-tokens');
  return {
    keepIssuedTokens: (write: () => Promise<void>) =>
      actual.keepIssuedTokens(async () => {
        await write();
        await mockAfterWrite();
      }),
  };
});

describe('authorization-code token caching', () => {
  const tokens: GitLabTokenResponse = {
    access_token: 'issued-access',
    refresh_token: 'issued-refresh',
    token_type: 'Bearer',
    created_at: Math.floor(Date.now() / 1000),
    expires_in: 7200,
  };
  let flow: AuthCodeFlowState;

  beforeEach(async () => {
    sessionStore.clear();
    jest.clearAllMocks();
    mockAfterWrite = async () => undefined;
    flow = {
      internalState: 'callback-state',
      clientId: 'client',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      clientState: 'state',
      clientRedirectUri: 'https://client.example/callback',
      callbackUri: 'https://mcp.example/callback',
      expiresAt: Date.now() + 600_000,
      link: { stage: 'connect', sessionId: 'primary', instance: 'https://gitlab.example' },
    };
    await sessionStore.storeAuthCodeFlow(flow.internalState, flow);
    jest.mocked(exchangeGitLabAuthCode).mockResolvedValue(tokens);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['connect', 'verify'] as const)(
    'does not resurrect a spent %s flow after a lost write acknowledgement',
    async (stage) => {
      // The first write commits, another callback consumes it, then the acknowledgement
      // is lost. Retrying must retain cleanup credentials without enabling another callback.
      flow.link!.stage = stage;
      let first = true;
      mockAfterWrite = async () => {
        if (!first) return;
        first = false;
        await sessionStore.consumeAuthCodeFlow(flow.internalState);
        throw new Error('Write committed but acknowledgement was lost');
      };
      await expect(
        exchangeFlowCode(flow.internalState, flow, 'code', {} as OAuthConfig, {} as GitLabOAuthApp),
      ).rejects.toThrow('no longer available');
      expect(await sessionStore.getAuthCodeFlow(flow.internalState)).toBeUndefined();
      const cleanup = jest.fn().mockResolvedValue(undefined);
      sessionStore.onAbandonedFlowGrant(cleanup, 30_000);
      await sessionStore.cleanup();
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ gitlabTokens: tokens }),
        expect.any(Function),
      );
    },
  );

  it('keeps the ordinary OAuth cache retry unchanged', async () => {
    // Ordinary sign-in retains its existing token handoff and does not use link-only storage.
    delete flow.link;
    let first = true;
    mockAfterWrite = async () => {
      if (!first) return;
      first = false;
      throw new Error('Write acknowledgement was lost');
    };
    await expect(
      exchangeFlowCode(flow.internalState, flow, 'code', {} as OAuthConfig, {} as GitLabOAuthApp),
    ).resolves.toEqual(tokens);
    expect((await sessionStore.getAuthCodeFlow(flow.internalState))?.gitlabTokens).toEqual(tokens);
  });

  it('hands tokens to atomic completion when every cache write fails', async () => {
    // If storage recovers for the final commit, it can still store the single-use grant in hand.
    jest
      .spyOn(sessionStore, 'cacheLinkedFlowTokens')
      .mockRejectedValue(new Error('storage unavailable'));
    await expect(
      exchangeFlowCode(flow.internalState, flow, 'code', {} as OAuthConfig, {} as GitLabOAuthApp),
    ).resolves.toEqual(tokens);
    expect(sessionStore.cacheLinkedFlowTokens).toHaveBeenCalledTimes(4);
    expect((await sessionStore.getAuthCodeFlow(flow.internalState))?.gitlabTokens).toBeUndefined();
  });
});
