import * as path from "path";
import * as fs from "fs";
import { z } from "zod";
import type { Request } from "express";

// Get package.json path
const packageJsonPath = path.resolve(process.cwd(), "package.json");

// Environment variables
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
export const GITLAB_AUTH_COOKIE_PATH = process.env.GITLAB_AUTH_COOKIE_PATH;
export const IS_OLD = process.env.GITLAB_IS_OLD === "true";
export const GITLAB_READ_ONLY_MODE = process.env.GITLAB_READ_ONLY_MODE === "true";

/**
 * Whether to include "Related:" cross-references in tool descriptions.
 * When true (default), descriptions include hints to complementary tools.
 * When false, "Related:" sections are stripped from all descriptions.
 * Dynamic resolution (stripping refs to unavailable tools) still applies when enabled.
 */
export const GITLAB_CROSS_REFS = process.env.GITLAB_CROSS_REFS !== "false";

export const GITLAB_DENIED_TOOLS_REGEX = process.env.GITLAB_DENIED_TOOLS_REGEX
  ? new RegExp(process.env.GITLAB_DENIED_TOOLS_REGEX)
  : undefined;

/**
 * Parse denied actions from environment variable
 * Format: "tool_name:action,tool_name:action,..."
 * Example: "manage_milestone:delete,manage_milestone:promote,browse_events:user"
 * @returns Map of tool name to Set of denied action names
 */
function parseDeniedActions(envValue?: string): Map<string, Set<string>> {
  const deniedActions = new Map<string, Set<string>>();

  if (!envValue) {
    return deniedActions;
  }

  const pairs = envValue
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const colonIndex = pair.indexOf(":");
    if (colonIndex === -1) {
      // Invalid format, skip
      continue;
    }

    const toolName = pair.substring(0, colonIndex).toLowerCase();
    const actionName = pair.substring(colonIndex + 1).toLowerCase();

    if (!toolName || !actionName) {
      continue;
    }

    let actionSet = deniedActions.get(toolName);
    if (!actionSet) {
      actionSet = new Set();
      deniedActions.set(toolName, actionSet);
    }
    actionSet.add(actionName);
  }

  return deniedActions;
}

export const GITLAB_DENIED_ACTIONS = parseDeniedActions(process.env.GITLAB_DENIED_ACTIONS);

// Logging format configuration - type imported from logging module to avoid duplication
// - 'condensed' (default): Single-line access log per request with stack aggregation
// - 'verbose': Traditional multi-line logging (existing behavior)
import type { LogFormat } from "./logging/types.js";

function parseLogFormat(value?: string): LogFormat {
  const format = value?.toLowerCase();
  if (format === "verbose") {
    return "verbose";
  }
  return "condensed"; // Default - single-line condensed access logs
}

export const LOG_FORMAT: LogFormat = parseLogFormat(process.env.LOG_FORMAT);

// Re-export LogFormat type for consumers of config module
export type { LogFormat };

/**
 * Schema for a single log filter rule.
 * A request is skipped from access logging if ALL specified conditions match.
 */
const LogFilterRuleSchema = z
  .object({
    method: z
      .string()
      .optional()
      .describe("HTTP method to match (exact, case-insensitive). If omitted, matches any method."),
    path: z
      .string()
      .optional()
      .describe(
        "Request path to match. Exact match, or prefix match if ends with '*'. If omitted, matches any path."
      ),
    userAgent: z
      .string()
      .optional()
      .describe(
        "Substring to match in User-Agent header (case-insensitive). If omitted, matches any User-Agent."
      ),
  })
  .describe("Filter rule for skipping access log entries. All specified conditions must match.");

/**
 * Schema for LOG_FILTER environment variable.
 * JSON array of filter rules.
 */
const LogFilterSchema = z.array(LogFilterRuleSchema).describe("Array of log filter rules");

/**
 * Parsed log filter rule
 */
