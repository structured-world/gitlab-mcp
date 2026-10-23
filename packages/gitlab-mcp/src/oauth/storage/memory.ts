/**
 * In-Memory Session Storage Backend
 *
 * Default storage for development and single-instance deployments.
 * Sessions are lost on server restart.
 */

import {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
  RegisteredOAuthClient,
} from '../types';
import {
  AbandonedFlowGrantHandler,
  ExpiredSessionHandler,
  LinkedAccountCommit,
  isPastAgeLimit,
  SessionStorageBackend,
  SessionStorageStats,
} from './types';
import type { AccountSettings, AccountSettingsRecord } from '../../configuration/types';
import { logInfo, logWarn, logError, logDebug, truncateId } from '../../logger';

export interface MemoryStorageOptions {
  /** Suppress initialization logging (used when wrapped by FileStorage) */
  silent?: boolean;
}

/**
 * How many grants cleanup ends at once: a backlog (after a restart, say) goes out in steps
 * instead of one burst against GitLab's rate limits.
 */
const CLEANUP_BATCH = 5;

/** Run `run` over `items`, at most CLEANUP_BATCH at a time. */
async function inBatches<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
  from = 0,
): Promise<void> {
  if (from >= items.length) return;
  await Promise.all(items.slice(from, from + CLEANUP_BATCH).map((item) => run(item)));
  return inBatches(items, run, from + CLEANUP_BATCH);
}

/** Remove expired entries except records an asynchronous cleanup still owns. */
function deleteExpired<K>(
  entries: Map<K, { expiresAt?: number }>,
  now: number,
  retained?: ReadonlySet<K>,
): number {
  let removed = 0;
  for (const [key, entry] of entries) {
    if (entry.expiresAt !== undefined && entry.expiresAt < now) {
      if (retained?.has(key)) continue;
      entries.delete(key);
      removed++;
    }
  }
  return removed;
}

export class MemoryStorageBackend implements SessionStorageBackend {
  readonly type = 'memory' as const;

  private sessions = new Map<string, OAuthSession>();
  private deviceFlows = new Map<string, DeviceFlowState>();
  private authCodeFlows = new Map<string, AuthCodeFlowState>();
  /** Hidden from callbacks, but retained in exports until their grant is ended. */
  private abandonedFlowsInProgress = new Set<string>();
  private authCodes = new Map<string, AuthorizationCode>();
  private tokenToSession = new Map<string, string>();
  private refreshTokenToSession = new Map<string, string>();
  private mcpSessionToOAuthSession = new Map<string, string>();
  private clients = new Map<string, RegisteredOAuthClient>();
  private accountSettings = new Map<string, AccountSettingsRecord>();
  /** Session id -> end of its GitLab refresh lease (transient, not exported). */
  private gitlabRefreshLeases = new Map<string, number>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private abandonedFlowGrant: AbandonedFlowGrantHandler | undefined;
  private expiredSession: ExpiredSessionHandler | undefined;
  private silent: boolean;

  constructor(options?: MemoryStorageOptions) {
    this.silent = options?.silent ?? false;
  }

  async initialize(): Promise<void> {
    this.startCleanupInterval();
    if (!this.silent) {
      logInfo('Memory storage backend initialized');
    }
  }

  // Session operations
  /** Synchronous insertion shared with the atomic account-link transition. */
  private insertSession(session: OAuthSession): void {
    if (this.sessions.has(session.id)) throw new Error(`Session ${session.id} already exists`);
    this.sessions.set(session.id, session);
    if (session.mcpAccessToken) this.tokenToSession.set(session.mcpAccessToken, session.id);
    if (session.mcpRefreshToken)
      this.refreshTokenToSession.set(session.mcpRefreshToken, session.id);
  }

