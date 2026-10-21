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
import { revokeGitLabToken } from '../../../src/oauth/gitlab-device-flow';
import { oauthAppFor } from '../../../src/oauth/instance-app';
import { claimSessionLease } from '../../../src/oauth/gitlab-token-refresh';
import type { OAuthConfig } from '../../../src/oauth/config';
import type { AuthCodeFlowState, OAuthSession } from '../../../src/oauth/types';

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
  },
}));
jest.mock('../../../src/oauth/gitlab-device-flow', () => ({ revokeGitLabToken: jest.fn() }));
jest.mock('../../../src/oauth/instance-app', () => ({ oauthAppFor: jest.fn() }));
jest.mock('../../../src/oauth/gitlab-token-refresh', () => ({
  withFreshGitLabToken: jest.fn(async (session: unknown) => session),
  claimSessionLease: jest.fn(),
}));
jest.mock('../../../src/logger', () => ({ logWarn: jest.fn() }));

const mockStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockRevoke = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;
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
  created_at: 0,
};
const linkFlow = {
  link: { sessionId: 'session-1', stage: 'connect', instance: 'https://gitlab.example.com' },
  selectedInstance: 'https://gitlab.example.com',
  gitlabTokens: tokens,
} as AuthCodeFlowState;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.linksAccounts.mockReturnValue(true);
  mockStore.getLinkedSessions.mockResolvedValue([]);
  mockStore.getSession.mockResolvedValue(session);
  mockStore.deleteSession.mockResolvedValue(true);
  mockStore.cleanup.mockResolvedValue(undefined);
  mockStore.storeAuthCodeFlow.mockResolvedValue(undefined);
  mockLease.mockResolvedValue(Date.now() + 15_000);
  mockAppFor.mockResolvedValue(app);
  mockRevoke.mockResolvedValue(undefined);
});

describe('startSessionStore', () => {
  // Both cleanups end grants, and the first runs at once: sessions that expired while the
  // server was stopped are not left to the periodic cleanup.
  it('registers the grant-ending cleanups and runs cleanup at once', async () => {
    await startSessionStore(config);

    expect(mockStore.initialize).toHaveBeenCalled();
    expect(mockStore.cleanup).toHaveBeenCalled();
    const onFlow = mockStore.onAbandonedFlowGrant.mock.calls[0][0];
    const onExpired = mockStore.onExpiredSession.mock.calls[0][0];

    await onFlow({ ...linkFlow, link: undefined });
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

    await expect(onFlow({ ...linkFlow, link: undefined })).rejects.toThrow('GitLab returned 502');
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
  // The flow is the grant's only copy: when the grant cannot be ended, the flow goes back
  // for storage cleanup to retry once it expires.
  it('keeps the flow for cleanup when its grant cannot be ended', async () => {
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(linkFlow);
    mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));

    await discardAuthCodeFlow('state-1', linkFlow, config);

    expect(mockStore.storeAuthCodeFlow).toHaveBeenCalledWith('state-1', linkFlow);
  });

  // Someone else took the flow first (its callback completed it, or another discard): that
  // one decided its grant, so this discard ends nothing.
  it('ends nothing when the flow was already taken', async () => {
    mockStore.consumeAuthCodeFlow.mockResolvedValueOnce(undefined);

    await discardAuthCodeFlow('state-1', linkFlow, config);

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockStore.storeAuthCodeFlow).not.toHaveBeenCalled();
  });
});