export interface LogFilterRule {
  /** HTTP method (lowercase for comparison) */
  method?: string;
  /** Request path (exact match, or prefix if ends with *) */
  path?: string;
  /** Whether path uses prefix matching (ends with *) */
  pathIsPrefix?: boolean;
  /** User-Agent substring (lowercase for comparison) */
  userAgent?: string;
}

/**
 * Parse LOG_FILTER from environment variable
 * @returns Array of parsed filter rules, empty array if not set or invalid
 */
function parseLogFilter(envValue?: string): LogFilterRule[] {
  if (!envValue || envValue.trim() === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(envValue);
    const validated = LogFilterSchema.parse(parsed);

    return validated.map(rule => {
      const result: LogFilterRule = {};

      if (rule.method) {
        result.method = rule.method.toLowerCase();
      }

      if (rule.path) {
        if (rule.path.endsWith("*")) {
          result.path = rule.path.slice(0, -1); // Remove trailing *
          result.pathIsPrefix = true;
        } else {
          result.path = rule.path;
          result.pathIsPrefix = false;
        }
      }

      if (rule.userAgent) {
        result.userAgent = rule.userAgent.toLowerCase();
      }

      return result;
    });
  } catch (error) {
    // Log warning at startup for invalid JSON/schema
    console.warn(
      `[gitlab-mcp] Invalid LOG_FILTER format, logging all requests. Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Default log filter rules - skip Claude Code polling requests.
 * Claude Code polls GET / every second to check MCP server availability.
 */
const DEFAULT_LOG_FILTER: LogFilterRule[] = [
  { method: "get", path: "/", pathIsPrefix: false, userAgent: "claude-code" },
];

/**
 * Parsed log filter rules from LOG_FILTER environment variable.
 * Defaults to filtering Claude Code polling (GET / with claude-code user agent).
 * Set to empty array '[]' to log all requests.
 * Whitespace-only or unset LOG_FILTER uses the default filter.
 */
export const LOG_FILTER: LogFilterRule[] = process.env.LOG_FILTER?.trim()
  ? parseLogFilter(process.env.LOG_FILTER)
  : DEFAULT_LOG_FILTER;

/**
 * Check if a request should be skipped from access logging.
 * A request is skipped if it matches ANY of the filter rules.
 * Within a rule, ALL specified conditions must match.
 *
 * @param method - HTTP method (e.g., "GET", "POST")
 * @param path - Request path (e.g., "/", "/health")
 * @param userAgent - User-Agent header value (may be undefined)
 * @returns true if request should be skipped from logging
 */
export function shouldSkipAccessLog(method: string, path: string, userAgent?: string): boolean {
  if (LOG_FILTER.length === 0) {
    return false;
  }

  const methodLower = method.toLowerCase();
  const userAgentLower = userAgent?.toLowerCase() ?? "";

  return LOG_FILTER.some(rule => {
    // Check method (if specified)
    if (rule.method && rule.method !== methodLower) {
      return false;
    }

    // Check path (if specified)
    if (rule.path !== undefined) {
      if (rule.pathIsPrefix) {
        if (!path.startsWith(rule.path)) {
          return false;
        }
      } else {
        if (path !== rule.path) {
          return false;
        }
      }
    }

    // Check User-Agent (if specified) - substring match
    if (rule.userAgent && !userAgentLower.includes(rule.userAgent)) {
      return false;
    }

    // All specified conditions matched
    return true;
  });
}

/**
 * Check if a request should be skipped from access logging (Express request overload).
 * Convenience function that extracts method, path, and User-Agent from Express request.
 *
 * @param req - Express request object
 * @returns true if request should be skipped from logging
 */
export function shouldSkipAccessLogRequest(req: Request): boolean {
  return shouldSkipAccessLog(req.method, req.path, req.headers["user-agent"]);
}

// Schema mode configuration
// - 'flat' (default): Flatten discriminated unions for AI clients that don't support oneOf well
// - 'discriminated': Keep oneOf structure for clients that properly support JSON Schema
// - 'auto': Detect schema mode from clientInfo during MCP initialize
//   NOTE: 'auto' is only reliable for stdio mode (single client). For HTTP/SSE with multiple
//   concurrent sessions, use explicit 'flat' or 'discriminated' mode instead.
export type SchemaMode = "flat" | "discriminated" | "auto";

function parseSchemaMode(value?: string): SchemaMode {
  const mode = value?.toLowerCase();
  if (mode === "discriminated") {
    return "discriminated";
  }
  if (mode === "auto") {
    return "auto";
  }
  return "flat"; // Default - best compatibility with current AI clients
}

export const GITLAB_SCHEMA_MODE: SchemaMode = parseSchemaMode(process.env.GITLAB_SCHEMA_MODE);

/**
 * Detect effective schema mode based on clientInfo from MCP initialize
 * Called during initialize to determine per-session schema mode when GITLAB_SCHEMA_MODE=auto
 *
 * NOTE: This detection is only reliable for stdio mode (single client per server instance).
 * For HTTP/SSE modes with multiple concurrent sessions, use explicit GITLAB_SCHEMA_MODE instead.
 *
 * @param clientName - Client name from clientInfo (e.g., "claude-code", "mcp-inspector")
 * @returns Effective schema mode for this client
 */
export function detectSchemaMode(clientName?: string): "flat" | "discriminated" {
  const name = clientName?.toLowerCase() ?? "";

  // Known clients that need flat schemas (don't support oneOf well)
  // Use exact match or prefix to avoid false positives (e.g., "my-claude-wrapper")
  if (
    name === "claude" ||
    name.startsWith("claude-") ||
    name === "cursor" ||
    name.startsWith("cursor-")
  ) {
    return "flat";
  }

  // Known clients that support discriminated unions
  // Use same pattern as above: exact match or dash-prefix
  if (
    name === "inspector" ||
    name.startsWith("inspector-") ||
    name === "mcp-inspector" ||
    name.startsWith("mcp-inspector-")
  ) {
    return "discriminated";
  }

  // Safe default for unknown clients
  return "flat";
}

export const USE_GITLAB_WIKI = process.env.USE_GITLAB_WIKI !== "false";
export const USE_MILESTONE = process.env.USE_MILESTONE !== "false";
export const USE_PIPELINE = process.env.USE_PIPELINE !== "false";
export const USE_WORKITEMS = process.env.USE_WORKITEMS !== "false";
export const USE_LABELS = process.env.USE_LABELS !== "false";
export const USE_MRS = process.env.USE_MRS !== "false";
export const USE_FILES = process.env.USE_FILES !== "false";
export const USE_VARIABLES = process.env.USE_VARIABLES !== "false";
export const USE_SNIPPETS = process.env.USE_SNIPPETS !== "false";
export const USE_WEBHOOKS = process.env.USE_WEBHOOKS !== "false";
export const USE_INTEGRATIONS = process.env.USE_INTEGRATIONS !== "false";
export const USE_RELEASES = process.env.USE_RELEASES !== "false";
export const USE_REFS = process.env.USE_REFS !== "false";
export const USE_MEMBERS = process.env.USE_MEMBERS !== "false";
export const USE_SEARCH = process.env.USE_SEARCH !== "false";
export const USE_ITERATIONS = process.env.USE_ITERATIONS !== "false";
export const HOST = process.env.HOST ?? "0.0.0.0";
export const PORT = process.env.PORT ?? 3002;

// TLS/SSL configuration for direct HTTPS termination
export const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
export const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
export const SSL_CA_PATH = process.env.SSL_CA_PATH;
export const SSL_PASSPHRASE = process.env.SSL_PASSPHRASE;

// Reverse proxy configuration
// Values: 'true', 'false', 'loopback', 'linklocal', 'uniquelocal', or specific IPs
export const TRUST_PROXY = process.env.TRUST_PROXY;

// SSE heartbeat interval (in milliseconds)
// Sends `: ping\n\n` comments to keep SSE connections alive through proxies (Cloudflare, Envoy, etc.)
// Default 30s — well under Cloudflare's ~100-125s idle timeout
const parsedHeartbeatMs = parseInt(process.env.GITLAB_SSE_HEARTBEAT_MS ?? "30000", 10);
export const SSE_HEARTBEAT_MS =
  Number.isFinite(parsedHeartbeatMs) && parsedHeartbeatMs > 0 ? parsedHeartbeatMs : 30000;

// HTTP server keepalive timeout (in milliseconds)
// Must be higher than any upstream proxy timeout (Cloudflare max is 600s for Enterprise)
// Default 620s ensures the Node.js server doesn't close connections before the proxy does
const parsedKeepAliveTimeout = parseInt(
  process.env.GITLAB_HTTP_KEEPALIVE_TIMEOUT_MS ?? "620000",
  10
);
export const HTTP_KEEPALIVE_TIMEOUT_MS =
  Number.isFinite(parsedKeepAliveTimeout) && parsedKeepAliveTimeout > 0
    ? parsedKeepAliveTimeout
    : 620000;

// === Granular API timeout configuration ===
// Each phase of an HTTP request has its own timeout to prevent different types of hangs.

// TCP connect timeout (default: 2s)
const parsedConnectTimeoutMs = parseInt(process.env.GITLAB_API_CONNECT_TIMEOUT_MS ?? "2000", 10);
export const CONNECT_TIMEOUT_MS =
  Number.isFinite(parsedConnectTimeoutMs) && parsedConnectTimeoutMs > 0
    ? parsedConnectTimeoutMs
    : 2000;

// Response headers timeout (default: 10s) — time to first response byte after connect
const parsedHeadersTimeoutMs = parseInt(process.env.GITLAB_API_HEADERS_TIMEOUT_MS ?? "10000", 10);
export const HEADERS_TIMEOUT_MS =
  Number.isFinite(parsedHeadersTimeoutMs) && parsedHeadersTimeoutMs > 0
    ? parsedHeadersTimeoutMs
    : 10000;

// Response body timeout (default: 30s) — time to receive full body after headers
// Larger default for big responses (pipeline logs, large diffs)
const parsedBodyTimeoutMs = parseInt(process.env.GITLAB_API_BODY_TIMEOUT_MS ?? "30000", 10);
export const BODY_TIMEOUT_MS =
  Number.isFinite(parsedBodyTimeoutMs) && parsedBodyTimeoutMs > 0 ? parsedBodyTimeoutMs : 30000;

// Tool handler timeout (default: 120s) — total time for entire tool execution including retries
const parsedHandlerTimeoutMs = parseInt(process.env.GITLAB_TOOL_TIMEOUT_MS ?? "120000", 10);
export const HANDLER_TIMEOUT_MS =
  Number.isFinite(parsedHandlerTimeoutMs) && parsedHandlerTimeoutMs > 0
    ? parsedHandlerTimeoutMs
    : 120000;

// === Connection pool configuration ===
// Max HTTP connections per GitLab instance (default: 25, up from 10)
const parsedPoolMaxConnections = parseInt(process.env.GITLAB_POOL_MAX_CONNECTIONS ?? "25", 10);
export const POOL_MAX_CONNECTIONS =
  Number.isFinite(parsedPoolMaxConnections) && parsedPoolMaxConnections > 0
    ? parsedPoolMaxConnections
    : 25;

// Retry configuration for idempotent operations (GET/HEAD/OPTIONS requests by default)
// Retries on: timeouts, network errors, 5xx server errors, 429 rate limits
export const API_RETRY_ENABLED = process.env.GITLAB_API_RETRY_ENABLED !== "false";

const parsedMaxAttempts = parseInt(process.env.GITLAB_API_RETRY_MAX_ATTEMPTS ?? "3", 10);
export const API_RETRY_MAX_ATTEMPTS =
  Number.isFinite(parsedMaxAttempts) && parsedMaxAttempts >= 0 ? parsedMaxAttempts : 3;

const parsedBaseDelay = parseInt(process.env.GITLAB_API_RETRY_BASE_DELAY_MS ?? "1000", 10);
export const API_RETRY_BASE_DELAY_MS =
  Number.isFinite(parsedBaseDelay) && parsedBaseDelay > 0 ? parsedBaseDelay : 1000;

const parsedMaxDelay = parseInt(process.env.GITLAB_API_RETRY_MAX_DELAY_MS ?? "4000", 10);
export const API_RETRY_MAX_DELAY_MS =
  Number.isFinite(parsedMaxDelay) && parsedMaxDelay > 0 ? parsedMaxDelay : 4000;

// Rate limiting configuration
// Per-IP rate limiting (for anonymous requests) - enabled by default
export const RATE_LIMIT_IP_ENABLED = process.env.RATE_LIMIT_IP_ENABLED !== "false";
export const RATE_LIMIT_IP_WINDOW_MS = parseInt(process.env.RATE_LIMIT_IP_WINDOW_MS ?? "60000", 10); // 1 minute
export const RATE_LIMIT_IP_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_IP_MAX_REQUESTS ?? "100",
  10
);

// Per-session rate limiting (for authenticated requests) - disabled by default
export const RATE_LIMIT_SESSION_ENABLED = process.env.RATE_LIMIT_SESSION_ENABLED === "true";
export const RATE_LIMIT_SESSION_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_SESSION_WINDOW_MS ?? "60000",
  10
);
export const RATE_LIMIT_SESSION_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_SESSION_MAX_REQUESTS ?? "300",
  10
);

// Transport mode selection:
// - If PORT env var is present: HTTP mode with dual transport (SSE + StreamableHTTP)
// - If no PORT env var: stdio mode for direct MCP communication

// TLS/SSL configuration
export const SKIP_TLS_VERIFY = process.env.SKIP_TLS_VERIFY === "true";

// Dashboard configuration
// When enabled, GET / returns health dashboard (HTML or JSON based on Accept header)
// When disabled, GET / is handled by MCP StreamableHTTP transport
export const DASHBOARD_ENABLED = process.env.DASHBOARD_ENABLED !== "false";

// Proxy configuration
export const HTTP_PROXY = process.env.HTTP_PROXY;
export const HTTPS_PROXY = process.env.HTTPS_PROXY;
export const NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
export const GITLAB_CA_CERT_PATH = process.env.GITLAB_CA_CERT_PATH;

// GitLab base URL configuration (without /api/v4)
function normalizeGitLabBaseUrl(url?: string): string {
  if (!url) {
    return "https://gitlab.com";
  }

  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }

  // Remove /api/v4 if user accidentally added it
  if (url.endsWith("/api/v4")) {
    url = url.slice(0, -7);
  }

  return url;
}

export const GITLAB_BASE_URL = normalizeGitLabBaseUrl(process.env.GITLAB_API_URL ?? "");
export const GITLAB_API_URL = `${GITLAB_BASE_URL}/api/v4`;
export const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
export const GITLAB_ALLOWED_PROJECT_IDS =
  process.env.GITLAB_ALLOWED_PROJECT_IDS?.split(",").map(id => id.trim()) ?? [];

export function getEffectiveProjectId(projectId: string): string {
  if (GITLAB_PROJECT_ID) {
    return GITLAB_PROJECT_ID;
  }

  if (GITLAB_ALLOWED_PROJECT_IDS.length > 0) {
    if (!GITLAB_ALLOWED_PROJECT_IDS.includes(projectId)) {
      throw new Error(
        `Project ID ${projectId} is not allowed. Allowed project IDs: ${GITLAB_ALLOWED_PROJECT_IDS.join(", ")}`
      );
    }
  }

  return projectId;
}

// Package info
let packageName = "gitlab-mcp";
let packageVersion = "unknown";

try {
  const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
  };
  packageName = packageInfo.name ?? packageName;
  packageVersion = packageInfo.version ?? packageVersion;
} catch {
  // Ignore errors when reading package.json
}

export { packageName, packageVersion };

/**
 * Parse tool description overrides from environment variables
 * Environment variables should follow the pattern: GITLAB_TOOL_{TOOL_NAME}="Custom description"
 * @returns Map of tool name to custom description
 */
export function getToolDescriptionOverrides(): Map<string, string> {
  const overrides = new Map<string, string>();
  const prefix = "GITLAB_TOOL_";

  // Scan all environment variables for tool description overrides
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      // Extract tool name from environment variable
      // Convert from GITLAB_TOOL_LIST_PROJECTS to list_projects
      const toolName = key.substring(prefix.length).toLowerCase();

      overrides.set(toolName, value);
    }
  }

  return overrides;
}

/**
 * Parse action description overrides from environment variables
 * Environment variables should follow the pattern: GITLAB_ACTION_{TOOL}_{ACTION}="Custom description"
 * Example: GITLAB_ACTION_MANAGE_MILESTONE_DELETE="Remove a milestone permanently"
 * @returns Map of "tool:action" to custom description
 */
export function getActionDescriptionOverrides(): Map<string, string> {
  const overrides = new Map<string, string>();
  const prefix = "GITLAB_ACTION_";

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      // Extract tool and action from environment variable
      // GITLAB_ACTION_MANAGE_MILESTONE_DELETE -> manage_milestone:delete
      const rest = key.substring(prefix.length).toLowerCase();

      // Find the last underscore to split tool from action
      // This handles tool names with underscores (e.g., manage_milestone)
      const lastUnderscoreIndex = rest.lastIndexOf("_");
      if (lastUnderscoreIndex === -1) {
        continue;
      }

      const toolName = rest.substring(0, lastUnderscoreIndex);
      const actionName = rest.substring(lastUnderscoreIndex + 1);

      if (!toolName || !actionName) {
        continue;
      }

      overrides.set(`${toolName}:${actionName}`, value);
    }
  }

  return overrides;
}

/**
 * Parse parameter description overrides from environment variables
 * Environment variables should follow the pattern: GITLAB_PARAM_{TOOL}_{PARAM}="Custom description"
 * Example: GITLAB_PARAM_MANAGE_MILESTONE_TITLE="The milestone title (required for create)"
 * @returns Map of "tool:param" to custom description
 */
export function getParamDescriptionOverrides(): Map<string, string> {
  const overrides = new Map<string, string>();
  const prefix = "GITLAB_PARAM_";

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      // Extract tool and param from environment variable
      // GITLAB_PARAM_MANAGE_MILESTONE_TITLE -> manage_milestone:title
      const rest = key.substring(prefix.length).toLowerCase();

      // Find the last underscore to split tool from param
      const lastUnderscoreIndex = rest.lastIndexOf("_");
      if (lastUnderscoreIndex === -1) {
        continue;
      }

      const toolName = rest.substring(0, lastUnderscoreIndex);
      const paramName = rest.substring(lastUnderscoreIndex + 1);

      if (!toolName || !paramName) {
        continue;
      }

      overrides.set(`${toolName}:${paramName}`, value);
    }
  }

  return overrides;
}

/**
 * Check if a specific action is denied for a tool
 * @param toolName - The tool name (e.g., "manage_milestone")
 * @param actionName - The action name (e.g., "delete")
 * @returns true if the action is denied
 */
export function isActionDenied(toolName: string, actionName: string): boolean {
  const deniedActions = GITLAB_DENIED_ACTIONS.get(toolName.toLowerCase());
  if (!deniedActions) {
    return false;
  }
  return deniedActions.has(actionName.toLowerCase());
}

/**
 * Get allowed actions for a tool by filtering out denied actions
 * @param toolName - The tool name (e.g., "manage_milestone")
 * @param allActions - Array of all possible actions
 * @returns Array of allowed actions
 */
export function getAllowedActions(toolName: string, allActions: string[]): string[] {
  const deniedActions = GITLAB_DENIED_ACTIONS.get(toolName.toLowerCase());
  if (!deniedActions || deniedActions.size === 0) {
    return allActions;
  }
  return allActions.filter(action => !deniedActions.has(action.toLowerCase()));
}
