/**
 * Unit tests for OAuth session store
 * Tests session CRUD operations, device flows, auth codes, and cleanup
 */

import { SessionStore } from '../../../src/oauth/session-store';
import {
  OAuthSession,
  DeviceFlowState,
  AuthorizationCode,
  AuthCodeFlowState,
} from '../../../src/oauth/types';
import { SessionStorageBackend } from '../../../src/oauth/storage';
import { MemoryStorageBackend } from '../../../src/oauth/storage/memory';

describe('OAuth Session Store', () => {
  let store: SessionStore;

  // Helper function to create a test session
  const createTestSession = (overrides: Partial<OAuthSession> = {}): OAuthSession => ({
    id: `session-${Date.now()}`,
    mcpAccessToken: 'mcp-token-123',
    mcpRefreshToken: 'mcp-refresh-123',
    mcpTokenExpiry: Date.now() + 3600000,
    gitlabAccessToken: 'gitlab-token-123',
    gitlabRefreshToken: 'gitlab-refresh-123',
    gitlabTokenExpiry: Date.now() + 7200000,
    gitlabUserId: 12345,
    gitlabUsername: 'testuser',
    clientId: 'test-client',
    scopes: ['mcp:tools', 'mcp:resources'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  // Helper function to create a test device flow
  const createTestDeviceFlow = (overrides: Partial<DeviceFlowState> = {}): DeviceFlowState => ({
    deviceCode: 'device-code-123',
    userCode: 'ABCD-1234',
    verificationUri: 'https://gitlab.example.com/oauth/authorize',
    verificationUriComplete: 'https://gitlab.example.com/oauth/authorize?user_code=ABCD-1234',
    expiresAt: Date.now() + 600000,
    interval: 5,
    clientId: 'test-client',
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    state: 'state-123',
    redirectUri: 'https://callback.example.com',
    ...overrides,
  });

  // Helper function to create a test auth code
  const createTestAuthCode = (overrides: Partial<AuthorizationCode> = {}): AuthorizationCode => ({
    code: 'auth-code-123',
    sessionId: 'session-456',
    clientId: 'test-client',
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    redirectUri: 'https://callback.example.com',
    expiresAt: Date.now() + 600000,
    ...overrides,
  });

  beforeEach(() => {
    store = new SessionStore();
  });

  describe('Session Operations', () => {
    describe('createSession', () => {
      it('should create a new session', async () => {
        const session = createTestSession();
        await store.createSession(session);

        const retrieved = await store.getSession(session.id);
        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(session.id);
      });

      it('should index session by access token', async () => {
        const session = createTestSession();
        await store.createSession(session);

        const retrieved = await store.getSessionByToken(session.mcpAccessToken);
        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(session.id);
      });

      it('should fail when the backend cannot store the session', async () => {
        // A sign-in must not be reported as complete when the session was not stored.
        const backend = new MemoryStorageBackend();
        jest.spyOn(backend, 'createSession').mockRejectedValue(new Error('database down'));
        await expect(new SessionStore(backend).createSession(createTestSession())).rejects.toThrow(
          'database down',
        );
      });
    });

    describe('getSession', () => {
      it('should return undefined for non-existent session', async () => {
        const session = await store.getSession('non-existent-id');
        expect(session).toBeUndefined();
      });

      it('should return existing session', async () => {
        const session = createTestSession();
        await store.createSession(session);

        const retrieved = await store.getSession(session.id);
        expect(retrieved).toEqual(session);
      });

      it('should read every lookup from the backend shared by replicas', async () => {
        // A session written through one store is visible through another on the same backend.
        const backend = new MemoryStorageBackend();
        const replicaA = new SessionStore(backend);
        const replicaB = new SessionStore(backend);
        const session = createTestSession({ id: 'shared' });

        await replicaA.createSession(session);

        expect((await replicaB.getSession('shared'))?.id).toBe('shared');
        expect((await replicaB.getSessionByRefreshToken(session.mcpRefreshToken))?.id).toBe(
          'shared',
        );
      });
    });

    describe('getSessionByToken', () => {
      it('should return undefined for non-existent token', async () => {
        const session = await store.getSessionByToken('non-existent-token');
        expect(session).toBeUndefined();
      });

      it('should return session by access token', async () => {
        const session = createTestSession({ mcpAccessToken: 'unique-token-123' });
        await store.createSession(session);

        const retrieved = await store.getSessionByToken('unique-token-123');
        expect(retrieved?.id).toBe(session.id);
      });
    });

    describe('updateSession', () => {
      it('should update session fields', async () => {
        const session = createTestSession();
        await store.createSession(session);

        await store.updateSession(session.id, {
          gitlabAccessToken: 'new-gitlab-token',
          gitlabRefreshToken: 'new-gitlab-refresh',
        });

        const updated = await store.getSession(session.id);
        expect(updated?.gitlabAccessToken).toBe('new-gitlab-token');
        expect(updated?.gitlabRefreshToken).toBe('new-gitlab-refresh');
      });

      it('should update updatedAt timestamp', async () => {
        const session = createTestSession({ updatedAt: 1000 });
        await store.createSession(session);

        const beforeUpdate = Date.now();
        await store.updateSession(session.id, { gitlabAccessToken: 'new-token' });

        const updated = await store.getSession(session.id);
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
      });

      it('should update token index when access token changes', async () => {
        const session = createTestSession({ mcpAccessToken: 'old-token' });
        await store.createSession(session);

        await store.updateSession(session.id, { mcpAccessToken: 'new-token' });

        // Old token should not find session
        expect(await store.getSessionByToken('old-token')).toBeUndefined();
        // New token should find session
        expect((await store.getSessionByToken('new-token'))?.id).toBe(session.id);
      });

      it('should do nothing for non-existent session', async () => {
        // Should not throw
        await expect(
          store.updateSession('non-existent', { gitlabAccessToken: 'new' }),
        ).resolves.toBe(false);
      });
    });

    describe('deleteSession', () => {
      it('should delete existing session', async () => {
        const session = createTestSession();
        await store.createSession(session);

        await store.deleteSession(session.id);

        expect(await store.getSession(session.id)).toBeUndefined();
      });

      it('should remove token index', async () => {
        const session = createTestSession();
        await store.createSession(session);

        await store.deleteSession(session.id);

        expect(await store.getSessionByToken(session.mcpAccessToken)).toBeUndefined();
      });

      it('should do nothing for non-existent session', async () => {
        // Should not throw
        await expect(store.deleteSession('non-existent')).resolves.toBe(false);
      });
    });

    describe('rotateSession', () => {
      it('rotates only while the session holds the presented refresh token', async () => {
        // Of two refreshes with the same token, exactly one may rotate the session.
        const session = createTestSession({ id: 'rotating', mcpRefreshToken: 'refresh-1' });
        await store.createSession(session);

        const [first, second] = await Promise.all([
          store.rotateSession('rotating', 'refresh-1', { mcpRefreshToken: 'refresh-A' }),
          store.rotateSession('rotating', 'refresh-1', { mcpRefreshToken: 'refresh-B' }),
        ]);

        expect([first, second].filter(Boolean)).toHaveLength(1);
        expect(await store.getSessionByRefreshToken('refresh-1')).toBeUndefined();
      });

      it('refuses an unknown session', async () => {
        await expect(store.rotateSession('missing', 'refresh-1', {})).resolves.toBe(false);
      });
    });
  });

  describe('Device Flow Operations', () => {
    describe('storeDeviceFlow', () => {
      it('should store device flow by state', async () => {
        const flow = createTestDeviceFlow();
        await store.storeDeviceFlow('flow-state-123', flow);

        const retrieved = await store.getDeviceFlow('flow-state-123');
        expect(retrieved).toBeDefined();
        expect(retrieved?.deviceCode).toBe(flow.deviceCode);
      });
    });

    describe('getDeviceFlow', () => {
      it('should return undefined for non-existent flow', async () => {
        const flow = await store.getDeviceFlow('non-existent');
        expect(flow).toBeUndefined();
      });

      it('should return existing flow', async () => {
        const flow = createTestDeviceFlow();
        await store.storeDeviceFlow('test-state', flow);

        const retrieved = await store.getDeviceFlow('test-state');
        expect(retrieved).toEqual(flow);
      });
    });

    describe('getDeviceFlowByDeviceCode', () => {
      it('should return undefined for non-existent device code', async () => {
        const flow = await store.getDeviceFlowByDeviceCode('non-existent');
        expect(flow).toBeUndefined();
      });

      it('should return flow by device code', async () => {
        const flow = createTestDeviceFlow({ deviceCode: 'unique-device-code' });
        await store.storeDeviceFlow('test-state', flow);

        const retrieved = await store.getDeviceFlowByDeviceCode('unique-device-code');
        expect(retrieved?.userCode).toBe(flow.userCode);
      });
    });

    describe('deleteDeviceFlow', () => {
      it('should delete existing flow', async () => {
        const flow = createTestDeviceFlow();
        await store.storeDeviceFlow('test-state', flow);

        await store.deleteDeviceFlow('test-state');

        expect(await store.getDeviceFlow('test-state')).toBeUndefined();
      });

      it('should do nothing for non-existent flow', async () => {
        await expect(store.deleteDeviceFlow('non-existent')).resolves.toBe(false);
      });
    });

    describe('consumeDeviceFlow', () => {
      it('gives the flow to exactly one of concurrent consumers', async () => {
        // One poller completes the flow, so one session is created.
        await store.storeDeviceFlow('test-state', createTestDeviceFlow());

        const claims = await Promise.all([
          store.consumeDeviceFlow('test-state'),
          store.consumeDeviceFlow('test-state'),
        ]);

        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(await store.getDeviceFlow('test-state')).toBeUndefined();
      });
    });
  });

  describe('Authorization Code Operations', () => {
    describe('storeAuthCode', () => {
      it('should store authorization code', async () => {
        const authCode = createTestAuthCode();
        await store.storeAuthCode(authCode);

        const retrieved = await store.getAuthCode(authCode.code);
        expect(retrieved).toBeDefined();
        expect(retrieved?.sessionId).toBe(authCode.sessionId);
      });
    });

    describe('getAuthCode', () => {
      it('should return undefined for non-existent code', async () => {
        const code = await store.getAuthCode('non-existent');
        expect(code).toBeUndefined();
      });

      it('should return existing code', async () => {
        const authCode = createTestAuthCode({ code: 'unique-code-123' });
        await store.storeAuthCode(authCode);

        const retrieved = await store.getAuthCode('unique-code-123');
        expect(retrieved).toEqual(authCode);
      });
    });

    describe('deleteAuthCode', () => {
      it('should delete existing code', async () => {
        const authCode = createTestAuthCode();
        await store.storeAuthCode(authCode);

        await store.deleteAuthCode(authCode.code);

        expect(await store.getAuthCode(authCode.code)).toBeUndefined();
      });

      it('should do nothing for non-existent code', async () => {
        await expect(store.deleteAuthCode('non-existent')).resolves.toBe(false);
      });
    });

    describe('consumeAuthCode', () => {
      it('redeems a code exactly once across concurrent exchanges', async () => {
        // RFC 6749 4.1.2: an authorization code is single-use.
        const authCode = createTestAuthCode({ code: 'single-use' });
        await store.storeAuthCode(authCode);

        const redemptions = await Promise.all([
          store.consumeAuthCode('single-use'),
          store.consumeAuthCode('single-use'),
        ]);

        expect(redemptions.filter(Boolean)).toEqual([authCode]);
        expect(await store.getAuthCode('single-use')).toBeUndefined();
      });

      it('returns nothing for an unknown code', async () => {
        expect(await store.consumeAuthCode('missing')).toBeUndefined();
      });
    });
  });

  describe('Cleanup Operations', () => {
    describe('cleanup', () => {
      it('should remove expired sessions', async () => {
        // Session expiration is based on createdAt + 7 days
        const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago (expired)
        const expiredSession = createTestSession({
          id: 'expired-session',
          createdAt: sevenDaysAgo,
        });
        const validSession = createTestSession({
          id: 'valid-session',
          createdAt: Date.now(), // Just created (not expired)
        });

        await store.createSession(expiredSession);
        await store.createSession(validSession);

        await store.cleanup();

        expect(await store.getSession('expired-session')).toBeUndefined();
        expect(await store.getSession('valid-session')).toBeDefined();
      });

      it('should remove expired device flows', async () => {
        const expiredFlow = createTestDeviceFlow({
          expiresAt: Date.now() - 1000, // Expired
        });
        const validFlow = createTestDeviceFlow({
          expiresAt: Date.now() + 600000, // Not expired
        });

        await store.storeDeviceFlow('expired-flow', expiredFlow);
        await store.storeDeviceFlow('valid-flow', validFlow);

        await store.cleanup();

        expect(await store.getDeviceFlow('expired-flow')).toBeUndefined();
        expect(await store.getDeviceFlow('valid-flow')).toBeDefined();
      });

      it('should remove expired auth codes', async () => {
        const expiredCode = createTestAuthCode({
          code: 'expired-code',
          expiresAt: Date.now() - 1000, // Expired
        });
        const validCode = createTestAuthCode({
          code: 'valid-code',
          expiresAt: Date.now() + 600000, // Not expired
        });

        await store.storeAuthCode(expiredCode);
        await store.storeAuthCode(validCode);

        await store.cleanup();

        expect(await store.getAuthCode('expired-code')).toBeUndefined();
        expect(await store.getAuthCode('valid-code')).toBeDefined();
      });
    });
  });

  describe('Authorization Code Flow Operations', () => {
    const createTestAuthCodeFlow = (): AuthCodeFlowState => ({
      clientId: 'test-client',
      codeChallenge: 'challenge-123',
      codeChallengeMethod: 'S256',
      clientState: 'client-state-123',
      internalState: 'internal-state-123',
      clientRedirectUri: 'https://client.example.com/callback',
      callbackUri: 'https://server.example.com/oauth/callback',
      expiresAt: Date.now() + 600000,
    });

    describe('storeAuthCodeFlow', () => {
      it('should store auth code flow by internal state', async () => {
        const flow = createTestAuthCodeFlow();
        await store.storeAuthCodeFlow('internal-state-123', flow);

        const retrieved = await store.getAuthCodeFlow('internal-state-123');
        expect(retrieved).toBeDefined();
        expect(retrieved?.clientId).toBe('test-client');
      });
    });

    describe('getAuthCodeFlow', () => {
      it('should return undefined for non-existent flow', async () => {
        const flow = await store.getAuthCodeFlow('non-existent');
        expect(flow).toBeUndefined();
      });
    });

    describe('deleteAuthCodeFlow', () => {
      it('should delete existing flow', async () => {
        const flow = createTestAuthCodeFlow();
        await store.storeAuthCodeFlow('test-state', flow);

        const deleted = await store.deleteAuthCodeFlow('test-state');

        expect(deleted).toBe(true);
        expect(await store.getAuthCodeFlow('test-state')).toBeUndefined();
      });

      it('should return false for non-existent flow', async () => {
        const deleted = await store.deleteAuthCodeFlow('non-existent');
        expect(deleted).toBe(false);
      });
    });

    describe('consumeAuthCodeFlow', () => {
      it('processes a callback state exactly once', async () => {
        await store.storeAuthCodeFlow('test-state', createTestAuthCodeFlow());

        const claims = await Promise.all([
          store.consumeAuthCodeFlow('test-state'),
          store.consumeAuthCodeFlow('test-state'),
        ]);

        expect(claims.filter(Boolean)).toHaveLength(1);
      });
    });

    describe('getAuthCodeFlowCount', () => {
      it('should return count of auth code flows', async () => {
        expect(await store.getAuthCodeFlowCount()).toBe(0);

        await store.storeAuthCodeFlow('flow-1', createTestAuthCodeFlow());
        expect(await store.getAuthCodeFlowCount()).toBe(1);

        await store.storeAuthCodeFlow('flow-2', createTestAuthCodeFlow());
        expect(await store.getAuthCodeFlowCount()).toBe(2);
      });
    });

    describe('cleanup expired auth code flows', () => {
      it('should remove expired auth code flows', async () => {
        const expiredFlow = { ...createTestAuthCodeFlow(), expiresAt: Date.now() - 1000 };
        const validFlow = { ...createTestAuthCodeFlow(), expiresAt: Date.now() + 600000 };

        await store.storeAuthCodeFlow('expired-flow', expiredFlow);
        await store.storeAuthCodeFlow('valid-flow', validFlow);

        await store.cleanup();

        expect(await store.getAuthCodeFlow('expired-flow')).toBeUndefined();
        expect(await store.getAuthCodeFlow('valid-flow')).toBeDefined();
      });
    });
  });

  describe('Registered Clients', () => {
    it('keeps a registration visible to every store on the backend', async () => {
      // Dynamic registrations must survive across replicas sharing the backend.
      const backend: SessionStorageBackend = new MemoryStorageBackend();
      const client = {
        clientId: 'dcr-client',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        createdAt: 1,
      };

      await new SessionStore(backend).storeClient(client);

      expect(await new SessionStore(backend).getClient('dcr-client')).toEqual(client);
      expect(await store.getClient('dcr-client')).toBeUndefined();
    });
  });

  describe('MCP Session Mapping Operations', () => {
    describe('associateMcpSession', () => {
      it('should associate MCP session with OAuth session', async () => {
        const session = createTestSession();
        await store.createSession(session);

        await store.associateMcpSession('mcp-session-123', session.id);

        const retrieved = await store.getSessionByMcpSessionId('mcp-session-123');
        expect(retrieved?.id).toBe(session.id);
      });
    });

    describe('getSessionByMcpSessionId', () => {
      it('should return undefined for non-existent MCP session', async () => {
        const session = await store.getSessionByMcpSessionId('non-existent');
        expect(session).toBeUndefined();
      });

      it('should return undefined when OAuth session was deleted', async () => {
        const session = createTestSession();
        await store.createSession(session);
        await store.associateMcpSession('mcp-session-123', session.id);
        await store.deleteSession(session.id);

        const retrieved = await store.getSessionByMcpSessionId('mcp-session-123');
        expect(retrieved).toBeUndefined();
      });
    });

    describe('getGitLabTokenByMcpSessionId', () => {
      it('should return GitLab token for valid MCP session', async () => {
        const session = createTestSession({ gitlabAccessToken: 'gitlab-token-xyz' });
        await store.createSession(session);
        await store.associateMcpSession('mcp-session-123', session.id);

        const token = await store.getGitLabTokenByMcpSessionId('mcp-session-123');
        expect(token).toBe('gitlab-token-xyz');
      });

      it('should return undefined for non-existent MCP session', async () => {
        const token = await store.getGitLabTokenByMcpSessionId('non-existent');
        expect(token).toBeUndefined();
      });
    });

    describe('removeMcpSessionAssociation', () => {
      it('should remove MCP session association', async () => {
        const session = createTestSession();
        await store.createSession(session);
        await store.associateMcpSession('mcp-session-123', session.id);

        const deleted = await store.removeMcpSessionAssociation('mcp-session-123');

        expect(deleted).toBe(true);
        expect(await store.getSessionByMcpSessionId('mcp-session-123')).toBeUndefined();
      });

      it('should return false for non-existent association', async () => {
        const deleted = await store.removeMcpSessionAssociation('non-existent');
        expect(deleted).toBe(false);
      });
    });
  });

  describe('Session Enumeration', () => {
    describe('getAllSessions', () => {
      it('should return empty list when no sessions', async () => {
        const sessions = await store.getAllSessions();
        expect(sessions).toEqual([]);
      });

      it('should return all sessions', async () => {
        const session1 = createTestSession({ id: 'session-1' });
        const session2 = createTestSession({ id: 'session-2' });

        await store.createSession(session1);
        await store.createSession(session2);

        const sessions = await store.getAllSessions();
        expect(sessions).toHaveLength(2);
        expect(sessions.map((s) => s.id)).toContain('session-1');
        expect(sessions.map((s) => s.id)).toContain('session-2');
      });
    });

    describe('getSessionByRefreshToken', () => {
      it('should return undefined for non-existent refresh token', async () => {
        const session = await store.getSessionByRefreshToken('non-existent');
        expect(session).toBeUndefined();
      });

      it('should return session by refresh token', async () => {
        const session = createTestSession({ mcpRefreshToken: 'unique-refresh-token' });
        await store.createSession(session);

        const retrieved = await store.getSessionByRefreshToken('unique-refresh-token');
        expect(retrieved?.id).toBe(session.id);
      });
    });

    describe('getSessionCount', () => {
      it('should return count of sessions', async () => {
        expect(await store.getSessionCount()).toBe(0);

        await store.createSession(createTestSession({ id: 'session-1' }));
        expect(await store.getSessionCount()).toBe(1);

        await store.createSession(createTestSession({ id: 'session-2' }));
        expect(await store.getSessionCount()).toBe(2);
      });
    });

    describe('getDeviceFlowCount', () => {
      it('should return count of device flows', async () => {
        expect(await store.getDeviceFlowCount()).toBe(0);

        await store.storeDeviceFlow('flow-1', createTestDeviceFlow());
        expect(await store.getDeviceFlowCount()).toBe(1);
      });
    });

    describe('getAuthCodeCount', () => {
      it('should return count of auth codes', async () => {
        expect(await store.getAuthCodeCount()).toBe(0);

        await store.storeAuthCode(createTestAuthCode({ code: 'code-1' }));
        expect(await store.getAuthCodeCount()).toBe(1);
      });
    });
  });

  describe('updateSession edge cases', () => {
    it('should return false for non-existent session', async () => {
      const result = await store.updateSession('non-existent', { gitlabAccessToken: 'new' });
      expect(result).toBe(false);
    });

    it('should update refresh token index when refresh token changes', async () => {
      const session = createTestSession({ mcpRefreshToken: 'old-refresh' });
      await store.createSession(session);

      await store.updateSession(session.id, { mcpRefreshToken: 'new-refresh' });

      expect(await store.getSessionByRefreshToken('old-refresh')).toBeUndefined();
      expect((await store.getSessionByRefreshToken('new-refresh'))?.id).toBe(session.id);
    });
  });

  describe('Store Management', () => {
    describe('getBackendType', () => {
      it('should return backend type', () => {
        const type = store.getBackendType();
        expect(type).toBe('memory');
      });
    });

    describe('getStats', () => {
      it('should return store statistics', async () => {
        await store.createSession(createTestSession({ id: 's1' }));
        await store.createSession(createTestSession({ id: 's2' }));
        await store.storeDeviceFlow('df1', createTestDeviceFlow());
        await store.storeAuthCode(createTestAuthCode({ code: 'ac1' }));

        const stats = await store.getStats();

        expect(stats.sessions).toBe(2);
        expect(stats.deviceFlows).toBe(1);
        expect(stats.authCodes).toBe(1);
        expect(stats.authCodeFlows).toBe(0);
      });
    });

    describe('clear', () => {
      it('should clear all data', async () => {
        await store.createSession(createTestSession({ id: 's1' }));
        await store.storeDeviceFlow('df1', createTestDeviceFlow());
        await store.storeAuthCode(createTestAuthCode({ code: 'ac1' }));

        store.clear();

        expect(await store.getSessionCount()).toBe(0);
        expect(await store.getDeviceFlowCount()).toBe(0);
        expect(await store.getAuthCodeCount()).toBe(0);
      });

      it('should never wipe a shared database', () => {
        const backend = { type: 'postgresql' } as unknown as SessionStorageBackend;
        expect(() => new SessionStore(backend).clear()).toThrow(
          'clear() is only supported for in-memory storage',
        );
      });
    });

    describe('stopCleanupInterval', () => {
      it('should stop cleanup interval without error', () => {
        expect(() => store.stopCleanupInterval()).not.toThrow();
      });

      it('should be safe to call multiple times', () => {
        expect(() => {
          store.stopCleanupInterval();
          store.stopCleanupInterval();
        }).not.toThrow();
      });
    });
  });
});
