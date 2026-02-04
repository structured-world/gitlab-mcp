/**
 * Instance Registry Service
 *
 * Singleton managing multiple GitLab instances with:
 * - Per-instance rate limiting
 * - Per-instance introspection caching
 * - Connection health tracking
 * - Instance registration and lookup
 *
 * This is the central point for multi-instance support, providing
 * a unified interface to access GitLab instances regardless of configuration source.
 */

import { logInfo, logWarn, logDebug } from "../logger.js";
import {
  InstanceRateLimiter,
  RateLimiterConfig,
  RateLimitMetrics,
  DEFAULT_RATE_LIMIT_CONFIG,
} from "./InstanceRateLimiter.js";
import {
  GitLabInstanceConfig,
  GitLabInstanceState,
  ConnectionStatus,
  CachedIntrospection,
} from "../config/instances-schema.js";
import { loadInstancesConfig, LoadedInstancesConfig } from "../config/instances-loader.js";
import { InstanceConnectionPool, PoolStats } from "./InstanceConnectionPool.js";
import { GraphQLClient } from "../graphql/client.js";

/**
 * Instance registry entry combining config, state, and rate limiter
 */
interface RegistryEntry {
  config: GitLabInstanceConfig;
  state: GitLabInstanceState;
  rateLimiter: InstanceRateLimiter;
}

/**
 * Instance summary for listing
 */
export interface InstanceSummary {
  url: string;
  label: string | undefined;
  connectionStatus: ConnectionStatus;
  lastHealthCheck: Date | null;
  hasOAuth: boolean;
  rateLimit: RateLimitMetrics;
  introspection: {
    version: string | null;
    tier: string | null;
    cachedAt: Date | null;
    /** Whether the cached introspection data has expired (TTL: 10 min) */
    isExpired: boolean;
  };
}

/**
 * Introspection cache TTL (10 minutes)
 */
const INTROSPECTION_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Singleton registry managing all GitLab instances
 */
export class InstanceRegistry {
  private static instance: InstanceRegistry | null = null;

