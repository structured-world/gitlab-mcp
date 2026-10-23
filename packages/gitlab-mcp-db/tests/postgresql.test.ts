import type {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
  LinkedAccountCommit,
} from '@structured-world/gitlab-mcp/storage-contract';
import { PostgreSQLStorageBackend } from '../src/postgresql';

type MockPrisma = ReturnType<typeof createMockPrisma>;
let mockPrisma: MockPrisma;

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  Prisma: { AnyNull: Symbol('AnyNull'), DbNull: Symbol('DbNull') },
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn((options: unknown) => ({ adapterFor: options })),
}));

import { PrismaClient, Prisma } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
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
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
  accountSettings: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

/** Give the backend the Prisma mock in place of the client `initialize` would connect. */
function attachPrisma(target: PostgreSQLStorageBackend, prisma: MockPrisma): void {
  (target as unknown as { prisma: MockPrisma }).prisma = prisma;
}

/** A model of the Prisma mock by name, for tests parameterized over models. */
function mockModel(name: string): Record<string, jest.Mock> {
  return (mockPrisma as unknown as Record<string, Record<string, jest.Mock>>)[name];
}

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

  // Prisma Migrate puts the tables in the URL's `schema`; the adapter must query the same
  // schema, or every query targets `public` and finds no tables.
  it('queries the schema named in the connection URL', async () => {
    backend = new PostgreSQLStorageBackend({
      connectionString: 'postgresql://db.example/x?schema=oauth',
    });

    await backend.initialize();

    expect(PrismaPg).toHaveBeenCalledWith(
      { connectionString: 'postgresql://db.example/x?schema=oauth' },
      { schema: 'oauth' },
    );
    await backend.close();
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

  describe('atomic account-link commits', () => {
    let tx: MockPrisma;
    let commit: LinkedAccountCommit;

    beforeEach(() => {
      attachPrisma(backend, mockPrisma);
      tx = createMockPrisma();
      tx.oAuthSession.updateMany.mockResolvedValue({ count: 1 });
      tx.authCodeFlowState.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
      commit = {
        internalState: createAuthCodeFlow().internalState,
        primaryLeaseUntil: Date.now() + 30_000,
        account: {
          ...createSession(),
          id: 'linked-account',
          linkedToSessionId: createSession().id,
          mcpAccessToken: '',
          mcpRefreshToken: '',
          mcpTokenExpiry: 0,
        },
      };
    });

    // Only the transaction client may write: an outer-client write would survive rollback.
    it('fences the primary, spends a valid connect flow and inserts in one transaction', async () => {
      expect(await backend.commitLinkedAccount(commit)).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.oAuthSession.create).not.toHaveBeenCalled();
      expect(mockPrisma.oAuthSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.authCodeFlowState.deleteMany).not.toHaveBeenCalled();
      expect(tx.oAuthSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: commit.account.linkedToSessionId,
          gitlabRefreshLeaseUntil: {
            equals: BigInt(commit.primaryLeaseUntil),
            gt: expect.any(BigInt),
          },
        },
        data: { updatedAt: expect.any(BigInt) },
      });
      expect(tx.authCodeFlowState.deleteMany).toHaveBeenCalledWith({
        where: {
          internalState: commit.internalState,
          expiresAt: { gt: expect.any(BigInt) },
          NOT: { internalState: { startsWith: 'cleanup:' } },
          AND: [
            { link: { path: ['sessionId'], equals: commit.account.linkedToSessionId } },
            { link: { path: ['stage'], equals: 'connect' } },
          ],
        },
      });
      expect(tx.oAuthSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: commit.account.id,
          linkedToSessionId: commit.account.linkedToSessionId,
          gitlabAccessToken: commit.account.gitlabAccessToken,
        }),
      });
      expect(tx.oAuthSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.authCodeFlowState.deleteMany.mock.invocationCallOrder[0],
      );
      expect(tx.authCodeFlowState.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.oAuthSession.create.mock.invocationCallOrder[0],
      );
    });

    // Replacing a credential must not retain the permissions of the previous grant.
    it('compares the account lease and refresh token and clears unknown scopes', async () => {
      commit.existing = { refreshToken: 'old-refresh', leaseUntil: Date.now() + 15_000 };
      commit.account.gitlabScopes = undefined;
      expect(await backend.commitLinkedAccount(commit)).toBe(true);
      expect(tx.oAuthSession.create).not.toHaveBeenCalled();
      expect(tx.oAuthSession.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: commit.account.id,
          linkedToSessionId: commit.account.linkedToSessionId,
          gitlabRefreshToken: commit.existing.refreshToken,
          gitlabRefreshLeaseUntil: {
            equals: BigInt(commit.existing.leaseUntil),
            gt: expect.any(BigInt),
          },
        },
        data: {
          updatedAt: expect.any(BigInt),
          gitlabAccessToken: commit.account.gitlabAccessToken,
          gitlabRefreshToken: commit.account.gitlabRefreshToken,
          gitlabTokenExpiry: BigInt(commit.account.gitlabTokenExpiry),
          gitlabScopes: Prisma.DbNull,
          gitlabUsername: commit.account.gitlabUsername,
        },
      });
    });

    // A conflict must throw through Prisma's callback to roll back its earlier writes.
    it.each(['primary', 'flow', 'account'] as const)(
      'rolls back a lost %s precondition',
      async (lost) => {
        commit.existing = { refreshToken: 'old-refresh', leaseUntil: Date.now() + 15_000 };
        if (lost === 'primary') tx.oAuthSession.updateMany.mockResolvedValueOnce({ count: 0 });
        if (lost === 'flow') tx.authCodeFlowState.deleteMany.mockResolvedValueOnce({ count: 0 });
        if (lost === 'account')
          tx.oAuthSession.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        let rolledBack = false;
        mockPrisma.$transaction.mockImplementation(async (callback) => {
          try {
            return await callback(tx);
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        });
        expect(await backend.commitLinkedAccount(commit)).toBe(false);
        expect(rolledBack).toBe(true);
        expect(tx.oAuthSession.create).not.toHaveBeenCalled();
        if (lost === 'primary') expect(tx.authCodeFlowState.deleteMany).not.toHaveBeenCalled();
        if (lost === 'flow') expect(tx.oAuthSession.updateMany).toHaveBeenCalledTimes(1);
      },
    );

    // A primary-key collision is retryable only after Prisma rolled the entire attempt back.
    it('rolls back a colliding insertion instead of consuming its flow', async () => {
      const collision = Object.assign(new Error('duplicate id'), { code: 'P2002' });
      tx.oAuthSession.create.mockRejectedValueOnce(collision);
      let rolledBack = false;
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        try {
          return await callback(tx);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      });
      expect(await backend.commitLinkedAccount(commit)).toBe(false);
      expect(rolledBack).toBe(true);
    });

    // Infrastructure failures are not CAS misses and must reach the caller for a safe retry.
    it('propagates a transaction failure', async () => {
      tx.oAuthSession.create.mockRejectedValueOnce(new Error('database unavailable'));
      await expect(backend.commitLinkedAccount(commit)).rejects.toThrow('database unavailable');
    });
  });

  it('creates, reads, updates, and deletes sessions', async () => {
    attachPrisma(backend, mockPrisma);

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
    attachPrisma(backend, mockPrisma);
    mockModel(model)[method].mockRejectedValueOnce(new Error('connection lost'));

    await expect(call(backend)).rejects.toThrow('connection lost');
  });

  it('lists sessions', async () => {
    attachPrisma(backend, mockPrisma);

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
      attachPrisma(backend, mockPrisma);
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
    attachPrisma(backend, mockPrisma);
    mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
      ...createSession(),
      gitlabScopes: ['api', 1],
    });
    await expect(backend.getSession('session-1')).rejects.toThrow('Invalid stored GitLab scopes');
  });

  it('handles device flow operations', async () => {
    attachPrisma(backend, mockPrisma);

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
      attachPrisma(backend, mockPrisma);
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
        mockPrisma.authCodeFlowState.upsert.mock.calls[0][0].create.requestedGitlabScopes,
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

  // GitLab issues device tokens once; a poll on another replica finishes the setup with
  // the copy stored here.
  it('keeps the GitLab tokens of a completed device flow', async () => {
    attachPrisma(backend, mockPrisma);
    const gitlabTokens = {
      access_token: 'gl-at',
      refresh_token: 'gl-rt',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 1,
      scope: 'api',
    };
    const device = { ...createDeviceFlow(), gitlabTokens };
    await backend.storeDeviceFlow(device.state, device);
    const deviceData = mockPrisma.deviceFlowState.upsert.mock.calls[0][0];
    expect(deviceData.update.gitlabTokens).toEqual(gitlabTokens);
    mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
      ...device,
      expiresAt: BigInt(device.expiresAt),
    });

    expect((await backend.getDeviceFlow(device.state))?.gitlabTokens).toEqual(gitlabTokens);
  });

  it('rejects corrupt GitLab tokens in a device flow', async () => {
    attachPrisma(backend, mockPrisma);
    mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
      ...createDeviceFlow(),
      expiresAt: BigInt(Date.now()),
      gitlabTokens: { access_token: 'gl-at' },
    });

    await expect(backend.getDeviceFlow('fixture')).rejects.toThrow('Invalid stored GitLab tokens');
  });

  it.each(['device', 'auth'])('rejects corrupt requested scopes in a %s flow', async (kind) => {
    // Corrupt stored requests must not turn into an unknown, unrestricted account grant.
    attachPrisma(backend, mockPrisma);
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
    attachPrisma(backend, mockPrisma);

    const flow = createAuthCodeFlow();
    await backend.storeAuthCodeFlow(flow.internalState, flow);
    expect(mockPrisma.authCodeFlowState.upsert).toHaveBeenCalled();

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
    attachPrisma(backend, mockPrisma);

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
    attachPrisma(backend, mockPrisma);

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

  // Linked accounts belong to their session: stored with its id, listed for it oldest first,
  // and removed with it by the foreign key's cascade.
  describe('linked accounts', () => {
    beforeEach(() => {
      attachPrisma(backend, mockPrisma);
    });

    it('stores and reads the session an account is linked to', async () => {
      await backend.createSession({
        ...createSession(),
        id: 'linked',
        linkedToSessionId: 'session-1',
      });
      const data = mockPrisma.oAuthSession.create.mock.calls[0][0].data;
      expect(data.linkedToSessionId).toBe('session-1');

      mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
        ...data,
        gitlabApiUrl: null,
        instanceLabel: null,
      });
      expect((await backend.getSession('linked'))?.linkedToSessionId).toBe('session-1');
    });

    it('stores a session without a link as null and reads it back without one', async () => {
      await backend.createSession(createSession());
      const data = mockPrisma.oAuthSession.create.mock.calls[0][0].data;
      expect(data.linkedToSessionId).toBeNull();

      mockPrisma.oAuthSession.findUnique.mockResolvedValueOnce({
        ...data,
        gitlabApiUrl: null,
        instanceLabel: null,
      });
      expect(await backend.getSession('session-1')).not.toHaveProperty(
        'linkedToSessionId',
        expect.anything(),
      );
    });

    it('lists the accounts linked to a session, oldest first', async () => {
      mockPrisma.oAuthSession.findMany.mockResolvedValueOnce([
        {
          ...createSession(),
          id: 'linked',
          linkedToSessionId: 'session-1',
          mcpTokenExpiry: BigInt(1),
          gitlabTokenExpiry: BigInt(2),
          createdAt: BigInt(3),
          updatedAt: BigInt(4),
          gitlabApiUrl: 'https://gitlab.com',
          instanceLabel: null,
        },
      ]);

      const linked = await backend.getLinkedSessions('session-1');

      expect(mockPrisma.oAuthSession.findMany).toHaveBeenCalledWith({
        where: { linkedToSessionId: 'session-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(linked).toEqual([
        expect.objectContaining({ id: 'linked', linkedToSessionId: 'session-1' }),
      ]);
    });

    it('keeps the account linking step of a flow', async () => {
      const link = {
        sessionId: 'session-1',
        stage: 'verify' as const,
        instance: 'https://gitlab.com',
        instanceLabel: 'GitLab.com',
      };
      await backend.storeAuthCodeFlow('link-state', { ...createAuthCodeFlow(), link });
      const call = mockPrisma.authCodeFlowState.upsert.mock.calls[0][0];
      expect(call.create.link).toEqual(link);

      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
        ...call.create,
        expiresAt: BigInt(6666),
      });
      expect((await backend.getAuthCodeFlow('link-state'))?.link).toEqual(link);
    });

    // The connect step carries the digest that ties it to the browser that passed verify,
    // and the elicitation whose chat learns the link completed; both survive the round trip.
    it('keeps the browser binding and the elicitation of a connect step', async () => {
      const link = {
        sessionId: 'session-1',
        stage: 'connect' as const,
        instance: 'https://gitlab.com',
        browserBinding: 'ab'.repeat(32),
        mcpSessionId: 'chat-1',
        elicitationId: 'elicit-1',
      };
      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
        ...createAuthCodeFlow(),
        expiresAt: BigInt(6666),
        link,
      });

      expect((await backend.getAuthCodeFlow('link-state'))?.link).toEqual(link);
    });

    it.each(['browserBinding', 'mcpSessionId', 'elicitationId'])(
      'refuses a link step whose %s is not a string',
      async (field) => {
        mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
          ...createAuthCodeFlow(),
          expiresAt: BigInt(6666),
          link: {
            sessionId: 'session-1',
            stage: 'connect',
            instance: 'https://gitlab.com',
            [field]: 42,
          },
        });

        await expect(backend.getAuthCodeFlow('internal-1')).rejects.toThrow(
          'Invalid stored account link step',
        );
      },
    );

    it('refuses a corrupt account linking step instead of half-using it', async () => {
      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
        ...createAuthCodeFlow(),
        expiresAt: BigInt(6666),
        link: { sessionId: 'session-1', stage: 'unknown', instance: 'https://gitlab.com' },
      });

      await expect(backend.getAuthCodeFlow('internal-1')).rejects.toThrow(
        'Invalid stored account link step',
      );
    });
  });

  describe('durable flow and session binding', () => {
    beforeEach(() => {
      attachPrisma(backend, mockPrisma);
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

      // Only the caller's own lease ends: a newer holder's lease has a later leaseUntil.
      await backend.releaseGitLabRefresh('session-1', 40000);
      expect(mockPrisma.oAuthSession.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'session-1', gitlabRefreshLeaseUntil: BigInt(40000) },
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
      const data = mockPrisma.authCodeFlowState.upsert.mock.calls[0][0].create;
      expect(data).toMatchObject({
        selectedInstance: 'https://git.corp.example/gitlab',
        selectedInstanceLabel: 'Corp',
        mcpScopes: ['mcp:tools', 'mcp:resources'],
        resource: 'https://mcp.example.com/mcp',
      });

      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce(data);
      expect(await backend.getAuthCodeFlow(flow.internalState)).toEqual(flow);
    });

    // GitLab's authorization code works once: the tokens of a callback that failed after
    // the exchange are stored with the flow, so a retried callback on any replica finishes.
    it('keeps the GitLab tokens of an authorization code flow', async () => {
      const gitlabTokens = {
        access_token: 'gl-at',
        refresh_token: 'gl-rt',
        token_type: 'Bearer',
        expires_in: 7200,
        created_at: 1,
      };
      const flow: AuthCodeFlowState = { ...createAuthCodeFlow(), gitlabTokens };

      await backend.storeAuthCodeFlow(flow.internalState, flow);

      const call = mockPrisma.authCodeFlowState.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ internalState: flow.internalState });
      expect(call.update.gitlabTokens).toEqual(gitlabTokens);
      mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce(call.create);
      expect((await backend.getAuthCodeFlow(flow.internalState))?.gitlabTokens).toEqual(
        gitlabTokens,
      );
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
      mockModel(model).findUnique.mockResolvedValue(row);
      mockModel(model).deleteMany.mockResolvedValueOnce({ count: 1 });
      mockModel(model).deleteMany.mockResolvedValueOnce({ count: 0 });
      const consume = (code: string): Promise<unknown> =>
        (backend as unknown as Record<string, (code: string) => Promise<unknown>>)[method](code);

      const winner = await consume('code-1');
      const loser = await consume('code-1');

      expect(winner).toBeDefined();
      expect(loser).toBeUndefined();
      expect(mockModel(model).deleteMany).toHaveBeenCalledWith({ where });
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

    // Anonymous registrations are bounded: a source and an expiry are stored, a completed
    // authorization clears the expiry, and only never-used ones beyond the limit go.
    it('keeps the source and expiry of a registration', async () => {
      const client = {
        clientId: 'client-2',
        redirectUris: ['https://client.example.com/callback'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt: 1000,
        registeredFrom: 'source-a',
        expiresAt: 2000,
      };
      await backend.storeClient(client);
      const data = mockPrisma.oAuthClient.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ registeredFrom: 'source-a', expiresAt: BigInt(2000) });
      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ ...data, clientSecret: null });
      expect(await backend.getClient('client-2')).toEqual(client);
    });

    it('clears the expiry of a client that completed an authorization', async () => {
      await backend.markClientUsed('client-2');

      expect(mockPrisma.oAuthClient.updateMany).toHaveBeenCalledWith({
        where: { clientId: 'client-2' },
        data: { expiresAt: null },
      });
    });

    // Registrations are limited per source and hour: counted, never deleted for the limit.
    it('counts the registrations of a source since a time', async () => {
      mockPrisma.oAuthClient.count.mockResolvedValueOnce(7);

      expect(await backend.countClientsRegisteredSince('source-a', 1000)).toBe(7);

      expect(mockPrisma.oAuthClient.count).toHaveBeenCalledWith({
        where: { registeredFrom: 'source-a', createdAt: { gte: BigInt(1000) } },
      });
      expect(mockPrisma.oAuthClient.deleteMany).not.toHaveBeenCalled();
    });
  });

  // An expired flow whose callback exchanged the code but never finished holds the only
  // copy of that GitLab grant; cleanup hands it over to be ended as it removes the flow.
  it('hands over the grant of each expired auth code flow cleanup removes', async () => {
    attachPrisma(backend, mockPrisma);
    const gitlabTokens = {
      access_token: 'cached-token',
      refresh_token: 'cached-refresh',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 0,
    };
    const row = (internalState: string, tokens: unknown) => ({
      ...createAuthCodeFlow(),
      internalState,
      expiresAt: BigInt(1),
      gitlabTokens: tokens,
    });
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([
      row('abandoned', gitlabTokens),
      row('completed', gitlabTokens),
      row('no-grant', null),
    ]);
    // The callback of "completed" finished after the read above and consumed its flow:
    // cleanup takes over only the flow still there, and ends only that one's grant.
    mockPrisma.authCodeFlowState.updateMany.mockImplementation(
      async ({ where }: { where: { internalState: string } }) => ({
        count: where.internalState === 'abandoned' ? 1 : 0,
      }),
    );
    const handler = jest.fn(async () => {});
    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce(
      row('cleanup:abandoned', gitlabTokens),
    );
    backend.onAbandonedFlowGrant(handler, 60_000);

    await backend.cleanup();

    expect(mockPrisma.authCodeFlowState.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(BigInt) } },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        internalState: 'cleanup:abandoned',
        gitlabTokens,
      }),
      expect.any(Function),
      Number(mockPrisma.authCodeFlowState.updateMany.mock.calls[0][0].data.expiresAt),
    );
    expect(mockPrisma.authCodeFlowState.updateMany).toHaveBeenCalledWith({
      where: {
        internalState: 'abandoned',
        expiresAt: { lt: expect.any(BigInt) },
      },
      data: {
        internalState: 'cleanup:abandoned',
        expiresAt: expect.any(BigInt),
      },
    });
    expect(mockPrisma.authCodeFlowState.deleteMany).toHaveBeenCalledWith({
      where: {
        internalState: 'cleanup:abandoned',
        expiresAt: mockPrisma.authCodeFlowState.updateMany.mock.calls[0][0].data.expiresAt,
      },
    });
  });

  // The flow is the only stored copy of the grant: it stays (claimed, out of its callback's
  // reach) until the grant is ended, so a cleanup that fails or stops leaves it for the next.
  it('keeps a claimed flow whose grant could not be ended', async () => {
    attachPrisma(backend, mockPrisma);
    const gitlabTokens = {
      access_token: 'cached-token',
      refresh_token: 'cached-refresh',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 0,
    };
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([
      {
        ...createAuthCodeFlow(),
        internalState: 'abandoned',
        expiresAt: BigInt(1),
        gitlabTokens,
      },
    ]);
    mockPrisma.authCodeFlowState.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
      ...createAuthCodeFlow(),
      internalState: 'cleanup:abandoned',
      expiresAt: BigInt(1),
      gitlabTokens,
    });
    const handler = jest.fn(async () => {
      throw new Error('GitLab unavailable');
    });
    backend.onAbandonedFlowGrant(handler, 60_000);

    await backend.cleanup();

    expect(handler).toHaveBeenCalledTimes(1);
    const deletions = mockPrisma.authCodeFlowState.deleteMany.mock.calls.map(
      ([request]) => request.where,
    );
    expect(deletions.some((where) => where.internalState === 'cleanup:abandoned')).toBe(false);
    expect(mockPrisma.authCodeFlowState.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(BigInt) },
        NOT: { internalState: { startsWith: 'cleanup:' } },
        gitlabTokens: { equals: Prisma.AnyNull },
      },
    });
  });

  // A failed claim leaves the credentials under their original key. Bulk cleanup must
  // still run for other data, but can delete only flows with SQL NULL or JSON null tokens.
  it('protects unclaimed token-bearing flows after a transient claim failure', async () => {
    attachPrisma(backend, mockPrisma);
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([
      {
        ...createAuthCodeFlow(),
        expiresAt: BigInt(1),
        gitlabTokens: { access_token: 'live', refresh_token: 'refresh' },
      },
    ]);
    mockPrisma.authCodeFlowState.updateMany.mockRejectedValueOnce(new Error('connection reset'));
    const handler = jest.fn(async () => {});
    backend.onAbandonedFlowGrant(handler, 60_000);

    await backend.cleanup();

    expect(handler).not.toHaveBeenCalled();
    expect(mockPrisma.authCodeFlowState.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.authCodeFlowState.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(BigInt) },
        NOT: { internalState: { startsWith: 'cleanup:' } },
        gitlabTokens: { equals: Prisma.AnyNull },
      },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.oAuthClient.deleteMany).toHaveBeenCalled();
  });

  // An expired flow whose tokens are intact but whose other fields cannot be read still
  // holds the only copy of a live grant: cleanup takes it out of the bulk delete instead
  // of dropping it, so the tokens are never lost while the grant stays active.
  it('keeps an unreadable expired flow that holds GitLab tokens', async () => {
    attachPrisma(backend, mockPrisma);
    const gitlabTokens = {
      access_token: 'cached-token',
      refresh_token: 'cached-refresh',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 0,
    };
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([
      {
        ...createAuthCodeFlow(),
        internalState: 'unreadable',
        expiresAt: BigInt(1),
        gitlabTokens,
        link: {
          sessionId: 'session-1',
          stage: 'unknown',
          instance: 'https://gitlab.com',
        },
      },
    ]);
    mockPrisma.authCodeFlowState.updateMany.mockResolvedValueOnce({ count: 1 });
    const handler = jest.fn(async () => {});
    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
      ...createAuthCodeFlow(),
      internalState: 'cleanup:unreadable',
      expiresAt: BigInt(1),
      gitlabTokens,
      link: {
        sessionId: 'session-1',
        stage: 'unknown',
        instance: 'https://gitlab.com',
      },
    });
    backend.onAbandonedFlowGrant(handler, 60_000);

    await backend.cleanup();

    expect(handler).not.toHaveBeenCalled();
    expect(mockPrisma.authCodeFlowState.updateMany).toHaveBeenCalledWith({
      where: {
        internalState: 'unreadable',
        expiresAt: { lt: expect.any(BigInt) },
      },
      data: {
        internalState: 'cleanup:unreadable',
        expiresAt: expect.any(BigInt),
      },
    });
    expect(
      mockPrisma.authCodeFlowState.deleteMany.mock.calls.some(
        ([request]) => request.where.internalState === 'cleanup:unreadable',
      ),
    ).toBe(false);
  });

  // A stopped worker's claim becomes retryable after its lease, with a new lease
  // fencing the retry so another replica cannot spend the same refresh token.
  it('reclaims an expired cleanup lease before ending the grant', async () => {
    attachPrisma(backend, mockPrisma);
    const gitlabTokens = {
      access_token: 'cached-token',
      refresh_token: 'cached-refresh',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 0,
    };
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([
      {
        ...createAuthCodeFlow(),
        internalState: 'cleanup:abandoned',
        expiresAt: BigInt(1),
        gitlabTokens,
      },
    ]);
    const handler = jest.fn(async () => {});
    mockPrisma.authCodeFlowState.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
      ...createAuthCodeFlow(),
      internalState: 'cleanup:abandoned',
      expiresAt: BigInt(1),
      gitlabTokens,
    });
    backend.onAbandonedFlowGrant(handler, 60_000);

    await backend.cleanup();

    expect(mockPrisma.authCodeFlowState.updateMany).toHaveBeenCalledWith({
      where: {
        internalState: 'cleanup:abandoned',
        expiresAt: { lt: expect.any(BigInt) },
      },
      data: {
        internalState: 'cleanup:abandoned',
        expiresAt: expect.any(BigInt),
      },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockPrisma.authCodeFlowState.deleteMany).toHaveBeenCalledWith({
      where: {
        internalState: 'cleanup:abandoned',
        expiresAt: mockPrisma.authCodeFlowState.updateMany.mock.calls[0][0].data.expiresAt,
      },
    });
  });

  it('persists rotated tokens under the cleanup lease and retains them after revoke failure', async () => {
    // The batch snapshot may predate a failed cleanup's rotation. Re-read the claimed
    // row and persist its next token pair before a retry can lose those credentials.
    attachPrisma(backend, mockPrisma);
    const tokens = {
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      token_type: 'Bearer',
      expires_in: 7200,
      created_at: 0,
    };
    const currentTokens = {
      ...tokens,
      access_token: 'stored-access',
      refresh_token: 'stored-refresh',
    };
    const fresh = {
      ...tokens,
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
    };
    const row = {
      ...createAuthCodeFlow(),
      internalState: 'abandoned',
      expiresAt: BigInt(1),
      gitlabTokens: tokens,
    };
    mockPrisma.authCodeFlowState.findMany.mockResolvedValueOnce([row]);
    mockPrisma.authCodeFlowState.findUnique.mockResolvedValueOnce({
      ...row,
      internalState: 'cleanup:abandoned',
      gitlabTokens: currentTokens,
    });
    mockPrisma.authCodeFlowState.updateMany.mockResolvedValue({ count: 1 });
    let seenTokens: unknown;
    backend.onAbandonedFlowGrant(async (flow, persistTokens) => {
      seenTokens = flow.gitlabTokens;
      await persistTokens(fresh);
      throw new Error('GitLab revoke unavailable');
    }, 60_000);

    await backend.cleanup();

    expect(seenTokens).toEqual(currentTokens);
    const leaseUntil = mockPrisma.authCodeFlowState.updateMany.mock.calls[0][0].data.expiresAt;
    expect(mockPrisma.authCodeFlowState.updateMany).toHaveBeenCalledWith({
      where: { internalState: 'cleanup:abandoned', expiresAt: leaseUntil },
      data: { gitlabTokens: fresh },
    });
    expect(
      mockPrisma.authCodeFlowState.deleteMany.mock.calls.some(
        ([request]) => request.where.internalState === 'cleanup:abandoned',
      ),
    ).toBe(false);
  });

  it('lets only one replica resume an abandoned-flow cleanup lease', async () => {
    // Refresh tokens are single-use: even an already prefixed cleanup row must be
    // claimed atomically before a worker can rotate its credentials.
    const peer = new PostgreSQLStorageBackend();
    attachPrisma(backend, mockPrisma);
    attachPrisma(peer, mockPrisma);
    const row = {
      ...createAuthCodeFlow(),
      internalState: 'cleanup:abandoned',
      expiresAt: BigInt(1),
      gitlabTokens: {
        access_token: 'old',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 7200,
        created_at: 0,
      },
    };
    mockPrisma.authCodeFlowState.findMany.mockResolvedValue([{ ...row }]);
    mockPrisma.authCodeFlowState.findUnique.mockImplementation(async () => ({
      ...row,
    }));
    mockPrisma.authCodeFlowState.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.internalState !== row.internalState || row.expiresAt >= where.expiresAt.lt) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const handler = jest.fn(async () => {
      if (++calls === 1) {
        entered();
        await held;
      }
    });
    backend.onAbandonedFlowGrant(handler, 60_000);
    peer.onAbandonedFlowGrant(handler, 60_000);
    const first = backend.cleanup();
    await started;
    try {
      await peer.cleanup();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
  });

  it('does not expose a leased cleanup row to OAuth callbacks', async () => {
    // The cleanup lease extends storage expiry, not browser authorization: the
    // reserved state must remain unreadable and unspendable by callback routes.
    attachPrisma(backend, mockPrisma);
    expect(await backend.getAuthCodeFlow('cleanup:state')).toBeUndefined();
    expect(await backend.consumeAuthCodeFlow('cleanup:state')).toBeUndefined();
    expect(mockPrisma.authCodeFlowState.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.authCodeFlowState.deleteMany).not.toHaveBeenCalled();
  });

  // A backlog of expired sessions is ended a few at a time, not in one burst.
  it('ends the grants of expired sessions a few at a time', async () => {
    attachPrisma(backend, mockPrisma);
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...createSession(),
      id: `expired-${i}`,
      createdAt: BigInt(1),
      linkedToSessionId: null,
    }));
    mockPrisma.oAuthSession.findMany.mockResolvedValueOnce(rows);
    let running = 0;
    let peak = 0;
    backend.onExpiredSession(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });

    await backend.cleanup();

    expect(peak).toBe(5);
  });

  // An expired session and its linked accounts hold GitLab grants: cleanup hands each
  // expired session (never a linked account, which goes with it) to the handler that ends
  // them, before its own delete removes whatever is left.
  it('hands each expired session to the expiry handler before deleting it', async () => {
    attachPrisma(backend, mockPrisma);
    const expired = {
      ...createSession(),
      createdAt: BigInt(1),
      linkedToSessionId: null,
    };
    mockPrisma.oAuthSession.findMany.mockResolvedValueOnce([expired]);
    const handler = jest.fn(async () => {
      throw new Error('GitLab unavailable');
    });
    backend.onExpiredSession(handler);

    await backend.cleanup();

    expect(mockPrisma.oAuthSession.findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(BigInt) }, linkedToSessionId: null },
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  // Row conversion can throw synchronously before a handler returns a promise. One
  // corrupt session must not prevent another session or unrelated expired data cleanup.
  it('continues expiry cleanup after an unreadable session', async () => {
    attachPrisma(backend, mockPrisma);
    const valid = { ...createSession(), createdAt: BigInt(1), linkedToSessionId: null };
    mockPrisma.oAuthSession.findMany.mockResolvedValueOnce([
      { ...valid, id: 'unreadable', gitlabScopes: ['api', 123] },
      valid,
    ]);
    const handler = jest.fn(async () => {});
    backend.onExpiredSession(handler);

    await backend.cleanup();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: valid.id }));
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.deviceFlowState.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.oAuthClient.deleteMany).toHaveBeenCalled();
  });

  // Linking an account again after a GitLab username change stores the new username.
  it('updates the GitLab username of a session', async () => {
    attachPrisma(backend, mockPrisma);

    await backend.updateSession('session-1', { gitlabUsername: 'renamed' });

    expect(mockPrisma.oAuthSession.updateMany.mock.calls[0][0].data.gitlabUsername).toBe('renamed');
  });

  it('runs cleanup and stats', async () => {
    attachPrisma(backend, mockPrisma);

    await backend.cleanup();
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Expired never-used client registrations go with the expired flows and codes.
    expect(mockPrisma.oAuthClient.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(BigInt) } },
    });

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

  // Account settings are written compare-and-set in one statement, so of replicas
  // writing the same version exactly one succeeds and a stale edit changes nothing.
  describe('account settings', () => {
    beforeEach(() => {
      attachPrisma(backend, mockPrisma);
    });

    it('reads stored settings with their version', async () => {
      mockPrisma.accountSettings.findUnique.mockResolvedValue({
        accountKey: 'acct',
        settings: { readOnly: true },
        version: 3,
        updatedAt: BigInt(42),
      });

      expect(await backend.getAccountSettings('acct')).toEqual({
        accountKey: 'acct',
        settings: { readOnly: true },
        version: 3,
        updatedAt: 42,
      });
      expect(mockPrisma.accountSettings.findUnique).toHaveBeenCalledWith({
        where: { accountKey: 'acct' },
      });
    });

    it('has no settings for an unknown account', async () => {
      mockPrisma.accountSettings.findUnique.mockResolvedValue(null);

      expect(await backend.getAccountSettings('acct')).toBeUndefined();
    });

    it('creates the first settings at version 1', async () => {
      const stored = await backend.putAccountSettings('acct', { preset: 'pm' }, 0);

      expect(mockPrisma.accountSettings.create).toHaveBeenCalledWith({
        data: {
          accountKey: 'acct',
          settings: { preset: 'pm' },
          version: 1,
          updatedAt: expect.any(BigInt),
        },
      });
      expect(stored).toMatchObject({ settings: { preset: 'pm' }, version: 1 });
    });

    // Two replicas creating the first settings: the primary key lets one insert win.
    it('reports a lost race for the first settings as a conflict', async () => {
      mockPrisma.accountSettings.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      expect(await backend.putAccountSettings('acct', { preset: 'pm' }, 0)).toBeUndefined();
    });

    it('propagates any other failure of the first write', async () => {
      mockPrisma.accountSettings.create.mockRejectedValue(new Error('connection lost'));

      await expect(backend.putAccountSettings('acct', { preset: 'pm' }, 0)).rejects.toThrow(
        'connection lost',
      );
    });

    it('updates only the row still at the expected version', async () => {
      mockPrisma.accountSettings.updateMany.mockResolvedValue({ count: 1 });

      const stored = await backend.putAccountSettings('acct', { readOnly: false }, 4);

      expect(mockPrisma.accountSettings.updateMany).toHaveBeenCalledWith({
        where: { accountKey: 'acct', version: 4 },
        data: {
          settings: { readOnly: false },
          version: 5,
          updatedAt: expect.any(BigInt),
        },
      });
      expect(stored).toMatchObject({
        settings: { readOnly: false },
        version: 5,
      });
    });

    it('reports a stale version as a conflict', async () => {
      mockPrisma.accountSettings.updateMany.mockResolvedValue({ count: 0 });

      expect(await backend.putAccountSettings('acct', { readOnly: false }, 4)).toBeUndefined();
    });
  });
});
