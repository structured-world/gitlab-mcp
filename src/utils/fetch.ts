/**
 * Enhanced fetch utilities for GitLab MCP Server
 *
 * Node.js v24 compatible implementation using Undici's dispatcher pattern.
 * Supports:
 * - TLS verification bypass (SKIP_TLS_VERIFY)
 * - Custom CA certificates (GITLAB_CA_CERT_PATH)
 * - HTTP/HTTPS proxy support (HTTP_PROXY, HTTPS_PROXY)
 * - Cookie authentication (GITLAB_AUTH_COOKIE_PATH)
 * - OAuth per-request token context
 * - Configurable timeout handling
 */

import * as fs from "fs";
import { logInfo, logWarn, logDebug } from "../logger";
import {
  SKIP_TLS_VERIFY,
  GITLAB_AUTH_COOKIE_PATH,
  GITLAB_CA_CERT_PATH,
  HTTP_PROXY,
  HTTPS_PROXY,
  NODE_TLS_REJECT_UNAUTHORIZED,
  GITLAB_TOKEN,
  GITLAB_BASE_URL,
  API_TIMEOUT_MS,
  API_RETRY_ENABLED,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_BASE_DELAY_MS,
  API_RETRY_MAX_DELAY_MS,
} from "../config";
import { isOAuthEnabled, getTokenContext, getGitLabApiUrlFromContext } from "../oauth/index";
import { getRequestTracker } from "../logging/index";
import { InstanceRegistry } from "../services/InstanceRegistry.js";

// Dynamic require to avoid TypeScript analyzing complex undici types at compile time
const undici = require("undici") as {
  Agent: new (opts?: Record<string, unknown>) => unknown;
  ProxyAgent: new (opts: string | Record<string, unknown>) => unknown;
};

/**
 * Cookie handling - parse cookies from file and format for HTTP Cookie header
 */
function loadCookieHeader(): string | null {
  if (!GITLAB_AUTH_COOKIE_PATH) {
    return null;
  }

  try {
    const cookieString = fs.readFileSync(GITLAB_AUTH_COOKIE_PATH, "utf-8");
    const cookies: string[] = [];

    cookieString.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const parts = trimmed.split("\t");
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6];
          cookies.push(`${name}=${value}`);
        }
      }
    });

    return cookies.length > 0 ? cookies.join("; ") : null;
  } catch (error: unknown) {
    logWarn("Failed to load GitLab authentication cookies", { err: error });
    return null;
  }
}

/**
 * Load custom CA certificate
 */
function loadCACertificate(): Buffer | undefined {
  if (!GITLAB_CA_CERT_PATH) {
    return undefined;
  }

  try {
    const ca = fs.readFileSync(GITLAB_CA_CERT_PATH);
    logInfo(`Custom CA certificate loaded from ${GITLAB_CA_CERT_PATH}`);
    return ca;
  } catch (error: unknown) {
    logWarn(`Failed to load CA certificate from ${GITLAB_CA_CERT_PATH}`, { err: error });
    return undefined;
  }
}

/**
 * Check if URL is a SOCKS proxy
 */
function isSocksProxy(url: string): boolean {
  return url.startsWith("socks4://") || url.startsWith("socks5://") || url.startsWith("socks://");
}

/**
 * Create Undici dispatcher for fetch requests
 *
 * LIMITATION: The dispatcher is created globally and uses environment variables
 * (SKIP_TLS_VERIFY, NODE_TLS_REJECT_UNAUTHORIZED) for TLS configuration.
 * Per-instance `insecureSkipVerify` settings from config files are NOT currently
 * consulted here. To support per-instance TLS settings, we would need to either:
 * 1. Create separate dispatchers per instance, or
 * 2. Use a different HTTP client that supports per-request TLS configuration
 *
 * For now, use environment variables for global TLS skip, or ensure all instances
 * use valid certificates.
 */
