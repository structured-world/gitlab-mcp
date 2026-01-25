/**
 * Logging Types for Condensed Access Log Format
 *
 * Implements request stack aggregation and connection tracking as specified in issue #194.
 * All events during a request lifecycle are collected and output as a single condensed line.
 */

/**
 * Request stack for aggregating events during request lifecycle.
 *
 * Opened when request arrives, closed when response is sent (success/error/timeout).
 * All accumulated data is formatted into a single access log line on close.
 */
export interface RequestStack {
  /** Request start timestamp in milliseconds */
  startTime: number;

  /** Client IP address */
  clientIp: string;

  /** Session ID (MCP or OAuth), if available */
  sessionId?: string;

  /** HTTP method (GET, POST, etc.) */
  method: string;

  /** Request path (e.g., /mcp, /sse, /token) */
  path: string;

  // Accumulated during request lifecycle

  /** MCP tool name if a tool was called */
  tool?: string;

  /** CQRS action (list, get, create, update, delete, etc.) */
  action?: string;

  /** GitLab API response status (200, 404, etc.) or special values */
  gitlabStatus?: number | "timeout" | "error";

  /** Time spent waiting for GitLab API response in milliseconds */
  gitlabDuration?: number;

  /** Context-specific key=value details */
  details: Record<string, string | number | boolean>;

  // Set on completion

  /** HTTP response status code */
  status?: number;

  /** Error message if request failed */
  error?: string;
}

/**
 * Connection close reason types
 */
export type ConnectionCloseReason =
  | "client_disconnect"
  | "idle_timeout"
  | "server_shutdown"
  | "transport_error"
  | "auth_expired";

/**
 * Connection statistics for SSE/persistent connections.
 *
 * Tracked from connection open to close, logged separately from request access logs.
 */
export interface ConnectionStats {
  /** Connection start timestamp in milliseconds */
  connectedAt: number;

  /** Client IP address */
  clientIp: string;

  /** Session ID (MCP session ID) */
  sessionId: string;

  /** Total HTTP requests on this connection */
  requestCount: number;

  /** Total tool invocations */
  toolCount: number;

  /** Total errors encountered */
  errorCount: number;

  /** Last error message if any errors occurred */
  lastError?: string;
}

/**
 * Formatted access log entry (for structured output)
 */
export interface AccessLogEntry {
  /** ISO 8601 UTC timestamp */
  timestamp: string;

  /** Client IP address */
  clientIp: string;

  /** Truncated session ID (8 chars + ..) or "-" */
  session: string;

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** HTTP response status */
  status: number;

  /** Request duration in milliseconds */
  durationMs: number;

  /** Tool name or "-" */
  tool: string;

  /** Action or "-" */
  action: string;

  /** GitLab status (GL:200, GL:404, GL:timeout) or "-" */
  gitlabStatus: string;

  /** GitLab duration in milliseconds or "-" */
  gitlabDurationMs: string;

  /** Formatted details string (key=value pairs) */
  details: string;
}

/**
 * Formatted connection close log entry
 */
export interface ConnectionCloseEntry {
  /** ISO 8601 UTC timestamp */
  timestamp: string;

  /** Client IP address */
  clientIp: string;

  /** Truncated session ID */
  session: string;

  /** Connection duration (human readable: 5m32s) */
  duration: string;

  /** Close reason */
  reason: ConnectionCloseReason;

  /** Total requests */
  requests: number;

  /** Total tools */
  tools: number;

  /** Total errors */
  errors: number;

  /** Last error message if applicable */
  lastError?: string;
}

/**
 * Log format mode configuration
 */
export type LogFormat = "condensed" | "verbose";

/**
 * Default log format
 */
export const DEFAULT_LOG_FORMAT: LogFormat = "condensed";
