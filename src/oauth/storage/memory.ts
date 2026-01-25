/**
 * In-Memory Session Storage Backend
 *
 * Default storage for development and single-instance deployments.
 * Sessions are lost on server restart.
 */

import { OAuthSession, DeviceFlowState, AuthCodeFlowState, AuthorizationCode } from "../types";
import { SessionStorageBackend, SessionStorageStats } from "./types";
import { logInfo, logWarn, logError, logDebug, truncateId } from "../../logger";

export interface MemoryStorageOptions {
  /** Suppress initialization logging (used when wrapped by FileStorage) */
  silent?: boolean;
}

export class MemoryStorageBackend implements SessionStorageBackend {
  readonly type = "memory" as const;

  private sessions = new Map<string, OAuthSession>();
  private deviceFlows = new Map<string, DeviceFlowState>();
  private authCodeFlows = new Map<string, AuthCodeFlowState>();
  private authCodes = new Map<string, AuthorizationCode>();
  private tokenToSession = new Map<string, string>();
  private refreshTokenToSession = new Map<string, string>();
  private mcpSessionToOAuthSession = new Map<string, string>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private silent: boolean;

  constructor(options?: MemoryStorageOptions) {
    this.silent = options?.silent ?? false;
  }

  async initialize(): Promise<void> {
    this.startCleanupInterval();
    if (!this.silent) {
      logInfo("Memory storage backend initialized");
    }
  }

  // Session operations
  async createSession(session: OAuthSession): Promise<void> {
    this.sessions.set(session.id, session);
    if (session.mcpAccessToken) {
      this.tokenToSession.set(session.mcpAccessToken, session.id);
    }
    if (session.mcpRefreshToken) {
      this.refreshTokenToSession.set(session.mcpRefreshToken, session.id);
    }
    logDebug("Session created", { sessionId: session.id, userId: session.gitlabUserId });
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
      logWarn("Attempted to update non-existent session", { sessionId });
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
    logDebug("Session updated", { sessionId });
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.mcpAccessToken) {
      this.tokenToSession.delete(session.mcpAccessToken);
    }
    if (session.mcpRefreshToken) {
      this.refreshTokenToSession.delete(session.mcpRefreshToken);
    }

    this.sessions.delete(sessionId);
    logDebug("Session deleted", { sessionId });
    return true;
  }

  async getAllSessions(): Promise<OAuthSession[]> {
    return Array.from(this.sessions.values());
  }

  // Device flow operations
  async storeDeviceFlow(state: string, flow: DeviceFlowState): Promise<void> {
    this.deviceFlows.set(state, flow);
    logDebug("Device flow stored", { state, userCode: flow.userCode });
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
    if (deleted) logDebug("Device flow deleted", { state });
    return deleted;
  }

  // Auth code flow operations
  async storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowState): Promise<void> {
    this.authCodeFlows.set(internalState, flow);
    logDebug("Auth code flow stored", { internalState: truncateId(internalState) });
  }

  async getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    return this.authCodeFlows.get(internalState);
  }

  async deleteAuthCodeFlow(internalState: string): Promise<boolean> {
    const deleted = this.authCodeFlows.delete(internalState);
    if (deleted) {
      logDebug("Auth code flow deleted", { internalState: truncateId(internalState) });
    }
    return deleted;
  }

  // Authorization code operations
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    this.authCodes.set(code.code, code);
    logDebug("Auth code stored", { code: truncateId(code.code) });
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.authCodes.get(code);
  }

  async deleteAuthCode(code: string): Promise<boolean> {
    const deleted = this.authCodes.delete(code);
    if (deleted) logDebug("Auth code deleted", { code: truncateId(code) });
    return deleted;
  }

  // MCP session mapping
  async associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void> {
    this.mcpSessionToOAuthSession.set(mcpSessionId, oauthSessionId);
    logDebug("MCP session associated with OAuth session", {
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
    if (deleted) logDebug("MCP session association removed", { mcpSessionId });
    return deleted;
  }

  // Cleanup
  async cleanup(): Promise<void> {
    const now = Date.now();
    let expiredSessions = 0;
    let expiredDeviceFlows = 0;
    let expiredAuthCodeFlows = 0;
    let expiredAuthCodes = 0;

    // Clean up expired sessions (7 days max age)
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    for (const [id, session] of this.sessions) {
      if (session.createdAt + maxAge < now) {
        await this.deleteSession(id);
        expiredSessions++;
      }
    }

    // Clean up expired device flows
    for (const [state, flow] of this.deviceFlows) {
      if (flow.expiresAt < now) {
        this.deviceFlows.delete(state);
        expiredDeviceFlows++;
      }
    }

    // Clean up expired auth code flows
    for (const [state, flow] of this.authCodeFlows) {
      if (flow.expiresAt < now) {
        this.authCodeFlows.delete(state);
        expiredAuthCodeFlows++;
      }
    }

    // Clean up expired auth codes
    for (const [code, auth] of this.authCodes) {
      if (auth.expiresAt < now) {
        this.authCodes.delete(code);
        expiredAuthCodes++;
      }
    }

    if (
      expiredSessions > 0 ||
      expiredDeviceFlows > 0 ||
      expiredAuthCodeFlows > 0 ||
      expiredAuthCodes > 0
    ) {
      logDebug("Memory storage cleanup completed", {
        expiredSessions,
        expiredDeviceFlows,
        expiredAuthCodeFlows,
        expiredAuthCodes,
        remainingSessions: this.sessions.size,
      });
    }
  }

  async close(): Promise<void> {
    this.stopCleanupInterval();
    if (!this.silent) {
      logInfo("Memory storage backend closed");
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
        this.cleanup().catch(err => logError("Cleanup error", { err }));
      },
      5 * 60 * 1000
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
  } {
    return {
      sessions: Array.from(this.sessions.values()),
      deviceFlows: Array.from(this.deviceFlows.entries()).map(([state, flow]) => ({ state, flow })),
      authCodeFlows: Array.from(this.authCodeFlows.entries()).map(([internalState, flow]) => ({
        internalState,
        flow,
      })),
      authCodes: Array.from(this.authCodes.values()),
      mcpSessionMappings: Array.from(this.mcpSessionToOAuthSession.entries()).map(
        ([mcpSessionId, oauthSessionId]) => ({ mcpSessionId, oauthSessionId })
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
  }): void {
    // Clear existing data
    this.sessions.clear();
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

    logInfo("Data imported into memory storage", {
      sessions: this.sessions.size,
      deviceFlows: this.deviceFlows.size,
      authCodeFlows: this.authCodeFlows.size,
      authCodes: this.authCodes.size,
    });
  }
}
