/**
 * Account profile: identity from validated credentials, a stable opaque id, and no
 * invented display values.
 */

import { accountProfileId, getAccountProfile } from '../../../../src/entities/context/profile';
import { runWithTokenContext } from '../../../../src/oauth/token-context';
import type { TokenContext } from '../../../../src/oauth/types';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

jest.mock('../../../../src/config', () => ({
  ...jest.requireActual('../../../../src/config'),
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

import { enhancedFetch } from '../../../../src/utils/fetch';
const mockFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

const account: TokenContext = {
  gitlabToken: 'fixture-only',
  gitlabUserId: 42,
  gitlabUsername: 'jane',
  sessionId: 'session',
  apiUrl: 'https://git.corp.example/gitlab',
  instanceLabel: 'Corp',
};

function userResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 401, json: async () => body } as Response;
}

describe('account profile', () => {
  beforeEach(() => mockFetch.mockReset());

  describe('accountProfileId', () => {
    it('is stable for equivalent instance URLs', () => {
      expect(accountProfileId('https://git.corp.example/gitlab/', 42)).toBe(
        accountProfileId('https://git.corp.example/gitlab/api/v4', 42),
      );
    });

    it('distinguishes equal user ids on different instances', () => {
      expect(accountProfileId('https://a.example.com', 42)).not.toBe(
        accountProfileId('https://b.example.com', 42),
      );
    });

    it('is opaque', () => {
      const id = accountProfileId('https://git.corp.example/gitlab', 42);
      expect(id).toMatch(/^gitlab:[A-Za-z0-9_-]{43}$/);
      expect(id).not.toContain('42');
      expect(id).not.toContain('corp');
    });
  });

  it('resolves the linked account with the values GitLab provides', async () => {
    mockFetch.mockResolvedValue(
      userResponse({ id: 42, username: 'jane', name: 'Jane Doe', email: 'jane@example.com' }),
    );

    const profile = await runWithTokenContext(account, () => getAccountProfile());

    expect(mockFetch).toHaveBeenCalledWith('https://git.corp.example/gitlab/api/v4/user', {
      retry: false,
    });
    expect(profile).toEqual({
      id: accountProfileId('https://git.corp.example/gitlab', 42),
      name: 'Jane Doe',
      email: 'jane@example.com',
      nickname: 'jane @ Corp',
    });
  });

  it('keeps the same id across token refresh and reconnect', async () => {
    mockFetch.mockResolvedValue(userResponse({ id: 42, username: 'jane' }));
    const first = await runWithTokenContext(account, () => getAccountProfile());
    const second = await runWithTokenContext(
      { ...account, gitlabToken: 'rotated', sessionId: 'reconnected' },
      () => getAccountProfile(),
    );
    expect(second.id).toBe(first.id);
  });

  it('omits display values GitLab does not provide', async () => {
    // The linked identity is still known when GitLab returns no user body.
    mockFetch.mockResolvedValue(userResponse({}, false));

    const profile = await runWithTokenContext({ ...account, instanceLabel: undefined }, () =>
      getAccountProfile(),
    );

    expect(profile).toEqual({
      id: accountProfileId('https://git.corp.example/gitlab', 42),
      nickname: 'jane @ git.corp.example',
    });
  });

  it('identifies a static-token connection from GitLab', async () => {
    mockFetch.mockResolvedValue(userResponse({ id: 7, username: 'bot', public_email: 'b@x.io' }));

    const profile = await getAccountProfile();

    expect(profile).toEqual({
      id: accountProfileId('https://gitlab.example.com', 7),
      email: 'b@x.io',
      nickname: 'bot @ gitlab.example.com',
    });
  });

  it('keeps the linked identity when GitLab throws a non-Error value', async () => {
    mockFetch.mockRejectedValue('socket hang up');

    const profile = await runWithTokenContext(account, () => getAccountProfile());

    expect(profile.nickname).toBe('jane @ Corp');
  });

  // The nickname shows the configured URL as written when it has no parseable host.
  it('names an instance by its URL when no host can be read', async () => {
    mockFetch.mockResolvedValue(userResponse({}, false));

    const profile = await runWithTokenContext(
      { ...account, apiUrl: 'gitlab-internal', instanceLabel: undefined },
      () => getAccountProfile(),
    );

    expect(profile.nickname).toMatch(/^jane @ gitlab-internal/);
  });

  it('fails when no account can be identified', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));
    await expect(getAccountProfile()).rejects.toThrow(
      'GitLab did not identify the account for this connection',
    );
  });
});
