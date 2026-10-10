/**
 * Session Store for OAuth
 *
 * Unified interface for OAuth session storage with pluggable backends.
 * Supports in-memory, file-based, and PostgreSQL storage.
 *
 * The backend is the single source of truth: every read goes to it and every write
 * completes before the caller continues, so replicas sharing a backend see the same
 * sessions, flows and codes, and a storage failure surfaces instead of being reported
 * as a successful sign-in.
 *
 * Configuration via environment variables:
 * - OAUTH_STORAGE_TYPE: "memory" | "file" | "postgresql" (default: "memory")
 * - OAUTH_STORAGE_FILE_PATH: Path for file storage
 * - OAUTH_STORAGE_POSTGRESQL_URL: PostgreSQL connection string
 */

import {
  OAuthSession,
  DeviceFlowState,
  AuthorizationCode,
  AuthCodeFlowState,
  RegisteredOAuthClient,
} from './types';
import { SessionStorageBackend, createStorageBackend } from './storage';
import { MemoryStorageBackend } from './storage/memory';
import { logInfo, logError, logDebug } from '../logger';

/**
 * Session store with pluggable storage backends
 */
export class SessionStore {
  private backend: SessionStorageBackend;
  private initialized = false;

  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(backend?: SessionStorageBackend) {
    this.backend = backend ?? createStorageBackend();
  }

  /**
   * Initialize the session store and backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.backend.initialize();

    // Start cleanup interval
    this.startCleanupInterval();

    this.initialized = true;
    logInfo('Session store initialized', { backendType: this.backend.type });
  }

  /**
   * Get storage backend type
   */
  getBackendType(): string {
    return this.backend.type;
  }

  // ============================================================
  // Session Operations
  // ============================================================

  /**
   * Create a new session
   */
  async createSession(session: OAuthSession): Promise<void> {
    await this.backend.createSession(session);
    logDebug('Session created', { sessionId: session.id, userId: session.gitlabUserId });
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return this.backend.getSession(sessionId);
  }

  /**
   * Get session by MCP access token
   */
  async getSessionByToken(token: string): Promise<OAuthSession | undefined> {
    return this.backend.getSessionByToken(token);
  }

  /**
   * Get session by MCP refresh token
   */
  async getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | undefined> {
    return this.backend.getSessionByRefreshToken(refreshToken);
  }

  /**
   * Update an existing session
   */
  async updateSession(sessionId: string, updates: Partial<OAuthSession>): Promise<boolean> {
    return this.backend.updateSession(sessionId, updates);
  }

  /**
   * Apply updates only while the session still holds `expectedRefreshToken`; of concurrent
   * refreshes on any replica exactly one succeeds.
   */
  async rotateSession(
    sessionId: string,
    expectedRefreshToken: string,
    updates: Partial<OAuthSession>,
  ): Promise<boolean> {
    return this.backend.rotateSession(sessionId, expectedRefreshToken, updates);
  }

  /**
   * Lease the session's single-use GitLab refresh token until `leaseUntil`; false while
   * another replica holds an unexpired lease or the token already changed.
   */
  async claimGitLabRefresh(
    sessionId: string,
    expectedRefreshToken: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    return this.backend.claimGitLabRefresh(sessionId, expectedRefreshToken, now, leaseUntil);
  }

  /** End the caller's GitLab refresh lease, named by the `leaseUntil` it claimed. */
  async releaseGitLabRefresh(sessionId: string, leaseUntil: number): Promise<void> {
    await this.backend.releaseGitLabRefresh(sessionId, leaseUntil);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.backend.deleteSession(sessionId);
  }

  /**
   * Get all sessions
   */
  async getAllSessions(): Promise<OAuthSession[]> {
    return this.backend.getAllSessions();
  }

  /**
   * Get session count
   */
  async getSessionCount(): Promise<number> {
    return (await this.backend.getStats()).sessions;
  }

  // ============================================================
  // Device Flow Operations
  // ============================================================

  /**
   * Store a device flow state
   */
  async storeDeviceFlow(state: string, flow: DeviceFlowState): Promise<void> {
    await this.backend.storeDeviceFlow(state, flow);
  }

