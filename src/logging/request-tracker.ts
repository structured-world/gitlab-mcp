/**
 * Request Tracker
 *
 * Implements request stack aggregation pattern: collect all events during a request
 * lifecycle and output a single condensed log line when the request completes.
 *
 * Lifecycle:
 * 1. Request arrives -> openStack() -> Record start time, client info
 * 2. Events during request -> setTool(), setGitLabResponse(), addDetail()
 * 3. Request completes -> closeStack() -> Calculate duration, output log
 *
 * Stack closes on: success response, error, or disconnect/timeout
 *
 * Request Context:
 * Uses AsyncLocalStorage to track current requestId across async operations.
 * This allows setTool/setGitLabResponse/addDetail to work without explicit requestId.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { RequestStack } from "./types.js";
import { formatAccessLog, createAccessLogEntry } from "./access-log.js";
import { logger } from "../logger.js";

/**
 * Request context stored in AsyncLocalStorage
 */
export interface RequestContext {
  requestId: string;
}

/**
 * AsyncLocalStorage for request context
 * Allows tracking of current request across async operations
 */
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get current request ID from async context
 */
export function getCurrentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Run a function with request context
 */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

/**
 * Run an async function with request context
 */
export async function runWithRequestContextAsync<T>(
  requestId: string,
  fn: () => Promise<T>
): Promise<T> {
  return requestContext.run({ requestId }, fn);
}

/**
 * Request tracker manages request stacks for concurrent requests.
 *
 * Uses requestId as key to track multiple concurrent requests (especially in HTTP mode).
 * Each request gets its own stack that accumulates events until completion.
 */
export class RequestTracker {
  private stacks: Map<string, RequestStack> = new Map();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Check if condensed logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable condensed logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Open a new request stack when request arrives
   *
   * @param requestId - Unique identifier for this request
   * @param clientIp - Client IP address
   * @param method - HTTP method
   * @param path - Request path
   * @param sessionId - Optional session ID (MCP or OAuth)
   */
  openStack(
    requestId: string,
    clientIp: string,
    method: string,
    path: string,
    sessionId?: string
  ): void {
    if (!this.enabled) return;

    const stack: RequestStack = {
      startTime: Date.now(),
      clientIp,
      method,
      path,
      sessionId,
      details: {},
    };

    this.stacks.set(requestId, stack);

    logger.debug({ requestId, clientIp, method, path }, "Request stack opened");
  }

  /**
   * Get the current stack for a request
   */
  getStack(requestId: string): RequestStack | undefined {
    return this.stacks.get(requestId);
  }

  /**
   * Set tool name and action for the request
   */
  setTool(requestId: string, tool: string, action?: string): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.tool = tool;
    if (action) {
      stack.action = action;
    }

