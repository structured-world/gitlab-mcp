import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { packageName, packageVersion, GITLAB_BASE_URL } from './config';
import { setupHandlers } from './handlers';
import { setDetectedSchemaMode } from './utils/schema-utils';
import { logInfo, logWarn, logError, logDebug } from './logger';
import { normalizeInstanceUrl } from './utils/url';

/** Default session idle timeout: 30 minutes */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Well-known session ID for stdio transport — exempt from idle timeout */
export const STDIO_SESSION_ID = 'stdio';

interface ManagedSession {
  server: Server;
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
  /** GitLab instance URL this session is targeting. Defaults to GITLAB_BASE_URL. */
  instanceUrl: string;
}

/**
 * Manages per-session MCP Server instances.
 *
 * Each connected client gets its own Server instance, preventing the transport
 * routing bug where a single Server's `_transport` field gets overwritten by
 * each new connection, causing responses to be sent to the wrong client.
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly sessionTimeoutMs: number;
  private schemaModeDetected = false;

  constructor(sessionTimeoutMs?: number) {
    this.sessionTimeoutMs = sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  }

  /**
   * Initialize the session manager and start the cleanup timer.
   * Must be called once before creating sessions.
   */
  start(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 60_000);

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref();

    logInfo('Session manager started', { sessionTimeoutMs: this.sessionTimeoutMs });
  }

  /**
   * Create a new per-session Server instance and connect it to the given transport.
   * Handlers are registered identically on each instance.
   *
   * @param instanceUrl - GitLab instance URL for this session. Defaults to GITLAB_BASE_URL.
   *   Updated on each tool call: in OAuth mode when the token context resolves the actual
   *   instance URL; in static-token mode when ConnectionManager reflects an instance change.
   */
  async createSession(
    sessionId: string,
    transport: Transport,
    instanceUrl?: string,
  ): Promise<Server> {
    // Guard against duplicate session IDs — close existing before allocating new resources
    if (this.sessions.has(sessionId)) {
      logWarn('Duplicate sessionId detected — closing existing session', { sessionId });
      await this.removeSession(sessionId);
    }

    const server = new Server(
      { name: packageName, version: packageVersion },
      { capabilities: { tools: { listChanged: true } } },
    );

    // Auto-detect schema mode from the first client to initialize.
    // Only the first session sets the mode to avoid race conditions.
    server.oninitialized = () => {
      if (!this.schemaModeDetected) {
        this.schemaModeDetected = true;
        const clientVersion = server.getClientVersion();
        setDetectedSchemaMode(clientVersion?.name);
      }
    };

    // Register request handlers (idempotent — same logic for every session)
    await setupHandlers(server);

    await server.connect(transport);

    const now = Date.now();
    this.sessions.set(sessionId, {
      server,
      sessionId,
      createdAt: now,
      lastActivityAt: now,
      instanceUrl: normalizeInstanceUrl(instanceUrl ?? GITLAB_BASE_URL),
    });

    logInfo('Session created', { sessionId, activeSessions: this.sessions.size });

    return server;
  }

  /**
   * Mark session as active (extends timeout).
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Update the GitLab instance URL for an active session.
   * Called by the tool handler when the effective instance URL is resolved:
   * - OAuth mode: updated on each tool call when the token context provides the URL
   * - Static-token mode: updated on each tool call from ConnectionManager's active instance
   */
  setSessionInstanceUrl(sessionId: string, url: string): void {
    const normalizedUrl = normalizeInstanceUrl(url);
    const session = this.sessions.get(sessionId);
    if (session && session.instanceUrl !== normalizedUrl) {
      session.instanceUrl = normalizedUrl;
      logDebug('Session instance URL updated', { sessionId, instanceUrl: normalizedUrl });
    }
  }

  /**
   * Get the GitLab instance URL associated with a session.
   * Returns undefined if the session does not exist.
   */
  getSessionInstanceUrl(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.instanceUrl;
  }

  /**
   * Return a map of instance URL → session count across all active sessions.
   * Used by the dashboard to show per-instance session distribution.
   */
  getSessionsByInstance(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const session of this.sessions.values()) {
      counts.set(session.instanceUrl, (counts.get(session.instanceUrl) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Remove a session and close its Server instance.
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);

    try {
      await session.server.close();
    } catch (error) {
      logDebug('Error closing session server (may already be closed)', { err: error, sessionId });
    }

    logInfo('Session removed', { sessionId, activeSessions: this.sessions.size });
  }

  /**
   * Send tools/list_changed notification to active sessions.
   *
   * @param instanceUrl - When provided, only sessions targeting this instance are notified.
   *   When omitted, all sessions are notified. Use the filtered form when a state change
   *   affects only one instance (e.g. HealthMonitor state transition) to avoid spurious
   *   re-fetches in sessions targeting unrelated instances.
   */
  async broadcastToolsListChanged(instanceUrl?: string): Promise<void> {
    // Normalize before comparing — session.instanceUrl is always stored normalized,
    // so the filter must also be normalized to ensure consistent matching.
    const normalizedFilter =
      instanceUrl !== undefined ? normalizeInstanceUrl(instanceUrl) : undefined;

    const promises: Promise<void>[] = [];

    for (const [sessionId, session] of this.sessions) {
      // Skip sessions targeting a different instance when a filter is active
      if (normalizedFilter !== undefined && session.instanceUrl !== normalizedFilter) {
        continue;
      }
      promises.push(
        session.server
          .notification({ method: 'notifications/tools/list_changed' })
          .then(() => {
            logDebug('Sent tools/list_changed to session', { sessionId });
          })
          .catch((error: unknown) => {
            logDebug('Failed to send tools/list_changed to session', { err: error, sessionId });
          }),
      );
    }

    await Promise.allSettled(promises);

    logInfo('Broadcast tools/list_changed', {
      sessionCount: this.sessions.size,
      notifiedCount: promises.length,
      instanceUrl: normalizedFilter ?? 'all',
    });
  }

  /**
   * Get the number of active sessions.
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up sessions that have been idle beyond the timeout.
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    const stale: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      // stdio is a single-client, single-process transport whose lifetime
      // is owned by the client — it must never be evicted by idle timeout.
      if (sessionId === STDIO_SESSION_ID) continue;

      if (now - session.lastActivityAt > this.sessionTimeoutMs) {
        stale.push(sessionId);
      }
    }

    if (stale.length === 0) return;

    logInfo('Cleaning up stale sessions', {
      staleCount: stale.length,
      activeSessions: this.sessions.size,
    });

    for (const sessionId of stale) {
      // Fire-and-forget cleanup
      this.removeSession(sessionId).catch((error: unknown) => {
        logError('Error during stale session cleanup', { err: error, sessionId });
      });
    }
  }

  /**
   * Stop the cleanup timer and close all sessions.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const sessionIds = [...this.sessions.keys()];
    await Promise.allSettled(sessionIds.map((id) => this.removeSession(id)));

    logInfo('Session manager shut down');
  }
}

/**
 * Singleton session manager instance.
 * Used by the server and by context-manager for broadcast notifications.
 */
let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  sessionManagerInstance ??= new SessionManager();
  return sessionManagerInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetSessionManager(): void {
  sessionManagerInstance = null;
}
