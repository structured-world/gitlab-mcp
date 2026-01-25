/**
 * Logging Module - Condensed Access Log Format
 *
 * Exports all logging utilities for request stack aggregation
 * and connection tracking.
 */

// Types
export type {
  RequestStack,
  ConnectionStats,
  AccessLogEntry,
  ConnectionCloseEntry,
  ConnectionCloseReason,
  LogFormat,
} from "./types.js";

export { DEFAULT_LOG_FORMAT } from "./types.js";

// Access Log Formatter
export {
  AccessLogFormatter,
  truncateSessionId,
  formatDuration,
  formatGitLabStatus,
  formatDetails,
  formatAccessLog,
  formatConnectionClose,
  createAccessLogEntry,
  createConnectionCloseEntry,
} from "./access-log.js";

// Request Tracker
export {
  RequestTracker,
  getRequestTracker,
  resetRequestTracker,
  getCurrentRequestId,
  runWithRequestContext,
  runWithRequestContextAsync,
  type RequestContext,
} from "./request-tracker.js";

// Connection Tracker
export {
  ConnectionTracker,
  getConnectionTracker,
  resetConnectionTracker,
} from "./connection-tracker.js";