    logger.debug({ requestId, tool, action }, "Tool set on request stack");
  }

  /**
   * Set GitLab API response information
   */
  setGitLabResponse(
    requestId: string,
    status: number | "timeout" | "error",
    durationMs?: number
  ): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.gitlabStatus = status;
    if (durationMs !== undefined) {
      stack.gitlabDuration = durationMs;
    }

    logger.debug(
      { requestId, gitlabStatus: status, gitlabDuration: durationMs },
      "GitLab response set on request stack"
    );
  }

  /**
   * Add a detail key-value pair to the request
   */
  addDetail(requestId: string, key: string, value: string | number | boolean): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.details[key] = value;
  }

  /**
   * Add multiple details at once
   */
  addDetails(requestId: string, details: Record<string, string | number | boolean>): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    Object.assign(stack.details, details);
  }

  /**
   * Set error on the request
   */
  setError(requestId: string, error: string): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.error = error;
    stack.details.err = error;
  }

  /**
   * Set context path on the request
   */
  setContext(requestId: string, context: string): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.context = context;
  }

  /**
   * Set read-only mode flag on the request
   */
  setReadOnly(requestId: string, readOnly: boolean): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.readOnly = readOnly;
  }

  /**
   * Update session ID on the request
   * Used when session ID is assigned after request stack is opened
   */
  setSessionId(requestId: string, sessionId: string): void {
    const stack = this.stacks.get(requestId);
    if (!stack) return;

    stack.sessionId = sessionId;
  }

  /**
   * Close the request stack and output access log
   *
   * @param requestId - Request identifier
   * @param status - HTTP response status code
   * @returns The formatted access log line (for testing) or undefined if disabled/not found
   */
  closeStack(requestId: string, status: number): string | undefined {
    const stack = this.stacks.get(requestId);
    if (!stack) {
      logger.debug({ requestId }, "Request stack not found on close");
      return undefined;
    }

    // Remove from map first to prevent duplicate closes
    this.stacks.delete(requestId);

    // Set final status
    stack.status = status;

    if (!this.enabled) {
      return undefined;
    }

    // Format and log the access entry
    const entry = createAccessLogEntry(stack);
    const logLine = formatAccessLog(entry);

    // Output the condensed access log at info level
    // The formatted line is logged as a single structured field for machine parsing
    logger.info({ accessLog: entry }, logLine);

    return logLine;
  }

  /**
   * Close stack due to error without a final status
   * Used when connection is lost before response is sent
   */
  closeStackWithError(requestId: string, error: string): string | undefined {
    const stack = this.stacks.get(requestId);
    if (!stack) return undefined;

    stack.error = error;
    stack.details.err = error;

    return this.closeStack(requestId, 0);
  }

  /**
   * Check if a stack exists for a request
   */
  hasStack(requestId: string): boolean {
    return this.stacks.has(requestId);
  }

  /**
   * Get current number of open stacks (for diagnostics)
   */
  getOpenStackCount(): number {
    return this.stacks.size;
  }

  /**
   * Clear all stacks (for testing or shutdown)
   */
  clear(): void {
    this.stacks.clear();
  }

  // ============================================================================
  // Context-aware methods (use current request from AsyncLocalStorage)
  // ============================================================================

  /**
   * Set tool for current request (context-aware)
   * Uses AsyncLocalStorage to get current requestId
   */
  setToolForCurrentRequest(tool: string, action?: string): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setTool(requestId, tool, action);
    }
  }

  /**
   * Set GitLab response for current request (context-aware)
   */
  setGitLabResponseForCurrentRequest(
    status: number | "timeout" | "error",
    durationMs?: number
  ): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setGitLabResponse(requestId, status, durationMs);
    }
  }

  /**
   * Add detail for current request (context-aware)
   */
  addDetailForCurrentRequest(key: string, value: string | number | boolean): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.addDetail(requestId, key, value);
    }
  }

  /**
   * Add multiple details for current request (context-aware)
   */
  addDetailsForCurrentRequest(details: Record<string, string | number | boolean>): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.addDetails(requestId, details);
    }
  }

  /**
   * Set error for current request (context-aware)
   */
  setErrorForCurrentRequest(error: string): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setError(requestId, error);
    }
  }

  /**
   * Set context for current request (context-aware)
   */
  setContextForCurrentRequest(context: string): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setContext(requestId, context);
    }
  }

  /**
   * Set read-only for current request (context-aware)
   */
  setReadOnlyForCurrentRequest(readOnly: boolean): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setReadOnly(requestId, readOnly);
    }
  }

  /**
   * Set session ID for current request (context-aware)
   */
  setSessionIdForCurrentRequest(sessionId: string): void {
    const requestId = getCurrentRequestId();
    if (requestId) {
      this.setSessionId(requestId, sessionId);
    }
  }
}

/**
 * Singleton instance of RequestTracker
 *
 * Used throughout the application to track requests.
 * Enable/disable via setEnabled() based on LOG_FORMAT config.
 */
let globalTracker: RequestTracker | null = null;

/**
 * Get the global RequestTracker instance
 */
export function getRequestTracker(): RequestTracker {
  globalTracker ??= new RequestTracker();
  return globalTracker;
}

/**
 * Reset the global tracker (for testing)
 */
export function resetRequestTracker(): void {
  globalTracker = null;
}
