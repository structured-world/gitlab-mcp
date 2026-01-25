/**
 * Request Context Logger Utility
 *
 * Provides structured request context extraction for consistent logging across
 * HTTP/OAuth mode endpoints. Extracts standard context from Express requests
 * for debugging and production monitoring.
 */

import { Request, Response } from "express";
import { randomUUID } from "crypto";

/**
 * Structured request context for logging
 *
 * Contains all relevant information for debugging and tracing
 * requests across the middleware chain.
 */
export interface RequestContext {
  /** Unique identifier for this request (UUID or short random) */
  requestId: string;
  /** Client IP address */
  ip: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request path (e.g., /mcp, /token) */
  path: string;
  /** User-Agent header if present */
  userAgent?: string;
  /** Whether request has an OAuth session */
  hasOAuthSession: boolean;
  /** Whether request has MCP-Session-Id header */
  hasMcpSessionHeader: boolean;
  /** Truncated OAuth session ID (first 4 + ".." + last 4) */
  oauthSessionId?: string;
  /** Truncated MCP session ID (first 4 + ".." + last 4) */
  mcpSessionId?: string;
}

/**
 * Rate limit information for logging
 */
export interface RateLimitInfo {
  /** Type of rate limit (ip or session) */
  type: "ip" | "session";
  /** The key being rate limited (IP address or session ID) */
  key: string;
  /** Number of requests used in current window */
  used: number;
  /** Maximum requests allowed in window */
  limit: number;
  /** Seconds until rate limit resets */
  resetInSec: number;
}

/**
 * Generate a short request ID for log correlation
 */
function generateRequestId(): string {
  // Use first 8 characters of UUID for shorter logs
  return randomUUID().substring(0, 8);
}

/**
 * Get the IP address from a request
 *
 * Handles various proxy configurations and fallback cases.
 */
export function getIpAddress(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

/**
 * Truncate a session ID for safe logging
 *
 * Shows first 4 characters + ".." + last 4 characters to avoid exposing full IDs
 * while maintaining identifiability.
 *
 * Example: "9fd82b35-6789-abcd" → "9fd8..abcd"
 */
export function truncateId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (id.length <= 10) return id;
  return id.substring(0, 4) + ".." + id.slice(-4);
}

/**
 * Extract structured request context for logging
 *
 * Call this at the start of request handling to get consistent
 * context information for all log entries in the request chain.
 *
 * @param req - Express request object
 * @param res - Express response object (for res.locals access)
 * @returns Structured request context
 */
export function getRequestContext(req: Request, res: Response): RequestContext {
  // Get MCP session ID from header
  const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;

  // Get OAuth session ID from res.locals (set by auth middleware)
  const oauthSessionId = res.locals.oauthSessionId as string | undefined;

  return {
    requestId: generateRequestId(),
    ip: getIpAddress(req),
    method: req.method,
    path: req.path,
    userAgent: req.headers["user-agent"],
    hasOAuthSession: !!oauthSessionId,
    hasMcpSessionHeader: !!mcpSessionId,
    oauthSessionId: truncateId(oauthSessionId),
    mcpSessionId: truncateId(mcpSessionId),
  };
}

/**
 * Extract minimal request context (without auth info)
 *
 * Use when auth context is not yet available (e.g., early middleware).
 *
 * @param req - Express request object
 * @returns Minimal request context
 */
export function getMinimalRequestContext(
  req: Request
): Pick<RequestContext, "requestId" | "ip" | "method" | "path" | "userAgent"> {
  return {
    requestId: generateRequestId(),
    ip: getIpAddress(req),
    method: req.method,
    path: req.path,
    userAgent: req.headers["user-agent"],
  };
}

/**
 * Build rate limit log context
 *
 * Creates a structured object for rate limit exceeded/warning logs.
 *
 * @param type - Rate limit type (ip or session)
 * @param key - The rate limit key (IP or session ID)
 * @param used - Requests used in current window
 * @param limit - Maximum allowed requests
 * @param resetAt - Timestamp when limit resets
 * @returns Rate limit info for logging
 */
export function buildRateLimitInfo(
  type: "ip" | "session",
  key: string,
  used: number,
  limit: number,
  resetAt: number
): RateLimitInfo {
  const resetInSec = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

  return {
    type,
    key: type === "session" ? (truncateId(key) ?? key) : key,
    used,
    limit,
    resetInSec,
  };
}
