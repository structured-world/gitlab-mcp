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

jest.mock('../../../src/config', () => ({
  GITLAB_BASE_URL: 'https://git.corp.example.com',
  CONNECT_TIMEOUT_MS: 100,
  HEADERS_TIMEOUT_MS: 100,
  BODY_TIMEOUT_MS: 100,
}));

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
  ...jest.requireActual('../../../src/oauth/gitlab-device-flow'),
  buildGitLabAuthUrl: jest.fn(
    (_config: unknown, _redirect: string, state: string, app: { baseUrl: string }) =>
      `${app.baseUrl}/oauth/authorize?state=${state}`,
  ),
  getGitLabUser: jest.fn(),
  revokeGitLabToken: jest.fn(),
  refreshGitLabToken: jest.fn(),
}));

jest.mock('../../../src/oauth/code-exchange', () => ({ exchangeFlowCode: jest.fn() }));
// Only the OAuth error class is real here; HTTP is mocked at the device-flow boundary.
jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));

const mockElicitationComplete = jest.fn();
jest.mock('../../../src/session-manager', () => ({
  getSessionManager: () => ({ notifyElicitationComplete: mockElicitationComplete }),
}));

import type { Response } from 'express';
import { completeAccountLink, startAccountLink } from '../../../src/accounts/link';
import { sessionStore } from '../../../src/oauth/session-store';
import { runWithTokenContext } from '../../../src/oauth/token-context';
import {
  getGitLabUser,
  revokeGitLabToken,
  refreshGitLabToken,
  GitLabOAuthHttpError,
} from '../../../src/oauth/gitlab-device-flow';
import { exchangeFlowCode } from '../../../src/oauth/code-exchange';
import {
  discardAuthCodeFlow,
  endAbandonedFlowGrant,
  revokeAbandonedFlowGrant,
} from '../../../src/oauth/grant-revocation';
import type { OAuthConfig } from '../../../src/oauth/config';
import type {
  AuthCodeFlowState,
  GitLabTokenResponse,
  OAuthSession,
} from '../../../src/oauth/types';

const mockUser = getGitLabUser as jest.MockedFunction<typeof getGitLabUser>;
const mockRevoke = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;
const mockRefresh = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;
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

const tokenCreatedAt = Math.floor(Date.now() / 1000);

function tokens(access: string): GitLabTokenResponse {
  return {
    access_token: access,
    refresh_token: `${access}-refresh`,
    token_type: 'Bearer',
    expires_in: 7200,
    created_at: tokenCreatedAt,
    scope: 'api',
  };
}

/** The cookies of the browser the tests sign in with; the server sets them on its responses. */
const browserCookies = new Map<string, string>();

function response() {
  const res = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string): void => {
      browserCookies.set(name, value);
    }),
    clearCookie: jest.fn((name: string): void => {
      browserCookies.delete(name);
    }),
    // The request this response answers comes from that browser, with its cookies.
    req: {
      get headers() {
        const cookie = [...browserCookies].map(([name, value]) => `${name}=${value}`).join('; ');
        return { cookie };
      },
    },
  };
  return res as unknown as Response & typeof res;
}

/** The state carried by a GitLab sign-in URL the link built. */
function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') as string;
}

/** The sign-in URL behind the continue button of a link page. */
function continueLink(page: string): string {
  const href = /<a [^>]*href="([^"]+)"/.exec(page)?.[1] as string;
  return href.replaceAll('&amp;', '&');
}

async function storedFlow(state: string): Promise<AuthCodeFlowState> {
  return (await sessionStore.getAuthCodeFlow(state)) as AuthCodeFlowState;
}

function startAsAlice(instance?: string, elicitation?: Parameters<typeof startAccountLink>[1]) {
  return runWithTokenContext(
    {
      gitlabToken: 'corp-gitlab',
      gitlabUserId: 7,
      gitlabUsername: 'alice',
      sessionId: 'primary',
      apiUrl: 'https://git.corp.example.com',
    },
    () => startAccountLink(instance, elicitation),
  ) as ReturnType<typeof startAccountLink>;
}

