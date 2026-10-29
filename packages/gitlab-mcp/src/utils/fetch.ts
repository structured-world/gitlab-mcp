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

import * as fs from 'fs';
import { Readable } from 'node:stream';
import { STATUS_CODES } from 'node:http';
import { createNetworkDispatcher } from './network-dispatcher';
import { assertSafeApiUrl } from './api-path';
import { parseRetryAfterSeconds } from './retry-after';
import { logWarn, logDebug } from '../logger';
import {
  SKIP_TLS_VERIFY,
  GITLAB_AUTH_COOKIE_PATH,
  NODE_TLS_REJECT_UNAUTHORIZED,
  GITLAB_TOKEN,
  CONNECT_TIMEOUT_MS,
  HEADERS_TIMEOUT_MS,
  BODY_TIMEOUT_MS,
  API_RETRY_ENABLED,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_BASE_DELAY_MS,
  API_RETRY_MAX_DELAY_MS,
} from '../config';
import { isOAuthEnabled, getTokenContext } from '../oauth/index';
import { currentTokenAccount } from '../accounts/token-account';
import { configuredInstanceFor, configuredInstanceToken } from '../accounts/instance-tokens';
import { getGitLabBaseUrl } from './gitlab-base-url';
import { getRequestTracker } from '../logging/index';
import { InstanceRegistry } from '../services/InstanceRegistry.js';

// Dynamic require to avoid TypeScript analyzing complex undici types at compile time.
// We use undici.fetch() instead of the global fetch() to ensure the fetch function
// and any custom dispatchers (Pool/Agent/ProxyAgent) come from the same undici version.
// The global fetch() uses Node.js's bundled undici, which may be a different major version
// than our npm package — causing "invalid onRequestStart method" dispatcher API mismatches.
const undici = require('undici') as {
  fetch: typeof globalThis.fetch;
  request: typeof import('undici').request;
};

/**
 * Cookie handling - parse cookies from file and format for HTTP Cookie header
 */
function loadCookieHeader(): string | null {
  if (!GITLAB_AUTH_COOKIE_PATH) {
    return null;
  }

  try {
    const cookieString = fs.readFileSync(GITLAB_AUTH_COOKIE_PATH, 'utf-8');
    const cookies: string[] = [];

    cookieString.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('\t');
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6];
          cookies.push(`${name}=${value}`);
        }
      }
    });

    return cookies.length > 0 ? cookies.join('; ') : null;
  } catch (error: unknown) {
    logWarn('Failed to load GitLab authentication cookies', { err: error });
    return null;
  }
}

/**
 * Create Undici dispatcher for fetch requests
 *
 * LIMITATION: This global dispatcher uses environment variables for TLS config.
 * Per-instance `insecureSkipVerify` settings are handled by InstanceConnectionPool
 * which creates per-instance dispatchers with correct TLS settings.
 *
 * This global dispatcher is used ONLY as fallback for:
 * - Requests to unregistered instances (not in config)
 * - Initialization before InstanceRegistry is ready
 *
 * For registered instances, enhancedFetch() uses registry.getDispatcher() which
 * returns the per-instance pool with proper TLS configuration.
 *
 * Security note: Global SKIP_TLS_VERIFY affects only fallback requests.
 * Production should configure instances in config file for per-instance TLS.
 */