function createDispatcher(): unknown {
  const proxyUrl = HTTPS_PROXY ?? HTTP_PROXY;

  // Build TLS options
  const tlsOptions: Record<string, unknown> = {};

  // SECURITY NOTE: Disabling certificate validation is an opt-in configuration
  // for self-hosted GitLab instances using self-signed certificates.
  // This is controlled by explicit environment variables (SKIP_TLS_VERIFY or
  // NODE_TLS_REJECT_UNAUTHORIZED=0) and is NOT enabled by default.
  // Users must consciously configure this for their private infrastructure.
  if (SKIP_TLS_VERIFY || NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    tlsOptions.rejectUnauthorized = false;
    if (SKIP_TLS_VERIFY) {
      logWarn("TLS certificate verification disabled via SKIP_TLS_VERIFY");
    }
    if (NODE_TLS_REJECT_UNAUTHORIZED === "0") {
      logWarn("TLS certificate verification disabled via NODE_TLS_REJECT_UNAUTHORIZED");
    }
  }

  const ca = loadCACertificate();
  if (ca) {
    tlsOptions.ca = ca;
  }

  const hasTlsConfig = Object.keys(tlsOptions).length > 0;

  // SOCKS proxy not supported with native fetch
  if (proxyUrl && isSocksProxy(proxyUrl)) {
    logInfo(`Using SOCKS proxy: ${proxyUrl}`);
    logWarn("SOCKS proxy not supported with native fetch. Consider HTTP/HTTPS proxy.");
    return undefined;
  }

  // HTTP/HTTPS proxy
  if (proxyUrl) {
    logInfo(`Using proxy: ${proxyUrl}`);
    return new undici.ProxyAgent({
      uri: proxyUrl,
      requestTls: hasTlsConfig ? tlsOptions : undefined,
    });
  }

  // Custom TLS config without proxy
  if (hasTlsConfig) {
    return new undici.Agent({ connect: tlsOptions });
  }

  return undefined;
}

/** Cached dispatcher */
let cachedDispatcher: unknown;
let dispatcherInitialized = false;

function getDispatcher(): unknown {
  if (!dispatcherInitialized) {
    cachedDispatcher = createDispatcher();
    dispatcherInitialized = true;
  }
  return cachedDispatcher;
}

/**
 * Base HTTP headers
 */
export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "GitLab MCP Server",
  "Content-Type": "application/json",
  Accept: "application/json",
};

function getGitLabToken(): string | undefined {
  if (isOAuthEnabled()) {
    const context = getTokenContext();
    if (!context) {
      logWarn("OAuth mode: no token context available - API call will fail with 401");
    } else if (!context.gitlabToken) {
      logWarn("OAuth mode: token context exists but no gitlabToken set");
    } else {
      logDebug("OAuth mode: using token from context", { userId: context.gitlabUserId });
    }
    return context?.gitlabToken;
  }
  return GITLAB_TOKEN;
}

/**
 * Get GitLab base URL from context or fallback to global config.
 * In OAuth mode, uses apiUrl from token context.
 * In static mode, uses GITLAB_BASE_URL from config.
 *
 * @returns The GitLab base URL (e.g., "https://gitlab.com")
 */
export function getGitLabBaseUrl(): string {
  if (isOAuthEnabled()) {
    const apiUrl = getGitLabApiUrlFromContext();
    if (apiUrl) {
      return apiUrl;
    }
    logWarn("OAuth mode: no API URL in context, falling back to global config");
  }
  return GITLAB_BASE_URL ?? "https://gitlab.com";
}

