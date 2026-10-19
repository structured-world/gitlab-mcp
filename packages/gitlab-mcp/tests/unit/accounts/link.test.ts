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

/** The sign-in URL behind the continue button of a link page. */
function continueLink(page: string): string {
  const href = /<a [^>]*href="([^"]+)"/.exec(page)?.[1] as string;
  return href.replaceAll('&amp;', '&');
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
    // just verified; an immediate redirect would authorize that same account again.
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
      expect(page).toContain('private window');
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

    // Only a create that collided with another link of the account is retried; a storage
    // failure surfaces at once (the page asks for a reload, the flow keeps its tokens).
    it('does not retry a create that failed for a storage reason', async () => {
      const state = await verified();
      mockExchange.mockResolvedValueOnce(tokens('com-token'));
      mockUser.mockResolvedValueOnce({ id: 99, username: 'alice-personal' });
      const create = jest
        .spyOn(sessionStore, 'createSession')
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
      const claim = jest.spyOn(sessionStore, 'claimGitLabRefresh').mockResolvedValue(false);
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

    // Another delivery of the same callback completed the link and reported it linked; the
    // account it reported is the one this delivery stored (one id per account), so the
    // losing delivery must not delete it.
    it('keeps the account when another delivery of the callback completed the link', async () => {
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
      const linked = await sessionStore.getLinkedSessions('primary');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({ gitlabUserId: 99, gitlabAccessToken: 'com-token' });
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
      const createSession = sessionStore.createSession.bind(sessionStore);
      const create = jest
        .spyOn(sessionStore, 'createSession')
        .mockImplementationOnce(async (row) => {
          await createSession(row);
          await sessionStore.deleteSession('primary');
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

    // Duplicate deliveries of one callback both replace an account linked before: the first
    // displaces the old grant, the second stores the same grant again and completes the link.
    // The first still ends the grant it displaced, which no row refers to any more.
    it('ends the grant it displaced when another delivery completed the link', async () => {
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
      const consume = jest
        .spyOn(sessionStore, 'consumeAuthCodeFlow')
        .mockResolvedValueOnce(undefined);
      const res = response();

      try {
        await completeAccountLink(res, state, flow, 'code', config);
      } finally {
        consume.mockRestore();
      }

      expect(res.send.mock.calls[0][0]).toContain('already completed');
      expect((await sessionStore.getSession('old-link'))?.gitlabAccessToken).toBe('com-token');
      expect(mockRevoke).toHaveBeenCalledWith('old-com-token', config, comApp);
      expect(mockRevoke).not.toHaveBeenCalledWith('com-token', config, comApp);
    });

    // Two links replacing the grant of an account linked before: every grant either ends up
    // stored or is ended; none stays authorized at GitLab without a row to revoke it by.
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
      // Both callbacks look the account up before either replaces its grant.
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
      const linkedSessions = sessionStore.getLinkedSessions.bind(sessionStore);
      let lookups = 0;
      let lookedUp!: () => void;
      const bothLookedUp = new Promise<void>((resolve) => (lookedUp = resolve));
      const lookup = jest
        .spyOn(sessionStore, 'getLinkedSessions')
        .mockImplementation(async (id) => {
          // Copies, as a database returns: the memory backend hands out its live records.
          const rows = (await linkedSessions(id)).map((row) => ({ ...row }));
          lookups += 1;
          if (lookups === 2) lookedUp();
          if (lookups <= 2) await bothLookedUp;
          return rows;
        });
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
      const update = sessionStore.updateSession.bind(sessionStore);
      const race = jest
        .spyOn(sessionStore, 'updateSession')
        .mockImplementationOnce(async (id, updates) => {
          await sessionStore.deleteSession(id);
          return update(id, updates);
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

  // Ending a cached grant is best effort: a failed revocation still discards the flow.
  it('discards an expired link whose cached grant cannot be ended', async () => {
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
    expect(await sessionStore.getAuthCodeFlow(state)).toBeUndefined();
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