describe('account linking', () => {
  beforeEach(async () => {
    mockOAuth = true;
    sessionStore.clear();
    jest.clearAllMocks();
    browserCookies.clear();
    // A copy: the memory backend keeps the object it is given and updates change it.
    await sessionStore.createSession({ ...primary });
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

    it("refuses when the session's own instance is no longer configured", async () => {
      await sessionStore.updateSession('primary', { gitlabApiUrl: 'https://gone.example.com' });

      await expect(startAsAlice('https://gitlab.com')).rejects.toThrow(
        'no longer configured; sign in again',
      );
    });

    it('refuses when the session storage cannot keep linked accounts', async () => {
      const backend = (sessionStore as unknown as { backend: Record<string, unknown> }).backend;
      backend.getLinkedSessions = undefined;
      try {
        await expect(startAsAlice('https://gitlab.com')).rejects.toThrow(
          'cannot keep linked accounts',
        );
      } finally {
        delete backend.getLinkedSessions;
      }
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

    // On the session's own instance the browser is still signed in to GitLab as the account
    // just verified; an immediate redirect would authorize that same account again. The user
    // changes the GitLab account in this browser, which holds the cookie of the next step (a
    // private window would not).
    it('pauses on its own instance so the user can sign in with the other account', async () => {
      const link = await startAsAlice();
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      const page = res.send.mock.calls[0][0] as string;
      expect(page).toContain('sign out of GitLab in this browser');
      expect(page).not.toContain('private window');
      const next = continueLink(page);
      expect(next.startsWith('https://git.corp.example.com/oauth/authorize')).toBe(true);
      expect((await storedFlow(stateOf(next))).link).toMatchObject({
        stage: 'connect',
        instance: 'https://git.corp.example.com',
      });
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
    });

    // A failed write of the next step must leave the verified step usable, as the error
    // page tells the user to reload.
    it('keeps the verified step for a retry when the next step cannot be stored', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const store = jest
        .spyOn(sessionStore, 'storeAuthCodeFlow')
        .mockRejectedValueOnce(new Error('database unavailable'));
      const res = response();

      try {
        await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      } finally {
        store.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send.mock.calls[0][0]).toContain('reload this page');
      expect(await sessionStore.getAuthCodeFlow(state)).toBeDefined();
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    // Two callbacks of one verified step: the one that loses drops the next step it stored,
    // so a link never continues twice.
    it('drops the next step when another callback spent the verified step first', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockImplementationOnce(async () => {
        await sessionStore.consumeAuthCodeFlow(state);
        return { id: 7, username: 'alice' };
      });
      const store = jest.spyOn(sessionStore, 'storeAuthCodeFlow');
      const res = response();
      let nextState: string;

      try {
        await completeAccountLink(res, state, flow, 'code', config);
        nextState = store.mock.calls[0][0];
      } finally {
        store.mockRestore();
      }

      expect(res.send.mock.calls[0][0]).toContain('already used');
      expect(await sessionStore.getAuthCodeFlow(nextState)).toBeUndefined();
      expect(mockRevoke).toHaveBeenCalledWith('verify-token', config, corpApp);
    });

    it('refuses a link opened by another user after it was already used', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      const flow = await storedFlow(state);
      await sessionStore.consumeAuthCodeFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('mallory-token'));
      mockUser.mockResolvedValueOnce({ id: 666, username: 'mallory' });
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('already used');
      expect(mockRevoke).toHaveBeenCalledWith('mallory-token', config, corpApp);
    });

    it('refuses a step whose instance is no longer configured', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      const flow = { ...(await storedFlow(state)), selectedInstance: 'https://gone.example.com' };
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('no longer configured');
      expect(mockExchange).not.toHaveBeenCalled();
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
    async function verified(elicitation?: Parameters<typeof startAccountLink>[1]): Promise<string> {
      const link = await startAsAlice('https://gitlab.com', elicitation);
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();
      await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      return stateOf(res.redirect.mock.calls[0][0] as string);
    }

    // The connect step is only the GitLab sign-in URL: forwarded to someone else, it would
    // link their GitLab account to this session. It completes only in the browser that
    // confirmed the session's own account.
    it('refuses a connect step opened in another browser', async () => {
      const state = await verified();
      browserCookies.clear();
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send.mock.calls[0][0]).toContain('browser');
      expect(await sessionStore.getLinkedSessions('primary')).toHaveLength(0);
      // Only the verify step exchanged a code: the forwarded one gets no grant at all.
      expect(mockExchange).toHaveBeenCalledTimes(1);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
    });

    // The verify step hands the browser a cookie only the server reads, scoped to the
    // callback, for the connect step to check.
    it('binds the connect step to the browser with a callback cookie', async () => {
      const link = await startAsAlice('https://gitlab.com');
      const state = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      const [name, value, options] = res.cookie.mock.calls[0] as unknown as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(name).toMatch(/^gitlab_mcp_link_/);
      expect(value).toEqual(expect.any(String));
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/oauth/callback',
      });
      // Only a digest is stored with the step; the browser holds the value itself.
      const next = await storedFlow(stateOf(res.redirect.mock.calls[0][0] as string));
      expect(next.link?.browserBinding).toEqual(expect.any(String));
      expect(next.link?.browserBinding).not.toBe(value);
    });

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

    // A client that opened the link through URL elicitation learns that the sign-in
    // completed: only the chat that asked for the link is told, with its elicitation id.
    it('tells the chat that opened the link that it completed', async () => {
      const state = await verified({ mcpSessionId: 'chat-1', elicitationId: 'elicit-1' });
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });

      await completeAccountLink(response(), state, await storedFlow(state), 'code', config);

      expect(mockElicitationComplete).toHaveBeenCalledTimes(1);
      expect(mockElicitationComplete).toHaveBeenCalledWith('chat-1', 'elicit-1');
    });

    // Nothing completed: a refused step tells the chat nothing, and a link the client did
    // not open has no elicitation to complete.
    it('announces no completion for a refused step or a link the client did not open', async () => {
      const refused = await verified({ mcpSessionId: 'chat-1', elicitationId: 'elicit-1' });
      browserCookies.clear();
      await completeAccountLink(response(), refused, await storedFlow(refused), 'code', config);
      const plain = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      await completeAccountLink(response(), plain, await storedFlow(plain), 'code', config);

      expect(await sessionStore.getLinkedSessions('primary')).toHaveLength(1);
      expect(mockElicitationComplete).not.toHaveBeenCalled();
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

    // Doorkeeper 5.6.6 skips expired access tokens on revoke. Rotate the old grant while
    // its refresh credential is still stored, then revoke the live replacement token.
    it('refreshes an expired displaced grant before replacing the account', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        gitlabAccessToken: 'expired-old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabTokenExpiry: Date.now() - 1,
        gitlabUserId: 99,
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: primary.id,
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('new-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      mockRefresh.mockImplementationOnce(async () => {
        // A slow linked-account refresh must not hold the primary account's lease.
        const now = Date.now();
        const leaseUntil = now + 1000;
        expect(
          await sessionStore.claimGitLabRefresh(
            primary.id,
            primary.gitlabRefreshToken,
            now,
            leaseUntil,
          ),
        ).toBe(true);
        await sessionStore.releaseGitLabRefresh(primary.id, leaseUntil);
        expect((await sessionStore.getSession('old-link'))?.gitlabRefreshToken).toBe('old-refresh');
        // A live token shorter than the proactive refresh buffer is still revocable.
        return { ...tokens('live-old-token'), expires_in: 60 };
      });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(mockRefresh).toHaveBeenCalledWith('old-refresh', config, comApp);
      expect(mockRevoke).toHaveBeenCalledWith('live-old-token', config, comApp);
      expect(mockRevoke).not.toHaveBeenCalledWith('expired-old-token', config, comApp);
      expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('new-token');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // Re-linking can replace a grant GitLab has already revoked; application failures
    // and temporary outages do not prove revocation and must retain both old credentials.
    it.each([
      ['invalid_grant', 400, true],
      ['invalid_client', 400, false],
      [undefined, 502, false],
    ] as const)(
      'handles displaced refresh error %s (%s) without losing credentials',
      async (code, status, ended) => {
        await sessionStore.createSession({
          ...primary,
          id: 'old-link',
          gitlabAccessToken: 'old-token',
          gitlabRefreshToken: 'old-refresh',
          gitlabTokenExpiry: Date.now() + 1000,
          gitlabUserId: 99,
          gitlabApiUrl: 'https://gitlab.com',
          linkedToSessionId: primary.id,
        });
        const state = await verified();
        mockExchange.mockResolvedValueOnce(tokens('new-token'));
        mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
        mockRefresh.mockRejectedValueOnce(new GitLabOAuthHttpError('Refresh failed', status, code));
        const res = response();

        await completeAccountLink(res, state, await storedFlow(state), 'code', config);

        expect(mockRefresh).toHaveBeenCalledWith('old-refresh', config, comApp);
        expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe(
          ended ? 'new-token' : 'old-token',
        );
        if (ended) {
          expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
          expect(res.status).toHaveBeenCalledWith(200);
          // A refused refresh does not prove the access token itself has expired.
          expect(mockRevoke).toHaveBeenCalledWith('old-token', config, comApp);
        } else {
          expect(await sessionStore.getAuthCodeFlow(state)).toBeDefined();
          expect(res.status).toHaveBeenCalledWith(500);
          expect(mockRevoke).not.toHaveBeenCalledWith('old-token', config, comApp);
        }
        expect(mockRevoke).not.toHaveBeenCalledWith('new-token', config, comApp);
      },
    );

    // A delayed storage read can outlive the primary lease. A callback already completed
    // elsewhere must not restore its grant after a subsequent link replaced and revoked it.
    it('does not restore a spent link after its primary lease expires', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        gitlabAccessToken: 'old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabUserId: 99,
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: primary.id,
      });
      const first = await verified();
      const second = await verified();
      const firstFlow = { ...(await storedFlow(first)), gitlabTokens: tokens('first-token') };
      const secondFlow = { ...(await storedFlow(second)), gitlabTokens: tokens('second-token') };
      await sessionStore.storeAuthCodeFlow(first, firstFlow);
      await sessionStore.storeAuthCodeFlow(second, secondFlow);
      mockUser.mockResolvedValue({ id: 99, username: 'alice-personal' });
      let resume!: () => void;
      let entered!: () => void;
      const pause = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const reading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const read = sessionStore.getLinkedSessions.bind(sessionStore);
      const delayed = jest
        .spyOn(sessionStore, 'getLinkedSessions')
        .mockImplementationOnce(async (id) => {
          const rows = await read(id);
          entered();
          await pause;
          return rows;
        });
      const pending = completeAccountLink(response(), first, firstFlow, 'code', config);
      await reading;
      const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
      try {
        await completeAccountLink(response(), first, firstFlow, 'code', config);
        await completeAccountLink(response(), second, secondFlow, 'code', config);
        resume();
        await pending;

        expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('second-token');
      } finally {
        resume();
        await pending;
        clock.mockRestore();
        delayed.mockRestore();
      }
    });

    it('refuses the account the connection already uses', async () => {
      const link = await startAsAlice();
      const verifyState = stateOf(link.url);
      mockExchange.mockResolvedValueOnce(tokens('verify-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const verifyRes = response();
      await completeAccountLink(verifyRes, verifyState, await storedFlow(verifyState), 'c', config);
      const state = stateOf(continueLink(verifyRes.send.mock.calls[0][0] as string));
      mockExchange.mockResolvedValueOnce(tokens('same-token'));
      mockUser.mockResolvedValueOnce({ id: 7, username: 'alice' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('the account this connection already uses');
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
      expect(mockRevoke).toHaveBeenCalledWith('same-token', config, corpApp);
    });

    // Two links of the same account completing at once store it once; the grant that lost
    // the race is ended rather than left active behind the stored one.
    it('stores an account linked by two concurrent links once', async () => {
      const first = await verified();
      const second = await verified();
      mockExchange
        .mockResolvedValueOnce(tokens('com-token-1'))
        .mockResolvedValueOnce(tokens('com-token-2'));
      mockUser
        .mockResolvedValueOnce({ id: 99, username: 'alice-personal' })
        .mockResolvedValueOnce({ id: 99, username: 'alice-personal' });

      const [firstFlow, secondFlow] = [await storedFlow(first), await storedFlow(second)];
      await Promise.all([
        completeAccountLink(response(), first, firstFlow, 'code', config),
        completeAccountLink(response(), second, secondFlow, 'code', config),
      ]);

      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      const lost = linked[0].gitlabAccessToken === 'com-token-1' ? 'com-token-2' : 'com-token-1';
      expect(mockRevoke).toHaveBeenCalledWith(lost, config, comApp);
    });

    // Only a commit that collided with another link of the account is retried; a storage
    // failure surfaces at once (the page asks for a reload, the flow keeps its tokens).
    it('does not retry a commit that failed for a storage reason', async () => {
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const create = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockRejectedValue(new Error('database unavailable'));
      const res = response();

      try {
        await completeAccountLink(res, state, await storedFlow(state), 'code', config);
        expect(create).toHaveBeenCalledTimes(1);
      } finally {
        create.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(500);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeDefined();
    });

    // The account stays leased elsewhere (a stuck refresh, say): the link stops after its
    // passes and asks for a reload; the flow keeps its tokens and nothing is replaced.
    it('asks for a reload when the account stays leased elsewhere', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('new-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      // Only the account is held; the session is free for the link to take its turn.
      const claimLease = sessionStore.claimGitLabRefresh.bind(sessionStore);
      const claim = jest
        .spyOn(sessionStore, 'claimGitLabRefresh')
        .mockImplementation(async (id, ...rest) => id !== 'old-link' && claimLease(id, ...rest));
      const res = response();

      try {
        await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      } finally {
        claim.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(500);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeDefined();
      expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('old-token');
      expect(mockRevoke).not.toHaveBeenCalledWith('old-token', config, comApp);
    });

    // Ending the displaced grant and releasing the lease are best effort: the new grant is
    // stored, so the link succeeds when either fails.
    it('links the account when ending the old grant or releasing the lease fails', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('new-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));
      // The lease is released, then the call reports a failure: a lease left held would
      // block the account in the tests that follow.
      const releaseLease = sessionStore.releaseGitLabRefresh.bind(sessionStore);
      const release = jest
        .spyOn(sessionStore, 'releaseGitLabRefresh')
        .mockImplementationOnce(async (id, leaseUntil) => {
          await releaseLease(id, leaseUntil);
          throw new Error('database unavailable');
        });
      const res = response();

      try {
        await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      } finally {
        release.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(200);
      expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('new-token');
    });

    it('refuses a connect step whose instance is no longer configured', async () => {
      const state = await verified();
      const flow = { ...(await storedFlow(state)), selectedInstance: 'https://gone.example.com' };
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('no longer configured');
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
    });

    // Another delivery of the same callback completed the link and reported the account it
    // stored as linked. The losing delivery leaves that account as it is and ends nothing:
    // the grant both deliveries got is the stored one.
    it('keeps the account when another delivery of the callback completed the link', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockImplementationOnce(async () => {
        // The winning delivery: it stores the account, then spends the link.
        await sessionStore.createSession({
          ...primary,
          id: 'winner-link',
          mcpAccessToken: '',
          mcpRefreshToken: '',
          gitlabAccessToken: 'com-token',
          gitlabRefreshToken: 'com-token-refresh',
          gitlabUserId: 99,
          gitlabUsername: 'stored-by-winner',
          gitlabApiUrl: 'https://gitlab.com',
          linkedToSessionId: 'primary',
        });
        await sessionStore.consumeAuthCodeFlow(state);
        return { id: 99, username: 'alice-personal' };
      });
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('already completed');
      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        gitlabAccessToken: 'com-token',
        gitlabUsername: 'stored-by-winner',
      });
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
    });

    // The connection is revoked right after the link stored the account, too late for the
    // revocation to see it: the row goes with the session, so the link ends its own grant
    // instead of reporting an account that no longer exists.
    it('ends its grant when the connection is revoked after the account was stored', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const commitAccount = sessionStore.commitLinkedAccount.bind(sessionStore);
      const create = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockImplementationOnce(async (commit) => {
          const result = await commitAccount(commit);
          await sessionStore.deleteSession('primary');
          return result;
        });
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        create.mockRestore();
      }

      expect(res.send.mock.calls[0][0]).toContain('has signed out');
      expect(mockRevoke).toHaveBeenCalledWith('com-token', config, comApp);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
    });

    // A failed atomic commit leaves both the account absent and the flow available to
    // cleanup, which must end the unclaimed incoming grant.
    it('ends the unused grant when a failed commit is discarded', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const consume = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockRejectedValueOnce(new Error('database unavailable'));
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        consume.mockRestore();
      }
      expect(res.status).toHaveBeenCalledWith(500);
      const left = await sessionStore.getAuthCodeFlow(state);
      expect(left).toBeDefined();

      await revokeAbandonedFlowGrant(
        { ...(left as AuthCodeFlowState), gitlabTokens: tokens('com-token') },
        config,
      );

      expect(mockRevoke).toHaveBeenCalledWith('com-token', config, comApp);
      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toEqual([]);
    });

    // A revocation of the session cannot slip in between the check of the session and the
    // completion: the link holds the session's lease while it completes, so a sign-out either
    // sees the completed account or makes this link report the sign-out.
    it('holds the session lease while it completes the link', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const commitAccount = sessionStore.commitLinkedAccount.bind(sessionStore);
      let revocationGotIn: boolean | undefined;
      const consume = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockImplementationOnce(async (commit) => {
          const now = Date.now();
          revocationGotIn = await sessionStore.claimGitLabRefresh(
            'primary',
            primary.gitlabRefreshToken,
            now,
            now + 1_000,
          );
          return commitAccount(commit);
        });

      try {
        await completeAccountLink(response(), state, flow, 'code', config);
      } finally {
        consume.mockRestore();
      }

      expect(revocationGotIn).toBe(false);
    });

    // The check of the session took its lease; one that cannot be given back expires on its
    // own, and the account stays linked.
    it('links the account when the lease of the session check cannot be released', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const release = jest
        .spyOn(sessionStore, 'releaseGitLabRefresh')
        .mockRejectedValueOnce(new Error('database unavailable'));
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        release.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(200);
      expect(await sessionStore.getLinkedSessions('primary')).toHaveLength(1);
    });

    // A refresh of the session holds its lease for a moment; the link waits for it and
    // completes once the session is free.
    it('waits for a refresh of the session before completing the link', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const leaseUntil = Date.now() + 60_000;
      await sessionStore.claimGitLabRefresh(
        'primary',
        primary.gitlabRefreshToken,
        Date.now(),
        leaseUntil,
      );
      const released = new Promise<void>((resolve) =>
        setTimeout(() => {
          void sessionStore.releaseGitLabRefresh('primary', leaseUntil).then(resolve);
        }, 50),
      );
      const res = response();

      await completeAccountLink(res, state, flow, 'code', config);
      await released;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
    });

    // A flow spent between the initial read and the atomic commit cannot replace a live
    // account or cause the callback to revoke that account's existing grant.
    it('preserves the existing account when the link was spent before commit', async () => {
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
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const commitAccount = sessionStore.commitLinkedAccount.bind(sessionStore);
      const consume = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockImplementationOnce(async (commit) => {
          await sessionStore.consumeAuthCodeFlow(commit.internalState);
          return commitAccount(commit);
        });
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        consume.mockRestore();
      }

      expect(res.send.mock.calls[0][0]).toContain('already completed');
      expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('old-com-token');
      expect(mockRevoke).not.toHaveBeenCalledWith('old-com-token', config, comApp);
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
    });

    // Expiry between preflight and storage is terminal: retain the cached grant for
    // cleanup, store nothing, and do not keep reacquiring leases for the expired flow.
    it('stops retrying when its flow expires before the atomic commit', async () => {
      const state = await verified();
      const flow = { ...(await storedFlow(state)), gitlabTokens: tokens('com-token') };
      await sessionStore.storeAuthCodeFlow(state, flow);
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const getLinked = sessionStore.getLinkedSessions.bind(sessionStore);
      const expire = jest
        .spyOn(sessionStore, 'getLinkedSessions')
        .mockImplementationOnce(async (id) => {
          const accounts = await getLinked(id);
          await sessionStore.storeAuthCodeFlow(state, { ...flow, expiresAt: Date.now() - 1 });
          return accounts;
        });
      const commit = jest.spyOn(sessionStore, 'commitLinkedAccount');
      const res = response();
      try {
        await completeAccountLink(res, state, flow, 'code', config);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send.mock.calls[0][0]).toContain('expired');
        expect(commit).toHaveBeenCalledTimes(1);
        expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
        expect((await sessionStore.getAuthCodeFlow(state))?.gitlabTokens).toEqual(
          flow.gitlabTokens,
        );
      } finally {
        expire.mockRestore();
        commit.mockRestore();
      }
    });

    // Two links replacing the grant of an account linked before, their callbacks arriving
    // together: the completions take turns, and every grant either ends up stored or is ended;
    // none stays authorized at GitLab without a row to revoke it by.
    it('ends every displaced grant when two links replace an account at once', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const first = await verified();
      const second = await verified();
      mockExchange
        .mockResolvedValueOnce(tokens('new-token-1'))
        .mockResolvedValueOnce(tokens('new-token-2'));
      // Both callbacks have their account from GitLab before either completes.
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => (release = resolve));
      const meetThenReturnUser = async () => {
        arrived += 1;
        if (arrived === 2) release();
        await barrier;
        return { id: 99, username: 'alice-personal' };
      };
      mockUser
        .mockImplementationOnce(meetThenReturnUser)
        .mockImplementationOnce(meetThenReturnUser);
      // Copies, as a database returns: the memory backend hands out its live records.
      const linkedSessions = sessionStore.getLinkedSessions.bind(sessionStore);
      const lookup = jest
        .spyOn(sessionStore, 'getLinkedSessions')
        .mockImplementation(async (id) => (await linkedSessions(id)).map((row) => ({ ...row })));
      const [firstFlow, secondFlow] = [await storedFlow(first), await storedFlow(second)];

      try {
        await Promise.all([
          completeAccountLink(response(), first, firstFlow, 'code', config),
          completeAccountLink(response(), second, secondFlow, 'code', config),
        ]);
      } finally {
        lookup.mockRestore();
      }

      const [stored] = await sessionStore.getLinkedSessions('primary');
      const displaced = ['old-token', 'new-token-1', 'new-token-2'].filter(
        (token) => token !== stored.gitlabAccessToken,
      );
      for (const token of displaced) {
        expect(mockRevoke).toHaveBeenCalledWith(token, config, comApp);
      }
      expect(mockRevoke).not.toHaveBeenCalledWith(stored.gitlabAccessToken, config, comApp);
    });

    // The account is unlinked in another chat between the lookup and the update: the link
    // stores it again instead of reporting success for nothing stored.
    it('stores the account again when it was unlinked during the link', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'old-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'old-token',
        gitlabRefreshToken: 'old-refresh',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('new-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const commitAccount = sessionStore.commitLinkedAccount.bind(sessionStore);
      const race = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockImplementationOnce(async (commit) => {
          await sessionStore.deleteSession(commit.account.id);
          return commitAccount(commit);
        });
      const res = response();

      try {
        await completeAccountLink(res, state, await storedFlow(state), 'code', config);
      } finally {
        race.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(200);
      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({ gitlabUserId: 99, gitlabAccessToken: 'new-token' });
    });

    // Both deliveries of link A's callback got its grant; one completed A, then link B of the
    // same account replaced and ended A's grant. The delayed delivery of A must not put the
    // ended grant back over B's and end B's: a spent link stores nothing.
    it('does not let a delayed delivery of a completed link replace a later link', async () => {
      const a = await verified();
      const flowA = await storedFlow(a);
      const cookiesOfA = new Map(browserCookies);
      const b = await verified();
      const flowB = await storedFlow(b);
      mockExchange
        .mockResolvedValueOnce(tokens('token-a'))
        .mockResolvedValueOnce(tokens('token-b'));
      mockUser.mockResolvedValue({ id: 99, username: 'alice-personal' });
      await completeAccountLink(response(), a, flowA, 'code', config);
      await completeAccountLink(response(), b, flowB, 'code', config);
      expect(mockRevoke).toHaveBeenCalledWith('token-a', config, comApp);
      mockRevoke.mockClear();

      // The duplicate delivery of A, from the same browser, with the grant A1 obtained.
      for (const [name, value] of cookiesOfA) browserCookies.set(name, value);
      const res = response();
      await completeAccountLink(
        res,
        a,
        { ...flowA, gitlabTokens: tokens('token-a') },
        'code',
        config,
      );

      expect(res.send.mock.calls[0][0]).toContain('already completed');
      const [linked] = await sessionStore.getLinkedSessions('primary');
      expect(linked.gitlabAccessToken).toBe('token-b');
      expect(mockRevoke).not.toHaveBeenCalledWith('token-b', config, comApp);
    });

    // Cleanup removed the flow after the initial read. It may end its unused grant once
    // the callback releases the primary lease, but that callback must not store the grant.
    it('does not store a grant whose flow cleanup removed before commit', async () => {
      const state = await verified();
      const flow = await storedFlow(state);
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const getFlow = sessionStore.getAuthCodeFlow.bind(sessionStore);
      let cleanup: Promise<void> | undefined;
      const persistTokens = jest.fn();
      const check = jest
        .spyOn(sessionStore, 'getAuthCodeFlow')
        .mockImplementationOnce(async (s) => {
          const found = await getFlow(s);
          // Cleanup takes the flow out of the callback's reach, then ends its grant.
          await sessionStore.deleteAuthCodeFlow(s);
          cleanup = endAbandonedFlowGrant(
            { ...(found as AuthCodeFlowState), gitlabTokens: tokens('com-token') },
            config,
            persistTokens,
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
          return found;
        });

      try {
        await completeAccountLink(response(), state, flow, 'code', config);
        await cleanup;
      } finally {
        check.mockRestore();
      }

      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
      expect(mockRevoke).toHaveBeenCalledWith('com-token', config, comApp);
      expect(persistTokens).not.toHaveBeenCalled();
    });

    // The step is opened in another browser and discarded while the browser it belongs to
    // retries it with the grant cached by a failed attempt: the retry must not store the
    // grant the discard is ending, or the account is left linked with an ended grant.
    it('does not let a retry store the grant a discard of its flow ends', async () => {
      const state = await verified();
      const cached = { ...(await storedFlow(state)), gitlabTokens: tokens('com-token') };
      await sessionStore.storeAuthCodeFlow(state, cached);
      mockUser.mockResolvedValue({ id: 99, username: 'alice-personal' });
      // The retry from the bound browser lands while the discard ends the grant.
      mockRevoke.mockImplementationOnce(async () => {
        await completeAccountLink(response(), state, cached, 'code', config);
      });

      await discardAuthCodeFlow(state, cached, config);

      const linked = await sessionStore.getLinkedSessions('primary');
      expect(mockRevoke).toHaveBeenCalledWith('com-token', config, comApp);
      expect(linked.map((account) => account.gitlabAccessToken)).not.toContain('com-token');
    });

    // A lost commit response leaves an account and a spent flow together. Retrying the
    // callback must acknowledge the spent flow without overwriting or revoking its grant.
    it('preserves a committed link when its commit response was lost', async () => {
      const state = await verified();
      const flow = { ...(await storedFlow(state)), gitlabTokens: tokens('com-token') };
      await sessionStore.storeAuthCodeFlow(state, flow);
      mockUser.mockResolvedValue({ id: 99, username: 'alice-personal' });
      const commitAccount = sessionStore.commitLinkedAccount.bind(sessionStore);
      const create = jest
        .spyOn(sessionStore, 'commitLinkedAccount')
        .mockImplementationOnce(async (commit) => {
          await commitAccount(commit);
          throw new Error('connection reset');
        });
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        create.mockRestore();
      }

      expect(res.status).toHaveBeenCalledWith(500);
      const retry = response();
      await completeAccountLink(retry, state, flow, 'code', config);
      expect(retry.send.mock.calls[0][0]).toContain('already completed');
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      expect(linked[0].gitlabAccessToken).toBe('com-token');
    });

    // The connection signed out after the account was signed in at GitLab but before the
    // link completed: nothing is stored, the link is spent and its grant is ended.
    it('ends the grant of a link whose connection signed out before it completed', async () => {
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockImplementationOnce(async () => {
        await sessionStore.deleteSession('primary');
        return { id: 99, username: 'alice-personal' };
      });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.send.mock.calls[0][0]).toContain('has signed out');
      expect(mockRevoke).toHaveBeenCalledWith('com-token', config, comApp);
      expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
      expect(await sessionStore.getLinkedSessions('primary')).toEqual([]);
    });

    // The page is already sent when the chat is told: a failed announcement changes nothing.
    it('links the account when the chat cannot be told', async () => {
      const state = await verified({ mcpSessionId: 'chat-1', elicitationId: 'elicit-1' });
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      mockElicitationComplete.mockRejectedValueOnce(new Error('session closed'));
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(await sessionStore.getLinkedSessions('primary')).toHaveLength(1);
    });

    // A retry after a failed completion reuses the cached grant the first attempt already
    // stored; the stored grant is the new one, not one to end.
    it('keeps the grant a retry reuses', async () => {
      await sessionStore.createSession({
        ...primary,
        id: 'stored-link',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabAccessToken: 'com-token',
        gitlabUserId: 99,
        gitlabUsername: 'alice-personal',
        gitlabApiUrl: 'https://gitlab.com',
        linkedToSessionId: 'primary',
      });
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const res = response();

      await completeAccountLink(res, state, await storedFlow(state), 'code', config);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
      expect((await sessionStore.getSession('stored-link'))?.gitlabAccessToken).toBe('com-token');
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

  // An earlier callback exchanged the code and cached the grant, then failed until the link
  // expired: discarding the flow ends that grant instead of leaving it authorized.
  it('ends the cached grant of an expired link', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    const flow = {
      ...(await storedFlow(state)),
      gitlabTokens: tokens('cached-token'),
      expiresAt: Date.now() - 1,
    };
    await sessionStore.storeAuthCodeFlow(state, flow);
    const res = response();

    await completeAccountLink(res, state, flow, 'code', config);

    expect(res.send.mock.calls[0][0]).toContain('expired');
    expect(mockRevoke).toHaveBeenCalledWith('cached-token', config, corpApp);
    expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
  });

  // The connection signed out after a callback exchanged the code: the cached grant ends
  // with the flow, as the account it would have linked is never stored.
  it('ends the cached grant of a link whose connection signed out', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    const flow = { ...(await storedFlow(state)), gitlabTokens: tokens('cached-token') };
    await sessionStore.storeAuthCodeFlow(state, flow);
    await sessionStore.deleteSession('primary');
    const res = response();

    await completeAccountLink(res, state, flow, 'code', config);

    expect(res.send.mock.calls[0][0]).toContain('has signed out');
    expect(mockRevoke).toHaveBeenCalledWith('cached-token', config, corpApp);
    expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
  });

  // The expired flow holds the only copy of its grant: when ending the grant fails, the flow
  // stays for storage cleanup to retry instead of being dropped with the grant alive.
  it('keeps an expired link whose cached grant cannot be ended for cleanup', async () => {
    const link = await startAsAlice('https://gitlab.com');
    const state = stateOf(link.url);
    const flow = {
      ...(await storedFlow(state)),
      gitlabTokens: tokens('cached-token'),
      expiresAt: Date.now() - 1,
    };
    await sessionStore.storeAuthCodeFlow(state, flow);
    mockRevoke.mockRejectedValueOnce(new Error('GitLab returned 502'));
    const res = response();

    await completeAccountLink(res, state, flow, 'code', config);

    expect(res.send.mock.calls[0][0]).toContain('expired');
    expect(await sessionStore.getAuthCodeFlow(state)).toMatchObject({
      gitlabTokens: tokens('cached-token'),
    });
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