/**
 * Get authentication headers based on the current auth mode.
 * - Static mode (PAT): returns { "PRIVATE-TOKEN": token }
 * - OAuth mode: returns { "Authorization": "Bearer <token>" }
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getGitLabToken();
  if (!token) return {};

  if (isOAuthEnabled()) {
    return { Authorization: `Bearer ${token}` };
  }

  // PAT mode: use GitLab's canonical PRIVATE-TOKEN header
  return { "PRIVATE-TOKEN": token };
}

/** @deprecated Use enhancedFetch() directly */
export function createFetchOptions(): Record<string, unknown> {
  const dispatcher = getDispatcher();
  return dispatcher ? { dispatcher } : {};
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Extended fetch options with retry configuration
 */
export interface FetchWithRetryOptions extends RequestInit {
  /** Enable retry for this request (default: true for GET/HEAD/OPTIONS, false otherwise) */
  retry?: boolean;
  /** Maximum number of retry attempts (default: from config) */
  maxRetries?: number;
  /** Enable per-instance rate limiting (default: true in multi-instance mode) */
  rateLimit?: boolean;
  /** Override the base URL for rate limit slot acquisition (derived from request URL if not specified) */
  rateLimitBaseUrl?: string;
}

/**
 * Sleep for a specified duration with optional abort support
 * @param ms - Duration to sleep in milliseconds
 * @param signal - Optional AbortSignal to cancel the sleep early
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Helper to get abort error - ensures we reject with an AbortError-typed instance
    // Preserves AbortError semantics so downstream code can identify abort errors
    const getAbortError = (): Error => {
      const reason: unknown = signal?.reason;

      // If reason is already an Error, ensure it's identifiable as AbortError
      if (reason instanceof Error) {
        if (reason.name !== "AbortError") {
          reason.name = "AbortError";
        }
        return reason;
      }

      // For non-Error reasons, create DOMException with AbortError name
      const message = reason !== undefined ? String(reason) : "Aborted";
      return new DOMException(message, "AbortError");
    };

    if (signal?.aborted) {
      reject(getAbortError());
      return;
    }

    let abortHandler: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      // Clean up abort listener on normal completion
      if (abortHandler) {
        signal?.removeEventListener("abort", abortHandler);
      }
      resolve();
    }, ms);

    if (signal) {
      abortHandler = () => {
        clearTimeout(timeoutId);
        reject(getAbortError());
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
}

/**
 * Redact sensitive information from URLs for safe logging
 * Masks upload secrets, tokens in paths, and sensitive query parameters
 */
function redactUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);

    // Redact URL userinfo (user:pass@host)
    if (parsed.username) parsed.username = "[REDACTED]";
    if (parsed.password) parsed.password = "[REDACTED]";

    // Redact upload secrets in path: /uploads/<secret>/<filename> -> /uploads/[REDACTED]/<filename>
    // Secret can be any string (not just hex), so match any path segment after /uploads/
    parsed.pathname = parsed.pathname.replace(/\/uploads\/([^/]+)\//gi, "/uploads/[REDACTED]/");

    // Redact any path segment that looks like a secret/token (32+ hex chars)
    // Match both mid-path (/token/) and end-of-path (/token) tokens
    parsed.pathname = parsed.pathname.replace(/\/([a-f0-9]{32,})(\/|$)/gi, "/[REDACTED]$2");

    // Redact sensitive query parameters
    const sensitiveParams = [
      "private_token",
      "access_token",
      "oauth_token",
      "token",
      "secret",
      "key",
      "password",
      "auth",
    ];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "[REDACTED]");
      }
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return a safe fallback
    // Extract only scheme and host, excluding any userinfo (user:pass@)
    const schemeMatch = url.match(/^(https?):\/\//);
    if (!schemeMatch) return "[INVALID_URL]";

    // Remove userinfo if present and extract host
    const afterScheme = url.slice(schemeMatch[0].length);
    const atIndex = afterScheme.indexOf("@");
    const hostPart = atIndex >= 0 ? afterScheme.slice(atIndex + 1) : afterScheme;
    const hostMatch = hostPart.match(/^([^/:]+)/);

    return hostMatch ? `${schemeMatch[1]}://[REDACTED_HOST]/[URL_PARSE_ERROR]` : "[INVALID_URL]";
  }
}

/**
 * Determine if an error is retryable
 * Retryable errors: internal timeouts, network errors
 * NOT retryable: caller-initiated aborts (AbortError from caller signal)
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  // Caller-initiated AbortErrors are NOT retryable
  // (doFetch converts internal timeouts to "GitLab API timeout" message)
  if (error.name === "AbortError") {
    return false;
  }

  // Internal timeout errors (converted by doFetch) are retryable
  if (message.includes("gitlab api timeout")) {
    return true;
  }

  // Network errors (fetch failures) are retryable
  if (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("network")
  ) {
    return true;
  }

  return false;
}

/**
 * Determine if an HTTP response status is retryable
 * 5xx server errors are retryable, 429 rate limit is retryable after delay
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number): number {
  const delay = API_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, API_RETRY_MAX_DELAY_MS);
}

/**
 * Parse Retry-After header value
 * Supports both delta-seconds (integer) and HTTP-date (RFC 7231) formats
 * @returns delay in milliseconds, or null if parsing fails
 */
