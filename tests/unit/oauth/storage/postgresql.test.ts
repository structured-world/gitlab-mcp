import {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
} from "../../../../src/oauth/types";
import { PostgreSQLStorageBackend } from "../../../../src/oauth/storage/postgresql";

let mockPrisma: any;

jest.mock("../../../../generated/prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const createMockPrisma = () => ({
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $transaction: jest.fn().mockResolvedValue([
    { count: 1 },
    { count: 2 },
    { count: 3 },
    { count: 4 },
  ]),
  oAuthSession: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  },
  deviceFlowState: {
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
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
    count: jest.fn().mockResolvedValue(0),
  },
});

const createSession = (): OAuthSession => ({
  id: "session-1",
  mcpAccessToken: "mcp-access",
  mcpRefreshToken: "mcp-refresh",
  mcpTokenExpiry: 1111,
  gitlabAccessToken: "gl-access",
  gitlabRefreshToken: "gl-refresh",
  gitlabTokenExpiry: 2222,
  gitlabUserId: 10,
  gitlabUsername: "test-user",
  clientId: "client-1",
  scopes: ["read_api"],
  createdAt: 3333,
  updatedAt: 4444,
});

const createDeviceFlow = (): DeviceFlowState => ({
  state: "state-1",
  deviceCode: "device-1",
  userCode: "user-1",
  verificationUri: "https://gitlab.example.com/verify",
  verificationUriComplete: "https://gitlab.example.com/verify?code=abc",
  expiresAt: 5555,
  interval: 5,
  clientId: "client-1",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
  redirectUri: "https://gitlab.example.com/redirect",
});

const createAuthCodeFlow = (): AuthCodeFlowState => ({
  internalState: "internal-1",
  clientId: "client-1",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
  clientState: "client-state",
  clientRedirectUri: "https://gitlab.example.com/callback",
  callbackUri: "https://gitlab.example.com/authorize",
  expiresAt: 6666,
});

const createAuthCode = (): AuthorizationCode => ({
  code: "code-1",
  sessionId: "session-1",
  clientId: "client-1",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
  redirectUri: "https://gitlab.example.com/callback",
  expiresAt: 7777,
});

describe("PostgreSQLStorageBackend", () => {
  let backend: PostgreSQLStorageBackend;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    backend = new PostgreSQLStorageBackend();
  });

  it("initializes and closes prisma client", async () => {
    jest.useFakeTimers();

    await backend.initialize();
    expect(mockPrisma.$connect).toHaveBeenCalled();

    await backend.close();
    expect(mockPrisma.$disconnect).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("throws when used before initialization", async () => {
    await expect(backend.getStats()).rejects.toThrow("PostgreSQL/Prisma client not initialized");
  });

  it("creates, reads, updates, and deletes sessions", async () => {
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

    const updateOk = await backend.updateSession(session.id, {
      mcpAccessToken: "new-access",
      gitlabTokenExpiry: 9999,
    });
    expect(updateOk).toBe(true);

    mockPrisma.oAuthSession.update.mockRejectedValueOnce(new Error("fail"));
    const updateFail = await backend.updateSession(session.id, { mcpAccessToken: "bad" });
    expect(updateFail).toBe(false);

    const deleteOk = await backend.deleteSession(session.id);
    expect(deleteOk).toBe(true);

    mockPrisma.oAuthSession.delete.mockRejectedValueOnce(new Error("fail"));
    const deleteFail = await backend.deleteSession(session.id);
    expect(deleteFail).toBe(false);
  });

  it("lists sessions", async () => {
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

  it("handles device flow operations", async () => {
    (backend as any).prisma = mockPrisma;

    const flow = createDeviceFlow();
    await backend.storeDeviceFlow(flow.state, flow);
    expect(mockPrisma.deviceFlowState.upsert).toHaveBeenCalled();

    mockPrisma.deviceFlowState.findUnique.mockResolvedValueOnce({
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

    const deleteOk = await backend.deleteDeviceFlow(flow.state);
    expect(deleteOk).toBe(true);

    mockPrisma.deviceFlowState.delete.mockRejectedValueOnce(new Error("fail"));
    const deleteFail = await backend.deleteDeviceFlow(flow.state);
    expect(deleteFail).toBe(false);
  });

  it("handles auth code flow operations", async () => {
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

    const deleteOk = await backend.deleteAuthCodeFlow(flow.internalState);
    expect(deleteOk).toBe(true);

    mockPrisma.authCodeFlowState.delete.mockRejectedValueOnce(new Error("fail"));
    const deleteFail = await backend.deleteAuthCodeFlow(flow.internalState);
    expect(deleteFail).toBe(false);
  });

  it("handles authorization code operations", async () => {
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

    const deleteOk = await backend.deleteAuthCode(code.code);
    expect(deleteOk).toBe(true);

    mockPrisma.authorizationCode.delete.mockRejectedValueOnce(new Error("fail"));
    const deleteFail = await backend.deleteAuthCode(code.code);
    expect(deleteFail).toBe(false);
  });

  it("handles mcp session mapping", async () => {
    (backend as any).prisma = mockPrisma;

    await backend.associateMcpSession("mcp-1", "session-1");
    expect(mockPrisma.mcpSessionMapping.upsert).toHaveBeenCalled();

    const session = createSession();
    mockPrisma.mcpSessionMapping.findUnique.mockResolvedValueOnce({
      mcpSessionId: "mcp-1",
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

    const fetched = await backend.getSessionByMcpSessionId("mcp-1");
    expect(fetched?.id).toBe(session.id);

    mockPrisma.mcpSessionMapping.findUnique.mockResolvedValueOnce({
      mcpSessionId: "mcp-2",
      oauthSessionId: "session-2",
      oauthSession: undefined,
    });
    const missing = await backend.getSessionByMcpSessionId("mcp-2");
    expect(missing).toBeUndefined();

    const deleteOk = await backend.removeMcpSessionAssociation("mcp-1");
    expect(deleteOk).toBe(true);

    mockPrisma.mcpSessionMapping.delete.mockRejectedValueOnce(new Error("fail"));
    const deleteFail = await backend.removeMcpSessionAssociation("mcp-1");
    expect(deleteFail).toBe(false);
  });

  it("runs cleanup and stats", async () => {
    (backend as any).prisma = mockPrisma;

    await backend.cleanup();
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    mockPrisma.$transaction.mockRejectedValueOnce(new Error("fail"));
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