  /**
   * Get device flow by state parameter
   */
  async getDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    return this.backend.getDeviceFlow(state);
  }

  /**
   * Get device flow by device code
   */
  async getDeviceFlowByDeviceCode(deviceCode: string): Promise<DeviceFlowState | undefined> {
    return this.backend.getDeviceFlowByDeviceCode(deviceCode);
  }

  /**
   * Delete a device flow
   */
  async deleteDeviceFlow(state: string): Promise<boolean> {
    return this.backend.deleteDeviceFlow(state);
  }

  /**
   * Remove and return a device flow; exactly one concurrent caller receives it.
   */
  async consumeDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    return this.backend.consumeDeviceFlow(state);
  }

  /**
   * Reserve the next GitLab poll of a device flow; of concurrent pollers on any replica
   * one wins each interval, the others get undefined.
   */
  async claimDevicePoll(
    state: string,
    now: number,
    nextPollAt: number,
  ): Promise<DeviceFlowState | undefined> {
    return this.backend.claimDevicePoll(state, now, nextPollAt);
  }

  /**
   * Get device flow count
   */
  async getDeviceFlowCount(): Promise<number> {
    return (await this.backend.getStats()).deviceFlows;
  }

  // ============================================================
  // Authorization Code Flow Operations
  // ============================================================

  /**
   * Store an authorization code flow state
   */
  async storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowState): Promise<void> {
    await this.backend.storeAuthCodeFlow(internalState, flow);
  }

  /**
   * Get authorization code flow by internal state
   */
  async getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    return this.backend.getAuthCodeFlow(internalState);
  }

  /**
   * Delete an authorization code flow
   */
  async deleteAuthCodeFlow(internalState: string): Promise<boolean> {
    return this.backend.deleteAuthCodeFlow(internalState);
  }

  /**
   * Remove and return an authorization code flow; exactly one concurrent caller receives it.
   */
  async consumeAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    return this.backend.consumeAuthCodeFlow(internalState);
  }

  /**
   * Get auth code flow count
   */
  async getAuthCodeFlowCount(): Promise<number> {
    return (await this.backend.getStats()).authCodeFlows;
  }

  // ============================================================
  // Authorization Code Operations
  // ============================================================

  /**
   * Store an authorization code
   */
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    await this.backend.storeAuthCode(code);
  }

  /**
   * Get authorization code
   */
  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.backend.getAuthCode(code);
  }

  /**
   * Delete authorization code
   */
  async deleteAuthCode(code: string): Promise<boolean> {
    return this.backend.deleteAuthCode(code);
  }

  /**
   * Remove and return an authorization code (single use); exactly one concurrent caller
   * receives it.
   */
  async consumeAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.backend.consumeAuthCode(code);
  }

  /**
   * Get auth code count
   */
  async getAuthCodeCount(): Promise<number> {
    return (await this.backend.getStats()).authCodes;
  }

  // ============================================================
  // Registered OAuth Clients
  // ============================================================

  /**
   * Store a client registered through Dynamic Client Registration
   */
  async storeClient(client: RegisteredOAuthClient): Promise<void> {
    await this.backend.storeClient(client);
  }

  /**
   * Get a registered client
   */
  async getClient(clientId: string): Promise<RegisteredOAuthClient | undefined> {
    return this.backend.getClient(clientId);
  }

  /** Record that the client completed an authorization, so its registration stays. */
  async markClientUsed(clientId: string): Promise<void> {
    await this.backend.markClientUsed(clientId);
  }

  /** Keep only the newest `keep` never-used registrations of one source. */
  async countClientsRegisteredSince(registeredFrom: string, since: number): Promise<number> {
    return this.backend.countClientsRegisteredSince(registeredFrom, since);
  }

  // ============================================================
  // MCP Session Mapping Operations
  // ============================================================

  /**
   * Associate an MCP session ID with an OAuth session ID
   */
  async associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void> {
    await this.backend.associateMcpSession(mcpSessionId, oauthSessionId);
  }

  /**
   * Get OAuth session by MCP session ID
   */
  async getSessionByMcpSessionId(mcpSessionId: string): Promise<OAuthSession | undefined> {
    return this.backend.getSessionByMcpSessionId(mcpSessionId);
  }

  /**
   * Get GitLab token by MCP session ID
   */
  async getGitLabTokenByMcpSessionId(mcpSessionId: string): Promise<string | undefined> {
    const session = await this.getSessionByMcpSessionId(mcpSessionId);
    return session?.gitlabAccessToken;
  }

  /**
   * Remove MCP session association
   */
  async removeMcpSessionAssociation(mcpSessionId: string): Promise<boolean> {
    return this.backend.removeMcpSessionAssociation(mcpSessionId);
  }

  // ============================================================
  // Cleanup Operations
  // ============================================================

  /**
   * Clean up all expired entries
   */
  async cleanup(): Promise<void> {
    await this.backend.cleanup();
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanup().catch((err: unknown) => logError('Session store cleanup failed', { err }));
      },
      5 * 60 * 1000,
    );

    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Stop cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Clear all data (for testing). Only the in-memory backend can be cleared; a shared
   * database is never wiped from application code.
   */
  clear(): void {
    if (!(this.backend instanceof MemoryStorageBackend)) {
      throw new TypeError('clear() is only supported for in-memory storage');
    }
    this.backend.importData({});
    logDebug('Session store cleared');
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    this.stopCleanupInterval();
    await this.backend.close();
    logInfo('Session store closed');
  }

  /**
   * Get store statistics
   */
  async getStats(): Promise<{
    sessions: number;
    deviceFlows: number;
    authCodeFlows: number;
    authCodes: number;
  }> {
    const { sessions, deviceFlows, authCodeFlows, authCodes } = await this.backend.getStats();
    return { sessions, deviceFlows, authCodeFlows, authCodes };
  }
}

/**
 * Singleton session store instance
 *
 * Note: Must call sessionStore.initialize() before use
 */
export const sessionStore = new SessionStore();
