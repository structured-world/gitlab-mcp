/**
 * GitLab token refresh of a session: one refresh token is spent once, however many
 * requests or replicas need fresh tokens at the same time.
 */

import {
  withFreshGitLabToken,
  GitLabGrantRevokedError,
} from '../../../src/oauth/gitlab-token-refresh';
import { sessionStore } from '../../../src/oauth/session-store';
import {
  refreshGitLabToken,
  revokeGitLabToken,
  GitLabOAuthHttpError,
} from '../../../src/oauth/gitlab-device-flow';
import { BODY_TIMEOUT_MS, CONNECT_TIMEOUT_MS, HEADERS_TIMEOUT_MS } from '../../../src/config';
import { oauthAppFor } from '../../../src/oauth/instance-app';
import type { OAuthConfig } from '../../../src/oauth/config';
import type { OAuthSession } from '../../../src/oauth/types';

jest.mock('../../../src/oauth/session-store', () => ({
  sessionStore: {
    updateSession: jest.fn(),
    getSession: jest.fn(),
    claimGitLabRefresh: jest.fn(),
    releaseGitLabRefresh: jest.fn(),
  },
}));
jest.mock('../../../src/oauth/gitlab-device-flow', () => ({
  refreshGitLabToken: jest.fn(),
  revokeGitLabToken: jest.fn(),
  GitLabOAuthHttpError: jest.requireActual('../../../src/oauth/gitlab-device-flow')
    .GitLabOAuthHttpError,
}));
jest.mock('../../../src/oauth/instance-app', () => ({ oauthAppFor: jest.fn() }));
jest.mock('../../../src/logger', () => ({
  logDebug: jest.fn(),
  logWarn: jest.fn(),
  truncateId: (id: string) => id,
}));

const mockStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockRefresh = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;
const mockAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const mockRevoke = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;

