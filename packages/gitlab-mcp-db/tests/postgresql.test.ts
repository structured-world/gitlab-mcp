import type {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
} from '@structured-world/gitlab-mcp/storage-contract';
import { PostgreSQLStorageBackend } from '../src/postgresql';

let mockPrisma: any;

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn((options: unknown) => ({ adapterFor: options })),
}));

import { PrismaClient } from '../generated/prisma/client';

const createMockPrisma = () => ({
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $transaction: jest
    .fn()
    .mockResolvedValue([{ count: 1 }, { count: 2 }, { count: 3 }, { count: 4 }]),
  oAuthSession: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
  oAuthClient: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
  },
  deviceFlowState: {
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
  authCodeFlowState: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
  authorizationCode: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
  mcpSessionMapping: {
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
});

const createSession = (): OAuthSession => ({
  id: 'session-1',
  mcpAccessToken: 'mcp-access',
  mcpRefreshToken: 'mcp-refresh',
  mcpTokenExpiry: 1111,
  gitlabAccessToken: 'gl-access',
  gitlabRefreshToken: 'gl-refresh',
  gitlabTokenExpiry: 2222,
  gitlabUserId: 10,
  gitlabUsername: 'test-user',
  clientId: 'client-1',
  scopes: ['read_api'],
  createdAt: 3333,
  updatedAt: 4444,
});

const createDeviceFlow = (): DeviceFlowState => ({
  state: 'state-1',
  deviceCode: 'device-1',
  userCode: 'user-1',
  verificationUri: 'https://gitlab.example.com/verify',
  verificationUriComplete: 'https://gitlab.example.com/verify?code=abc',
  expiresAt: 5555,
  interval: 5,
  clientId: 'client-1',
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256',
  redirectUri: 'https://gitlab.example.com/redirect',
});

const createAuthCodeFlow = (): AuthCodeFlowState => ({
  internalState: 'internal-1',
  clientId: 'client-1',
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256',
  clientState: 'client-state',
  clientRedirectUri: 'https://gitlab.example.com/callback',
  callbackUri: 'https://gitlab.example.com/authorize',
  expiresAt: 6666,
});

const createAuthCode = (): AuthorizationCode => ({
  code: 'code-1',
  sessionId: 'session-1',
  clientId: 'client-1',
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256',
  redirectUri: 'https://gitlab.example.com/callback',
  expiresAt: 7777,
});

describe('PostgreSQLStorageBackend', () => {
  let backend: PostgreSQLStorageBackend;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    backend = new PostgreSQLStorageBackend();
  });

  it('initializes and closes prisma client', async () => {
    jest.useFakeTimers();
    backend = new PostgreSQLStorageBackend({
      connectionString: 'postgresql://db.example/x',
    });

    await backend.initialize();
    expect(mockPrisma.$connect).toHaveBeenCalled();
    // Prisma 7 has no built-in engine: the client must be given the pg driver adapter.
    expect(PrismaClient).toHaveBeenCalledWith({
      adapter: {
        adapterFor: { connectionString: 'postgresql://db.example/x' },
      },
    });

    await backend.close();
    expect(mockPrisma.$disconnect).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('refuses to start without a connection string', async () => {
    const saved = [process.env.OAUTH_STORAGE_POSTGRESQL_URL, process.env.DATABASE_URL];
    delete process.env.OAUTH_STORAGE_POSTGRESQL_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(new PostgreSQLStorageBackend().initialize()).rejects.toThrow(
        'PostgreSQL storage requires OAUTH_STORAGE_POSTGRESQL_URL or DATABASE_URL',
      );
    } finally {
      [process.env.OAUTH_STORAGE_POSTGRESQL_URL, process.env.DATABASE_URL] = saved;
    }
  });

  it('throws when used before initialization', async () => {
    await expect(backend.getStats()).rejects.toThrow('PostgreSQL/Prisma client not initialized');
  });

  it('creates, reads, updates, and deletes sessions', async () => {
    (backend as any).prisma = mockPrisma;

    const session = createSession();
    await backend.createSession(session);
    expect(mockPrisma.oAuthSession.create).toHaveBeenCalled();

    mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
      id: session.id,
      mcpAccessToken: session.mcpAccessToken,
      mcpRefreshToken: session.mcpRefreshToken,
      mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
      gitlabAccessToken: session.gitlabAccessToken,
      gitlabRefreshToken: session.gitlabRefreshToken,
      gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
      gitlabUserId: session.gitlabUserId,
      gitlabUsername: session.gitlabUsername,
      clientId: session.clientId,
      scopes: session.scopes,
      createdAt: BigInt(session.createdAt),
      updatedAt: BigInt(session.updatedAt),
    });

    const fetched = await backend.getSession(session.id);
    expect(fetched?.id).toBe(session.id);
    expect(fetched?.mcpTokenExpiry).toBe(session.mcpTokenExpiry);

    mockPrisma.oAuthSession.findFirst.mockResolvedValueOnce({
      id: session.id,
      mcpAccessToken: session.mcpAccessToken,
      mcpRefreshToken: session.mcpRefreshToken,
      mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
      gitlabAccessToken: session.gitlabAccessToken,
      gitlabRefreshToken: session.gitlabRefreshToken,
      gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
      gitlabUserId: session.gitlabUserId,
      gitlabUsername: session.gitlabUsername,
      clientId: session.clientId,
      scopes: session.scopes,
      createdAt: BigInt(session.createdAt),
      updatedAt: BigInt(session.updatedAt),
    });
    const byToken = await backend.getSessionByToken(session.mcpAccessToken);
    expect(byToken?.id).toBe(session.id);

    mockPrisma.oAuthSession.findFirst.mockResolvedValueOnce({
      id: session.id,
      mcpAccessToken: session.mcpAccessToken,
      mcpRefreshToken: session.mcpRefreshToken,
      mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
      gitlabAccessToken: session.gitlabAccessToken,
      gitlabRefreshToken: session.gitlabRefreshToken,
      gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
      gitlabUserId: session.gitlabUserId,
      gitlabUsername: session.gitlabUsername,
      clientId: session.clientId,
      scopes: session.scopes,
      createdAt: BigInt(session.createdAt),
      updatedAt: BigInt(session.updatedAt),
    });
    const byRefresh = await backend.getSessionByRefreshToken(session.mcpRefreshToken);
    expect(byRefresh?.id).toBe(session.id);

    mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 1 });
    const updateOk = await backend.updateSession(session.id, {
      mcpAccessToken: 'new-access',
      gitlabTokenExpiry: 9999,
    });
    expect(updateOk).toBe(true);

    // false means the session does not exist
    mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 0 });
    const updateMissing = await backend.updateSession(session.id, {
      mcpAccessToken: 'bad',
    });
    expect(updateMissing).toBe(false);

    mockPrisma.oAuthSession.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteOk = await backend.deleteSession(session.id);
    expect(deleteOk).toBe(true);

    mockPrisma.oAuthSession.deleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteMissing = await backend.deleteSession(session.id);
    expect(deleteMissing).toBe(false);
  });

  // A database error is not a missing row: reporting it as false made revocation answer
  // 200 while the session stayed usable, and dropped refreshed GitLab tokens silently.
  it.each([
    [
      'updateSession',
      'oAuthSession',
      'updateMany',
      (b: PostgreSQLStorageBackend) => b.updateSession('session-1', { mcpAccessToken: 'x' }),
    ],
    [
      'deleteSession',
      'oAuthSession',
      'deleteMany',
      (b: PostgreSQLStorageBackend) => b.deleteSession('session-1'),
    ],
    [
      'deleteDeviceFlow',
      'deviceFlowState',
      'deleteMany',
      (b: PostgreSQLStorageBackend) => b.deleteDeviceFlow('state-1'),
    ],
    [
      'deleteAuthCodeFlow',
      'authCodeFlowState',
      'deleteMany',
      (b: PostgreSQLStorageBackend) => b.deleteAuthCodeFlow('internal-1'),
    ],
    [
      'deleteAuthCode',
      'authorizationCode',
      'deleteMany',
      (b: PostgreSQLStorageBackend) => b.deleteAuthCode('code-1'),
    ],
    [
      'removeMcpSessionAssociation',
      'mcpSessionMapping',
      'deleteMany',
      (b: PostgreSQLStorageBackend) => b.removeMcpSessionAssociation('mcp-1'),
    ],
  ] as const)('%s reports database errors', async (_name, model, method, call) => {
    (backend as any).prisma = mockPrisma;
    (mockPrisma as any)[model][method].mockRejectedValueOnce(new Error('connection lost'));

    await expect(call(backend)).rejects.toThrow('connection lost');
  });

  it('lists sessions', async () => {
    (backend as any).prisma = mockPrisma;

    const session = createSession();
    mockPrisma.oAuthSession.findMany.mockResolvedValueOnce([
      {
        id: session.id,
        mcpAccessToken: session.mcpAccessToken,
        mcpRefreshToken: session.mcpRefreshToken,
        mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
        gitlabAccessToken: session.gitlabAccessToken,
        gitlabRefreshToken: session.gitlabRefreshToken,
        gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
        gitlabUserId: session.gitlabUserId,
        gitlabUsername: session.gitlabUsername,
        clientId: session.clientId,
        scopes: session.scopes,
        createdAt: BigInt(session.createdAt),
        updatedAt: BigInt(session.updatedAt),
      },
    ]);

    const sessions = await backend.getAllSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(session.id);
  });

  it.each([undefined, [], ['read_api'], ['api', 'read_user']])(
    'persists upstream grants independently of MCP scopes: %j',
    async (grants) => {
      // Unknown grants stay unknown; an explicitly empty grant is never upgraded.
      (backend as any).prisma = mockPrisma;
      const session = { ...createSession(), gitlabScopes: grants };
      await backend.createSession(session);
      expect(mockPrisma.oAuthSession.create.mock.calls[0][0].data.gitlabScopes).toEqual(grants);
      mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
        ...session,
        gitlabScopes: grants === undefined ? null : grants,
        mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
        gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
        createdAt: BigInt(session.createdAt),
        updatedAt: BigInt(session.updatedAt),
      });
      const restored = await backend.getSession(session.id);
      expect(restored?.gitlabScopes).toEqual(grants);
      expect(restored?.scopes).toEqual(session.scopes);
      await backend.updateSession(session.id, { gitlabScopes: grants });
      const update = mockPrisma.oAuthSession.updateMany.mock.calls[0][0].data;
      if (grants === undefined) expect(update).not.toHaveProperty('gitlabScopes');
      else expect(update.gitlabScopes).toEqual(grants);
    },
  );

  it('rejects malformed stored grants instead of granting access', async () => {
    // Corrupt durable permissions must not become the unknown/fail-open state.
    (backend as any).prisma = mockPrisma;
    mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
      ...createSession(),
      gitlabScopes: ['api', 1],
    });
    await expect(backend.getSession('session-1')).rejects.toThrow('Invalid stored GitLab scopes');
  });

  it('handles device flow operations', async () => {
    (backend as any).prisma = mockPrisma;

    const flow = createDeviceFlow();
    await backend.storeDeviceFlow(flow.state, flow);
    expect(mockPrisma.deviceFlowState.upsert).toHaveBeenCalled();

    mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
      state: flow.state,
      clientState: flow.state,
      deviceCode: flow.deviceCode,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      verificationUriComplete: flow.verificationUriComplete,
      expiresAt: BigInt(flow.expiresAt),
      interval: flow.interval,
      clientId: flow.clientId,
      codeChallenge: flow.codeChallenge,
      codeChallengeMethod: flow.codeChallengeMethod,
      redirectUri: flow.redirectUri,
    });
    const fetched = await backend.getDeviceFlow(flow.state);
    expect(fetched?.state).toBe(flow.state);

    mockPrisma.deviceFlowState.findFirst.mockResolvedValueOnce({
      state: flow.state,
      deviceCode: flow.deviceCode,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      verificationUriComplete: flow.verificationUriComplete,
      expiresAt: BigInt(flow.expiresAt),
      interval: flow.interval,
      clientId: flow.clientId,
      codeChallenge: flow.codeChallenge,
      codeChallengeMethod: flow.codeChallengeMethod,
      redirectUri: flow.redirectUri,
    });
    const byDeviceCode = await backend.getDeviceFlowByDeviceCode(flow.deviceCode);
    expect(byDeviceCode?.deviceCode).toBe(flow.deviceCode);

    mockPrisma.deviceFlowState.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteOk = await backend.deleteDeviceFlow(flow.state);
    expect(deleteOk).toBe(true);

    mockPrisma.deviceFlowState.deleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteMissing = await backend.deleteDeviceFlow(flow.state);
    expect(deleteMissing).toBe(false);
  });

  it.each([undefined, [], ['read_api', 'read_user']])(
    'retains requested scopes across persisted OAuth flows: %j',
    async (requestedGitlabScopes) => {
      // Callback/poll may run on another replica; omitted upstream scope must use the saved request.
      (backend as any).prisma = mockPrisma;
      const device = { ...createDeviceFlow(), requestedGitlabScopes };
      await backend.storeDeviceFlow(device.state, device);
      const deviceData = mockPrisma.deviceFlowState.upsert.mock.calls[0][0];
      expect(deviceData.create.requestedGitlabScopes).toEqual(requestedGitlabScopes);
      expect(deviceData.update.requestedGitlabScopes).toEqual(requestedGitlabScopes);
      mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
        ...device,
        requestedGitlabScopes: requestedGitlabScopes === undefined ? null : requestedGitlabScopes,
        expiresAt: BigInt(device.expiresAt),
      });
      expect((await backend.getDeviceFlow(device.state))?.requestedGitlabScopes).toEqual(
        requestedGitlabScopes,
      );
      const auth = { ...createAuthCodeFlow(), requestedGitlabScopes };
      await backend.storeAuthCodeFlow(auth.internalState, auth);
      expect(
        mockPrisma.authCodeFlowState.create.mock.calls[0][0].data.requestedGitlabScopes,
      ).toEqual(requestedGitlabScopes);
      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
        ...auth,
        requestedGitlabScopes: requestedGitlabScopes === undefined ? null : requestedGitlabScopes,
        expiresAt: BigInt(auth.expiresAt),
      });
      expect((await backend.getAuthCodeFlow(auth.internalState))?.requestedGitlabScopes).toEqual(
        requestedGitlabScopes,
      );
    },
  );

  it.each(['device', 'auth'])('rejects corrupt requested scopes in a %s flow', async (kind) => {
    // Corrupt stored requests must not turn into an unknown, unrestricted account grant.
    (backend as any).prisma = mockPrisma;
    const invalid = { requestedGitlabScopes: ['api', 1] };
    if (kind === 'device') {
      mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce(invalid);
      await expect(backend.getDeviceFlow('fixture')).rejects.toThrow(
        'Invalid stored GitLab scopes',
      );
    } else {
      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce(invalid);
      await expect(backend.getAuthCodeFlow('fixture')).rejects.toThrow(
        'Invalid stored GitLab scopes',
      );
    }
  });

  it('handles auth code flow operations', async () => {
    (backend as any).prisma = mockPrisma;

    const flow = createAuthCodeFlow();
    await backend.storeAuthCodeFlow(flow.internalState, flow);
    expect(mockPrisma.authCodeFlowState.create).toHaveBeenCalled();

    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
      internalState: flow.internalState,
      clientId: flow.clientId,
      codeChallenge: flow.codeChallenge,
      codeChallengeMethod: flow.codeChallengeMethod,
      clientState: flow.clientState,
      clientRedirectUri: flow.clientRedirectUri,
      callbackUri: flow.callbackUri,
      expiresAt: BigInt(flow.expiresAt),
    });
    const fetched = await backend.getAuthCodeFlow(flow.internalState);
    expect(fetched?.internalState).toBe(flow.internalState);

    mockPrisma.authCodeFlowState.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteOk = await backend.deleteAuthCodeFlow(flow.internalState);
    expect(deleteOk).toBe(true);

    mockPrisma.authCodeFlowState.deleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteMissing = await backend.deleteAuthCodeFlow(flow.internalState);
    expect(deleteMissing).toBe(false);
  });

  it('handles authorization code operations', async () => {
    (backend as any).prisma = mockPrisma;

    const code = createAuthCode();
    await backend.storeAuthCode(code);
    expect(mockPrisma.authorizationCode.create).toHaveBeenCalled();

    mockPrisma.authorizationCode.findUnique.mockResolvedValueOnce({
      code: code.code,
      sessionId: code.sessionId,
      clientId: code.clientId,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      redirectUri: code.redirectUri,
      expiresAt: BigInt(code.expiresAt),
    });
    const fetched = await backend.getAuthCode(code.code);
    expect(fetched?.code).toBe(code.code);

    mockPrisma.authorizationCode.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteOk = await backend.deleteAuthCode(code.code);
    expect(deleteOk).toBe(true);

    mockPrisma.authorizationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteMissing = await backend.deleteAuthCode(code.code);
    expect(deleteMissing).toBe(false);
  });

  it('handles mcp session mapping', async () => {
    (backend as any).prisma = mockPrisma;

    await backend.associateMcpSession('mcp-1', 'session-1');
    expect(mockPrisma.mcpSessionMapping.upsert).toHaveBeenCalled();

    const session = createSession();
    mockPrisma.mcpSessionMapping.findUnique.mockResolvedValueOnce({
      mcpSessionId: 'mcp-1',
      oauthSessionId: session.id,
      oauthSession: {
        id: session.id,
        mcpAccessToken: session.mcpAccessToken,
        mcpRefreshToken: session.mcpRefreshToken,
        mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
        gitlabAccessToken: session.gitlabAccessToken,
        gitlabRefreshToken: session.gitlabRefreshToken,
        gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
        gitlabUserId: session.gitlabUserId,
        gitlabUsername: session.gitlabUsername,
        clientId: session.clientId,
        scopes: session.scopes,
        createdAt: BigInt(session.createdAt),
        updatedAt: BigInt(session.updatedAt),
      },
    });

    const fetched = await backend.getSessionByMcpSessionId('mcp-1');
    expect(fetched?.id).toBe(session.id);

    mockPrisma.mcpSessionMapping.findUnique.mockResolvedValueOnce({
      mcpSessionId: 'mcp-2',
      oauthSessionId: 'session-2',
      oauthSession: undefined,
    });
    const missing = await backend.getSessionByMcpSessionId('mcp-2');
    expect(missing).toBeUndefined();

    mockPrisma.mcpSessionMapping.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteOk = await backend.removeMcpSessionAssociation('mcp-1');
    expect(deleteOk).toBe(true);

    mockPrisma.mcpSessionMapping.deleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteMissing = await backend.removeMcpSessionAssociation('mcp-1');
    expect(deleteMissing).toBe(false);
  });

  describe('durable flow and session binding', () => {
    beforeEach(() => {
      (backend as any).prisma = mockPrisma;
    });

    // Only the lease holder spends the single-use GitLab refresh token: the lease is a
    // conditional update on the presented token and an expired or absent lease.
    it('leases the GitLab refresh token with a conditional update', async () => {
      mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 1 });

      expect(await backend.claimGitLabRefresh('session-1', 'gl-refresh', 10000, 40000)).toBe(true);
      expect(mockPrisma.oAuthSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'session-1',
          gitlabRefreshToken: 'gl-refresh',
          OR: [
            { gitlabRefreshLeaseUntil: null },
            { gitlabRefreshLeaseUntil: { lte: BigInt(10000) } },
          ],
        },
        data: { gitlabRefreshLeaseUntil: BigInt(40000) },
      });

      mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await backend.claimGitLabRefresh('session-1', 'gl-refresh', 10000, 40000)).toBe(false);

      await backend.releaseGitLabRefresh('session-1');
      expect(mockPrisma.oAuthSession.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'session-1' },
        data: { gitlabRefreshLeaseUntil: null },
      });
    });

    // One replica per interval may poll GitLab: the reservation is a conditional update
    // whose row count picks the winner.
    it('reserves a device flow poll with a conditional update', async () => {
      mockPrisma.deviceFlowState.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
        ...createDeviceFlow(),
        state: 'flow-key',
        clientState: 'client-csrf',
        expiresAt: BigInt(5555),
        nextPollAt: BigInt(16000),
      });

      const claimed = await backend.claimDevicePoll('flow-key', 10000, 16000);

      expect(mockPrisma.deviceFlowState.updateMany).toHaveBeenCalledWith({
        where: {
          state: 'flow-key',
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: BigInt(10000) } }],
        },
        data: { nextPollAt: BigInt(16000) },
      });
      expect(claimed).toMatchObject({
        state: 'client-csrf',
        nextPollAt: 16000,
      });

      mockPrisma.deviceFlowState.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await backend.claimDevicePoll('flow-key', 10000, 16000)).toBeUndefined();
    });

    it("returns the client's state, not the storage key, of a device flow", async () => {
      // The storage key is ours; the client checks its own state value on completion.
      const flow = { ...createDeviceFlow(), state: 'client-csrf' };
      await backend.storeDeviceFlow('flow-key', flow);
      const call = mockPrisma.deviceFlowState.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ state: 'flow-key' });
      expect(call.create.state).toBe('flow-key');
      expect(call.create.clientState).toBe('client-csrf');

      mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
        ...call.create,
        verificationUriComplete: null,
        redirectUri: null,
      });
      expect((await backend.getDeviceFlow('flow-key'))?.state).toBe('client-csrf');
    });

    it('keeps instance, scopes, resource and cadence of a device flow on every write', async () => {
      // Another replica polls the flow and must see the same binding and interval.
      const flow: DeviceFlowState = {
        ...createDeviceFlow(),
        selectedInstance: 'https://git.corp.example/gitlab',
        selectedInstanceLabel: 'Corp',
        scopes: ['mcp:tools'],
        resource: 'https://mcp.example.com',
        interval: 10,
        nextPollAt: 9000,
      };
      await backend.storeDeviceFlow('flow-key', flow);
      const call = mockPrisma.deviceFlowState.upsert.mock.calls[0][0];
      for (const data of [call.create, call.update]) {
        expect(data).toMatchObject({
          selectedInstance: 'https://git.corp.example/gitlab',
          selectedInstanceLabel: 'Corp',
          mcpScopes: ['mcp:tools'],
          resource: 'https://mcp.example.com',
          interval: 10,
          nextPollAt: BigInt(9000),
        });
      }

      mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
        ...call.create,
        verificationUriComplete: flow.verificationUriComplete,
        redirectUri: flow.redirectUri,
      });
      expect(await backend.getDeviceFlow('flow-key')).toEqual(flow);
    });

    it('keeps instance, scopes and resource of an authorization code flow', async () => {
      const flow: AuthCodeFlowState = {
        ...createAuthCodeFlow(),
        selectedInstance: 'https://git.corp.example/gitlab',
        selectedInstanceLabel: 'Corp',
        scopes: ['mcp:tools', 'mcp:resources'],
        resource: 'https://mcp.example.com/mcp',
      };
      await backend.storeAuthCodeFlow(flow.internalState, flow);
      const data = mockPrisma.authCodeFlowState.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        selectedInstance: 'https://git.corp.example/gitlab',
        selectedInstanceLabel: 'Corp',
        mcpScopes: ['mcp:tools', 'mcp:resources'],
        resource: 'https://mcp.example.com/mcp',
      });

      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce(data);
      expect(await backend.getAuthCodeFlow(flow.internalState)).toEqual(flow);
    });

    it('keeps the resource of a session', async () => {
      await backend.createSession({
        ...createSession(),
        resource: 'https://mcp.example.com',
      });
      const data = mockPrisma.oAuthSession.create.mock.calls[0][0].data;
      expect(data.resource).toBe('https://mcp.example.com');

      await backend.updateSession('session-1', {
        resource: 'https://mcp.example.com/mcp',
      });
      expect(mockPrisma.oAuthSession.updateMany.mock.calls[0][0].data.resource).toBe(
        'https://mcp.example.com/mcp',
      );

      mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
        ...data,
        gitlabScopes: null,
      });
      expect((await backend.getSession('session-1'))?.resource).toBe('https://mcp.example.com');
    });

    it.each([
      ['authorization code', 'consumeAuthCode', 'authorizationCode', { code: 'code-1' }],
      [
        'authorization flow',
        'consumeAuthCodeFlow',
        'authCodeFlowState',
        { internalState: 'code-1' },
      ],
      ['device flow', 'consumeDeviceFlow', 'deviceFlowState', { state: 'code-1' }],
    ])('gives a %s to exactly one consumer', async (_kind, method, model, where) => {
      // The deleted-row count decides the winner across replicas.
      const row = {
        ...createAuthCode(),
        ...createAuthCodeFlow(),
        ...createDeviceFlow(),
        ...where,
        expiresAt: BigInt(7777),
        verificationUriComplete: null,
        redirectUri: null,
      };
      mockPrisma[model].findUnique.mockResolvedValue(row);
      mockPrisma[model].deleteMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma[model].deleteMany.mockResolvedValueOnce({ count: 0 });

      const winner = await (backend as any)[method]('code-1');
      const loser = await (backend as any)[method]('code-1');

      expect(winner).toBeDefined();
      expect(loser).toBeUndefined();
      expect(mockPrisma[model].deleteMany).toHaveBeenCalledWith({ where });
    });

    it('returns nothing when the record does not exist', async () => {
      mockPrisma.authorizationCode.findUnique.mockResolvedValueOnce(null);
      expect(await backend.consumeAuthCode('missing')).toBeUndefined();
      expect(mockPrisma.authorizationCode.deleteMany).not.toHaveBeenCalled();
    });

    it('rotates a session only while it holds the presented refresh token', async () => {
      mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.oAuthSession.updateMany.mockResolvedValueOnce({ count: 0 });

      const first = await backend.rotateSession('session-1', 'refresh-1', {
        mcpRefreshToken: 'refresh-2',
      });
      const second = await backend.rotateSession('session-1', 'refresh-1', {
        mcpRefreshToken: 'refresh-3',
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(mockPrisma.oAuthSession.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'session-1', mcpRefreshToken: 'refresh-1' },
        data: { mcpRefreshToken: 'refresh-2' },
      });
    });

    it('stores and reads registered clients', async () => {
      const client = {
        clientId: 'client-1',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        clientName: 'ChatGPT',
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        createdAt: 1234,
      };
      await backend.storeClient(client);
      const data = mockPrisma.oAuthClient.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        clientId: 'client-1',
        createdAt: BigInt(1234),
      });

      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({
        ...data,
        clientSecret: null,
      });
      expect(await backend.getClient('client-1')).toEqual(client);
      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce(null);
      expect(await backend.getClient('unknown')).toBeUndefined();
    });
  });

  it('runs cleanup and stats', async () => {
    (backend as any).prisma = mockPrisma;

    await backend.cleanup();
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    mockPrisma.$transaction.mockRejectedValueOnce(new Error('fail'));
    await backend.cleanup();

    mockPrisma.oAuthSession.count.mockResolvedValueOnce(2);
    mockPrisma.deviceFlowState.count.mockResolvedValueOnce(3);
    mockPrisma.authCodeFlowState.count.mockResolvedValueOnce(4);
    mockPrisma.authorizationCode.count.mockResolvedValueOnce(5);
    mockPrisma.mcpSessionMapping.count.mockResolvedValueOnce(6);

    const stats = await backend.getStats();
    expect(stats.sessions).toBe(2);
    expect(stats.deviceFlows).toBe(3);
    expect(stats.authCodeFlows).toBe(4);
    expect(stats.authCodes).toBe(5);
    expect(stats.mcpSessionMappings).toBe(6);
  });
});
