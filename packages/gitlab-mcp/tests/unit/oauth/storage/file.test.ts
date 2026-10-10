/**
 * Unit tests for File Storage Backend
 * Tests file persistence, atomic writes, and recovery scenarios
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStorageBackend } from '../../../../src/oauth/storage/file';
import { STORAGE_DATA_VERSION, StorageData } from '../../../../src/oauth/storage/types';
import {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
} from '../../../../src/oauth/types';

describe('FileStorageBackend', () => {
  let storage: FileStorageBackend;
  let tempDir: string;
  let filePath: string;

  // Helper function to create a test session
  const createTestSession = (overrides: Partial<OAuthSession> = {}): OAuthSession => ({
    id: `session-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    mcpAccessToken: `mcp-token-${Math.random().toString(36).substring(7)}`,
    mcpRefreshToken: `mcp-refresh-${Math.random().toString(36).substring(7)}`,
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
    deviceCode: `device-code-${Math.random().toString(36).substring(7)}`,
    userCode: 'ABCD-1234',
    verificationUri: 'https://gitlab.example.com/oauth/authorize',
    verificationUriComplete: 'https://gitlab.example.com/oauth/authorize?user_code=ABCD-1234',
    expiresAt: Date.now() + 600000,
    interval: 5,
    clientId: 'test-client',
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    state: `state-${Math.random().toString(36).substring(7)}`,
    redirectUri: 'https://callback.example.com',
    ...overrides,
  });

  // Helper function to create a test auth code flow
  const createTestAuthCodeFlow = (
    overrides: Partial<AuthCodeFlowState> = {},
  ): AuthCodeFlowState => ({
    clientId: 'test-client',
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    clientState: 'client-state-123',
    internalState: `internal-${Math.random().toString(36).substring(7)}`,
    clientRedirectUri: 'https://client.example.com/callback',
    callbackUri: 'https://server.example.com/callback',
    expiresAt: Date.now() + 600000,
    ...overrides,
  });

  // Helper function to create a test auth code
  const createTestAuthCode = (overrides: Partial<AuthorizationCode> = {}): AuthorizationCode => ({
    code: `auth-code-${Math.random().toString(36).substring(7)}`,
    sessionId: 'session-456',
    clientId: 'test-client',
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    redirectUri: 'https://callback.example.com',
    expiresAt: Date.now() + 600000,
    ...overrides,
  });

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-storage-test-'));
    filePath = path.join(tempDir, 'sessions.json');
  });

  afterEach(async () => {
    // Close storage if initialized
    if (storage) {
      await storage.close();
    }

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Single-use transitions must be on disk before they are reported: with the debounced
  // save, a crash right after redeeming a code reloaded the code from the file and let it
  // be redeemed again (same for a spent refresh token and a revoked session).
  describe('single-use transitions survive a crash', () => {
    const slowSave = { saveDebounce: 60_000, saveInterval: 60_000 };

    /** State as a new process sees it after this one died without flushing. */
    async function reloadAfterCrash(): Promise<FileStorageBackend> {
      const restarted = new FileStorageBackend({ filePath, ...slowSave });
      await restarted.initialize();
      return restarted;
    }

    async function seeded(): Promise<{ session: OAuthSession; code: AuthorizationCode }> {
      const session = createTestSession();
      const code = createTestAuthCode({ sessionId: session.id });
      const seed = new FileStorageBackend({ filePath, ...slowSave });
      await seed.initialize();
      await seed.createSession(session);
      await seed.storeAuthCode(code);
      await seed.close();
      storage = new FileStorageBackend({ filePath, ...slowSave });
      await storage.initialize();
      return { session, code };
    }

    it('persists a consumed authorization code', async () => {
      const { code } = await seeded();

      expect(await storage.consumeAuthCode(code.code)).toBeDefined();
      const restarted = await reloadAfterCrash();

      expect(await restarted.consumeAuthCode(code.code)).toBeUndefined();
      await restarted.close();
    });

    it('persists a rotated refresh token', async () => {
      const { session } = await seeded();

      expect(
        await storage.rotateSession(session.id, session.mcpRefreshToken, {
          mcpRefreshToken: 'rotated-refresh',
        }),
      ).toBe(true);
      const restarted = await reloadAfterCrash();

      expect(await restarted.getSessionByRefreshToken(session.mcpRefreshToken)).toBeUndefined();
      await restarted.close();
    });

    it('persists consumed authorization and device flows', async () => {
      await seeded();
      const authFlow = createTestAuthCodeFlow();
      const deviceFlow = createTestDeviceFlow();
      await storage.storeAuthCodeFlow(authFlow.internalState, authFlow);
      await storage.storeDeviceFlow('device-state', deviceFlow);

      expect(await storage.consumeAuthCodeFlow(authFlow.internalState)).toBeDefined();
      expect(await storage.consumeDeviceFlow('device-state')).toBeDefined();
      const restarted = await reloadAfterCrash();

      expect(await restarted.getAuthCodeFlow(authFlow.internalState)).toBeUndefined();
      expect(await restarted.getDeviceFlow('device-state')).toBeUndefined();
      await restarted.close();
    });

    it('reports a missed consumption or rotation without writing', async () => {
      const { session } = await seeded();
      const before = fs.statSync(filePath).mtimeMs;

      expect(await storage.consumeAuthCode('unknown')).toBeUndefined();
      expect(await storage.consumeAuthCodeFlow('unknown')).toBeUndefined();
      expect(await storage.consumeDeviceFlow('unknown')).toBeUndefined();
      expect(await storage.rotateSession(session.id, 'not-current', {})).toBe(false);

      expect(fs.statSync(filePath).mtimeMs).toBe(before);
    });

    /** The next file write fails, on every platform and for every user (root included). */
    function failNextWrite(): jest.SpyInstance {
      return jest
        .spyOn(fs.promises, 'open')
        .mockRejectedValueOnce(
          Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
        );
    }

    // A transition that could not be written must not be reported as done.
    it('fails the operation when the write-through fails', async () => {
      const { code } = await seeded();
      const open = failNextWrite();
      try {
        await expect(storage.consumeAuthCode(code.code)).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }
    });

    // Issued MCP tokens and refreshed GitLab tokens (whose predecessors are spent) are
    // returned to clients right after this update; losing it strands the account.
    it('persists a session update', async () => {
      const { session } = await seeded();

      expect(
        await storage.updateSession(session.id, {
          mcpAccessToken: 'issued-access',
          gitlabRefreshToken: 'gl-refresh-new',
        }),
      ).toBe(true);
      const restarted = await reloadAfterCrash();

      const stored = await restarted.getSession(session.id);
      expect(stored?.mcpAccessToken).toBe('issued-access');
      expect(stored?.gitlabRefreshToken).toBe('gl-refresh-new');
      await restarted.close();
    });

    // Each of these is handed to a client or to GitLab right after it is stored: a client
    // id, a code, a session behind a code, a flow GitLab will call back for, and a device
    // flow holding tokens GitLab issued once. A crash must not lose them.
    it('persists records handed to clients or GitLab', async () => {
      await seeded();
      const client = {
        clientId: 'registered-client',
        redirectUris: ['https://client.example.com/callback'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        createdAt: 1,
      };
      const session = createTestSession();
      const code = createTestAuthCode({ sessionId: session.id });
      const authFlow = createTestAuthCodeFlow();
      const deviceFlow = createTestDeviceFlow({
        gitlabTokens: {
          access_token: 'gl-at',
          refresh_token: 'gl-rt',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: 1,
        },
      });

      await storage.storeClient(client);
      await storage.createSession(session);
      await storage.storeAuthCode(code);
      await storage.storeAuthCodeFlow(authFlow.internalState, authFlow);
      await storage.storeDeviceFlow('device-state', deviceFlow);
      const restarted = await reloadAfterCrash();

      expect(await restarted.getClient(client.clientId)).toEqual(client);
      expect(await restarted.getSession(session.id)).toEqual(session);
      expect(await restarted.getAuthCode(code.code)).toEqual(code);
      expect(await restarted.getAuthCodeFlow(authFlow.internalState)).toEqual(authFlow);
      expect((await restarted.getDeviceFlow('device-state'))?.gitlabTokens).toEqual(
        deviceFlow.gitlabTokens,
      );
      await restarted.close();
    });

    // Writes do not block the event loop, so several can be in flight: they must not share
    // the temp file, and the file must end with every record.
    it('keeps every record when writes run concurrently', async () => {
      await seeded();
      const clients = Array.from({ length: 10 }, (_, i) => ({
        clientId: `client-${i}`,
        redirectUris: ['https://client.example.com/callback'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt: i,
      }));

      await Promise.all(clients.map((client) => storage.storeClient(client)));
      const restarted = await reloadAfterCrash();

      for (const client of clients) {
        expect(await restarted.getClient(client.clientId)).toEqual(client);
      }
      await restarted.close();
    });

    // A process crash keeps the page cache; a power loss does not. The new file and the
    // rename are flushed before a write-through is reported.
    it('flushes the file and the directory to disk', async () => {
      const { code } = await seeded();
      const realOpen = fs.promises.open.bind(fs.promises);
      const synced: string[] = [];
      const open = jest
        .spyOn(fs.promises, 'open')
        .mockImplementation(async (file: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
          const handle = await realOpen(file, flags, mode);
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            synced.push(String(file));
            await sync();
          };
          return handle;
        });
      try {
        await storage.consumeAuthCode(code.code);
      } finally {
        open.mockRestore();
      }

      expect(synced).toContain(`${filePath}.tmp`);
      if (process.platform !== 'win32') expect(synced).toContain(tempDir);
    });

    // A rotation that could not be written is reported as a failure: the client never got
    // the new refresh token, so its old one must keep working for the retry.
    it('keeps the old refresh token when the rotation cannot be written', async () => {
      const { session } = await seeded();
      const open = failNextWrite();
      try {
        await expect(
          storage.rotateSession(session.id, session.mcpRefreshToken, {
            mcpAccessToken: 'undisclosed-access',
            mcpRefreshToken: 'undisclosed-refresh',
          }),
        ).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }

      expect((await storage.getSessionByRefreshToken(session.mcpRefreshToken))?.id).toBe(
        session.id,
      );
      expect(await storage.getSessionByRefreshToken('undisclosed-refresh')).toBeUndefined();
      expect(await storage.getSessionByToken('undisclosed-access')).toBeUndefined();
    });

    // A write started meanwhile by another request must not persist the rotation that
    // failed: after a restart the client's old refresh token still has to work.
    it('does not let a concurrent write persist a failed rotation', async () => {
      const { session } = await seeded();
      const open = failNextWrite();
      let rotation: Promise<boolean>;
      try {
        rotation = storage.rotateSession(session.id, session.mcpRefreshToken, {
          mcpRefreshToken: 'undisclosed-refresh',
        });
        const other = storage.createSession(createTestSession({ id: 'concurrent' }));
        await expect(rotation).rejects.toThrow('EACCES');
        await other;
      } finally {
        open.mockRestore();
      }
      const restarted = await reloadAfterCrash();

      expect((await restarted.getSessionByRefreshToken(session.mcpRefreshToken))?.id).toBe(
        session.id,
      );
      expect(await restarted.getSessionByRefreshToken('undisclosed-refresh')).toBeUndefined();
      expect(await restarted.getSession('concurrent')).toBeDefined();
      await restarted.close();
    });

    // Same for a consumption: the caller saw a failure, so the code stays redeemable.
    it('keeps a code whose consumption cannot be written', async () => {
      const { code } = await seeded();
      const open = failNextWrite();
      try {
        await expect(storage.consumeAuthCode(code.code)).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }

      expect(await storage.consumeAuthCode(code.code)).toBeDefined();
    });

    // An approved flow whose consumption failed is completed by the retry.
    it('keeps flows whose consumption cannot be written', async () => {
      await seeded();
      const authFlow = createTestAuthCodeFlow();
      await storage.storeAuthCodeFlow(authFlow.internalState, authFlow);
      await storage.storeDeviceFlow('device-state', createTestDeviceFlow());
      let open = failNextWrite();
      try {
        await expect(storage.consumeAuthCodeFlow(authFlow.internalState)).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }
      open = failNextWrite();
      try {
        await expect(storage.consumeDeviceFlow('device-state')).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }

      expect(await storage.consumeAuthCodeFlow(authFlow.internalState)).toBeDefined();
      expect(await storage.consumeDeviceFlow('device-state')).toBeDefined();
    });

    it('writes again after a failed write', async () => {
      const { code } = await seeded();
      const open = failNextWrite();
      try {
        await expect(storage.consumeAuthCode(code.code)).rejects.toThrow('EACCES');
      } finally {
        open.mockRestore();
      }

      await storage.createSession(createTestSession({ id: 'after-failure' }));
      const restarted = await reloadAfterCrash();

      expect(await restarted.getSession('after-failure')).toBeDefined();
      await restarted.close();
    });

    // A write-through also carries changes waiting for the debounced save and replaces it.
    it('writes pending debounced changes with the next write-through', async () => {
      const { session } = await seeded();
      await storage.associateMcpSession('mcp-session', session.id);

      await storage.storeClient({
        clientId: 'another-client',
        redirectUris: ['https://client.example.com/callback'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt: 1,
      });
      const restarted = await reloadAfterCrash();

      expect((await restarted.getSessionByMcpSessionId('mcp-session'))?.id).toBe(session.id);
      await restarted.close();
    });

    it('persists a revoked session', async () => {
      const { session } = await seeded();

      expect(await storage.deleteSession(session.id)).toBe(true);
      const restarted = await reloadAfterCrash();

      expect(await restarted.getSession(session.id)).toBeUndefined();
      await restarted.close();
    });

    // Background saves (cleanup, debounce, close) have no caller to report to: a failed
    // one is logged and the next save writes the state again.
    it('does not fail cleanup when its save fails', async () => {
      await seeded();
      const open = failNextWrite();
      try {
        await expect(storage.cleanup()).resolves.toBeUndefined();
      } finally {
        open.mockRestore();
      }
    });

    // The hourly count of a source survives a restart: registrations are written through.
    it('counts registrations of a source after a restart', async () => {
      await seeded();
      const client = (clientId: string, createdAt: number) => ({
        clientId,
        redirectUris: ['https://client.example.com/callback'],
        tokenEndpointAuthMethod: 'none' as const,
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt,
        registeredFrom: 'source-hash',
        expiresAt: Date.now() + 60_000,
      });
      await storage.storeClient(client('older', 1));
      await storage.storeClient(client('newer', 2));
      const restarted = await reloadAfterCrash();

      expect(await restarted.countClientsRegisteredSince('source-hash', 2)).toBe(1);
      expect(await restarted.countClientsRegisteredSince('source-hash', 0)).toBe(2);
      await restarted.close();
    });

    // Windows cannot open a directory to flush it; NTFS journals the rename itself.
    it('does not sync the directory on Windows', async () => {
      const { code } = await seeded();
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      const open = jest.spyOn(fs.promises, 'open');
      let opened: string[];
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        await storage.consumeAuthCode(code.code);
        opened = open.mock.calls.map(([file]) => String(file));
      } finally {
        Object.defineProperty(process, 'platform', platform);
        open.mockRestore();
      }

      expect(opened).toContain(`${filePath}.tmp`);
      expect(opened).not.toContain(tempDir);
    });
  });

  // The reservations of the device poll and the GitLab refresh behave as in memory.
  describe('poll reservation and refresh lease', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({ filePath });
      await storage.initialize();
    });

    it('reserves a device poll once per interval', async () => {
      await storage.storeDeviceFlow('flow', createTestDeviceFlow({ nextPollAt: 1000 }));

      expect((await storage.claimDevicePoll('flow', 1000, 6000))?.nextPollAt).toBe(6000);
      expect(await storage.claimDevicePoll('flow', 1000, 6000)).toBeUndefined();
    });

    it('leases a GitLab refresh token until released', async () => {
      const session = createTestSession({ gitlabRefreshToken: 'grt' });
      await storage.createSession(session);

      expect(await storage.claimGitLabRefresh(session.id, 'grt', 1, 30001)).toBe(true);
      expect(await storage.claimGitLabRefresh(session.id, 'grt', 2, 30002)).toBe(false);
      await storage.releaseGitLabRefresh(session.id, 30001);
      expect(await storage.claimGitLabRefresh(session.id, 'grt', 3, 30003)).toBe(true);
    });
  });

  describe('Initialization and Lifecycle', () => {
    it('should initialize with empty file', async () => {
      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      expect(storage.type).toBe('file');
      const stats = await storage.getStats();
      expect(stats.sessions).toBe(0);
    });

    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'sessions.json');
      storage = new FileStorageBackend({ filePath: nestedPath });
      await storage.initialize();

      expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);
    });

    it('should load existing data from file', async () => {
      // Create a storage file with existing data
      const existingData: StorageData = {
        version: STORAGE_DATA_VERSION,
        exportedAt: Date.now(),
        sessions: [createTestSession({ id: 'existing-session' })],
        deviceFlows: [],
        authCodeFlows: [],
        authCodes: [],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      const session = await storage.getSession('existing-session');
      expect(session).toBeDefined();
      expect(session?.id).toBe('existing-session');
    });

    it('should filter expired sessions on load', async () => {
      // Create a storage file with expired and valid sessions
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const existingData: StorageData = {
        version: STORAGE_DATA_VERSION,
        exportedAt: Date.now(),
        sessions: [
          createTestSession({ id: 'expired-session', createdAt: eightDaysAgo }),
          createTestSession({ id: 'valid-session', createdAt: Date.now() }),
        ],
        deviceFlows: [],
        authCodeFlows: [],
        authCodes: [],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      expect(await storage.getSession('expired-session')).toBeUndefined();
      expect(await storage.getSession('valid-session')).toBeDefined();
    });

    it('should filter expired device flows on load', async () => {
      const existingData: StorageData = {
        version: STORAGE_DATA_VERSION,
        exportedAt: Date.now(),
        sessions: [],
        deviceFlows: [
          { state: 'expired-flow', flow: createTestDeviceFlow({ expiresAt: Date.now() - 1000 }) },
          { state: 'valid-flow', flow: createTestDeviceFlow({ expiresAt: Date.now() + 600000 }) },
        ],
        authCodeFlows: [],
        authCodes: [],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      expect(await storage.getDeviceFlow('expired-flow')).toBeUndefined();
      expect(await storage.getDeviceFlow('valid-flow')).toBeDefined();
    });

    it('should filter expired auth code flows on load', async () => {
      const existingData: StorageData = {
        version: STORAGE_DATA_VERSION,
        exportedAt: Date.now(),
        sessions: [],
        deviceFlows: [],
        authCodeFlows: [
          {
            internalState: 'expired-flow',
            flow: createTestAuthCodeFlow({ expiresAt: Date.now() - 1000 }),
          },
          {
            internalState: 'valid-flow',
            flow: createTestAuthCodeFlow({ expiresAt: Date.now() + 600000 }),
          },
        ],
        authCodes: [],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      expect(await storage.getAuthCodeFlow('expired-flow')).toBeUndefined();
      expect(await storage.getAuthCodeFlow('valid-flow')).toBeDefined();
    });

    it('should filter expired auth codes on load', async () => {
      const existingData: StorageData = {
        version: STORAGE_DATA_VERSION,
        exportedAt: Date.now(),
        sessions: [],
        deviceFlows: [],
        authCodeFlows: [],
        authCodes: [
          createTestAuthCode({ code: 'expired-code', expiresAt: Date.now() - 1000 }),
          createTestAuthCode({ code: 'valid-code', expiresAt: Date.now() + 600000 }),
        ],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      expect(await storage.getAuthCode('expired-code')).toBeUndefined();
      expect(await storage.getAuthCode('valid-code')).toBeDefined();
    });

    it('should handle corrupted file gracefully', async () => {
      // Write invalid JSON
      fs.writeFileSync(filePath, 'not valid json', 'utf-8');

      storage = new FileStorageBackend({ filePath });
      // Should not throw - starts fresh
      await storage.initialize();

      const stats = await storage.getStats();
      expect(stats.sessions).toBe(0);
    });

    it('should throw if directory is not writable', async () => {
      // Skip this test on Windows as permission handling differs
      if (process.platform === 'win32') {
        return;
      }

      const readOnlyDir = path.join(tempDir, 'readonly');
      fs.mkdirSync(readOnlyDir);
      fs.chmodSync(readOnlyDir, 0o444);

      const readOnlyPath = path.join(readOnlyDir, 'sessions.json');
      storage = new FileStorageBackend({ filePath: readOnlyPath });

      await expect(storage.initialize()).rejects.toThrow('not writable');

      // Cleanup: make writable again before rmSync
      fs.chmodSync(readOnlyDir, 0o755);
    });

    it('should handle version mismatch on load', async () => {
      const oldVersionData = {
        version: 0, // Old version
        exportedAt: Date.now(),
        sessions: [createTestSession({ id: 'migrated-session' })],
        deviceFlows: [],
        authCodeFlows: [],
        authCodes: [],
        mcpSessionMappings: [],
      };
      fs.writeFileSync(filePath, JSON.stringify(oldVersionData), 'utf-8');

      storage = new FileStorageBackend({ filePath });
      await storage.initialize();

      // Data should still be loaded (migration happens in place)
      const session = await storage.getSession('migrated-session');
      expect(session).toBeDefined();
    });
  });

  describe('Session Operations with Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 10, // Fast debounce for tests
        saveInterval: 60000, // Long interval to avoid auto-saves
      });
      await storage.initialize();
    });

    it('should persist session creation', async () => {
      const session = createTestSession({ id: 'persist-test' });
      await storage.createSession(session);

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify file was written
      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('persist-test');
    });

    it('should persist session updates', async () => {
      const session = createTestSession({ id: 'update-test' });
      await storage.createSession(session);
      await storage.updateSession('update-test', { gitlabAccessToken: 'new-token' });

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions[0].gitlabAccessToken).toBe('new-token');
    });

    it('should persist session deletion', async () => {
      const session = createTestSession({ id: 'delete-test' });
      await storage.createSession(session);

      // Both are written through before they resolve.
      await storage.deleteSession('delete-test');

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions).toHaveLength(0);
    });
  });

  describe('Device Flow Operations with Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 10,
        saveInterval: 60000,
      });
      await storage.initialize();
    });

    it('should persist device flow', async () => {
      const flow = createTestDeviceFlow({ deviceCode: 'persist-device' });
      await storage.storeDeviceFlow('flow-state', flow);

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.deviceFlows).toHaveLength(1);
      expect(data.deviceFlows[0].state).toBe('flow-state');
    });

    it('should persist device flow deletion', async () => {
      const flow = createTestDeviceFlow();
      await storage.storeDeviceFlow('delete-flow-state', flow);

      await storage.deleteDeviceFlow('delete-flow-state');

      // The deletion is saved with the debounce; flush it instead of racing the timer.
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.deviceFlows).toHaveLength(0);
    });
  });

  describe('Auth Code Flow Operations with Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 10,
        saveInterval: 60000,
      });
      await storage.initialize();
    });

    it('should persist auth code flow', async () => {
      const flow = createTestAuthCodeFlow({ internalState: 'persist-auth-flow' });
      await storage.storeAuthCodeFlow('persist-auth-flow', flow);

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.authCodeFlows).toHaveLength(1);
      expect(data.authCodeFlows[0].internalState).toBe('persist-auth-flow');
    });

    it('should persist auth code flow deletion', async () => {
      const flow = createTestAuthCodeFlow({ internalState: 'delete-auth-flow' });
      await storage.storeAuthCodeFlow('delete-auth-flow', flow);

      await storage.deleteAuthCodeFlow('delete-auth-flow');

      // The deletion is saved with the debounce; flush it instead of racing the timer.
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.authCodeFlows).toHaveLength(0);
    });
  });

  describe('Authorization Code Operations with Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 10,
        saveInterval: 60000,
      });
      await storage.initialize();
    });

    it('should persist auth code', async () => {
      const authCode = createTestAuthCode({ code: 'persist-code' });
      await storage.storeAuthCode(authCode);

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.authCodes).toHaveLength(1);
      expect(data.authCodes[0].code).toBe('persist-code');
    });

    it('should persist auth code deletion', async () => {
      const authCode = createTestAuthCode({ code: 'delete-code' });
      await storage.storeAuthCode(authCode);

      await storage.deleteAuthCode('delete-code');

      // The deletion is saved with the debounce; flush it instead of racing the timer.
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.authCodes).toHaveLength(0);
    });
  });

  describe('MCP Session Mapping Operations with Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 10,
        saveInterval: 60000,
      });
      await storage.initialize();
    });

    it('should persist MCP session association', async () => {
      const session = createTestSession({ id: 'mapped-session' });
      await storage.createSession(session);
      await storage.associateMcpSession('mcp-123', 'mapped-session');

      // Transport mappings are saved with the debounce; flush instead of racing the timer.
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.mcpSessionMappings).toHaveLength(1);
      expect(data.mcpSessionMappings[0].mcpSessionId).toBe('mcp-123');
    });

    it('should persist MCP session association removal', async () => {
      const session = createTestSession({ id: 'mapped-session-2' });
      await storage.createSession(session);
      await storage.associateMcpSession('mcp-456', 'mapped-session-2');

      await storage.removeMcpSessionAssociation('mcp-456');

      // Transport mappings are saved with the debounce; flush instead of racing the timer.
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.mcpSessionMappings).toHaveLength(0);
    });
  });

  describe('Read Operations (No Persistence Needed)', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();
    });

    it('should get session by ID', async () => {
      const session = createTestSession({ id: 'get-test' });
      await storage.createSession(session);

      const retrieved = await storage.getSession('get-test');
      expect(retrieved?.id).toBe('get-test');
    });

    it('should get session by token', async () => {
      const session = createTestSession({ mcpAccessToken: 'get-token-test' });
      await storage.createSession(session);

      const retrieved = await storage.getSessionByToken('get-token-test');
      expect(retrieved?.mcpAccessToken).toBe('get-token-test');
    });

    it('should get session by refresh token', async () => {
      const session = createTestSession({ mcpRefreshToken: 'get-refresh-test' });
      await storage.createSession(session);

      const retrieved = await storage.getSessionByRefreshToken('get-refresh-test');
      expect(retrieved?.mcpRefreshToken).toBe('get-refresh-test');
    });

    it('should get all sessions', async () => {
      await storage.createSession(createTestSession({ id: 'all-1' }));
      await storage.createSession(createTestSession({ id: 'all-2' }));

      const sessions = await storage.getAllSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should get device flow', async () => {
      const flow = createTestDeviceFlow();
      await storage.storeDeviceFlow('get-flow', flow);

      const retrieved = await storage.getDeviceFlow('get-flow');
      expect(retrieved?.deviceCode).toBe(flow.deviceCode);
    });

    it('should get device flow by device code', async () => {
      const flow = createTestDeviceFlow({ deviceCode: 'search-device' });
      await storage.storeDeviceFlow('search-state', flow);

      const retrieved = await storage.getDeviceFlowByDeviceCode('search-device');
      expect(retrieved?.deviceCode).toBe('search-device');
    });

    it('should get auth code flow', async () => {
      const flow = createTestAuthCodeFlow({ internalState: 'get-auth-flow' });
      await storage.storeAuthCodeFlow('get-auth-flow', flow);

      const retrieved = await storage.getAuthCodeFlow('get-auth-flow');
      expect(retrieved?.clientId).toBe(flow.clientId);
    });

    it('should get auth code', async () => {
      const authCode = createTestAuthCode({ code: 'get-code' });
      await storage.storeAuthCode(authCode);

      const retrieved = await storage.getAuthCode('get-code');
      expect(retrieved?.code).toBe('get-code');
    });

    it('should get session by MCP session ID', async () => {
      const session = createTestSession({ id: 'get-mcp-mapped' });
      await storage.createSession(session);
      await storage.associateMcpSession('get-mcp-id', 'get-mcp-mapped');

      const retrieved = await storage.getSessionByMcpSessionId('get-mcp-id');
      expect(retrieved?.id).toBe('get-mcp-mapped');
    });
  });

  describe('Cleanup and Persistence', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();
    });

    it('should save after cleanup', async () => {
      const expiredSession = createTestSession({
        id: 'cleanup-expired',
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });
      const validSession = createTestSession({ id: 'cleanup-valid' });

      await storage.createSession(expiredSession);
      await storage.createSession(validSession);

      // Wait for initial save
      await new Promise((resolve) => setTimeout(resolve, 50));

      await storage.cleanup();

      // Cleanup triggers immediate save, no need to wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 10));

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('cleanup-valid');
    });
  });

  describe('Force Save', () => {
    it('should save immediately on forceSave', async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 5000, // Long debounce
        saveInterval: 60000,
      });
      await storage.initialize();

      const session = createTestSession({ id: 'force-save-test' });
      await storage.createSession(session);

      // Force save immediately (don't wait for debounce)
      await storage.forceSave();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('force-save-test');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();
    });

    it('should return correct stats', async () => {
      await storage.createSession(createTestSession({ id: 'stats-1' }));
      await storage.createSession(createTestSession({ id: 'stats-2' }));
      await storage.storeDeviceFlow('stats-flow', createTestDeviceFlow());
      await storage.storeAuthCodeFlow('stats-auth-flow', createTestAuthCodeFlow());
      await storage.storeAuthCode(createTestAuthCode());
      await storage.associateMcpSession('stats-mcp', 'stats-1');

      const stats = await storage.getStats();
      expect(stats.sessions).toBe(2);
      expect(stats.deviceFlows).toBe(1);
      expect(stats.authCodeFlows).toBe(1);
      expect(stats.authCodes).toBe(1);
      expect(stats.mcpSessionMappings).toBe(1);
    });
  });

  describe('Atomic Writes', () => {
    it('should not leave temp files after successful write', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      await storage.createSession(createTestSession({ id: 'atomic-test' }));
      await storage.forceSave();

      const tempFile = `${filePath}.tmp`;
      expect(fs.existsSync(tempFile)).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    // The file holds MCP and GitLab tokens: other OS accounts on the host must not read it,
    // whatever the umask, including when a temp file left by a crash had wider permissions.
    // POSIX modes only; Windows has no such permission bits.
    it('writes the store readable by its owner only', async () => {
      if (process.platform === 'win32') return;
      fs.writeFileSync(`${filePath}.tmp`, '', { mode: 0o644 });
      fs.chmodSync(`${filePath}.tmp`, 0o644);
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      await storage.createSession(createTestSession({ id: 'mode-test' }));

      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });
  });

  describe('Close Behavior', () => {
    it('should save on close', async () => {
      storage = new FileStorageBackend({
        filePath,
        saveDebounce: 5000, // Long debounce
        saveInterval: 60000,
      });
      await storage.initialize();

      await storage.createSession(createTestSession({ id: 'close-test' }));

      // Close should trigger final save
      await storage.close();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageData;
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('close-test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle update returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      // Update non-existent session
      const result = await storage.updateSession('non-existent', { gitlabAccessToken: 'new' });
      expect(result).toBe(false);
    });

    it('should handle delete returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      // Delete non-existent session
      const result = await storage.deleteSession('non-existent');
      expect(result).toBe(false);
    });

    it('should handle delete device flow returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      const result = await storage.deleteDeviceFlow('non-existent');
      expect(result).toBe(false);
    });

    it('should handle delete auth code flow returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      const result = await storage.deleteAuthCodeFlow('non-existent');
      expect(result).toBe(false);
    });

    it('should handle delete auth code returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      const result = await storage.deleteAuthCode('non-existent');
      expect(result).toBe(false);
    });

    it('should handle remove MCP session returning false gracefully', async () => {
      storage = new FileStorageBackend({ filePath, saveDebounce: 10, saveInterval: 60000 });
      await storage.initialize();

      const result = await storage.removeMcpSessionAssociation('non-existent');
      expect(result).toBe(false);
    });
  });
});
