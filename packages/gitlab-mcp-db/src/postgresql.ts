/**
 * PostgreSQL Session Storage Backend (Prisma)
 *
 * Production-grade storage for multi-instance deployments.
 * Uses Prisma ORM for type-safe database access.
 *
 * Features:
 * - Type-safe queries via Prisma
 * - Automatic migrations on startup
 * - Connection pooling (Prisma managed)
 * - Automatic cleanup of expired entries
 */

import type {
  OAuthSession,
  DeviceFlowState as DeviceFlowStateType,
  AuthCodeFlowState as AuthCodeFlowStateType,
  AuthorizationCode as AuthorizationCodeType,
  RegisteredOAuthClient as RegisteredOAuthClientType,
  GitLabTokenResponse,
  SessionStorageBackend,
  SessionStorageStats,
} from '@structured-world/gitlab-mcp/storage-contract';
import { logInfo, logError, logDebug } from './logger';

/**
 * Explicit interfaces for Prisma model results.
 * These mirror the Prisma schema but with explicit types that ESLint can resolve.
 */
interface PrismaOAuthSessionRow {
  id: string;
  mcpAccessToken: string;
  mcpRefreshToken: string;
  mcpTokenExpiry: bigint;
  gitlabAccessToken: string;
  gitlabRefreshToken: string;
  gitlabTokenExpiry: bigint;
  gitlabScopes?: unknown;
  gitlabUserId: number;
  gitlabUsername: string;
  gitlabApiUrl: string | null;
  instanceLabel: string | null;
  clientId: string;
  scopes: string[];
  resource?: string | null;
  createdAt: bigint;
  updatedAt: bigint;
}

interface PrismaDeviceFlowStateRow {
  requestedGitlabScopes?: unknown;
  clientState?: string | null;
  nextPollAt?: bigint | null;
  selectedInstance?: string | null;
  selectedInstanceLabel?: string | null;
  mcpScopes?: unknown;
  resource?: string | null;
  gitlabTokens?: unknown;
  state: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: bigint;
  interval: number;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string | null;
}

interface PrismaAuthCodeFlowStateRow {
  requestedGitlabScopes?: unknown;
  selectedInstance?: string | null;
  selectedInstanceLabel?: string | null;
  mcpScopes?: unknown;
  resource?: string | null;
  internalState: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientState: string;
  clientRedirectUri: string;
  callbackUri: string;
  expiresAt: bigint;
}

interface PrismaAuthorizationCodeRow {
  code: string;
  sessionId: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string | null;
  expiresAt: bigint;
}

interface PrismaMcpSessionMappingRow {
  mcpSessionId: string;
  oauthSessionId: string;
  oauthSession?: PrismaOAuthSessionRow;
}

interface PrismaOAuthClientRow {
  clientId: string;
  clientSecret: string | null;
  redirectUris: string[];
  clientName: string | null;
  tokenEndpointAuthMethod: string;
  grantTypes: string[];
  responseTypes: string[];
  createdAt: bigint;
}

interface PrismaBatchPayload {
  count: number;
}

/** Preserve unknown/empty grants and reject corrupt durable permissions. */
function storedGitlabScopes(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || !value.every((scope) => typeof scope === 'string')) {
    throw new Error('Invalid stored GitLab scopes');
  }
  return value;
}

/** MCP scopes of a flow; null means the full default set, corrupt values are refused. */
function storedMcpScopes(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || !value.every((scope) => typeof scope === 'string')) {
    throw new Error('Invalid stored MCP scopes');
  }
  return value;
}

/** GitLab tokens kept with a device flow; corrupt values are refused, not half-used. */
function storedGitlabTokens(value: unknown): GitLabTokenResponse | undefined {
  if (value == null) return undefined;
  const tokens = value as Partial<Record<keyof GitLabTokenResponse, unknown>>;
  if (
    typeof tokens.access_token !== 'string' ||
    typeof tokens.refresh_token !== 'string' ||
    typeof tokens.token_type !== 'string' ||
    typeof tokens.expires_in !== 'number' ||
    typeof tokens.created_at !== 'number' ||
    (tokens.scope !== undefined && typeof tokens.scope !== 'string')
  ) {
    throw new Error('Invalid stored GitLab tokens');
  }
  return value as GitLabTokenResponse;
}

