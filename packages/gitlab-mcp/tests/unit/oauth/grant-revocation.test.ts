/**
 * Ending the GitLab grants of sessions and flows that are removed: the store's cleanups,
 * a removal on a store without linked accounts, and abandoned flows.
 */

import {
  discardAuthCodeFlow,
  endSession,
  revokeAbandonedFlowGrant,
  startSessionStore,
} from '../../../src/oauth/grant-revocation';
import { sessionStore } from '../../../src/oauth/session-store';
import { refreshGitLabToken, revokeGitLabToken } from '../../../src/oauth/gitlab-device-flow';
import { oauthAppFor } from '../../../src/oauth/instance-app';
import { claimSessionLease } from '../../../src/oauth/gitlab-token-refresh';
import { logWarn } from '../../../src/logger';
import type { OAuthConfig } from '../../../src/oauth/config';
import type {
  AuthCodeFlowState,
  GitLabTokenResponse,
  OAuthSession,
} from '../../../src/oauth/types';

jest.mock('../../../src/oauth/session-store', () => ({
  sessionStore: {
    initialize: jest.fn(),
    onAbandonedFlowGrant: jest.fn(),
    onExpiredSession: jest.fn(),
    cleanup: jest.fn(),
    linksAccounts: jest.fn(),
    getLinkedSessions: jest.fn(),
    getSession: jest.fn(),
    deleteSession: jest.fn(),
    releaseGitLabRefresh: jest.fn(),
    consumeAuthCodeFlow: jest.fn(),
    storeAuthCodeFlow: jest.fn(),
    deleteAuthCodeFlow: jest.fn(),
  },
}));
jest.mock('../../../src/oauth/gitlab-device-flow', () => ({
  revokeGitLabToken: jest.fn(),
  refreshGitLabToken: jest.fn(),
}));
jest.mock('../../../src/oauth/instance-app', () => ({ oauthAppFor: jest.fn() }));
jest.mock('../../../src/oauth/gitlab-token-refresh', () => ({
  withFreshGitLabToken: jest.fn(async (session: unknown) => session),
  claimSessionLease: jest.fn(),
}));
jest.mock('../../../src/logger', () => ({ logWarn: jest.fn() }));

const mockStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockRevoke = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;
const mockRefresh = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;
const mockAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const mockLease = claimSessionLease as jest.MockedFunction<typeof claimSessionLease>;

const config = { issuer: 'https://mcp.example.com' } as OAuthConfig;
const app = { baseUrl: 'https://gitlab.example.com', clientId: 'app', scopes: 'api' };
const session: OAuthSession = {
  id: 'session-1',
  mcpAccessToken: 'mcp-access',
  mcpRefreshToken: 'mcp-refresh',
  mcpTokenExpiry: Date.now() + 3_600_000,
  gitlabAccessToken: 'gl-access',
  gitlabRefreshToken: 'gl-refresh',
  gitlabTokenExpiry: Date.now() + 7_200_000,
  gitlabUserId: 1,
  gitlabUsername: 'alice',
  gitlabApiUrl: 'https://gitlab.example.com',
  clientId: 'client',
  scopes: ['mcp:tools'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const tokens = {
  access_token: 'cached-access',
  refresh_token: 'cached-refresh',
  token_type: 'Bearer',
  expires_in: 7200,
  created_at: Math.floor(Date.now() / 1000),
};
const linkFlow = {
  internalState: 'state-1',
  expiresAt: Date.now() + 600_000,
  link: { sessionId: 'session-1', stage: 'connect', instance: 'https://gitlab.example.com' },
  selectedInstance: 'https://gitlab.example.com',
  gitlabTokens: tokens,
} as AuthCodeFlowState;

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockReset();
  mockStore.linksAccounts.mockReturnValue(true);
  mockStore.getLinkedSessions.mockResolvedValue([]);
  mockStore.getSession.mockResolvedValue(session);
  mockStore.deleteSession.mockResolvedValue(true);
  mockStore.cleanup.mockResolvedValue(undefined);
  mockStore.storeAuthCodeFlow.mockResolvedValue(undefined);
  mockStore.deleteAuthCodeFlow.mockResolvedValue(true);
  mockStore.releaseGitLabRefresh.mockResolvedValue(undefined);
  mockLease.mockResolvedValue(Date.now() + 15_000);
  mockAppFor.mockResolvedValue(app);
  mockRevoke.mockResolvedValue(undefined);
});

