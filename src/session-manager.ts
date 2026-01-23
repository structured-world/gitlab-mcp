import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { packageName, packageVersion } from "./config";
import { setupHandlers } from "./handlers";
import { setDetectedSchemaMode } from "./utils/schema-utils";
import { logger } from "./logger";

/**
 * Default session idle timeout: 30 minutes.
 * Sessions without activity for this duration are automatically cleaned up.
 */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

interface ManagedSession {
  server: Server;
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
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
  private handlersInitialized = false;

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

    logger.info({ sessionTimeoutMs: this.sessionTimeoutMs }, "Session manager started");
  }

  /**
   * Create a new per-session Server instance and connect it to the given transport.
   * Handlers are registered identically on each instance.
   */
  async createSession(sessionId: string, transport: Transport): Promise<Server> {
    const server = new Server(
      { name: packageName, version: packageVersion },
      { capabilities: { tools: { listChanged: true } } }
    );

    // Auto-detect schema mode from client info
    server.oninitialized = () => {
      const clientVersion = server.getClientVersion();
      setDetectedSchemaMode(clientVersion?.name);
    };

    // Register request handlers (idempotent — same logic for every session)
    if (!this.handlersInitialized) {
      // Initialize connection manager once on first session
      await setupHandlers(server);
      this.handlersInitialized = true;
    } else {
      // For subsequent sessions, register handlers without re-initializing connection
      await setupHandlers(server);
    }

    await server.connect(transport);

    const now = Date.now();
    this.sessions.set(sessionId, {
      server,
      sessionId,
      createdAt: now,
      lastActivityAt: now,
    });

    logger.info({ sessionId, activeSessions: this.sessions.size }, "Session created");

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
   * Remove a session and close its Server instance.
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);

    try {
      await session.server.close();
    } catch (error) {
      logger.debug(
        { err: error, sessionId },
        "Error closing session server (may already be closed)"
      );
    }

    logger.info({ sessionId, activeSessions: this.sessions.size }, "Session removed");
  }

  /**
   * Send tools/list_changed notification to ALL active sessions.
   */
  async broadcastToolsListChanged(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [sessionId, session] of this.sessions) {
      promises.push(
        session.server
          .notification({ method: "notifications/tools/list_changed" })
          .then(() => {
            logger.debug({ sessionId }, "Sent tools/list_changed to session");
          })
          .catch((error: unknown) => {
            logger.debug({ err: error, sessionId }, "Failed to send tools/list_changed to session");
          })
      );
    }

    await Promise.allSettled(promises);

    logger.info(
      { sessionCount: this.sessions.size },
      "Broadcast tools/list_changed to all sessions"
    );
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
      if (now - session.lastActivityAt > this.sessionTimeoutMs) {
        stale.push(sessionId);
      }
    }

    if (stale.length === 0) return;

    logger.info(
      { staleCount: stale.length, activeSessions: this.sessions.size },
      "Cleaning up stale sessions"
    );

    for (const sessionId of stale) {
      // Fire-and-forget cleanup
      this.removeSession(sessionId).catch((error: unknown) => {
        logger.error({ err: error, sessionId }, "Error during stale session cleanup");
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
    await Promise.allSettled(sessionIds.map(id => this.removeSession(id)));

    logger.info("Session manager shut down");
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
