/**
 * Linking another GitLab account to a signed-in session. The browser first proves it
 * belongs to the session's own user, then signs in with the account to link; a link opened
 * by someone else, reused, expired or completed twice links nothing.
 */

let mockOAuth = true;
jest.mock('../../../src/oauth/config', () => ({
  isOAuthEnabled: () => mockOAuth,
  loadOAuthConfig: () => (mockOAuth ? { issuer: 'https://mcp.example.com' } : null),
}));

jest.mock('../../../src/config', () => ({ GITLAB_BASE_URL: 'https://git.corp.example.com' }));

jest.mock('../../../src/oauth/session-store', () => {
  const { SessionStore } = jest.requireActual('../../../src/oauth/session-store');
  const { MemoryStorageBackend } = jest.requireActual('../../../src/oauth/storage/memory');
  return { sessionStore: new SessionStore(new MemoryStorageBackend({ silent: true })) };
});

const corpApp = {
  baseUrl: 'https://git.corp.example.com',
  label: 'Corporate GitLab',
  clientId: 'corp-app',
  scopes: 'api read_user',
};
const comApp = {
  baseUrl: 'https://gitlab.com',
  label: 'GitLab.com',
  clientId: 'com-app',
  scopes: 'api',
};
jest.mock('../../../src/oauth/instance-app', () => ({
  oauthAppFor: jest.fn(async (_config: unknown, url?: string) =>
    url === undefined || url === 'https://git.corp.example.com'
      ? corpApp
      : url === 'https://gitlab.com'
        ? comApp
        : undefined,
  ),
  selectableOAuthApps: jest.fn(async () => [corpApp, comApp]),
}));

jest.mock('../../../src/oauth/gitlab-device-flow', () => ({
  buildGitLabAuthUrl: jest.fn(
    (_config: unknown, _redirect: string, state: string, app: { baseUrl: string }) =>
      `${app.baseUrl}/oauth/authorize?state=${state}`,
  ),
  getGitLabUser: jest.fn(),
  revokeGitLabToken: jest.fn(),
}));

jest.mock('../../../src/oauth/code-exchange', () => ({ exchangeFlowCode: jest.fn() }));

import type { Response } from 'express';
import { completeAccountLink, startAccountLink } from '../../../src/accounts/link';
import { sessionStore } from '../../../src/oauth/session-store';
import { runWithTokenContext } from '../../../src/oauth/token-context';
import { getGitLabUser, revokeGitLabToken } from '../../../src/oauth/gitlab-device-flow';
import { exchangeFlowCode } from '../../../src/oauth/code-exchange';
import type { OAuthConfig } from '../../../src/oauth/config';
import type {
  AuthCodeFlowState,
  GitLabTokenResponse,
  OAuthSession,
} from '../../../src/oauth/types';

const mockUser = getGitLabUser as jest.MockedFunction<typeof getGitLabUser>;
const mockRevoke = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;
const mockExchange = exchangeFlowCode as jest.MockedFunction<typeof exchangeFlowCode>;
const config = { issuer: 'https://mcp.example.com' } as OAuthConfig;

const primary: OAuthSession = {
  id: 'primary',
  mcpAccessToken: 'mcp-access',
  mcpRefreshToken: 'mcp-refresh',
  mcpTokenExpiry: Date.now() + 3600_000,
  gitlabAccessToken: 'corp-gitlab',
  gitlabRefreshToken: 'corp-refresh',
  gitlabTokenExpiry: Date.now() + 3600_000,
  gitlabUserId: 7,
  gitlabUsername: 'alice',
  gitlabApiUrl: 'https://git.corp.example.com',
  clientId: 'client',
  scopes: ['mcp:tools'],
  createdAt: 1000,
  updatedAt: 1000,
};

function tokens(access: string): GitLabTokenResponse {
  return {
    access_token: access,
    refresh_token: `${access}-refresh`,
    token_type: 'Bearer',
    expires_in: 7200,
    created_at: 0,
    scope: 'api',
  };
}

function response() {
  const res = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & typeof res;
}

/** The state carried by a GitLab sign-in URL the link built. */
function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') as string;
}

async function storedFlow(state: string): Promise<AuthCodeFlowState> {
  return (await sessionStore.getAuthCodeFlow(state)) as AuthCodeFlowState;
}

function startAsAlice(instance?: string) {
  return runWithTokenContext(
    {
      gitlabToken: 'corp-gitlab',
      gitlabUserId: 7,
      gitlabUsername: 'alice',
      sessionId: 'primary',
      apiUrl: 'https://git.corp.example.com',
    },
    () => startAccountLink(instance),
  ) as ReturnType<typeof startAccountLink>;
}