  private instances = new Map<string, RegistryEntry>();
  private configSource: LoadedInstancesConfig["source"] = "none";
  private configSourceDetails = "";
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): InstanceRegistry {
    InstanceRegistry.instance ??= new InstanceRegistry();
    return InstanceRegistry.instance;
  }

  /**
   * Initialize registry from configuration
   * Should be called once at startup
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logDebug("InstanceRegistry already initialized, skipping");
      return;
    }

    const config = await loadInstancesConfig();
    this.configSource = config.source;
    this.configSourceDetails = config.sourceDetails;

    for (const instanceConfig of config.instances) {
      this.register(instanceConfig);
    }

    this.initialized = true;

    logInfo("InstanceRegistry initialized", {
      source: this.configSource,
      sourceDetails: this.configSourceDetails,
      instanceCount: this.instances.size,
      instances: Array.from(this.instances.keys()),
    });
  }

  /**
   * Register a GitLab instance
   */
  public register(config: GitLabInstanceConfig): void {
    const normalizedUrl = this.normalizeUrl(config.url);

    if (this.instances.has(normalizedUrl)) {
      logWarn("Instance already registered, updating configuration", {
        url: normalizedUrl,
      });
    }

    // Create rate limiter with instance-specific config or defaults
    const rateLimiterConfig: RateLimiterConfig = config.rateLimit ?? DEFAULT_RATE_LIMIT_CONFIG;

    const rateLimiter = new InstanceRateLimiter(rateLimiterConfig);

    // Create initial state
    const state: GitLabInstanceState = {
      ...config,
      url: normalizedUrl,
      connectionStatus: "healthy",
      lastHealthCheck: null,
      introspectionCache: null,
    };

    this.instances.set(normalizedUrl, {
      config: { ...config, url: normalizedUrl },
      state,
      rateLimiter,
    });

    logDebug("Instance registered", {
      url: normalizedUrl,
      label: config.label,
      hasOAuth: !!config.oauth,
      rateLimit: rateLimiterConfig,
    });
  }

  /**
   * Get instance entry by URL
   */
  public get(baseUrl: string): RegistryEntry | undefined {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    return this.instances.get(normalizedUrl);
  }

  /**
   * Get instance config by URL
   */
  public getConfig(baseUrl: string): GitLabInstanceConfig | undefined {
    return this.get(baseUrl)?.config;
  }

  /**
   * Get instance state by URL
   */
  public getState(baseUrl: string): GitLabInstanceState | undefined {
    return this.get(baseUrl)?.state;
  }

  /**
   * List all registered instances
   */
  public list(): InstanceSummary[] {
    return Array.from(this.instances.values()).map(entry => {
      const cache = entry.state.introspectionCache;
      const isExpired =
        cache !== null && Date.now() - cache.cachedAt.getTime() > INTROSPECTION_CACHE_TTL_MS;

      return {
        url: entry.config.url,
        label: entry.config.label,
        connectionStatus: entry.state.connectionStatus,
        lastHealthCheck: entry.state.lastHealthCheck,
        hasOAuth: !!entry.config.oauth,
        rateLimit: entry.rateLimiter.getMetrics(),
        introspection: {
          version: cache?.version ?? null,
          tier: cache?.tier ?? null,
          cachedAt: cache?.cachedAt ?? null,
          isExpired,
        },
      };
    });
  }

  /**
   * Check if an instance is registered
   */
  public has(baseUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    return this.instances.has(normalizedUrl);
  }

  /**
   * Unregister an instance
   */
  public unregister(baseUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const existed = this.instances.delete(normalizedUrl);

    if (existed) {
      logInfo("Instance unregistered", { url: normalizedUrl });
    }

    return existed;
  }

  /**
   * Get all registered instance URLs
   */
  public getUrls(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Get the first (or default) instance URL
   * Used for backward compatibility when no specific instance is specified
   */
  public getDefaultUrl(): string | undefined {
    const urls = this.getUrls();
    return urls.length > 0 ? urls[0] : undefined;
  }

  /**
   * Acquire a rate limit slot for an instance
   * Returns a release function that MUST be called when request completes
   */
  public async acquireSlot(baseUrl: string): Promise<() => void> {
    const entry = this.get(baseUrl);
    if (!entry) {
      // If instance not registered, allow request without rate limiting.
      // This supports dynamic instances not in config (e.g., non-GitLab URLs via enhancedFetch).
      // Use debug level to avoid noisy logs in normal operation.
      logDebug("Rate limit slot requested for unregistered instance, allowing", {
        url: baseUrl,
      });
      return () => {};
    }

    return entry.rateLimiter.acquire();
  }

  /**
   * Get rate limit metrics for an instance
   */
  public getRateLimitMetrics(baseUrl: string): RateLimitMetrics | undefined {
    return this.get(baseUrl)?.rateLimiter.getMetrics();
  }

  /**
   * Get cached introspection for an instance
   */
  public getIntrospection(baseUrl: string): CachedIntrospection | null {
    const entry = this.get(baseUrl);
    if (!entry) return null;

    const cache = entry.state.introspectionCache;
    if (!cache) return null;

    // Check if cache is still valid
    const age = Date.now() - cache.cachedAt.getTime();
    if (age > INTROSPECTION_CACHE_TTL_MS) {
      logDebug("Introspection cache expired", {
        url: baseUrl,
        ageMs: age,
        ttlMs: INTROSPECTION_CACHE_TTL_MS,
      });
      return null;
    }

    return cache;
  }

  /**
   * Set cached introspection for an instance
   */
  public setIntrospection(baseUrl: string, introspection: CachedIntrospection): void {
    const entry = this.get(baseUrl);
    if (!entry) {
      logWarn("Cannot cache introspection for unregistered instance", { url: baseUrl });
      return;
    }

    entry.state.introspectionCache = introspection;

    logDebug("Introspection cached for instance", {
      url: baseUrl,
      version: introspection.version,
      tier: introspection.tier,
    });
  }

  /**
   * Update connection status for an instance
   */
  public updateConnectionStatus(baseUrl: string, status: ConnectionStatus): void {
    const entry = this.get(baseUrl);
    if (!entry) return;

    entry.state.connectionStatus = status;
    entry.state.lastHealthCheck = new Date();

    logDebug("Instance connection status updated", {
      url: baseUrl,
      status,
    });
  }

  /**
   * Clear introspection cache for an instance (or all instances)
   */
  public clearIntrospectionCache(baseUrl?: string): void {
    if (baseUrl) {
      const entry = this.get(baseUrl);
      if (entry) {
        entry.state.introspectionCache = null;
        logDebug("Introspection cache cleared", { url: baseUrl });
      }
    } else {
      for (const entry of this.instances.values()) {
        entry.state.introspectionCache = null;
      }
      logDebug("All introspection caches cleared");
    }
  }

  /**
   * Get configuration source info
   */
  public getConfigSource(): { source: string; details: string } {
    return {
      source: this.configSource,
      details: this.configSourceDetails,
    };
  }

  /**
   * Check if registry has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get a thread-safe GraphQL client for an instance
   *
   * This is the preferred way to get a GraphQL client for multi-instance setups.
   * Each instance gets its own client with dedicated connection pool, avoiding
   * the singleton endpoint mutation issue.
   *
   * @param baseUrl - Instance base URL
   * @param authHeaders - Optional auth headers (for OAuth per-request tokens)
   * @returns GraphQL client or undefined if instance not registered
   */
  public getGraphQLClient(
    baseUrl: string,
    authHeaders?: Record<string, string>
  ): GraphQLClient | undefined {
    const entry = this.get(baseUrl);
    if (!entry) return undefined;

    const connectionPool = InstanceConnectionPool.getInstance();
    return connectionPool.getGraphQLClient(entry.config, authHeaders);
  }

  /**
   * Get connection pool statistics for all instances
   */
  public getConnectionPoolStats(): PoolStats[] {
    const connectionPool = InstanceConnectionPool.getInstance();
    return connectionPool.getStats();
  }

  /**
   * Get connection pool statistics for a specific instance
   */
  public getInstancePoolStats(baseUrl: string): PoolStats | undefined {
    const connectionPool = InstanceConnectionPool.getInstance();
    return connectionPool.getInstanceStats(baseUrl);
  }

  /**
   * Get the Undici dispatcher (HTTP/2 connection pool) for an instance.
   * Used by enhancedFetch for per-instance connection pooling.
   *
   * Lazily creates the connection pool if the instance is registered but
   * pool doesn't exist yet (e.g., REST-only calls before any GraphQL calls).
   *
   * @param baseUrl - GitLab instance base URL
   * @returns Undici Pool/Dispatcher or undefined if instance not registered
   */
  public getDispatcher(baseUrl: string): unknown {
    const connectionPool = InstanceConnectionPool.getInstance();
    let dispatcher = connectionPool.getDispatcher(baseUrl);

    // Lazily create pool if instance is registered but pool doesn't exist yet
    // This ensures per-instance TLS settings are applied for REST calls
    if (!dispatcher) {
      const normalizedUrl = this.normalizeUrl(baseUrl);
      const entry = this.instances.get(normalizedUrl);
      if (entry) {
        // Creating the GraphQL client also initializes the connection pool
        connectionPool.getGraphQLClient(entry.config);
        dispatcher = connectionPool.getDispatcher(baseUrl);
      }
    }

    return dispatcher;
  }

  /**
   * Reset registry (for testing)
   */
  public reset(): void {
    this.instances.clear();
    this.configSource = "none";
    this.configSourceDetails = "";
    this.initialized = false;
    logDebug("InstanceRegistry reset");
  }

  /**
   * Reset registry and destroy connection pools (for testing)
   */
  public async resetWithPools(): Promise<void> {
    this.reset();
    await InstanceConnectionPool.resetInstance();
    logDebug("InstanceRegistry and connection pools reset");
  }

  /**
   * Normalize URL for consistent lookup
   */
  private normalizeUrl(url: string): string {
    let normalized = url;

    // Remove trailing slash
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    // Remove /api/v4 suffix
    if (normalized.endsWith("/api/v4")) {
      normalized = normalized.slice(0, -7);
    }

    // Remove /api/graphql suffix
    if (normalized.endsWith("/api/graphql")) {
      normalized = normalized.slice(0, -12);
    }

    return normalized;
  }
}
