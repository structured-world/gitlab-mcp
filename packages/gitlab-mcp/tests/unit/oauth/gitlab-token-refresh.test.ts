/**
 * GitLab token refresh of a session: one refresh token is spent once, however many
 * requests or replicas need fresh tokens at the same time.
 */

import { withFreshGitLabToken } from '../../../src/oauth/gitlab-token-refresh';
import { sessionStore } from '../../../src/oauth/session-store';
import { refreshGitLabToken } from '../../../src/oauth/gitlab-device-flow';
import { oauthAppFor } from '../../../src/oauth/instance-app';
import type { OAuthConfig } from '../../../src/oauth/config';
import type { OAuthSession } from '../../../src/oauth/types';

jest.mock('../../../src/oauth/session-store', () => ({
  sessionStore: { updateSession: jest.fn(), getSession: jest.fn() },
}));
jest.mock('../../../src/oauth/gitlab-device-flow', () => ({ refreshGitLabToken: jest.fn() }));
jest.mock('../../../src/oauth/instance-app', () => ({ oauthAppFor: jest.fn() }));
jest.mock('../../../src/logger', () => ({
  logDebug: jest.fn(),
  truncateId: (id: string) => id,
}));

const mockStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockRefresh = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;
const mockAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;

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
    mockRefresh.mockRejectedValue(new Error('Failed to refresh token: 400 invalid_grant'));

    const result = await withFreshGitLabToken(expiring, config);

    expect(result?.gitlabAccessToken).toBe('gl-new');
    expect(mockStore.updateSession).not.toHaveBeenCalled();
  });

  it('fails when GitLab refuses and nobody refreshed the session', async () => {
    mockRefresh.mockRejectedValue(new Error('Failed to refresh token: 400 invalid_grant'));
    mockStore.getSession.mockResolvedValue(expiring);

    await expect(withFreshGitLabToken(expiring, config)).rejects.toThrow('invalid_grant');
  });

  it('never refreshes through another instance when the session instance is gone', async () => {
    mockAppFor.mockResolvedValue(undefined);
    mockStore.getSession.mockResolvedValue(expiring);

    await expect(withFreshGitLabToken(expiring, config)).rejects.toThrow(
      'GitLab instance is no longer configured',
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('reports a session deleted during the refresh', async () => {
    mockRefresh.mockResolvedValue(tokens);
    mockStore.getSession.mockResolvedValue(undefined);

    expect(await withFreshGitLabToken(expiring, config)).toBeUndefined();
  });
});