const config = { gitlabClientId: 'app', gitlabScopes: 'api' } as OAuthConfig;
const app = { baseUrl: 'https://gitlab.example.com', clientId: 'app', scopes: 'api' };
const expiring: OAuthSession = {
  id: 'session-1',
  mcpAccessToken: 'a',
  mcpRefreshToken: 'r',
  mcpTokenExpiry: Date.now() + 3600000,
  gitlabAccessToken: 'gl-old',
  gitlabRefreshToken: 'gl-refresh-old',
  gitlabTokenExpiry: Date.now() + 1000, // within the 5 minute buffer
  gitlabUserId: 1,
  gitlabUsername: 'u',
  clientId: 'c',
  scopes: ['mcp:tools'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const refreshed: OAuthSession = {
  ...expiring,
  gitlabAccessToken: 'gl-new',
  gitlabRefreshToken: 'gl-refresh-new',
  gitlabTokenExpiry: Date.now() + 7200000,
};
const tokens = {
  access_token: 'gl-new',
  refresh_token: 'gl-refresh-new',
  token_type: 'Bearer',
  expires_in: 7200,
  created_at: 1,
};

describe('withFreshGitLabToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppFor.mockResolvedValue(app);
    mockStore.updateSession.mockResolvedValue(true);
    mockStore.getSession.mockResolvedValue(refreshed);
    // This replica holds the refresh lease unless a test says otherwise.
    mockStore.claimGitLabRefresh.mockResolvedValue(true);
    mockStore.releaseGitLabRefresh.mockResolvedValue(undefined);
  });

  // Another replica is spending the single-use refresh token: this one must not spend it
  // too, and uses the tokens that replica stores.
  it('waits for the replica holding the refresh lease instead of spending the token', async () => {
    mockStore.claimGitLabRefresh.mockResolvedValue(false);
    mockStore.getSession.mockResolvedValueOnce(expiring).mockResolvedValue(refreshed);

    const result = await withFreshGitLabToken(expiring, config);

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result?.gitlabAccessToken).toBe('gl-new');
  });

  // A lease that cannot be released expires on its own; the refresh itself succeeded.
  it('returns the refreshed session when the lease cannot be released', async () => {
    mockRefresh.mockResolvedValue(tokens);
    mockStore.releaseGitLabRefresh.mockRejectedValue(new Error('database down'));

    const result = await withFreshGitLabToken(expiring, config);

    expect(result?.gitlabAccessToken).toBe('gl-new');
  });

  it('reports a session deleted while waiting for another replica', async () => {
    mockStore.claimGitLabRefresh.mockResolvedValue(false);
    mockStore.getSession.mockResolvedValue(undefined);

    expect(await withFreshGitLabToken(expiring, config)).toBeUndefined();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // A replica that holds the lease past its term without storing tokens is a temporary
  // failure: callers answer 503 and the account stays linked.
  it('gives up with a temporary error when the other replica never finishes', async () => {
    jest.useFakeTimers();
    try {
      mockStore.claimGitLabRefresh.mockResolvedValue(false);
      mockStore.getSession.mockResolvedValue(expiring);

      const result = withFreshGitLabToken(expiring, config);
      const settled = expect(result).rejects.toThrow(
        'GitLab token refresh on another replica did not finish',
      );
      await jest.advanceTimersByTimeAsync(300_000);
      await settled;
      await expect(result).rejects.not.toBeInstanceOf(GitLabGrantRevokedError);
      expect(mockRefresh).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('claims the lease for the presented refresh token and releases it afterwards', async () => {
    mockRefresh.mockResolvedValue(tokens);

    await withFreshGitLabToken(expiring, config);

    expect(mockStore.claimGitLabRefresh).toHaveBeenCalledWith(
      'session-1',
      'gl-refresh-old',
      expect.any(Number),
      expect.any(Number),
    );
    const [, , now, leaseUntil] = mockStore.claimGitLabRefresh.mock.calls[0];
    expect(leaseUntil).toBeGreaterThan(now);
    // Only this caller's lease is ended, named by the leaseUntil it claimed.
    expect(mockStore.releaseGitLabRefresh).toHaveBeenCalledWith('session-1', leaseUntil);
  });

  // The lease must outlast the GitLab call: another replica may claim an expired lease
  // and spend the same single-use token while this call is still in flight.
  it('holds the lease longer than a GitLab call can take', async () => {
    mockRefresh.mockResolvedValue(tokens);

    await withFreshGitLabToken(expiring, config);

    const [, , now, leaseUntil] = mockStore.claimGitLabRefresh.mock.calls[0];
    expect(leaseUntil - now).toBeGreaterThan(
      2 * CONNECT_TIMEOUT_MS + HEADERS_TIMEOUT_MS + BODY_TIMEOUT_MS,
    );
  });

  // The account was disconnected while GitLab issued new tokens: they are stored nowhere,
  // so they are revoked at GitLab instead of staying valid.
  it('revokes fresh GitLab tokens when the session was removed meanwhile', async () => {
    mockRefresh.mockResolvedValue(tokens);
    mockStore.updateSession.mockResolvedValue(false);
    mockStore.getSession.mockResolvedValue(undefined);

    expect(await withFreshGitLabToken(expiring, config)).toBeUndefined();
    expect(mockRevoke).toHaveBeenCalledWith('gl-new', config, app);
  });

  // GitLab already spent the old refresh token: if the new tokens are not stored, the
  // next refresh presents the spent one and the account is disconnected. The write is
  // retried while this replica still holds the lease, and the lease is released after it.
  it('retries storing refreshed tokens before releasing the lease', async () => {
    jest.useFakeTimers();
    try {
      mockRefresh.mockResolvedValue(tokens);
      mockStore.updateSession
        .mockRejectedValueOnce(new Error('database down'))
        .mockRejectedValueOnce(new Error('database down'))
        .mockResolvedValue(true);

      const result = withFreshGitLabToken(expiring, config);
      await jest.advanceTimersByTimeAsync(5_000);

      expect((await result)?.gitlabAccessToken).toBe('gl-new');
      expect(mockStore.updateSession).toHaveBeenCalledTimes(3);
      expect(mockStore.releaseGitLabRefresh.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockStore.updateSession.mock.invocationCallOrder[2],
      );
    } finally {
      jest.useRealTimers();
    }
  });

  // Storage that stays down for the whole lease is a temporary failure, never a revoked grant.
  it('gives up storing refreshed tokens when the lease runs out', async () => {
    jest.useFakeTimers();
    try {
      mockRefresh.mockResolvedValue(tokens);
      mockStore.updateSession.mockRejectedValue(new Error('database down'));

      const result = withFreshGitLabToken(expiring, config);
      const settled = expect(result).rejects.toThrow('database down');
      await jest.advanceTimersByTimeAsync(300_000);
      await settled;
      await expect(result).rejects.not.toBeInstanceOf(GitLabGrantRevokedError);
      expect(mockStore.updateSession.mock.calls.length).toBeGreaterThan(1);
      expect(mockStore.releaseGitLabRefresh).toHaveBeenCalledWith('session-1', expect.any(Number));
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns a session whose token is not expiring without calling GitLab', async () => {
    expect(await withFreshGitLabToken(refreshed, config)).toBe(refreshed);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('spends the refresh token once for concurrent requests of one session', async () => {
    // Parallel tool calls must not each present the single-use refresh token.
    mockRefresh.mockResolvedValue(tokens);

    const results = await Promise.all([
      withFreshGitLabToken(expiring, config),
      withFreshGitLabToken(expiring, config),
      withFreshGitLabToken(expiring, config),
    ]);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith('gl-refresh-old', config, app);
    expect(results.every((session) => session?.gitlabAccessToken === 'gl-new')).toBe(true);
  });

  it('uses the tokens another replica stored when GitLab refuses the spent token', async () => {
    mockRefresh.mockRejectedValue(
      new GitLabOAuthHttpError('Failed to refresh token: 400 invalid_grant', 400),
    );

    const result = await withFreshGitLabToken(expiring, config);

    expect(result?.gitlabAccessToken).toBe('gl-new');
    expect(mockStore.updateSession).not.toHaveBeenCalled();
  });

  it('reports a revoked grant when GitLab refuses and nobody refreshed the session', async () => {
    mockRefresh.mockRejectedValue(
      new GitLabOAuthHttpError('Failed to refresh token: 400 invalid_grant', 400),
    );
    mockStore.getSession.mockResolvedValue(expiring);

    await expect(withFreshGitLabToken(expiring, config)).rejects.toBeInstanceOf(
      GitLabGrantRevokedError,
    );
  });

  // Network errors and GitLab 5xx must not read as a revoked grant: callers answer them
  // with a retryable error and keep the account linked.
  it('passes a temporary failure through without declaring the grant revoked', async () => {
    const outage = new GitLabOAuthHttpError('Failed to refresh token: 502 Bad Gateway', 502);
    mockRefresh.mockRejectedValue(outage);
    mockStore.getSession.mockResolvedValue(expiring);

    await expect(withFreshGitLabToken(expiring, config)).rejects.toBe(outage);
  });

  it('never refreshes through another instance when the session instance is gone', async () => {
    mockAppFor.mockResolvedValue(undefined);
    mockStore.getSession.mockResolvedValue(expiring);

    const failure = withFreshGitLabToken(expiring, config);
    await expect(failure).rejects.toBeInstanceOf(GitLabGrantRevokedError);
    await expect(failure).rejects.toThrow('GitLab instance is no longer configured');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('reports a session deleted during the refresh', async () => {
    mockRefresh.mockResolvedValue(tokens);
    mockStore.getSession.mockResolvedValue(undefined);

    expect(await withFreshGitLabToken(expiring, config)).toBeUndefined();
  });
});