describe('startSessionStore', () => {
  it.each([true, false])(
    'rejects an expired cleanup lease before upstream work (expired token: %s)',
    async (expired) => {
      // A replica can pause on a storage read past its lease. It must not refresh or
      // revoke after another replica can claim that flow, even when its snapshot is live.
      await startSessionStore(config);
      const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
      const flow = {
        ...linkFlow,
        link: undefined,
        gitlabTokens: { ...tokens, created_at: expired ? 0 : Math.floor(Date.now() / 1000) },
      };
      const persist = jest.fn();

      await expect(onFlow(flow, persist, Date.now() - 1)).rejects.toThrow('insufficient time');

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(mockRevoke).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    },
  );

  // A successful revoke of an expired access token can leave its refresh token live.
  // Cleanup must durably rotate the cached grant before revoking its live access token.
  it('persists refreshed abandoned-flow credentials before revoking them', async () => {
    await startSessionStore(config);
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    const expired = {
      ...linkFlow,
      link: undefined,
      gitlabTokens: { ...tokens, created_at: 0 },
    };
    const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
    mockRefresh.mockResolvedValueOnce(fresh);
    const persist = jest.fn(async (_tokens: GitLabTokenResponse) => {});

    const leaseMs = mockStore.onAbandonedFlowGrant.mock.calls[0][1];
    await onFlow(expired, persist, Date.now() + leaseMs);

    expect(mockRefresh).toHaveBeenCalledWith('cached-refresh', config, app);
    expect(persist).toHaveBeenCalledWith(fresh);
    expect(mockRevoke).toHaveBeenCalledWith('fresh-access', config, app);
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      mockRevoke.mock.invocationCallOrder[0],
    );
  });

  // A temporary refresh failure must reach storage: deleting the flow would lose the
  // grant's only credentials even though GitLab has not revoked them.
  it('retains an expired abandoned grant when refresh is unavailable', async () => {
    await startSessionStore(config);
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    const expired = { ...linkFlow, link: undefined, gitlabTokens: { ...tokens, created_at: 0 } };
    mockRefresh.mockRejectedValueOnce(new Error('GitLab refresh unavailable'));

    await expect(onFlow(expired, jest.fn())).rejects.toThrow('GitLab refresh unavailable');
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  // Once GitLab rotates a refresh token, a retry must use the persisted replacement,
  // never spend the old refresh token again after revocation fails.
  it('retries failed revocation with the refreshed cached credentials', async () => {
    await startSessionStore(config);
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    const expired = { ...linkFlow, link: undefined, gitlabTokens: { ...tokens, created_at: 0 } };
    const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
    mockRefresh.mockResolvedValueOnce(fresh);
    mockRevoke.mockRejectedValueOnce(new Error('GitLab revoke unavailable'));
    const persist = jest.fn(async (updated: GitLabTokenResponse) => {
      expired.gitlabTokens = updated;
    });

    await expect(onFlow(expired, persist)).rejects.toThrow('GitLab revoke unavailable');
    await onFlow(expired, persist);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenNthCalledWith(1, 'fresh-access', config, app);
    expect(mockRevoke).toHaveBeenNthCalledWith(2, 'fresh-access', config, app);
  });

  it('retries a temporary write failure without spending the refresh token twice', async () => {
    // GitLab has already rotated the token: retry only the durable write, then revoke.
    jest.useFakeTimers();
    try {
      await startSessionStore(config);
      const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
      const expired = { ...linkFlow, link: undefined, gitlabTokens: { ...tokens, created_at: 0 } };
      const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
      mockRefresh.mockResolvedValueOnce(fresh);
      const persist = jest
        .fn()
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockResolvedValue(undefined);
      const result = expect(onFlow(expired, persist)).resolves.toBeUndefined();

      await jest.advanceTimersByTimeAsync(200);
      await result;

      expect(persist).toHaveBeenCalledTimes(2);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith('fresh-access', config, app);
      expect(persist.mock.invocationCallOrder[1]).toBeLessThan(
        mockRevoke.mock.invocationCallOrder[0],
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('ends the rotated grant if storage stays unavailable through its write budget', async () => {
    // Once the write budget is exhausted, successful revocation is the only safe way
    // to finish without leaving an untracked replacement refresh token authorized.
    jest.useFakeTimers();
    try {
      await startSessionStore(config);
      const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
      const expired = { ...linkFlow, link: undefined, gitlabTokens: { ...tokens, created_at: 0 } };
      const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
      mockRefresh.mockResolvedValueOnce(fresh);
      const persist = jest.fn().mockRejectedValue(new Error('storage unavailable'));
      const result = expect(onFlow(expired, persist)).resolves.toBeUndefined();

      await jest.advanceTimersByTimeAsync(15_000);
      await result;

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(persist.mock.calls.length).toBeGreaterThan(1);
      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith('fresh-access', config, app);
    } finally {
      jest.useRealTimers();
    }
  });

  // Both cleanups end grants, and the first runs at once: sessions that expired while the
  // server was stopped are not left to the periodic cleanup.
  it('registers the grant-ending cleanups and runs cleanup at once', async () => {
    await startSessionStore(config);

    expect(mockStore.initialize).toHaveBeenCalled();
    expect(mockStore.cleanup).toHaveBeenCalled();
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    const onExpired = mockStore.onExpiredSession.mock.calls[0][0];

    await onFlow({ ...linkFlow, link: undefined }, jest.fn());
    expect(mockRevoke).toHaveBeenCalledWith('cached-access', config, app);
    await onExpired(session);
    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(mockRevoke).toHaveBeenCalledWith('gl-access', config, app);
  });

  // Cleanup keeps a flow whose grant could not be ended, so its handler reports the failure
  // instead of swallowing it.
  it('reports a grant of an abandoned flow that could not be ended to cleanup', async () => {
    await startSessionStore(config);
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));

    await expect(onFlow({ ...linkFlow, link: undefined }, jest.fn())).rejects.toThrow(
      'GitLab returned 502',
    );
    // The best-effort variant, for flows already spent, keeps going.
    mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));
    await expect(
      revokeAbandonedFlowGrant({ ...linkFlow, link: undefined }, config),
    ).resolves.toBeUndefined();
  });

  it('keeps starting when the startup cleanup fails', async () => {
    mockStore.cleanup.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(startSessionStore(config)).resolves.toBeUndefined();
  });
});

describe('endSession', () => {
  // A database package older than the server keeps no linked accounts: only the session's
  // own grant ends.
  it('ends only the session grant on a store without linked accounts', async () => {
    mockStore.linksAccounts.mockReturnValue(false);

    await endSession(session, config);

    expect(mockStore.getLinkedSessions).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith('gl-access', config, app);
  });

  // Removed by someone else before the lease was taken: nothing to delete, the grants
  // known still end.
  it('ends the known grants of a session removed meanwhile without deleting it', async () => {
    mockLease.mockResolvedValueOnce(undefined);

    await endSession(session, config);

    expect(mockStore.deleteSession).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledWith('gl-access', config, app);
  });
});

describe('revokeAbandonedFlowGrant', () => {
  it('removes the recovery record only after revoking its refreshed grant', async () => {
    // A flow already consumed by an error callback still needs durable rotated
    // credentials until GitLab has actually accepted revocation.
    const expired = { ...linkFlow, link: undefined, gitlabTokens: { ...tokens, created_at: 0 } };
    const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
    mockRefresh.mockResolvedValueOnce(fresh);

    await revokeAbandonedFlowGrant(expired, config);

    expect(mockStore.storeAuthCodeFlow).toHaveBeenCalledWith('state-1', {
      ...expired,
      expiresAt: expect.any(Number),
      gitlabTokens: fresh,
    });
    expect(mockStore.storeAuthCodeFlow.mock.calls[0][1].expiresAt).toBeLessThan(Date.now());
    expect(mockStore.storeAuthCodeFlow.mock.invocationCallOrder[0]).toBeLessThan(
      mockRevoke.mock.invocationCallOrder[0],
    );
    expect(mockRevoke).toHaveBeenCalledWith('fresh-access', config, app);
    expect(mockStore.deleteAuthCodeFlow).toHaveBeenCalledWith('state-1');
    expect(mockRevoke.mock.invocationCallOrder[0]).toBeLessThan(
      mockStore.deleteAuthCodeFlow.mock.invocationCallOrder[0],
    );
  });

  // A linked account is matched by either token of the grant, so a grant it stores is kept
  // even when only the refresh token is compared equal.
  it('keeps a grant a linked account stores under the same refresh token', async () => {
    mockStore.getLinkedSessions.mockResolvedValueOnce([
      {
        ...session,
        id: 'linked',
        gitlabAccessToken: 'other',
        gitlabRefreshToken: 'cached-refresh',
      },
    ]);

    await revokeAbandonedFlowGrant(linkFlow, config);

    expect(mockRevoke).not.toHaveBeenCalled();
  });

  // The flow's instance is no longer configured: there is no application to revoke with.
  it('skips a flow whose instance is no longer configured', async () => {
    mockAppFor.mockResolvedValueOnce(undefined);

    await revokeAbandonedFlowGrant({ ...linkFlow, link: undefined }, config);

    expect(mockRevoke).not.toHaveBeenCalled();
  });

  // The link's session is gone, and its linked accounts with it: nothing holds the grant.
  it('ends the grant of a link flow whose session is gone', async () => {
    mockLease.mockResolvedValueOnce(undefined);

    await revokeAbandonedFlowGrant(linkFlow, config);

    expect(mockStore.getLinkedSessions).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledWith('cached-access', config, app);
  });
});

describe('discardAuthCodeFlow', () => {
  it('retains refreshed credentials after a failed discard and ends them on retry', async () => {
    // A stale browser callback can discard a flow after a long outage too. Its
    // recovery copy must contain the rotated pair and remain unusable as a callback.
    const expired = { ...linkFlow, gitlabTokens: { ...tokens, created_at: 0 } };
    const fresh = { ...tokens, access_token: 'fresh-access', refresh_token: 'fresh-refresh' };
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(expired);
    mockRefresh.mockResolvedValueOnce(fresh);
    mockRevoke.mockRejectedValueOnce(new Error('GitLab revoke unavailable'));

    await discardAuthCodeFlow('state-1', expired, config);

    const recovery = mockStore.storeAuthCodeFlow.mock.calls.at(-1)![1];
    expect(recovery.gitlabTokens).toEqual(fresh);
    expect(recovery.expiresAt).toBeLessThan(Date.now());
    expect(mockStore.storeAuthCodeFlow.mock.invocationCallOrder[0]).toBeLessThan(
      mockRevoke.mock.invocationCallOrder[0],
    );
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(recovery);
    await discardAuthCodeFlow('state-1', recovery, config);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenNthCalledWith(2, 'fresh-access', config, app);
  });

  // The flow is the grant's only copy: when the grant cannot be ended, the flow goes back
  // for storage cleanup to retry once it expires.
  it('keeps the flow for cleanup when its grant cannot be ended', async () => {
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(linkFlow);
    mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));

    await discardAuthCodeFlow('state-1', linkFlow, config);

    expect(mockStore.storeAuthCodeFlow).toHaveBeenCalledWith('state-1', {
      ...linkFlow,
      expiresAt: expect.any(Number),
    });
    expect(mockStore.storeAuthCodeFlow.mock.calls[0][1].expiresAt).toBeLessThan(Date.now());
  });

  // Someone else took the flow first (its callback completed it, or another discard): that
  // one decided its grant, so this discard ends nothing.
  it('ends nothing when the flow was already taken', async () => {
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(undefined);

    await discardAuthCodeFlow('state-1', linkFlow, config);

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockStore.storeAuthCodeFlow).not.toHaveBeenCalled();
  });

  // A storage failure leaves the flow stored, so its grant is not this discard's to end:
  // it is left to cleanup, and the delay is logged.
  it('leaves the grant to cleanup and says so when the flow cannot be taken', async () => {
    mockStore.consumeAuthCodeFlow.mockRejectedValueOnce(new Error('disk full'));

    await discardAuthCodeFlow('state-1', linkFlow, config);

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockStore.storeAuthCodeFlow).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('cleanup ends its grant'),
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });
});