describe('account linking', () => {
  beforeEach(async () => {
    mockOAuth = true;
    sessionStore.clear();
    jest.clearAllMocks();
    await sessionStore.createSession(primary);
  });

  describe('start', () => {
    it("starts with the sign-in of the session's own account, bound to the session", async () => {
      const link = await startAsAlice('https://gitlab.com');

      expect(link.url.startsWith('https://git.corp.example.com/oauth/authorize')).toBe(true);
      expect(link).toMatchObject({
        instanceUrl: 'https://gitlab.com',
        instanceLabel: 'GitLab.com',
      });
      const flow = await storedFlow(stateOf(link.url));
      expect(flow.link).toEqual({
        sessionId: 'primary',
        stage: 'verify',
        instance: 'https://gitlab.com',
        instanceLabel: 'GitLab.com',
      });
      expect(flow.selectedInstance).toBe('https://git.corp.example.com');
      expect(flow.expiresAt).toBeGreaterThan(Date.now());
    });

    it("links another account on the session's own instance by default", async () => {
      const link = await startAsAlice();

      expect((await storedFlow(stateOf(link.url))).link?.instance).toBe(
        'https://git.corp.example.com',
      );
    });

    it('names the configured instances when asked for another one', async () => {
      await expect(startAsAlice('https://unknown.example.com')).rejects.toThrow(
        'configured: https://git.corp.example.com, https://gitlab.com',
      );
    });

    it('refuses without OAuth', async () => {
      mockOAuth = false;
      await expect(startAsAlice('https://gitlab.com')).rejects.toThrow(
        'needs a server that signs users in with GitLab',
      );
    });

    it('refuses when the connection is not signed in', async () => {
      await expect(startAccountLink('https://gitlab.com')).rejects.toThrow('not signed in');
    });
  });

  describe('verify step', () => {
    it("continues to the account to link when GitLab reports the session's own user", async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      // The identity check's grant ends at once.
      expect(mockRevoke).toHaveBeenCalledWith('verify-token', config, corpApp);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
      const next = res.redirect.mock.calls[0][0] as string;
      expect(next.startsWith('https://gitlab.com/oauth/authorize')).toBe(true);
      expect((await storedFlow(stateOf(next))).link).toMatchObject({
        sessionId: 'primary',
        stage: 'connect',
        instance: 'https://gitlab.com',
      });
    });

    // The account-linking CSRF this step exists for: someone else opening the link must not
    // attach their GitLab account to the session that created it.
    it('refuses a link opened by another GitLab user', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('mallory-token'));
      mockUser.mockResolvedValueOnce({ id: 666, username: 'mallory' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send.mock.calls[0][0]).toContain('This link belongs to alice');
      expect(res.redirect).not.toHaveBeenCalled();
      expect(mockRevoke).toHaveBeenCalledWith('mallory-token', config, corpApp);
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
    });

    it('refuses a link that was already used', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      const flow = await storedFlow(state);
      await sessionStore.consumeAuthCodeFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('late-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('already used');
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('connect step', () => {
    /** Run the verify step and return the state of the connect step it started. */
    async function verified(): Promise<string> {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();
      await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      return stateOf(res.redirect.mock.calls[0][0] as string);
    }

    it('stores the signed-in account with the session', async () => {
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      const [linked] = await sessionStore.getLinkedSessions('primary');
      expect(linked).toMatchObject({
        gitlabAccessToken: 'com-token',
        gitlabRefreshToken: 'com-token-refresh',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        instanceLabel: 'GitLab.com',
        linkedToSessionId: 'primary',
        mcpAccessToken: '',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send.mock.calls[0][0]).toContain('alice-personal @ GitLab.com is linked');
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
    });

    it('replaces the grant of an account linked before and ends the old one', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'old-com-token',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('new-com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });

      await completeAccountLink(response(), state, await storedFlow(state), 'code', config);

      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({ id: 'old-link', gitlabAccessToken: 'new-com-token' });
      expect(mockRevoke).toHaveBeenCalledWith('old-com-token', config, comApp);
    });

    it('refuses the account the connection already uses', async () => {
      const link = await startAsAlice();
      const verifyState = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const verifyRes = response();
      await completeAccountLink(verifyRes, verifyState, await storedFlow(verifyState), 'c', config);
      const state = stateOf(verifyRes.redirect.mock.calls[0][0] as string);
      mockExchange.mockResolvedValueOnce(tokens('same-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('the account this connection already uses');
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
      expect(mockRevoke).toHaveBeenCalledWith('same-token', config, corpApp);
    });

    it('removes what it created when another callback completed the link first', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockImplementationOnce(async () => {
        await sessionStore.consumeAuthCodeFlow(state);
        return { id: 99, username: 'alice-personal' };
      });
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('already completed');
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
    });
  });

  it('refuses an expired link', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    const flow = { ...(await storedFlow(state)), expiresAt: Date.now() - 1 };
    const res = response();

    await completeAccountLink(res, state, flow, 'code', config);

    expect(res.send.mock.calls[0][0]).toContain('expired');
    expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('refuses a link whose connection signed out meanwhile', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    const flow = await storedFlow(state);
    await sessionStore.deleteSession('primary');
    const res = response();

    await completeAccountLink(res, state, flow, 'code', config);

    expect(res.send.mock.calls[0][0]).toContain('has signed out');
    expect(mockExchange).not.toHaveBeenCalled();
  });

  // A temporary failure keeps the flow, so reloading the page finishes the link.
  it('keeps the flow for a retry when GitLab fails for a temporary reason', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    mockExchange.mockRejectedValueOnce(new Error('GitLab returned 502'));
    const res = response();

    await completeAccountLink(res, state, await storedFlow(state), 'code', config);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send.mock.calls[0][0]).toContain('reload this page');
    expect(await sessionStore.getAuthCodeFlow(state)).toBeDefined();
  });
});