function parseRetryAfter(retryAfter: string): number | null {
  // Try delta-seconds first (most common)
  // Accept 0 or positive integers per RFC 7231 (0 means "retry immediately")
  // Allow leading zeros per RFC 7231 delta-seconds = 1*DIGIT (e.g., "01", "001")
  const trimmed = retryAfter.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (seconds >= 0) {
      return seconds * 1000;
    }
  }

  // Try HTTP-date format (RFC 7231)
  // Example: "Wed, 21 Oct 2015 07:28:00 GMT"
  const dateMs = Date.parse(retryAfter);
  if (!isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    // Only return positive delays
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Perform a single fetch request with timeout
 * Internal function used by enhancedFetch
 * @param url - The URL to fetch
 * @param options - Standard fetch RequestInit options
 * @param instanceDispatcher - Optional per-instance Undici dispatcher for HTTP/2 pooling
 */
async function doFetch(
  url: string,
  options: RequestInit = {},
  instanceDispatcher?: unknown
): Promise<Response> {
  // Use per-instance dispatcher if provided, otherwise fall back to global
  const dispatcher = instanceDispatcher ?? getDispatcher();
  const cookieHeader = loadCookieHeader();

  // For FormData, don't set Content-Type - let fetch set it with proper boundary
  const isFormData = options.body instanceof FormData;
  const baseHeaders = isFormData
    ? { "User-Agent": DEFAULT_HEADERS["User-Agent"], Accept: DEFAULT_HEADERS.Accept }
    : { ...DEFAULT_HEADERS };

  const headers: Record<string, string> = { ...baseHeaders, ...getAuthHeaders() };

  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, value] of options.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, options.headers);
    }
  }

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const method = (options.method ?? "GET").toUpperCase();

  // Debug log at request start (redact sensitive URL parts)
  const safeUrl = redactUrlForLogging(url);
  logDebug("Starting GitLab API request", { url: safeUrl, method, timeout: API_TIMEOUT_MS });

  // Use a unique Symbol to identify internal timeout aborts vs caller aborts
  const TIMEOUT_REASON = Symbol("GitLab API timeout");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(TIMEOUT_REASON), API_TIMEOUT_MS);

  // Merge caller signal with internal timeout signal
  // Use AbortSignal.any() if available (Node.js 20+), otherwise use listener pattern
  let mergedSignal: AbortSignal = controller.signal;
  const callerSignal = options.signal as AbortSignal | undefined;
  let callerAbortHandler: (() => void) | undefined;

  if (callerSignal) {
    if (typeof AbortSignal.any === "function") {
      // Node.js 20+ - use AbortSignal.any for clean signal merging
      mergedSignal = AbortSignal.any([controller.signal, callerSignal]);
    } else {
      // Fallback for older Node.js - forward caller abort to our controller
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerAbortHandler = () => controller.abort(callerSignal.reason);
        callerSignal.addEventListener("abort", callerAbortHandler, { once: true });
      }
    }
  }

  // Helper to clean up listeners
  const cleanup = () => {
    clearTimeout(timeoutId);
    if (callerAbortHandler && callerSignal) {
      callerSignal.removeEventListener("abort", callerAbortHandler);
    }
  };

  const fetchOptions: Record<string, unknown> = {
    ...options,
    headers,
    signal: mergedSignal,
  };

  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  const startTime = Date.now();
  const requestTracker = getRequestTracker();

  try {
    const response = await fetch(url, fetchOptions as RequestInit);
    cleanup();

    const duration = Date.now() - startTime;
    logDebug("GitLab API request completed", {
      url: safeUrl,
      method,
      status: response.status,
      duration,
    });

    // Capture GitLab response for access logging
    requestTracker.setGitLabResponseForCurrentRequest(response.status, duration);

    return response;
  } catch (error) {
    cleanup();
    const duration = Date.now() - startTime;

    if (error instanceof Error && error.name === "AbortError") {
      // Distinguish between internal timeout and caller abort
      // Check if our internal controller was aborted with timeout reason
      const isInternalTimeout =
        controller.signal.aborted && controller.signal.reason === TIMEOUT_REASON;

      if (isInternalTimeout) {
        // Internal timeout - log and throw timeout error
        logWarn("GitLab API request timed out", {
          url: safeUrl,
          method,
          timeout: API_TIMEOUT_MS,
          duration,
        });

        // Capture timeout for access logging
        requestTracker.setGitLabResponseForCurrentRequest("timeout", duration);

        throw new Error(`GitLab API timeout after ${API_TIMEOUT_MS}ms`);
      } else {
        // Caller abort - re-throw original error to preserve abort reason
        logDebug("GitLab API request aborted by caller", {
          url: safeUrl,
          method,
          duration,
          reason: callerSignal?.reason,
        });
        throw error;
      }
    }

    // Log other errors with full error object for stack trace
    logWarn("GitLab API request failed", {
      url: safeUrl,
      method,
      err: error instanceof Error ? error : new Error(String(error)),
      duration,
    });

    // Capture error for access logging
    requestTracker.setGitLabResponseForCurrentRequest("error", duration);

    throw error;
  }
}

