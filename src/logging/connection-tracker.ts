/**
 * Connection Tracker
 *
 * Tracks statistics for SSE/persistent connections and logs a summary
 * when connections close.
 *
 * Each connection (identified by session ID) has its own stats:
 * - Total requests
 * - Total tool invocations
 * - Total errors
 * - Last error (if any)
 *
 * Logs a single line when connection closes with reason and stats.
 */

import type { ConnectionStats, ConnectionCloseReason } from "./types.js";
import { formatConnectionClose, createConnectionCloseEntry } from "./access-log.js";
import { logger, LOG_JSON } from "../logger.js";

/**
 * Connection tracker manages statistics for persistent connections.
 *
 * Connections are identified by session ID (MCP session ID).
 */
export class ConnectionTracker {
  private connections: Map<string, ConnectionStats> = new Map();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Check if connection tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable connection tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Register a new connection
   *
   * @param sessionId - MCP session ID
   * @param clientIp - Client IP address
   */
  openConnection(sessionId: string, clientIp: string): void {
    if (!this.enabled) return;

    const stats: ConnectionStats = {
      connectedAt: Date.now(),
      clientIp,
      sessionId,
      requestCount: 0,
      toolCount: 0,
      errorCount: 0,
    };

    this.connections.set(sessionId, stats);

    logger.debug({ sessionId, clientIp }, "Connection opened for tracking");
  }

  /**
   * Get connection stats for a session
   */
  getStats(sessionId: string): ConnectionStats | undefined {
    return this.connections.get(sessionId);
  }

  /**
   * Increment request count for a connection
   */
  incrementRequests(sessionId: string): void {
    const stats = this.connections.get(sessionId);
    if (!stats) return;

    stats.requestCount++;
  }

  /**
   * Increment tool count for a connection
   */
  incrementTools(sessionId: string): void {
    const stats = this.connections.get(sessionId);
    if (!stats) return;

    stats.toolCount++;
  }

  /**
   * Record an error on the connection
   */
  recordError(sessionId: string, error: string): void {
    const stats = this.connections.get(sessionId);
    if (!stats) return;

    stats.errorCount++;
    stats.lastError = error;
  }

  /**
   * Close a connection and log the summary
   *
   * @param sessionId - Session ID
   * @param reason - Why the connection closed
   * @returns The formatted log line (for testing) or undefined if disabled/not found
   */
  closeConnection(sessionId: string, reason: ConnectionCloseReason): string | undefined {
    const stats = this.connections.get(sessionId);
    if (!stats) {
      // Only log debug when enabled to avoid noise in verbose mode
      if (this.enabled) {
        logger.debug({ sessionId }, "Connection not found on close");
      }
      return undefined;
    }

    // Remove from map first to prevent leaking tracked connections
    this.connections.delete(sessionId);

    // When disabled, skip log emission but cleanup still occurred
    if (!this.enabled) {
      return undefined;
    }

    // Format and log the connection close entry
    const entry = createConnectionCloseEntry(stats, reason);
    const logLine = formatConnectionClose(entry);

    // Output connection close log at info level
    // JSON mode: include full connectionClose object for log aggregators
    // Plain mode: message only - prevents pino-pretty from outputting multiline JSON
    if (LOG_JSON) {
      logger.info({ connectionClose: entry }, logLine);
    } else {
      logger.info(logLine);
    }

    return logLine;
  }

  /**
   * Check if a connection is being tracked
   */
  hasConnection(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Get number of active connections being tracked
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get all session IDs (for shutdown handling)
   */
  getAllSessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Close all connections (for server shutdown)
   *
   * @param reason - Reason for closing all connections
   */
  closeAllConnections(reason: ConnectionCloseReason = "server_shutdown"): void {
    const sessionIds = this.getAllSessionIds();
    for (const sessionId of sessionIds) {
      this.closeConnection(sessionId, reason);
    }
  }

  /**
   * Clear all tracked connections (for testing)
   */
  clear(): void {
    this.connections.clear();
  }
}

/**
 * Singleton instance of ConnectionTracker
 */
let globalConnectionTracker: ConnectionTracker | null = null;

/**
 * Get the global ConnectionTracker instance
 */
export function getConnectionTracker(): ConnectionTracker {
  globalConnectionTracker ??= new ConnectionTracker();
  return globalConnectionTracker;
}

/**
 * Reset the global connection tracker (for testing)
 */
export function resetConnectionTracker(): void {
  globalConnectionTracker = null;
}