  async commitLinkedAccount(
    commit: LinkedAccountCommit,
    persist?: () => Promise<void>,
  ): Promise<boolean> {
    // No awaits between lease validation, account mutation and spending the flow: other
    // requests and abandoned-grant cleanup observe both records together. File storage
    // supplies persistence while holding its write/lease queue until this call returns.
    const { account, internalState, primaryLeaseUntil, existing } = commit;
    const now = Date.now();
    const parent = account.linkedToSessionId;
    const flow = this.authCodeFlows.get(internalState);
    if (
      !this.sessions.has(parent) ||
      this.gitlabRefreshLeases.get(parent) !== primaryLeaseUntil ||
      primaryLeaseUntil <= now ||
      !flow ||
      flow.expiresAt <= now ||
      flow.link?.stage !== 'connect' ||
      flow.link.sessionId !== parent ||
      this.abandonedFlowsInProgress.has(internalState)
    )
      return false;

    const stored = this.sessions.get(account.id);
    const previous = stored && { ...stored };
    const previousAccessOwner = this.tokenToSession.get(account.mcpAccessToken);
    const previousRefreshOwner = this.refreshTokenToSession.get(account.mcpRefreshToken);
    if (existing) {
      if (
        stored?.linkedToSessionId !== parent ||
        stored.gitlabRefreshToken !== existing.refreshToken ||
        this.gitlabRefreshLeases.get(account.id) !== existing.leaseUntil ||
        existing.leaseUntil <= now
      )
        return false;
      Object.assign(stored, {
        gitlabAccessToken: account.gitlabAccessToken,
        gitlabRefreshToken: account.gitlabRefreshToken,
        gitlabTokenExpiry: account.gitlabTokenExpiry,
        gitlabScopes: account.gitlabScopes,
        gitlabUsername: account.gitlabUsername,
        updatedAt: now,
      });
    } else {
      if (stored) return false;
      this.insertSession(account);
    }
    this.authCodeFlows.delete(internalState);
    if (persist) {
      try {
        await persist();
      } catch (error: unknown) {
        // File storage serializes this write and lease claims. Undo both records in one
        // synchronous step, preserving timestamps and indexes as well as credentials.
        if (stored && previous) Object.assign(stored, previous);
        else {
          this.sessions.delete(account.id);
          if (account.mcpAccessToken) {
            if (previousAccessOwner === undefined)
              this.tokenToSession.delete(account.mcpAccessToken);
            else this.tokenToSession.set(account.mcpAccessToken, previousAccessOwner);
          }
          if (account.mcpRefreshToken) {
            if (previousRefreshOwner === undefined)
              this.refreshTokenToSession.delete(account.mcpRefreshToken);
            else this.refreshTokenToSession.set(account.mcpRefreshToken, previousRefreshOwner);
          }
        }
        this.authCodeFlows.set(internalState, flow);
        throw error;
      }
    }
    return true;
  }

  async createSession(session: OAuthSession): Promise<void> {
    // Creating never replaces a session, as with the primary key of the database backend.
    this.insertSession(session);
    logDebug('Session created', { sessionId: session.id, userId: session.gitlabUserId });
  }

  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async getSessionByToken(token: string): Promise<OAuthSession | undefined> {
    const sessionId = this.tokenToSession.get(token);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | undefined> {
    const sessionId = this.refreshTokenToSession.get(refreshToken);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async updateSession(sessionId: string, updates: Partial<OAuthSession>): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logWarn('Attempted to update non-existent session', { sessionId });
      return false;
    }

    // Update token indexes if tokens changed
    if (updates.mcpAccessToken && updates.mcpAccessToken !== session.mcpAccessToken) {
      this.tokenToSession.delete(session.mcpAccessToken);
      this.tokenToSession.set(updates.mcpAccessToken, sessionId);
    }
    if (updates.mcpRefreshToken && updates.mcpRefreshToken !== session.mcpRefreshToken) {
      this.refreshTokenToSession.delete(session.mcpRefreshToken);
      this.refreshTokenToSession.set(updates.mcpRefreshToken, sessionId);
    }

    Object.assign(session, updates, { updatedAt: Date.now() });
    logDebug('Session updated', { sessionId });
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const linked = await this.getLinkedSessions(sessionId);
    await Promise.all(linked.map((account) => this.deleteSession(account.id)));
    if (session.mcpAccessToken) {
      this.tokenToSession.delete(session.mcpAccessToken);
    }
    if (session.mcpRefreshToken) {
      this.refreshTokenToSession.delete(session.mcpRefreshToken);
    }

    this.sessions.delete(sessionId);
    this.gitlabRefreshLeases.delete(sessionId);
    logDebug('Session deleted', { sessionId });
    return true;
  }

  async getAllSessions(): Promise<OAuthSession[]> {
    return Array.from(this.sessions.values());
  }

  getLinkedSessions(sessionId: string): Promise<OAuthSession[]> {
    return Promise.resolve(
      Array.from(this.sessions.values())
        .filter((session) => session.linkedToSessionId === sessionId)
        .sort((a, b) => a.createdAt - b.createdAt),
    );
  }

  // Device flow operations
  async storeDeviceFlow(state: string, flow: DeviceFlowState): Promise<void> {
    this.deviceFlows.set(state, flow);
    logDebug('Device flow stored', { state, userCode: flow.userCode });
  }

