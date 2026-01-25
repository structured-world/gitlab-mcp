/**
 * Access Log Formatter
 *
 * Formats request stacks and connection stats into condensed single-line log entries.
 * Inspired by nginx/envoy access log format.
 *
 * Format:
 * [timestamp] client_ip session ctx ro method path status duration_ms | tool action | gitlab_status gitlab_duration_ms | details
 */

import type {
  RequestStack,
  ConnectionStats,
  AccessLogEntry,
  ConnectionCloseEntry,
  ConnectionCloseReason,
} from "./types.js";

/**
 * Truncate session ID to first 8 characters + ".."
 * Returns "-" if no session ID provided
 */
export function truncateSessionId(sessionId?: string): string {
  if (!sessionId) return "-";
  if (sessionId.length <= 8) return sessionId;
  return sessionId.substring(0, 8) + "..";
}

/**
 * Format duration in human-readable form (e.g., "5m32s", "2h15m", "45s")
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format GitLab status for access log
 * Returns "GL:200", "GL:404", "GL:timeout", or "-"
 */
export function formatGitLabStatus(status?: number | "timeout" | "error"): string {
  if (status === undefined) return "-";
  if (status === "timeout") return "GL:timeout";
  if (status === "error") return "GL:error";
  return `GL:${status}`;
}

/**
 * Escape special characters in log values
 * Escapes backslashes, double quotes, and control characters (newlines, tabs)
 * to maintain single-line log format and enable safe log parsing
 */
function escapeLogValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Check if a value needs quoting (contains special characters)
 */
function needsQuoting(value: string): boolean {
  // Quote values containing spaces, quotes, backslashes, or control characters
  return /[\s"\\]/.test(value) || /[\n\r\t]/.test(value);
}

/**
 * Format details map into key=value string
 * Values are quoted if they contain spaces, quotes, backslashes, or control characters
 */
export function formatDetails(details: Record<string, string | number | boolean>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return "";

  return entries
    .map(([key, value]) => {
      const strValue = String(value);
      if (needsQuoting(strValue)) {
        return `${key}="${escapeLogValue(strValue)}"`;
      }
      return `${key}=${strValue}`;
    })
    .join(" ");
}

/**
 * Create AccessLogEntry from RequestStack
 */
export function createAccessLogEntry(stack: RequestStack): AccessLogEntry {
  const now = Date.now();
  const durationMs = now - stack.startTime;

  return {
    timestamp: new Date(now).toISOString(),
    clientIp: stack.clientIp,
    session: truncateSessionId(stack.sessionId),
    ctx: stack.context ?? "-",
    ro: stack.readOnly ? "RO" : "-",
    method: stack.method,
    path: stack.path,
    status: stack.status ?? 0,
    durationMs,
    tool: stack.tool ?? "-",
    action: stack.action ?? "-",
    gitlabStatus: formatGitLabStatus(stack.gitlabStatus),
    gitlabDurationMs: stack.gitlabDuration !== undefined ? `${stack.gitlabDuration}ms` : "-",
    details: formatDetails(stack.details),
  };
}

/**
 * Format AccessLogEntry into single condensed line
 *
 * All fields are always present (nginx-style alignment with "-" for missing values).
 *
 * Format:
 * [timestamp] client_ip session ctx ro method path status duration_ms | tool action | gitlab_status gitlab_duration_ms | details
 *
 * Examples:
 * [2026-01-25T12:34:56Z] 192.168.1.100 abc123.. mygroup/proj - POST /mcp 200 142ms | browse_projects list | GL:200 98ms | namespace=test/backend items=15
 * [2026-01-25T12:34:56Z] 192.168.1.100 abc123.. mygroup/proj RO POST /mcp 200 85ms | browse_files list | GL:200 45ms | path=src/
 * [2026-01-25T12:34:56Z] 192.168.1.100 - - - POST /mcp 429 2ms | - - | - - | rate_limit=true
 * [2026-01-25T12:34:56Z] 192.168.1.100 - - - GET /health 200 5ms | - - | - - | -
 */
export function formatAccessLog(entry: AccessLogEntry): string {
  // All fields always present with "-" for missing values (nginx-style alignment)
  const parts = [
    `[${entry.timestamp}]`,
    entry.clientIp,
    entry.session,
    entry.ctx,
    entry.ro,
    entry.method,
    entry.path,
    String(entry.status),
    `${entry.durationMs}ms`,
    "|",
    entry.tool,
    entry.action,
    "|",
    entry.gitlabStatus,
    entry.gitlabDurationMs,
    "|",
    entry.details || "-",
  ];

  return parts.join(" ");
}

/**
 * Create ConnectionCloseEntry from ConnectionStats
 */
export function createConnectionCloseEntry(
  stats: ConnectionStats,
  reason: ConnectionCloseReason
): ConnectionCloseEntry {
  const now = Date.now();
  const durationMs = now - stats.connectedAt;

  return {
    timestamp: new Date(now).toISOString(),
    clientIp: stats.clientIp,
    session: truncateSessionId(stats.sessionId),
    duration: formatDuration(durationMs),
    reason,
    requests: stats.requestCount,
    tools: stats.toolCount,
    errors: stats.errorCount,
    lastError: stats.lastError,
  };
}

/**
 * Format ConnectionCloseEntry into single condensed line
 *
 * Format:
 * [timestamp] CONN_CLOSE client_ip session duration reason | reqs=N tools=N errs=N [last_err="msg"]
 *
 * Examples:
 * [2026-01-25T12:40:00Z] CONN_CLOSE 192.168.1.100 abc123.. 5m32s client_disconnect | reqs=42 tools=15 errs=0
 * [2026-01-25T12:40:00Z] CONN_CLOSE 192.168.1.100 abc123.. 45s transport_error | reqs=5 tools=3 errs=1 last_err="write EPIPE"
 */
export function formatConnectionClose(entry: ConnectionCloseEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    "CONN_CLOSE",
    entry.clientIp,
    entry.session,
    entry.duration,
    entry.reason,
    "|",
    `reqs=${entry.requests}`,
    `tools=${entry.tools}`,
    `errs=${entry.errors}`,
  ];

  if (entry.lastError) {
    // Escape quotes and backslashes in error message for safe log parsing
    parts.push(`last_err="${escapeLogValue(entry.lastError)}"`);
  }

  return parts.join(" ");
}

/**
 * AccessLogFormatter - Main class for formatting access logs
 *
 * Provides methods to format request stacks and connection close events
 * into condensed single-line log format.
 */
export class AccessLogFormatter {
  /**
   * Format a completed request stack into access log line
   */
  formatRequest(stack: RequestStack): string {
    const entry = createAccessLogEntry(stack);
    return formatAccessLog(entry);
  }

  /**
   * Format connection close event
   */
  formatConnectionClose(stats: ConnectionStats, reason: ConnectionCloseReason): string {
    const entry = createConnectionCloseEntry(stats, reason);
    return formatConnectionClose(entry);
  }

  /**
   * Get structured AccessLogEntry from request stack
   * Useful for JSON logging mode
   */
  getAccessLogEntry(stack: RequestStack): AccessLogEntry {
    return createAccessLogEntry(stack);
  }

  /**
   * Get structured ConnectionCloseEntry
   * Useful for JSON logging mode
   */
  getConnectionCloseEntry(
    stats: ConnectionStats,
    reason: ConnectionCloseReason
  ): ConnectionCloseEntry {
    return createConnectionCloseEntry(stats, reason);
  }
}
