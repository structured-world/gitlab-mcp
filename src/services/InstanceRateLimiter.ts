/**
 * Per-Instance Rate Limiter
 *
 * Provides concurrent request limiting with request queuing for GitLab instances.
 * Each instance can have independent rate limits to prevent overwhelming
 * different GitLab servers with varying capacities.
 *
 * Features:
 * - Configurable max concurrent requests per instance
 * - Request queue with configurable size and timeout
 * - Automatic slot release on request completion or failure
 * - Metrics tracking for monitoring
 */

import { logDebug, logWarn } from "../logger.js";

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum concurrent requests (default: 100) */
  maxConcurrent: number;
  /** Maximum queued requests (default: 500) */
  queueSize: number;
  /** Queue wait timeout in milliseconds (default: 60000) */
  queueTimeout: number;
}

/**
 * Rate limit metrics for monitoring
 */
export interface RateLimitMetrics {
  /** Current number of active requests */
  activeRequests: number;
  /** Maximum concurrent requests allowed */
  maxConcurrent: number;
  /** Current number of queued requests */
  queuedRequests: number;
  /** Maximum queue size */
  queueSize: number;
  /** Total requests processed */
  requestsTotal: number;
  /** Total requests that were queued */
  requestsQueued: number;
  /** Total requests rejected due to full queue */
  requestsRejected: number;
  /** Average queue wait time in milliseconds */
  avgQueueWaitMs: number;
}

/**
 * Queued request entry
 */
interface QueuedRequest {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timeoutId: NodeJS.Timeout;
}

/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  maxConcurrent: 100,
  queueSize: 500,
  queueTimeout: 60000,
};

/**
 * Per-instance rate limiter with request queuing
 */
export class InstanceRateLimiter {
  private readonly config: RateLimiterConfig;
  private activeRequests = 0;
  private queue: QueuedRequest[] = [];

  // Metrics
  private requestsTotal = 0;
  private requestsQueued = 0;
  private requestsRejected = 0;
  private totalQueueWaitMs = 0;
  private queuedRequestsCompleted = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...config,
    };
  }

  /**
   * Acquire a request slot.
   * Returns a release function that MUST be called when the request completes.
   *
   * @throws Error if queue is full or timeout occurs
   * @returns Promise that resolves to a release function
   */
  async acquire(): Promise<() => void> {
    this.requestsTotal++;

    // If under limit, acquire immediately
    if (this.activeRequests < this.config.maxConcurrent) {
      this.activeRequests++;
      logDebug("Rate limiter: slot acquired immediately", {
        active: this.activeRequests,
        max: this.config.maxConcurrent,
      });
      return this.createIdempotentRelease();
    }

    // Check queue capacity
    if (this.queue.length >= this.config.queueSize) {
      this.requestsRejected++;
      throw new Error(
        `Rate limit exceeded: ${this.activeRequests} active, ` +
          `${this.queue.length} queued (max: ${this.config.queueSize})`
      );
    }

    // Add to queue and wait
    this.requestsQueued++;
    logDebug("Rate limiter: request queued", {
      active: this.activeRequests,
      queued: this.queue.length + 1,
      queueSize: this.config.queueSize,
    });

    return new Promise<() => void>((resolve, reject) => {
      const enqueuedAt = Date.now();

      // Timeout handler
      const timeoutId = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.timeoutId === timeoutId);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          logWarn("Rate limiter: request timed out in queue", {
            timeout: this.config.queueTimeout,
            waitedMs: Date.now() - enqueuedAt,
          });
          reject(
            new Error(
              `Request queued for ${this.config.queueTimeout}ms, timing out. ` +
                `Active: ${this.activeRequests}, Queued: ${this.queue.length}`
            )
          );
        }
      }, this.config.queueTimeout);

      const entry: QueuedRequest = {
        resolve,
        reject,
        enqueuedAt,
        timeoutId,
      };

      this.queue.push(entry);
    });
  }

  /**
   * Release a request slot.
   * Called automatically by the release function returned from acquire().
   */
  private release(): void {
    // Bounds check: prevent negative activeRequests in edge cases
    // (e.g., release called after rate limiter reset/destroy)
    this.activeRequests = Math.max(0, this.activeRequests - 1);

    // Process queue
    if (this.queue.length > 0 && this.activeRequests < this.config.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) return; // Type guard - should never happen since we checked length
      clearTimeout(next.timeoutId);

      // Track queue wait time
      const waitMs = Date.now() - next.enqueuedAt;
      this.totalQueueWaitMs += waitMs;
      this.queuedRequestsCompleted++;

      logDebug("Rate limiter: processing queued request", {
        waitMs,
        active: this.activeRequests + 1,
        remainingQueue: this.queue.length,
      });

      this.activeRequests++;
      next.resolve(this.createIdempotentRelease());
    }
  }

  /**
   * Create an idempotent release function that can only be called once.
   * Prevents double-release from corrupting activeRequests counter.
   */
  private createIdempotentRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        logWarn("Rate limiter: release() called multiple times, ignoring");
        return;
      }
      released = true;
      this.release();
    };
  }

  /**
   * Get current rate limit metrics
   */
  getMetrics(): RateLimitMetrics {
    return {
      activeRequests: this.activeRequests,
      maxConcurrent: this.config.maxConcurrent,
      queuedRequests: this.queue.length,
      queueSize: this.config.queueSize,
      requestsTotal: this.requestsTotal,
      requestsQueued: this.requestsQueued,
      requestsRejected: this.requestsRejected,
      avgQueueWaitMs:
        this.queuedRequestsCompleted > 0
          ? Math.round(this.totalQueueWaitMs / this.queuedRequestsCompleted)
          : 0,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<RateLimiterConfig> {
    return { ...this.config };
  }

  /**
   * Check if rate limiter is at capacity (would queue next request)
   */
  isAtCapacity(): boolean {
    return this.activeRequests >= this.config.maxConcurrent;
  }

  /**
   * Check if queue is full (would reject next request)
   */
  isQueueFull(): boolean {
    return this.queue.length >= this.config.queueSize;
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.requestsTotal = 0;
    this.requestsQueued = 0;
    this.requestsRejected = 0;
    this.totalQueueWaitMs = 0;
    this.queuedRequestsCompleted = 0;
  }
}