  async getDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    return this.deviceFlows.get(state);
  }

  async getDeviceFlowByDeviceCode(deviceCode: string): Promise<DeviceFlowState | undefined> {
    for (const flow of this.deviceFlows.values()) {
      if (flow.deviceCode === deviceCode) return flow;
    }
    return undefined;
  }

  async deleteDeviceFlow(state: string): Promise<boolean> {
    const deleted = this.deviceFlows.delete(state);
    if (deleted) logDebug('Device flow deleted', { state });
    return deleted;
  }

  // Auth code flow operations
  async storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowState): Promise<void> {
    this.authCodeFlows.set(internalState, flow);
    logDebug('Auth code flow stored', { internalState: truncateId(internalState) });
  }

  async getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    if (this.abandonedFlowsInProgress.has(internalState)) return undefined;
    return this.authCodeFlows.get(internalState);
  }

  async deleteAuthCodeFlow(internalState: string): Promise<boolean> {
    if (this.abandonedFlowsInProgress.has(internalState)) return false;
    const deleted = this.authCodeFlows.delete(internalState);
    if (deleted) {
      logDebug('Auth code flow deleted', { internalState: truncateId(internalState) });
    }
    return deleted;
  }

  // Authorization code operations
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    this.authCodes.set(code.code, code);
    logDebug('Auth code stored', { code: truncateId(code.code) });
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.authCodes.get(code);
  }

  async deleteAuthCode(code: string): Promise<boolean> {
    const deleted = this.authCodes.delete(code);
    if (deleted) logDebug('Auth code deleted', { code: truncateId(code) });
    return deleted;
  }

  // MCP session mapping
  async associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void> {
    this.mcpSessionToOAuthSession.set(mcpSessionId, oauthSessionId);
    logDebug('MCP session associated with OAuth session', {
      mcpSessionId,
      oauthSessionId: truncateId(oauthSessionId),
    });
  }

  async getSessionByMcpSessionId(mcpSessionId: string): Promise<OAuthSession | undefined> {
    const oauthSessionId = this.mcpSessionToOAuthSession.get(mcpSessionId);
    if (!oauthSessionId) return undefined;
    return this.sessions.get(oauthSessionId);
  }

  async removeMcpSessionAssociation(mcpSessionId: string): Promise<boolean> {
    const deleted = this.mcpSessionToOAuthSession.delete(mcpSessionId);
    if (deleted) logDebug('MCP session association removed', { mcpSessionId });
    return deleted;
  }

  // Registered OAuth clients
  async storeClient(client: RegisteredOAuthClient): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async getClient(clientId: string): Promise<RegisteredOAuthClient | undefined> {
    return this.clients.get(clientId);
  }

  async markClientUsed(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client?.expiresAt !== undefined) {
      this.clients.set(clientId, { ...client, expiresAt: undefined });
    }
  }

  async countClientsRegisteredSince(registeredFrom: string, since: number): Promise<number> {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.registeredFrom === registeredFrom && client.createdAt >= since) count++;
    }
    return count;
  }

  // Account settings: records are copied in and out, so a caller changing what it holds
  // never changes the stored settings.
  async getAccountSettings(accountKey: string): Promise<AccountSettingsRecord | undefined> {
    const record = this.accountSettings.get(accountKey);
    return record ? structuredClone(record) : undefined;
  }

  // Compare and write run without an await in between: of concurrent writes of one
  // version in this process exactly one succeeds.
  async putAccountSettings(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined> {
    const current = this.accountSettings.get(accountKey)?.version ?? 0;
    if (current !== expectedVersion) return undefined;
    const record: AccountSettingsRecord = {
      accountKey,
      settings: structuredClone(settings),
      version: current + 1,
      updatedAt: Date.now(),
    };
    this.accountSettings.set(accountKey, record);
    return structuredClone(record);
  }

  /** Restore the record a failed write replaced (undefined: there was none). */
  restoreAccountSettings(accountKey: string, previous: AccountSettingsRecord | undefined): void {
    if (previous) this.accountSettings.set(accountKey, previous);
    else this.accountSettings.delete(accountKey);
  }

  // Single-use consumption: lookup and removal run without an await in between, so in
  // this process exactly one caller gets the record.
  async consumeAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    const record = this.authCodes.get(code);
    if (record) this.authCodes.delete(code);
    return record;
  }

  async consumeAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    if (this.abandonedFlowsInProgress.has(internalState)) return undefined;
    const record = this.authCodeFlows.get(internalState);
    if (record) this.authCodeFlows.delete(internalState);
    return record;
  }

  async consumeDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    const record = this.deviceFlows.get(state);
    if (record) this.deviceFlows.delete(state);
    return record;
  }

  async claimDevicePoll(
    state: string,
    now: number,
    nextPollAt: number,
  ): Promise<DeviceFlowState | undefined> {
    const flow = this.deviceFlows.get(state);
    if (!flow || (flow.nextPollAt !== undefined && flow.nextPollAt > now)) return undefined;
    const claimed = { ...flow, nextPollAt };
    this.deviceFlows.set(state, claimed);
    return claimed;
  }

  async claimGitLabRefresh(
    sessionId: string,
    expectedRefreshToken: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    if (this.sessions.get(sessionId)?.gitlabRefreshToken !== expectedRefreshToken) return false;
    const held = this.gitlabRefreshLeases.get(sessionId);
    if (held !== undefined && held > now) return false;
    this.gitlabRefreshLeases.set(sessionId, leaseUntil);
    return true;
  }

  async releaseGitLabRefresh(sessionId: string, leaseUntil: number): Promise<void> {
    if (this.gitlabRefreshLeases.get(sessionId) === leaseUntil) {
      this.gitlabRefreshLeases.delete(sessionId);
    }
  }

  async rotateSession(
    sessionId: string,
    expectedRefreshToken: string,
    updates: Partial<OAuthSession>,
  ): Promise<boolean> {
    if (this.sessions.get(sessionId)?.mcpRefreshToken !== expectedRefreshToken) {
      return false;
    }
    return this.updateSession(sessionId, updates);
  }

  onAbandonedFlowGrant(handler: AbandonedFlowGrantHandler, leaseMs: number): void {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error('Abandoned-flow cleanup requires a positive integer lease duration');
    }
    this.abandonedFlowGrant = handler;
  }

  onExpiredSession(handler: ExpiredSessionHandler): void {
    this.expiredSession = handler;
  }

  /**
   * Remove a session past its age limit: through the handler, which ends its grants and
   * those of its linked accounts, then directly if the handler failed or left it.
   */
  private async expire(session: OAuthSession): Promise<void> {
    await this.expiredSession?.(session).catch((error: unknown) => {
      logWarn('Could not end the grants of an expired session', { err: error as Error });
    });
    await this.deleteSession(session.id);
  }

  // Cleanup
  async cleanup(): Promise<void> {
    const now = Date.now();

    // Clean up expired sessions (7 days max age). A linked account goes with its session;
    // it is younger than the session, so only one left without a session expires by itself.
    const expired = [...this.sessions.values()].filter(
      (session) =>
        isPastAgeLimit(session, now) &&
        !(session.linkedToSessionId && this.sessions.has(session.linkedToSessionId)),
    );
    await inBatches(expired, (session) => this.expire(session));
    const expiredSessions = expired.length;

    const expiredDeviceFlows = deleteExpired(this.deviceFlows, now);
    const handler = this.abandonedFlowGrant;
    const abandoned = handler
      ? [...this.authCodeFlows].filter(
          ([state, flow]) =>
            flow.gitlabTokens && flow.expiresAt < now && !this.abandonedFlowsInProgress.has(state),
        )
      : [];
    for (const [state] of abandoned) this.abandonedFlowsInProgress.add(state);
    let expiredAuthCodeFlows = deleteExpired(
      this.authCodeFlows,
      now,
      this.abandonedFlowsInProgress,
    );
    // Keep the only grant copy in exports during the GitLab request too: file autosaves
    // must not erase it. Callback reads/consumption and concurrent cleanups skip its claim.
    if (handler) {
      await inBatches(abandoned, async ([state, flow]) => {
        try {
          await handler(flow, async (tokens) => {
            flow.gitlabTokens = tokens;
            this.authCodeFlows.set(state, flow);
          });
          this.authCodeFlows.delete(state);
          expiredAuthCodeFlows++;
        } catch (error: unknown) {
          logWarn('Could not end the grant of an abandoned flow', { err: error as Error });
          this.authCodeFlows.set(state, flow);
        } finally {
          this.abandonedFlowsInProgress.delete(state);
        }
      });
    }
    const expiredAuthCodes = deleteExpired(this.authCodes, now);
    // Registrations that never completed an authorization expire; used ones have no expiry
    const expiredClients = deleteExpired(this.clients, now);

    if (
      expiredSessions > 0 ||
      expiredDeviceFlows > 0 ||
      expiredAuthCodeFlows > 0 ||
      expiredAuthCodes > 0 ||
      expiredClients > 0
    ) {
      logDebug('Memory storage cleanup completed', {
        expiredSessions,
        expiredDeviceFlows,
        expiredAuthCodeFlows,
        expiredAuthCodes,
        expiredClients,
        remainingSessions: this.sessions.size,
      });
    }
  }

  async close(): Promise<void> {
    this.stopCleanupInterval();
    if (!this.silent) {
      logInfo('Memory storage backend closed');
    }
  }

  async getStats(): Promise<SessionStorageStats> {
    return {
      sessions: this.sessions.size,
      deviceFlows: this.deviceFlows.size,
      authCodeFlows: this.authCodeFlows.size,
      authCodes: this.authCodes.size,
      mcpSessionMappings: this.mcpSessionToOAuthSession.size,
    };
  }

  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanup().catch((err) => logError('Cleanup error', { err }));
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

  /** Export all data for file persistence */
  exportData(): {
    sessions: OAuthSession[];
    deviceFlows: Array<{ state: string; flow: DeviceFlowState }>;
    authCodeFlows: Array<{ internalState: string; flow: AuthCodeFlowState }>;
    authCodes: AuthorizationCode[];
    mcpSessionMappings: Array<{ mcpSessionId: string; oauthSessionId: string }>;
    clients: RegisteredOAuthClient[];
    accountSettings: AccountSettingsRecord[];
  } {
    return {
      clients: Array.from(this.clients.values()),
      accountSettings: Array.from(this.accountSettings.values()),
      sessions: Array.from(this.sessions.values()),
      deviceFlows: Array.from(this.deviceFlows.entries()).map(([state, flow]) => ({ state, flow })),
      authCodeFlows: Array.from(this.authCodeFlows.entries()).map(([internalState, flow]) => ({
        internalState,
        flow,
      })),
      authCodes: Array.from(this.authCodes.values()),
      mcpSessionMappings: Array.from(this.mcpSessionToOAuthSession.entries()).map(
        ([mcpSessionId, oauthSessionId]) => ({ mcpSessionId, oauthSessionId }),
      ),
    };
  }

  /** Import data from file persistence */
  importData(data: {
    sessions?: OAuthSession[];
    deviceFlows?: Array<{ state: string; flow: DeviceFlowState }>;
    authCodeFlows?: Array<{ internalState: string; flow: AuthCodeFlowState }>;
    authCodes?: AuthorizationCode[];
    mcpSessionMappings?: Array<{ mcpSessionId: string; oauthSessionId: string }>;
    clients?: RegisteredOAuthClient[];
    accountSettings?: AccountSettingsRecord[];
  }): void {
    // Clear existing data
    this.clients.clear();
    for (const client of data.clients ?? []) {
      this.clients.set(client.clientId, client);
    }
    this.accountSettings.clear();
    for (const record of data.accountSettings ?? []) {
      this.accountSettings.set(record.accountKey, record);
    }
    this.sessions.clear();
    this.gitlabRefreshLeases.clear();
    this.deviceFlows.clear();
    this.authCodeFlows.clear();
    this.authCodes.clear();
    this.tokenToSession.clear();
    this.refreshTokenToSession.clear();
    this.mcpSessionToOAuthSession.clear();

    // Import sessions
    if (data.sessions) {
      for (const session of data.sessions) {
        this.sessions.set(session.id, session);
        if (session.mcpAccessToken) {
          this.tokenToSession.set(session.mcpAccessToken, session.id);
        }
        if (session.mcpRefreshToken) {
          this.refreshTokenToSession.set(session.mcpRefreshToken, session.id);
        }
      }
    }

    // Import device flows
    if (data.deviceFlows) {
      for (const { state, flow } of data.deviceFlows) {
        this.deviceFlows.set(state, flow);
      }
    }

    // Import auth code flows
    if (data.authCodeFlows) {
      for (const { internalState, flow } of data.authCodeFlows) {
        this.authCodeFlows.set(internalState, flow);
      }
    }

    // Import auth codes
    if (data.authCodes) {
      for (const code of data.authCodes) {
        this.authCodes.set(code.code, code);
      }
    }

    // Import MCP session mappings
    if (data.mcpSessionMappings) {
      for (const { mcpSessionId, oauthSessionId } of data.mcpSessionMappings) {
        this.mcpSessionToOAuthSession.set(mcpSessionId, oauthSessionId);
      }
    }

    logInfo('Data imported into memory storage', {
      sessions: this.sessions.size,
      deviceFlows: this.deviceFlows.size,
      authCodeFlows: this.authCodeFlows.size,
      authCodes: this.authCodes.size,
    });
  }
}
