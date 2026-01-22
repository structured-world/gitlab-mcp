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
import { logger } from "../logger";
import {
  SKIP_TLS_VERIFY,
  GITLAB_AUTH_COOKIE_PATH,
  GITLAB_CA_CERT_PATH,
  HTTP_PROXY,
  HTTPS_PROXY,
  NODE_TLS_REJECT_UNAUTHORIZED,
  GITLAB_TOKEN,
  API_TIMEOUT_MS,
  API_RETRY_ENABLED,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_BASE_DELAY_MS,
  API_RETRY_MAX_DELAY_MS,
} from "../config";
import { isOAuthEnabled, getTokenContext } from "../oauth/index";

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
    logger.warn({ err: error }, "Failed to load GitLab authentication cookies");
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
    logger.info(`Custom CA certificate loaded from ${GITLAB_CA_CERT_PATH}`);
    return ca;
  } catch (error: unknown) {
    logger.error({ err: error }, `Failed to load CA certificate from ${GITLAB_CA_CERT_PATH}`);
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
      logger.warn("TLS certificate verification disabled via SKIP_TLS_VERIFY");
    }
    if (NODE_TLS_REJECT_UNAUTHORIZED === "0") {
      logger.warn("TLS certificate verification disabled via NODE_TLS_REJECT_UNAUTHORIZED");
    }
  }

  const ca = loadCACertificate();
  if (ca) {
    tlsOptions.ca = ca;
  }

  const hasTlsConfig = Object.keys(tlsOptions).length > 0;

  // SOCKS proxy not supported with native fetch
  if (proxyUrl && isSocksProxy(proxyUrl)) {
    logger.info(`Using SOCKS proxy: ${proxyUrl}`);
    logger.warn("SOCKS proxy not supported with native fetch. Consider HTTP/HTTPS proxy.");
    return undefined;
  }

  // HTTP/HTTPS proxy
  if (proxyUrl) {
    logger.info(`Using proxy: ${proxyUrl}`);
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
      logger.warn("OAuth mode: no token context available - API call will fail with 401");
    } else if (!context.gitlabToken) {
      logger.warn("OAuth mode: token context exists but no gitlabToken set");
    } else {
      logger.debug({ userId: context.gitlabUserId }, "OAuth mode: using token from context");
    }
    return context?.gitlabToken;
  }
  return GITLAB_TOKEN;
}

export function getAuthorizationHeader(): string | undefined {
  const token = getGitLabToken();
  return token ? `Bearer ${token}` : undefined;
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
  /** Enable retry for this request (default: false for non-GET, true for GET) */
  retry?: boolean;
  /** Maximum number of retry attempts (default: from config) */
  maxRetries?: number;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine if an error is retryable
 * Retryable errors: timeouts, network errors, 5xx server errors
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Timeout errors are retryable
  if (error.message.includes("timeout") || error.name === "AbortError") {
    return true;
  }

  // Network errors (fetch failures) are retryable
  if (
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("ETIMEDOUT") ||
    error.message.includes("ENOTFOUND") ||
    error.message.includes("network")
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
 * Perform a single fetch request with timeout
 * Internal function used by enhancedFetch
 */
async function doFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const dispatcher = getDispatcher();
  const cookieHeader = loadCookieHeader();

  // For FormData, don't set Content-Type - let fetch set it with proper boundary
  const isFormData = options.body instanceof FormData;
  const baseHeaders = isFormData
    ? { "User-Agent": DEFAULT_HEADERS["User-Agent"], Accept: DEFAULT_HEADERS.Accept }
    : { ...DEFAULT_HEADERS };

  const headers: Record<string, string> = { ...baseHeaders };

  const authHeader = getAuthorizationHeader();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

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

  // Debug log at request start
  logger.debug({ url, method, timeout: API_TIMEOUT_MS }, "Starting GitLab API request");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const fetchOptions: Record<string, unknown> = {
    ...options,
    headers,
    signal: controller.signal,
  };

  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  const startTime = Date.now();
  try {
    const response = await fetch(url, fetchOptions as RequestInit);
    clearTimeout(timeoutId);

    const duration = Date.now() - startTime;
    logger.debug(
      { url, method, status: response.status, duration },
      "GitLab API request completed"
    );

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (error instanceof Error && error.name === "AbortError") {
      // Log timeout with context
      logger.warn(
        { url, method, timeout: API_TIMEOUT_MS, duration },
        "GitLab API request timed out"
      );
      throw new Error(`GitLab API timeout after ${API_TIMEOUT_MS}ms`);
    }

    // Log other errors
    logger.warn(
      { url, method, error: error instanceof Error ? error.message : String(error), duration },
      "GitLab API request failed"
    );
    throw error;
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
 * - GET requests retry by default (idempotent)
 * - POST/PUT/DELETE do NOT retry by default (not idempotent)
 * - Override with options.retry = true/false
 * - Retries on: timeouts, network errors, 5xx responses
 * - Uses exponential backoff: 1s, 2s, 4s (configurable)
 */
export async function enhancedFetch(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS";

  // Determine if retry is enabled for this request
  const shouldRetry = options.retry ?? (API_RETRY_ENABLED && isIdempotent);
  const maxRetries = options.maxRetries ?? API_RETRY_MAX_ATTEMPTS;

  // Extract retry options from fetch options to pass clean options to doFetch
  const { retry: _retry, maxRetries: _maxRetries, ...fetchOptions } = options;

  // If retry is disabled, just do a single fetch
  if (!shouldRetry || maxRetries <= 0) {
    return doFetch(url, fetchOptions);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await doFetch(url, fetchOptions);

      // Check if response status is retryable (5xx, 429)
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        // For 429, check Retry-After header
        let retryDelay = calculateBackoffDelay(attempt);
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter && response.status === 429) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            retryDelay = retryAfterSeconds * 1000;
          }
        }

        logger.warn(
          {
            url,
            method,
            status: response.status,
            attempt: attempt + 1,
            maxRetries,
            retryDelay,
          },
          "Retrying request after server error"
        );

        // Cancel response body to release connection before retry
        await response.body?.cancel();

        await sleep(retryDelay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable and we have attempts left
      if (isRetryableError(error) && attempt < maxRetries) {
        const retryDelay = calculateBackoffDelay(attempt);

        logger.warn(
          {
            url,
            method,
            error: lastError.message,
            attempt: attempt + 1,
            maxRetries,
            retryDelay,
          },
          "Retrying request after error"
        );

        await sleep(retryDelay);
        continue;
      }

      // Not retryable or no attempts left
      throw lastError;
    }
  }

  /* istanbul ignore next -- unreachable: loop always exits via return or throw */
  throw lastError ?? new Error("Unexpected: retry loop exited without result");
}

export function resetDispatcherCache(): void {
  cachedDispatcher = undefined;
  dispatcherInitialized = false;
}