/** Optional row values come back as null; the contract uses absent properties. */
function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * Generic Prisma client interface.
 * We use a loose interface here to avoid type compatibility issues with Prisma's complex types.
 */
interface GenericPrismaClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction(operations: unknown[]): Promise<unknown[]>;
  oAuthSession: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
    findMany(): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    count(): Promise<number>;
  };
  oAuthClient: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
  };
  deviceFlowState: {
    upsert(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    count(): Promise<number>;
  };
  authCodeFlowState: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    count(): Promise<number>;
  };
  authorizationCode: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    count(): Promise<number>;
  };
  mcpSessionMapping: {
    upsert(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
    count(): Promise<number>;
  };
}

export interface PostgreSQLStorageOptions {
  /** PostgreSQL connection string (optional, uses OAUTH_STORAGE_POSTGRESQL_URL if not provided) */
  connectionString?: string;
}

export class PostgreSQLStorageBackend implements SessionStorageBackend {
  readonly type = 'postgresql' as const;

  private prisma: GenericPrismaClient | null = null;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly connectionString: string | undefined;

  constructor(options: PostgreSQLStorageOptions = {}) {
    this.connectionString =
      options.connectionString ??
      process.env.OAUTH_STORAGE_POSTGRESQL_URL ??
      process.env.DATABASE_URL;
  }

  async initialize(): Promise<void> {
    try {
      if (!this.connectionString) {
        throw new Error('PostgreSQL storage requires OAUTH_STORAGE_POSTGRESQL_URL or DATABASE_URL');
      }

      // Dynamic import Prisma client to avoid initialization if not used
      const prismaModule = (await import('../generated/prisma/client')) as unknown as {
        PrismaClient: new (opts: Record<string, unknown>) => GenericPrismaClient;
      };
      const { PrismaPg } = await import('@prisma/adapter-pg');

      // Prisma 7 connects through a driver adapter; the client has no built-in engine.
      this.prisma = new prismaModule.PrismaClient({
        adapter: new PrismaPg({ connectionString: this.connectionString }),
      });

      // Connect and test
      await this.prisma.$connect();

      // Start cleanup interval
      this.startCleanupInterval();

      logInfo('PostgreSQL storage backend initialized via Prisma');
    } catch (error) {
      logError('Failed to initialize PostgreSQL storage backend', {
        err: error as Error,
      });
      throw error;
    }
  }

  private getPrisma(): GenericPrismaClient {
    if (!this.prisma) {
      throw new Error('PostgreSQL/Prisma client not initialized');
    }
    return this.prisma;
  }