/**
 * Extract base URL from a full URL for rate limit slot acquisition
 *
 * For GitLab deployments this preserves any leading subpath (e.g.,
 * https://example.com/gitlab) and strips known API suffixes such as
 * /api/v4 and /api/graphql so that the result matches InstanceRegistry
 * normalization rules.
 *
 * @internal Exported for testing purposes
 */
export function extractBaseUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);

    let basePath = parsed.pathname || "/";

    // Strip known GitLab API suffixes while preserving any leading subpath.
    // Handles both suffix at end AND in middle of path (e.g., /gitlab/api/v4/projects)
    // Ensures match is a full path segment (followed by "/" or end-of-path).
    //
    // Nested loop is necessary to skip partial matches (e.g., /api/v4foo/real/api/v4).
    // A simple indexOf would match the first /api/v4 which is part of "v4foo".
    // The inner while loop continues searching until it finds a complete segment match.
    //
    // Performance note: O(n*m) where n=path length, m=suffix count (2).
    // Acceptable because: paths are short (~100 chars max), and this runs once per request.
    // Correctness over micro-optimization — the nested loop handles edge cases properly.
    const apiSuffixes = ["/api/v4", "/api/graphql"];
    outerLoop: for (const suffix of apiSuffixes) {
      let searchPos = 0;
      while (searchPos < basePath.length) {
        const suffixIndex = basePath.indexOf(suffix, searchPos);
        if (suffixIndex === -1) break;

        // Verify the match is a complete segment (not partial like /api/v4foo)
        const afterSuffix = basePath.charAt(suffixIndex + suffix.length);
        if (afterSuffix === "" || afterSuffix === "/") {
          // Found complete API suffix - extract everything before it as the base path
          basePath = suffixIndex === 0 ? "/" : basePath.slice(0, suffixIndex);
          break outerLoop;
        }
        // Continue searching after this partial match
        searchPos = suffixIndex + 1;
      }
    }

    // Normalize path: ensure leading slash and remove trailing slash (except root).
    if (!basePath.startsWith("/")) {
      basePath = `/${basePath}`;
    }
    if (basePath.length > 1 && basePath.endsWith("/")) {
      basePath = basePath.slice(0, -1);
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    return basePath === "/" ? origin : `${origin}${basePath}`;
  } catch {
    return undefined;
  }
}

/**
 * Enhanced fetch with GitLab support, retry logic, and Node.js v24 compatibility
 *
 * @param url - URL to fetch
 * @param options - Fetch options with optional retry configuration
 * @returns Response from the server
 *
 * Retry behavior:
 * - By default, safe/read-only methods (GET/HEAD/OPTIONS) may be retried when
 *   global API retry is enabled.
 * - Other methods (e.g. POST/PUT/DELETE/PATCH) do NOT retry by default.
 * - Override per request with options.retry = true or false.
 * - Retries on: internal timeouts, network errors, 5xx responses, and 429 Too Many Requests.
 *   For 429, the Retry-After header is honored when present (delta-seconds or HTTP-date).
 * - Caller-provided AbortSignal aborts are NOT retried - they propagate immediately.
 * - Uses exponential backoff (configurable via API_RETRY_* settings).
 *
 * Rate limiting:
 * - When rateLimit option is true (default: true), acquires a rate limit slot
 *   from InstanceRegistry before making the request.
 * - The rate limit slot is automatically released after the request completes.
 * - Rate limiting is per-instance, allowing different GitLab servers to have
 *   independent rate limits.
 *
 * Timing considerations:
 * - With retries enabled (default for GET), worst-case time is:
 *   (maxRetries + 1) * timeout + sum of backoff delays
 * - Default: 4 attempts * 10s timeout + ~7s delays = ~47s worst case
 * - Disable retries (options.retry = false) for time-sensitive operations
 */