function createDispatcher(): unknown {
  // SECURITY NOTE: Disabling certificate validation is an opt-in configuration
  // for self-hosted GitLab instances using self-signed certificates.
  // This is controlled by explicit environment variables (SKIP_TLS_VERIFY or
  // NODE_TLS_REJECT_UNAUTHORIZED=0) and is NOT enabled by default.
  // Users must consciously configure this for their private infrastructure.
  if (SKIP_TLS_VERIFY || NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    if (SKIP_TLS_VERIFY) {
      logWarn('TLS certificate verification disabled via SKIP_TLS_VERIFY');
    }
    if (NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      logWarn('TLS certificate verification disabled via NODE_TLS_REJECT_UNAUTHORIZED');
    }
  }

  return createNetworkDispatcher({
    insecureSkipVerify: SKIP_TLS_VERIFY || NODE_TLS_REJECT_UNAUTHORIZED === '0',
    connectTimeout: CONNECT_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
  });
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
  'User-Agent': 'GitLab MCP Server',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function getGitLabToken(url: string): string | undefined {
  if (isOAuthEnabled()) {
    const context = getTokenContext();
    if (!context) {
      logWarn('OAuth mode: no token context available - API call will fail with 401');
    } else if (!context.gitlabToken) {
      logWarn('OAuth mode: token context exists but no gitlabToken set');
    } else {
      logDebug('OAuth mode: using token from context', { userId: context.gitlabUserId });
    }
    return context?.gitlabToken;
  }
  // A request to a configured instance carries that instance's own token, or none, in any
  // context: the server's token never goes to another configured host.
  const instance = configuredInstanceFor(url);
  if (instance) return configuredInstanceToken(instance);
  // A chat that switched to another configured instance uses that instance's token.
  return currentTokenAccount()?.token ?? GITLAB_TOKEN;
}

/**
 * Get authentication headers for a request to `url` based on the current auth mode.
 * - Static mode (PAT): returns { "PRIVATE-TOKEN": token } with the token of the instance
 *   `url` goes to
 * - OAuth mode: returns { "Authorization": "Bearer <token>" }
 */
export function getAuthHeaders(url: string): Record<string, string> {
  const token = getGitLabToken(url);
  if (!token) return {};

  if (isOAuthEnabled()) {
    return { Authorization: `Bearer ${token}` };
  }

  // PAT mode: use GitLab's canonical PRIVATE-TOKEN header
  return { 'PRIVATE-TOKEN': token };
}

/** @deprecated Use enhancedFetch() directly */
export function createFetchOptions(): Record<string, unknown> {
  const dispatcher = getDispatcher();
  return dispatcher ? { dispatcher } : {};
}

// ============================================================================
// Structured Timeout Error
// ============================================================================

/** Timeout phase reported by doFetch when Undici native timeouts fire */
export type TimeoutPhase = 'connect' | 'headers' | 'body';

/**
 * Structured timeout error thrown by doFetch instead of plain Error.
 * Allows callers to detect timeouts via instanceof rather than string matching.
 */
export class GitLabTimeoutError extends Error {
  public readonly phase: TimeoutPhase;
  public readonly timeoutMs: number;

  constructor(phase: TimeoutPhase, timeoutMs: number, cause?: Error) {
    super(`GitLab API timeout after ${timeoutMs}ms (${phase} phase)`);
    this.name = 'GitLabTimeoutError';
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    this.cause = cause;
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Extended fetch options with retry configuration
 */
export interface FetchWithRetryOptions extends RequestInit {
  /** Read undecoded HTTP bytes without automatic redirects; normal calls use fetch decoding. */
  rawBody?: boolean;
  /** Omit the entire query string from diagnostics, for signed download URLs. */
  redactQuery?: boolean;
  /** Enable retry for this request (default: true for GET/HEAD/OPTIONS, false otherwise) */
  retry?: boolean;
  /** Maximum number of retry attempts (default: from config) */
  maxRetries?: number;
  /** Enable per-instance rate limiting (default: true in multi-instance mode) */
  rateLimit?: boolean;
  /** Override the base URL for rate limit slot acquisition (derived from request URL if not specified) */
  rateLimitBaseUrl?: string;
  /**
   * Suppress auto-injected auth (getAuthHeaders from env/OAuth context, loadCookieHeader).
   * Caller-supplied headers in `options.headers` are NOT stripped — only ambient credentials
   * are blocked. Use for health probes (no auth at all) or requests that carry their own
   * explicit token (e.g., CLI wizard with user-provided PRIVATE-TOKEN).
   */
  skipAuth?: boolean;
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
        if (reason.name !== 'AbortError') {
          reason.name = 'AbortError';
        }
        return reason;
      }

      // For non-Error reasons, create DOMException with AbortError name
      const message = reason !== undefined ? String(reason) : 'Aborted';
      return new DOMException(message, 'AbortError');
    };

    if (signal?.aborted) {
      reject(getAbortError());
      return;
    }

    let abortHandler: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      // Clean up abort listener on normal completion
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler);
      }
      resolve();
    }, ms);

    if (signal) {
      abortHandler = () => {
        clearTimeout(timeoutId);
        reject(getAbortError());
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

/**
 * Redact sensitive information from URLs for safe logging
 * Masks upload secrets, tokens in paths, and sensitive query parameters
 */
function redactUrlForLogging(url: string, redactQuery?: boolean): string {
  try {
    const parsed = new URL(url);
    if (redactQuery) parsed.search = '';

    // Redact URL userinfo (user:pass@host)
    if (parsed.username) parsed.username = '[REDACTED]';
    if (parsed.password) parsed.password = '[REDACTED]';

    // Redact upload secrets in path: /uploads/<secret>/<filename> -> /uploads/[REDACTED]/<filename>
    // Secret can be any string (not just hex), so match any path segment after /uploads/
    parsed.pathname = parsed.pathname.replace(/\/uploads\/([^/]+)\//gi, '/uploads/[REDACTED]/');

    // Redact any path segment that looks like a secret/token (32+ hex chars)
    // Match both mid-path (/token/) and end-of-path (/token) tokens
    parsed.pathname = parsed.pathname.replace(/\/([a-f0-9]{32,})(\/|$)/gi, '/[REDACTED]$2');

    // Redact sensitive query parameters
    const sensitiveParams = [
      'private_token',
      'access_token',
      'oauth_token',
      'token',
      'secret',
      'key',
      'password',
      'auth',
    ];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return a safe fallback
    // Extract only scheme and host, excluding any userinfo (user:pass@)
    const schemeMatch = url.match(/^(https?):\/\//);
    if (!schemeMatch) return '[INVALID_URL]';

    // Remove userinfo if present and extract host
    const afterScheme = url.slice(schemeMatch[0].length);
    const atIndex = afterScheme.indexOf('@');
    const hostPart = atIndex >= 0 ? afterScheme.slice(atIndex + 1) : afterScheme;
    const hostMatch = hostPart.match(/^([^/:]+)/);

    return hostMatch ? `${schemeMatch[1]}://[REDACTED_HOST]/[URL_PARSE_ERROR]` : '[INVALID_URL]';
  }
}

/**
 * Determine if an error is retryable
 * Retryable errors: internal timeouts, network errors
 * NOT retryable: caller-initiated aborts (AbortError from caller signal)
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Caller-initiated AbortErrors are NOT retryable
  if (error.name === 'AbortError') {
    return false;
  }

  // Internal timeout errors (thrown as GitLabTimeoutError by doFetch) are retryable
  if (error instanceof GitLabTimeoutError) {
    return true;
  }

  // undici.fetch() wraps errors in TypeError('fetch failed') with the real error as .cause.
  // Unwrap one level to check the underlying error message for retryable network conditions.
  const underlying = error.cause instanceof Error ? error.cause : error;
  const message = underlying.message.toLowerCase();

  // Check underlying for timeout (in case undici wraps GitLabTimeoutError)
  if (underlying instanceof GitLabTimeoutError) {
    return true;
  }

  // Network errors (fetch failures) are retryable
  if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network')
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

/** Adapt undecoded download bytes without redirects or content inflation. */
export async function requestUndecoded(
  url: string,
  headers: Record<string, string>,
  signal: RequestInit['signal'],
  dispatcher?: unknown,
): Promise<Response> {
  const raw = await undici.request(url, {
    method: 'GET',
    headers,
    signal,
    dispatcher: dispatcher as import('undici').Dispatcher | undefined,
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
    highWaterMark: 16 * 1024,
  });
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(raw.headers)) {
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
    else if (value !== undefined) responseHeaders.set(name, value);
  }
  const noBody = [204, 205, 304].includes(raw.statusCode);
  if (noBody) raw.body.destroy();
  return new Response(
    noBody
      ? null
      : (Readable.toWeb(raw.body, {
          strategy: { highWaterMark: 16 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
        }) as ReadableStream<Uint8Array>),
    {
      status: raw.statusCode,
      statusText: STATUS_CODES[raw.statusCode],
      headers: responseHeaders,
    },
  );
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
  instanceDispatcher?: unknown,
  skipAuth = false,
  rawBody?: boolean,
  redactQuery?: boolean,
): Promise<Response> {
  // skipAuth controls auto-injected credentials only:
  //   - Suppresses getAuthHeaders() (OAuth Bearer / static PRIVATE-TOKEN from env)
  //   - Suppresses loadCookieHeader() (cookie file auth)
  // Caller-supplied headers in options.headers are NEVER stripped — they are merged
  // after the skipAuth guard and always reach the server. This allows callers like
  // testConnection() to pass explicit PRIVATE-TOKEN while still blocking ambient
  // credentials from leaking into the request.
  const dispatcher = instanceDispatcher ?? getDispatcher();
  const cookieHeader = skipAuth ? null : loadCookieHeader();

  // For FormData, don't set Content-Type - let fetch set it with proper boundary.
  // Duck-type check covers both global FormData and undici.FormData.
  const isFormData =
    options.body != null &&
    typeof options.body === 'object' &&
    typeof (options.body as unknown as Record<string, unknown>).append === 'function' &&
    typeof (options.body as unknown as Record<string, unknown>).getAll === 'function';
  const baseHeaders = isFormData
    ? { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Accept: DEFAULT_HEADERS.Accept }
    : { ...DEFAULT_HEADERS };

  // Use Headers API for case-insensitive merge. This prevents duplicate auth
  // headers when caller uses different casing (e.g., 'authorization' vs 'Authorization').
  // Merge order: base → ambient auth (if !skipAuth) → caller headers (wins).
  const h = new Headers(baseHeaders);

  if (!skipAuth) {
    for (const [key, value] of Object.entries(getAuthHeaders(url))) {
      h.set(key, value);
    }
  }

  if (options.headers) {
    // Normalize all header formats to Headers, then merge (caller wins)
    new Headers(options.headers).forEach((value, key) => {
      h.set(key, value);
    });
  }

  // Only inject cookie-file auth if caller didn't supply their own Cookie header
  if (cookieHeader && !h.has('cookie')) {
    h.set('Cookie', cookieHeader);
  }

  // Convert back to plain object for fetch options
  const headers: Record<string, string> = {};
  h.forEach((value, key) => {
    headers[key] = value;
  });

  const method = (options.method ?? 'GET').toUpperCase();

  // Debug log at request start (redact sensitive URL parts)
  const safeUrl = redactUrlForLogging(url, redactQuery);
  logDebug('Starting GitLab API request', { url: safeUrl, method });

  // No manual AbortController timeout — Undici handles connect/headers/body timeouts natively.
  // Only pass through caller-provided signal for external abort support.
  const fetchOptions: Record<string, unknown> = {
    ...options,
    headers,
    signal: options.signal,
  };

  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  const startTime = Date.now();
  const requestTracker = getRequestTracker();
  if (rawBody && (method !== 'GET' || options.body != null)) {
    throw new Error('Undecoded downloads require GET without a request body');
  }

  try {
    let response: Response;
    if (rawBody) {
      response = await requestUndecoded(url, headers, options.signal, dispatcher);
    } else {
      response = await undici.fetch(url, fetchOptions);
    }

    const duration = Date.now() - startTime;
    logDebug('GitLab API request completed', {
      url: safeUrl,
      method,
      status: response.status,
      duration,
    });

    // Capture GitLab response for access logging
    requestTracker.setGitLabResponseForCurrentRequest(response.status, duration);

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Caller-initiated AbortError — re-throw as-is
    if (error instanceof Error && error.name === 'AbortError') {
      logDebug('GitLab API request aborted by caller', {
        url: safeUrl,
        method,
        duration,
      });
      throw error;
    }

    // Map Undici native timeout errors to structured timeout messages.
    // undici.fetch() wraps timeout errors in TypeError('fetch failed') with the
    // real timeout error as .cause — unwrap before checking constructor name.
    if (error instanceof Error) {
      const underlying = error.cause instanceof Error ? error.cause : error;
      const diagnosticCause = redactQuery ? undefined : underlying;
      const errName = underlying.constructor?.name ?? '';
      const msg = underlying.message.toLowerCase();

      if (errName === 'HeadersTimeoutError' || msg.includes('headers timeout')) {
        logWarn('GitLab API headers timeout', {
          url: safeUrl,
          method,
          timeout: HEADERS_TIMEOUT_MS,
          duration,
        });
        requestTracker.setGitLabResponseForCurrentRequest('timeout', duration);
        throw new GitLabTimeoutError('headers', HEADERS_TIMEOUT_MS, diagnosticCause);
      }
      if (errName === 'BodyTimeoutError' || msg.includes('body timeout')) {
        logWarn('GitLab API body timeout', {
          url: safeUrl,
          method,
          timeout: BODY_TIMEOUT_MS,
          duration,
        });
        requestTracker.setGitLabResponseForCurrentRequest('timeout', duration);
        throw new GitLabTimeoutError('body', BODY_TIMEOUT_MS, diagnosticCause);
      }
      if (errName === 'ConnectTimeoutError' || msg.includes('connect timeout')) {
        logWarn('GitLab API connect timeout', {
          url: safeUrl,
          method,
          timeout: CONNECT_TIMEOUT_MS,
          duration,
        });
        requestTracker.setGitLabResponseForCurrentRequest('timeout', duration);
        throw new GitLabTimeoutError('connect', CONNECT_TIMEOUT_MS, diagnosticCause);
      }
    }

    let reportedError = error;
    if (redactQuery) {
      // Transport errors can retain signed URLs in their message and arbitrary properties.
      const underlying =
        error instanceof Error && error.cause instanceof Error ? error.cause : error;
      const code = (underlying as NodeJS.ErrnoException | null)?.code;
      const detail = typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : '';
      reportedError = new Error(
        `Artifact download ${isRetryableError(error) ? 'network ' : ''}request failed${detail}`,
      );
    }
    // Preserve full diagnostics only for requests without signed query redaction.
    logWarn('GitLab API request failed', {
      url: safeUrl,
      method,
      err: reportedError instanceof Error ? reportedError : new Error(String(reportedError)),
      duration,
    });

    // Capture error for access logging
    requestTracker.setGitLabResponseForCurrentRequest('error', duration);

    throw reportedError;
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

    let basePath = parsed.pathname || '/';

    // Strip known GitLab API suffixes while preserving any leading subpath.
    // Handles suffix in MIDDLE of path (e.g., /gitlab/api/v4/projects → /gitlab).
    // endsWith() won't work here — suffix may not be at end of URL.
    //
    // Nested loop skips partial matches (e.g., /api/v4foo/real/api/v4).
    // indexOf finds candidates, inner while verifies complete segment match.
    //
    // Performance: O(n*m) where n=path length, m=2 suffixes. Acceptable for
    // short paths (~100 chars), runs once per request. Correctness > speed.
    const apiSuffixes = ['/api/v4', '/api/graphql'];
    outerLoop: for (const suffix of apiSuffixes) {
      let searchPos = 0;
      while (searchPos < basePath.length) {
        const suffixIndex = basePath.indexOf(suffix, searchPos);
        if (suffixIndex === -1) break;

        // Verify the match is a complete segment (not partial like /api/v4foo)
        const afterSuffix = basePath.charAt(suffixIndex + suffix.length);
        if (afterSuffix === '' || afterSuffix === '/') {
          // Found complete API suffix — immediately exit both loops via labeled break.
          // Inner while only continues for PARTIAL matches (e.g., /api/v4foo).
          basePath = suffixIndex === 0 ? '/' : basePath.slice(0, suffixIndex);
          break outerLoop;
        }
        // Continue searching after this partial match
        searchPos = suffixIndex + 1;
      }
    }

    // Normalize path: ensure leading slash and remove trailing slash (except root).
    if (!basePath.startsWith('/')) {
      basePath = `/${basePath}`;
    }
    if (basePath.length > 1 && basePath.endsWith('/')) {
      basePath = basePath.slice(0, -1);
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    return basePath === '/' ? origin : `${origin}${basePath}`;
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
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  assertSafeApiUrl(url);
  const method = (options.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const safeUrl = redactUrlForLogging(url, options.redactQuery);

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
    skipAuth: _skipAuth,
    rawBody: _rawBody,
    redactQuery: _redactQuery,
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

    // Log pool pressure when requests are queuing inside Undici
    if (
      instanceDispatcher &&
      typeof instanceDispatcher === 'object' &&
      'stats' in instanceDispatcher
    ) {
      const stats = (
        instanceDispatcher as { stats: { queued: number; running: number; size: number } }
      ).stats;
      if (stats.queued > 0) {
        logWarn('Connection pool pressure: requests queuing', {
          queued: stats.queued,
          running: stats.running,
          size: stats.size,
          url: safeUrl,
        });
      }
    }

    if (shouldRateLimit) {
      // acquireSlot throws if rate limit exceeded - let it propagate
      //
      // NOTE: Slot is held for the entire retry loop including backoff sleeps.
      // This is intentional: during 429/retry scenarios, keeping the slot prevents
      // new requests from being queued while we're already at the rate limit.
      // Trade-off: slightly reduced throughput under retry conditions, but better
      // protection against overwhelming the GitLab instance with concurrent retries.
      // Alternative (release during backoff) risks thundering herd when retries complete.
      releaseSlot = await registry.acquireSlot(baseUrl);
    }
  }

  try {
    // If retry is disabled, just do a single fetch
    const unauthenticated = _skipAuth === true;
    if (!shouldRetry || maxRetries <= 0) {
      return await doFetch(
        url,
        fetchOptions,
        instanceDispatcher,
        unauthenticated,
        _rawBody,
        _redactQuery,
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await doFetch(
          url,
          fetchOptions,
          instanceDispatcher,
          unauthenticated,
          _rawBody,
          _redactQuery,
        );

        // Check if response status is retryable (5xx, 429)
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          // For 429, check Retry-After header (supports delta-seconds and HTTP-date)
          let retryDelay = calculateBackoffDelay(attempt);
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter && response.status === 429) {
            const parsedSeconds = parseRetryAfterSeconds(retryAfter, Date.now());
            if (parsedSeconds !== null) {
              // Cap Retry-After to max delay to prevent excessive waits
              retryDelay = Math.min(parsedSeconds * 1000, API_RETRY_MAX_DELAY_MS);
            }
          }

          logWarn('Retrying request after server error', {
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

          logWarn('Retrying request after error', {
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
    throw lastError ?? new Error('Unexpected: retry loop exited without result');
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