  // Session operations
  async createSession(session: OAuthSession): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.oAuthSession.create({
      data: {
        id: session.id,
        mcpAccessToken: session.mcpAccessToken,
        mcpRefreshToken: session.mcpRefreshToken,
        mcpTokenExpiry: BigInt(session.mcpTokenExpiry),
        gitlabAccessToken: session.gitlabAccessToken,
        gitlabRefreshToken: session.gitlabRefreshToken,
        gitlabTokenExpiry: BigInt(session.gitlabTokenExpiry),
        gitlabScopes: session.gitlabScopes,
        gitlabUserId: session.gitlabUserId,
        gitlabUsername: session.gitlabUsername,
        gitlabApiUrl: session.gitlabApiUrl,
        instanceLabel: session.instanceLabel,
        clientId: session.clientId,
        scopes: session.scopes,
        resource: session.resource ?? null,
        createdAt: BigInt(session.createdAt),
        updatedAt: BigInt(session.updatedAt),
      },
    });
    logDebug('Session created in PostgreSQL', { sessionId: session.id });
  }

  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.oAuthSession.findUnique({
      where: { id: sessionId },
    })) as PrismaOAuthSessionRow | null;
    return row ? this.rowToSession(row) : undefined;
  }

  async getSessionByToken(token: string): Promise<OAuthSession | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.oAuthSession.findFirst({
      where: { mcpAccessToken: token },
    })) as PrismaOAuthSessionRow | null;
    return row ? this.rowToSession(row) : undefined;
  }

  async getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.oAuthSession.findFirst({
      where: { mcpRefreshToken: refreshToken },
    })) as PrismaOAuthSessionRow | null;
    return row ? this.rowToSession(row) : undefined;
  }

  // Updates and deletes report a missing row as false through the affected-row count;
  // database errors propagate, so a failed write is never mistaken for an absent row.
  async updateSession(sessionId: string, updates: Partial<OAuthSession>): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.oAuthSession.updateMany({
      where: { id: sessionId },
      data: this.sessionUpdateData(updates),
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  async rotateSession(
    sessionId: string,
    expectedRefreshToken: string,
    updates: Partial<OAuthSession>,
  ): Promise<boolean> {
    const prisma = this.getPrisma();
    // Compare-and-set in one statement: only the row still holding the presented refresh
    // token is updated, so concurrent refreshes on different replicas have one winner.
    const result = (await prisma.oAuthSession.updateMany({
      where: { id: sessionId, mcpRefreshToken: expectedRefreshToken },
      data: this.sessionUpdateData(updates),
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  private sessionUpdateData(updates: Partial<OAuthSession>): Record<string, unknown> {
    const data: Record<string, unknown> = {
      updatedAt: BigInt(Date.now()),
    };

    if (updates.mcpAccessToken !== undefined) {
      data.mcpAccessToken = updates.mcpAccessToken;
    }
    if (updates.mcpRefreshToken !== undefined) {
      data.mcpRefreshToken = updates.mcpRefreshToken;
    }
    if (updates.mcpTokenExpiry !== undefined) {
      data.mcpTokenExpiry = BigInt(updates.mcpTokenExpiry);
    }
    if (updates.gitlabAccessToken !== undefined) {
      data.gitlabAccessToken = updates.gitlabAccessToken;
    }
    if (updates.gitlabRefreshToken !== undefined) {
      data.gitlabRefreshToken = updates.gitlabRefreshToken;
    }
    if (updates.gitlabTokenExpiry !== undefined) {
      data.gitlabTokenExpiry = BigInt(updates.gitlabTokenExpiry);
    }
    if (updates.gitlabScopes !== undefined) {
      data.gitlabScopes = updates.gitlabScopes;
    }
    if (updates.resource !== undefined) {
      data.resource = updates.resource;
    }
    return data;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.oAuthSession.deleteMany({
      where: { id: sessionId },
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  async getAllSessions(): Promise<OAuthSession[]> {
    const prisma = this.getPrisma();
    const rows = (await prisma.oAuthSession.findMany()) as PrismaOAuthSessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  private rowToSession(row: PrismaOAuthSessionRow): OAuthSession {
    return {
      id: row.id,
      mcpAccessToken: row.mcpAccessToken,
      mcpRefreshToken: row.mcpRefreshToken,
      mcpTokenExpiry: Number(row.mcpTokenExpiry),
      gitlabAccessToken: row.gitlabAccessToken,
      gitlabRefreshToken: row.gitlabRefreshToken,
      gitlabTokenExpiry: Number(row.gitlabTokenExpiry),
      gitlabScopes: storedGitlabScopes(row.gitlabScopes),
      gitlabUserId: row.gitlabUserId,
      gitlabUsername: row.gitlabUsername,
      gitlabApiUrl: row.gitlabApiUrl ?? undefined,
      instanceLabel: row.instanceLabel ?? undefined,
      clientId: row.clientId,
      scopes: row.scopes,
      resource: optional(row.resource),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  // Device flow operations
  async storeDeviceFlow(state: string, flow: DeviceFlowStateType): Promise<void> {
    const prisma = this.getPrisma();
    // Every write stores the whole flow: polling replicas update the interval and the
    // next poll time, and must not drop the binding written at /authorize.
    const data = {
      deviceCode: flow.deviceCode,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      verificationUriComplete: flow.verificationUriComplete ?? null,
      expiresAt: BigInt(flow.expiresAt),
      interval: flow.interval,
      clientId: flow.clientId,
      codeChallenge: flow.codeChallenge,
      codeChallengeMethod: flow.codeChallengeMethod,
      redirectUri: flow.redirectUri ?? null,
      requestedGitlabScopes: flow.requestedGitlabScopes,
      // `state` is the storage key; the client's own state has its own column.
      clientState: flow.state,
      nextPollAt: flow.nextPollAt === undefined ? null : BigInt(flow.nextPollAt),
      selectedInstance: flow.selectedInstance ?? null,
      selectedInstanceLabel: flow.selectedInstanceLabel ?? null,
      mcpScopes: flow.scopes,
      resource: flow.resource ?? null,
      gitlabTokens: flow.gitlabTokens,
    };
    await prisma.deviceFlowState.upsert({
      where: { state },
      update: data,
      create: { state, ...data },
    });
  }

  async getDeviceFlow(state: string): Promise<DeviceFlowStateType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.deviceFlowState.findUnique({
      where: { state },
    })) as PrismaDeviceFlowStateRow | null;
    return row ? this.rowToDeviceFlow(row) : undefined;
  }

  async getDeviceFlowByDeviceCode(deviceCode: string): Promise<DeviceFlowStateType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.deviceFlowState.findFirst({
      where: { deviceCode },
    })) as PrismaDeviceFlowStateRow | null;
    return row ? this.rowToDeviceFlow(row) : undefined;
  }

  async deleteDeviceFlow(state: string): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.deviceFlowState.deleteMany({
      where: { state },
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  private rowToDeviceFlow(row: PrismaDeviceFlowStateRow): DeviceFlowStateType {
    return {
      requestedGitlabScopes: storedGitlabScopes(row.requestedGitlabScopes),
      deviceCode: row.deviceCode,
      userCode: row.userCode,
      verificationUri: row.verificationUri,
      verificationUriComplete: row.verificationUriComplete ?? undefined,
      expiresAt: Number(row.expiresAt),
      interval: row.interval,
      clientId: row.clientId,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
      // The client's state, never the storage key; rows written before the column
      // existed have no client state.
      state: row.clientState ?? '',
      redirectUri: row.redirectUri ?? undefined,
      nextPollAt: row.nextPollAt == null ? undefined : Number(row.nextPollAt),
      selectedInstance: optional(row.selectedInstance),
      selectedInstanceLabel: optional(row.selectedInstanceLabel),
      scopes: storedMcpScopes(row.mcpScopes),
      resource: optional(row.resource),
      gitlabTokens: storedGitlabTokens(row.gitlabTokens),
    };
  }

  // Auth code flow operations
  async storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowStateType): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.authCodeFlowState.create({
      data: {
        internalState,
        clientId: flow.clientId,
        codeChallenge: flow.codeChallenge,
        codeChallengeMethod: flow.codeChallengeMethod,
        clientState: flow.clientState,
        clientRedirectUri: flow.clientRedirectUri,
        callbackUri: flow.callbackUri,
        expiresAt: BigInt(flow.expiresAt),
        requestedGitlabScopes: flow.requestedGitlabScopes,
        selectedInstance: flow.selectedInstance ?? null,
        selectedInstanceLabel: flow.selectedInstanceLabel ?? null,
        mcpScopes: flow.scopes,
        resource: flow.resource ?? null,
      },
    });
  }

  async getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowStateType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.authCodeFlowState.findUnique({
      where: { internalState },
    })) as PrismaAuthCodeFlowStateRow | null;
    if (!row) return undefined;
    return this.rowToAuthCodeFlow(row);
  }

  async deleteAuthCodeFlow(internalState: string): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.authCodeFlowState.deleteMany({
      where: { internalState },
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  private rowToAuthCodeFlow(row: PrismaAuthCodeFlowStateRow): AuthCodeFlowStateType {
    return {
      requestedGitlabScopes: storedGitlabScopes(row.requestedGitlabScopes),
      clientId: row.clientId,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
      clientState: row.clientState,
      internalState: row.internalState,
      clientRedirectUri: row.clientRedirectUri,
      callbackUri: row.callbackUri,
      expiresAt: Number(row.expiresAt),
      selectedInstance: optional(row.selectedInstance),
      selectedInstanceLabel: optional(row.selectedInstanceLabel),
      scopes: storedMcpScopes(row.mcpScopes),
      resource: optional(row.resource),
    };
  }

  // Authorization code operations
  async storeAuthCode(code: AuthorizationCodeType): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.authorizationCode.create({
      data: {
        code: code.code,
        sessionId: code.sessionId,
        clientId: code.clientId,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        redirectUri: code.redirectUri ?? null,
        expiresAt: BigInt(code.expiresAt),
      },
    });
  }

  async getAuthCode(code: string): Promise<AuthorizationCodeType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.authorizationCode.findUnique({
      where: { code },
    })) as PrismaAuthorizationCodeRow | null;
    if (!row) return undefined;
    return this.rowToAuthCode(row);
  }

  async deleteAuthCode(code: string): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.authorizationCode.deleteMany({
      where: { code },
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  private rowToAuthCode(row: PrismaAuthorizationCodeRow): AuthorizationCodeType {
    return {
      code: row.code,
      sessionId: row.sessionId,
      clientId: row.clientId,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
      redirectUri: row.redirectUri ?? undefined,
      expiresAt: Number(row.expiresAt),
    };
  }

  // MCP session mapping
  async associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.mcpSessionMapping.upsert({
      where: { mcpSessionId },
      update: { oauthSessionId },
      create: { mcpSessionId, oauthSessionId },
    });
  }

  async getSessionByMcpSessionId(mcpSessionId: string): Promise<OAuthSession | undefined> {
    const prisma = this.getPrisma();
    const mapping = (await prisma.mcpSessionMapping.findUnique({
      where: { mcpSessionId },
      include: { oauthSession: true },
    })) as PrismaMcpSessionMappingRow | null;
    return mapping?.oauthSession ? this.rowToSession(mapping.oauthSession) : undefined;
  }

  async removeMcpSessionAssociation(mcpSessionId: string): Promise<boolean> {
    const prisma = this.getPrisma();
    const result = (await prisma.mcpSessionMapping.deleteMany({
      where: { mcpSessionId },
    })) as PrismaBatchPayload;
    return result.count === 1;
  }

  // Single-use consumption: the row is read, then deleted with a count; only the caller
  // whose delete removed the row (count 1) receives it, on whichever replica it runs.
  async consumeAuthCode(code: string): Promise<AuthorizationCodeType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.authorizationCode.findUnique({
      where: { code },
    })) as PrismaAuthorizationCodeRow | null;
    if (!row) return undefined;
    const removed = (await prisma.authorizationCode.deleteMany({
      where: { code },
    })) as PrismaBatchPayload;
    return removed.count === 1 ? this.rowToAuthCode(row) : undefined;
  }

  async consumeAuthCodeFlow(internalState: string): Promise<AuthCodeFlowStateType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.authCodeFlowState.findUnique({
      where: { internalState },
    })) as PrismaAuthCodeFlowStateRow | null;
    if (!row) return undefined;
    const removed = (await prisma.authCodeFlowState.deleteMany({
      where: { internalState },
    })) as PrismaBatchPayload;
    return removed.count === 1 ? this.rowToAuthCodeFlow(row) : undefined;
  }

  async consumeDeviceFlow(state: string): Promise<DeviceFlowStateType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.deviceFlowState.findUnique({
      where: { state },
    })) as PrismaDeviceFlowStateRow | null;
    if (!row) return undefined;
    const removed = (await prisma.deviceFlowState.deleteMany({
      where: { state },
    })) as PrismaBatchPayload;
    return removed.count === 1 ? this.rowToDeviceFlow(row) : undefined;
  }

  async claimGitLabRefresh(
    sessionId: string,
    expectedRefreshToken: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    const prisma = this.getPrisma();
    // One statement: the row still holds the presented refresh token and no unexpired lease.
    const claimed = (await prisma.oAuthSession.updateMany({
      where: {
        id: sessionId,
        gitlabRefreshToken: expectedRefreshToken,
        OR: [{ gitlabRefreshLeaseUntil: null }, { gitlabRefreshLeaseUntil: { lte: BigInt(now) } }],
      },
      data: { gitlabRefreshLeaseUntil: BigInt(leaseUntil) },
    })) as PrismaBatchPayload;
    return claimed.count === 1;
  }

  async releaseGitLabRefresh(sessionId: string): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.oAuthSession.updateMany({
      where: { id: sessionId },
      data: { gitlabRefreshLeaseUntil: null },
    });
  }

  async claimDevicePoll(
    state: string,
    now: number,
    nextPollAt: number,
  ): Promise<DeviceFlowStateType | undefined> {
    const prisma = this.getPrisma();
    // Conditional update in one statement: of replicas polling the same flow, only the
    // one that moves nextPollAt forward polls GitLab in this interval.
    const claimed = (await prisma.deviceFlowState.updateMany({
      where: {
        state,
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: BigInt(now) } }],
      },
      data: { nextPollAt: BigInt(nextPollAt) },
    })) as PrismaBatchPayload;
    if (claimed.count !== 1) return undefined;
    return this.getDeviceFlow(state);
  }

  // Registered OAuth clients
  async storeClient(client: RegisteredOAuthClientType): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.oAuthClient.create({
      data: {
        clientId: client.clientId,
        clientSecret: client.clientSecret ?? null,
        redirectUris: client.redirectUris,
        clientName: client.clientName ?? null,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        grantTypes: client.grantTypes,
        responseTypes: client.responseTypes,
        createdAt: BigInt(client.createdAt),
      },
    });
  }

  async getClient(clientId: string): Promise<RegisteredOAuthClientType | undefined> {
    const prisma = this.getPrisma();
    const row = (await prisma.oAuthClient.findUnique({
      where: { clientId },
    })) as PrismaOAuthClientRow | null;
    if (!row) return undefined;
    return {
      clientId: row.clientId,
      clientSecret: optional(row.clientSecret),
      redirectUris: row.redirectUris,
      clientName: optional(row.clientName),
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
      grantTypes: row.grantTypes,
      responseTypes: row.responseTypes,
      createdAt: Number(row.createdAt),
    };
  }

  // Cleanup
  async cleanup(): Promise<void> {
    const prisma = this.getPrisma();
    const now = BigInt(Date.now());
    const maxSessionAge = BigInt(7 * 24 * 60 * 60 * 1000); // 7 days

    try {
      // Use transaction for atomic cleanup
      const results = (await prisma.$transaction([
        prisma.oAuthSession.deleteMany({
          where: {
            createdAt: { lt: now - maxSessionAge },
          },
        }),
        prisma.deviceFlowState.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
        prisma.authCodeFlowState.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
        prisma.authorizationCode.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
      ])) as PrismaBatchPayload[];

      const expiredSessions = results[0].count;
      const expiredDeviceFlows = results[1].count;
      const expiredAuthCodeFlows = results[2].count;
      const expiredAuthCodes = results[3].count;

      if (
        expiredSessions > 0 ||
        expiredDeviceFlows > 0 ||
        expiredAuthCodeFlows > 0 ||
        expiredAuthCodes > 0
      ) {
        logDebug('PostgreSQL cleanup completed', {
          expiredSessions,
          expiredDeviceFlows,
          expiredAuthCodeFlows,
          expiredAuthCodes,
        });
      }
    } catch (error) {
      logError('PostgreSQL cleanup failed', { err: error as Error });
    }
  }

  async close(): Promise<void> {
    this.stopCleanupInterval();
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }
    logInfo('PostgreSQL storage backend closed');
  }

  async getStats(): Promise<SessionStorageStats> {
    const prisma = this.getPrisma();
    const [sessions, deviceFlows, authCodeFlows, authCodes, mappings] = await Promise.all([
      prisma.oAuthSession.count(),
      prisma.deviceFlowState.count(),
      prisma.authCodeFlowState.count(),
      prisma.authorizationCode.count(),
      prisma.mcpSessionMapping.count(),
    ]);

    return {
      sessions,
      deviceFlows,
      authCodeFlows,
      authCodes,
      mcpSessionMappings: mappings,
    };
  }

  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanup().catch((err) => logError('PostgreSQL cleanup error', { err }));
      },
      5 * 60 * 1000,
    );

    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  private stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }
}