export async function enhancedFetch(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const safeUrl = redactUrlForLogging(url);

  // Determine if retry is enabled for this request
  const shouldRetry = options.retry ?? (API_RETRY_ENABLED && isIdempotent);
  const maxRetries = options.maxRetries ?? API_RETRY_MAX_ATTEMPTS;

  // Determine if rate limiting is enabled (default: true)
  const shouldRateLimit = options.rateLimit !== false;

  // Extract options to pass clean options to doFetch
  const {
    retry: _retry,
    maxRetries: _maxRetries,
    rateLimit: _rateLimit,
    rateLimitBaseUrl: _rateLimitBaseUrl,
    ...fetchOptions
  } = options;

  // Acquire rate limit slot and get per-instance dispatcher if enabled
  // NOTE: The slot is held for the entire request lifecycle including retries.
  // This is intentional - during retries the request is still "in progress" from
  // the server's perspective, and releasing/re-acquiring could allow queue jumping.
  let releaseSlot: (() => void) | undefined;
  let instanceDispatcher: unknown;

  const registry = InstanceRegistry.getInstance();
  if (registry.isInitialized()) {
    // Determine base URL for rate limiting and connection pooling
    const baseUrl = options.rateLimitBaseUrl ?? extractBaseUrl(url) ?? getGitLabBaseUrl();

    // Get per-instance HTTP/2 dispatcher for connection pooling.
    // InstanceRegistry.getDispatcher() lazily creates the pool for registered instances,
    // ensuring per-instance TLS settings (e.g., insecureSkipVerify) are applied even
    // for REST-only calls that happen before any GraphQL calls.
    // Falls back to global dispatcher only if instance is not registered at all.
    instanceDispatcher = registry.getDispatcher(baseUrl);

    if (shouldRateLimit) {
      // acquireSlot throws if rate limit exceeded - let it propagate
      //
      // NOTE: Slot is held for the entire retry loop including backoff sleeps.
      // This is intentional: during 429/retry scenarios, keeping the slot prevents
      // new requests from being queued while we're already at the rate limit.
      // Trade-off: slightly reduced throughput under retry conditions, but better
      // protection against overwhelming the GitLab instance with concurrent retries.
      releaseSlot = await registry.acquireSlot(baseUrl);
    }
  }

  try {
    // If retry is disabled, just do a single fetch
    if (!shouldRetry || maxRetries <= 0) {
      return await doFetch(url, fetchOptions, instanceDispatcher);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await doFetch(url, fetchOptions, instanceDispatcher);

        // Check if response status is retryable (5xx, 429)
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          // For 429, check Retry-After header (supports delta-seconds and HTTP-date)
          let retryDelay = calculateBackoffDelay(attempt);
          const retryAfter = response.headers.get("Retry-After");
          if (retryAfter && response.status === 429) {
            const parsedDelay = parseRetryAfter(retryAfter);
            if (parsedDelay !== null) {
              // Cap Retry-After to max delay to prevent excessive waits
              retryDelay = Math.min(parsedDelay, API_RETRY_MAX_DELAY_MS);
            }
          }

          logWarn("Retrying request after server error", {
            url: safeUrl,
            method,
            status: response.status,
            attempt: attempt + 1,
            maxRetries,
            retryDelay,
          });

          // Cancel response body to release connection before retry
          // Wrap in try-catch as cancel() can throw if body is already disturbed
          try {
            await response.body?.cancel();
          } catch {
            // Body already consumed or errored - safe to ignore
          }

          await sleep(retryDelay, fetchOptions.signal ?? undefined);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable and we have attempts left
        if (isRetryableError(error) && attempt < maxRetries) {
          const retryDelay = calculateBackoffDelay(attempt);

          logWarn("Retrying request after error", {
            url: safeUrl,
            method,
            error: lastError.message,
            attempt: attempt + 1,
            maxRetries,
            retryDelay,
          });

          await sleep(retryDelay, fetchOptions.signal ?? undefined);
          continue;
        }

        // Not retryable or no attempts left
        throw lastError;
      }
    }

    /* istanbul ignore next -- unreachable: loop always exits via return or throw */
    throw lastError ?? new Error("Unexpected: retry loop exited without result");
  } finally {
    // Always release rate limit slot
    if (releaseSlot) {
      releaseSlot();
    }
  }
}

export function resetDispatcherCache(): void {
  cachedDispatcher = undefined;
  dispatcherInitialized = false;
}
