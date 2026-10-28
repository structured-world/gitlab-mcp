/**
 * Instance Connection Pool
 *
 * Manages per-instance HTTP/2 connection pools with keepalive support.
 * Each GitLab instance gets its own connection pool for:
 * - HTTP/2 multiplexing (multiple requests over single connection)
 * - Connection keepalive (reuse connections across requests)
 * - Per-instance TLS configuration
 * - Thread-safe concurrent access
 *
 * This solves the singleton endpoint mutation problem by providing
 * isolated clients per instance instead of mutating a shared client.
 */

import { GraphQLClient } from '../graphql/client.js';
import { logInfo, logDebug, logWarn } from '../logger.js';
import { GitLabInstanceConfig } from '../config/instances-schema.js';
import { createNetworkDispatcher } from '../utils/network-dispatcher';
import {
  CONNECT_TIMEOUT_MS,
  HEADERS_TIMEOUT_MS,
  BODY_TIMEOUT_MS,
  POOL_MAX_CONNECTIONS,
} from '../config.js';

interface InstanceDispatcher {
  destroy(): Promise<void>;
  stats?: {
    connected: number;
    free: number;
    pending: number;
    queued: number;
    running: number;
    size: number;
  };
}

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  /** Maximum connections per instance */
  maxConnections: number;
  /** Keep-alive timeout in ms (default: 30000) */
  keepAliveTimeout: number;
  /** Maximum keep-alive timeout in ms (default: 300000 = 5 min) */
  keepAliveMaxTimeout: number;
  /** HTTP/1.1 pipelining depth (default: 1 = disabled) */
  pipelining: number;
  /** TCP connect timeout in ms */
  connectTimeout: number;
  /** Response headers timeout in ms */
  headersTimeout: number;
  /** Response body timeout in ms */
  bodyTimeout: number;
}

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: POOL_MAX_CONNECTIONS,
  keepAliveTimeout: 30000, // 30 seconds
  keepAliveMaxTimeout: 300000, // 5 minutes
  pipelining: 1, // Disabled by default (safer)
  connectTimeout: CONNECT_TIMEOUT_MS,
  headersTimeout: HEADERS_TIMEOUT_MS,
  bodyTimeout: BODY_TIMEOUT_MS,
};

/**
 * Per-instance connection entry
 */
interface ConnectionEntry {
  /** Per-instance direct Pool or environment proxy dispatcher. */
  pool: InstanceDispatcher;
  /** GraphQL client using this pool */
  graphqlClient: GraphQLClient;
  /** GraphQL endpoint URL */
  graphqlEndpoint: string;
  /** Instance base URL */
  baseUrl: string;
  /** TLS skip verify setting */
  insecureSkipVerify: boolean;
  /** Created timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsedAt: Date;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  baseUrl: string;
  graphqlEndpoint: string;
  connected: number;
  free: number;
  pending: number;
  queued: number;
  running: number;
  size: number;
  createdAt: Date;
  lastUsedAt: Date;
}

/**
 * Singleton managing per-instance connection pools
 */
export class InstanceConnectionPool {
  private static instance: InstanceConnectionPool | null = null;

  private pools = new Map<string, ConnectionEntry>();
  private config: ConnectionPoolConfig;

  private constructor(config?: Partial<ConnectionPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ConnectionPoolConfig>): InstanceConnectionPool {
    InstanceConnectionPool.instance ??= new InstanceConnectionPool(config);
    return InstanceConnectionPool.instance;
  }

  /**
   * Get or create a GraphQL client for an instance
   *
   * This is the primary method for getting a thread-safe GraphQL client
   * that doesn't require endpoint mutation.
   */
  public getGraphQLClient(
    instanceConfig: GitLabInstanceConfig,
    authHeaders?: Record<string, string>,
  ): GraphQLClient {
    const entry = this.getOrCreateEntry(instanceConfig);
    entry.lastUsedAt = new Date();

    // If no auth headers are provided, return the shared per-instance client directly.
    if (!authHeaders) {
      return entry.graphqlClient;
    }

    // When auth headers are provided, avoid mutating the shared client's default headers,
    // which could cause cross-session header leakage. Instead, return a lightweight proxy
    // that injects these headers into each request while delegating all other behavior
    // to the underlying pooled client.
    const baseClient = entry.graphqlClient;
    type RequestFn = (...fnArgs: unknown[]) => unknown;
    const clientWithAuth = new Proxy(baseClient, {
      get(target, prop: string | symbol, receiver): unknown {
        if (prop === 'request' || prop === 'rawRequest') {
          const original = (target as unknown as Record<string, unknown>)[prop];
          if (typeof original !== 'function') {
            return Reflect.get(target, prop, receiver) as unknown;
          }
          return (...args: unknown[]): unknown => {
            // graphql-request style: request(document, variables?, requestHeaders?)
            // Args: [doc] | [doc, vars] | [doc, vars, headers]
            const extraHeaders = authHeaders ?? {};
            if (Object.keys(extraHeaders).length === 0) {
              return (original as RequestFn).apply(target, args);
            }
            const adjustedArgs = [...args];

            // Only merge if 3+ args (last arg is requestHeaders)
            // For 1-2 args, append headers as new argument
            if (args.length >= 3) {
              const lastArg = adjustedArgs[adjustedArgs.length - 1];
              if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg)) {
                // Merge into existing request headers
                adjustedArgs[adjustedArgs.length - 1] = {
                  ...(lastArg as Record<string, string>),
                  ...extraHeaders,
                };
                return (original as RequestFn).apply(target, adjustedArgs);
              }
            }
            // Append headers as new argument
            adjustedArgs.push(extraHeaders);
            return (original as RequestFn).apply(target, adjustedArgs);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    return clientWithAuth;
  }

  /**
   * Get an instance's Undici dispatcher for enhancedFetch.
   *
   * Returns undefined if instance is not yet initialized - caller should
   * use default global dispatcher in that case.
   */
  public getDispatcher(baseUrl: string): InstanceDispatcher | undefined {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const entry = this.pools.get(normalizedUrl);

    if (entry) {
      entry.lastUsedAt = new Date();
    }

    return entry?.pool;
  }

  /**
   * Get statistics for dispatchers exposing Pool counters; proxy agents expose none.
   */
  public getStats(): PoolStats[] {
    const results: PoolStats[] = [];
    for (const entry of this.pools.values()) {
      const stats = entry.pool.stats;
      if (!stats) continue;
      results.push({
        baseUrl: entry.baseUrl,
        graphqlEndpoint: entry.graphqlEndpoint,
        ...stats,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
      });
    }
    return results;
  }

  /**
   * Get pool statistics for a specific instance
   */
  public getInstanceStats(baseUrl: string): PoolStats | undefined {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const entry = this.pools.get(normalizedUrl);

    if (!entry?.pool.stats) return undefined;

    return {
      baseUrl: entry.baseUrl,
      graphqlEndpoint: entry.graphqlEndpoint,
      ...entry.pool.stats,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
    };
  }

  /**
   * Destroy a specific instance's pool
   */
  public async destroyPool(baseUrl: string): Promise<void> {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const entry = this.pools.get(normalizedUrl);

    if (entry) {
      await entry.pool.destroy();
      this.pools.delete(normalizedUrl);
      logDebug('Connection pool destroyed', { baseUrl: normalizedUrl });
    }
  }

  /**
   * Destroy all pools (cleanup on shutdown)
   */
  public async destroyAll(): Promise<void> {
    const destroyPromises = Array.from(this.pools.values()).map((entry) => entry.pool.destroy());
    await Promise.all(destroyPromises);
    this.pools.clear();
    logInfo('All connection pools destroyed');
  }

  /**
   * Reset singleton (for testing)
   */
  public static async resetInstance(): Promise<void> {
    if (InstanceConnectionPool.instance) {
      await InstanceConnectionPool.instance.destroyAll();
      InstanceConnectionPool.instance = null;
    }
  }

  /**
   * Get or create connection entry for an instance
   */
  private getOrCreateEntry(instanceConfig: GitLabInstanceConfig): ConnectionEntry {
    const normalizedUrl = this.normalizeUrl(instanceConfig.url);

    let entry = this.pools.get(normalizedUrl);
    if (entry) {
      return entry;
    }

    // Create new pool and client
    entry = this.createEntry(instanceConfig, normalizedUrl);
    this.pools.set(normalizedUrl, entry);

    logInfo('Connection pool created for instance', {
      baseUrl: normalizedUrl,
      maxConnections: this.config.maxConnections,
      keepAliveTimeout: this.config.keepAliveTimeout,
    });

    return entry;
  }

  /**
   * Create a new connection entry
   */
  private createEntry(
    instanceConfig: GitLabInstanceConfig,
    normalizedUrl: string,
  ): ConnectionEntry {
    if (instanceConfig.insecureSkipVerify) {
      logWarn('TLS verification disabled for instance', { url: normalizedUrl });
    }

    // Pools take an origin; retain the GitLab subpath separately for API endpoints.
    const poolOrigin = new URL(normalizedUrl).origin;
    const pool = createNetworkDispatcher({
      origin: poolOrigin,
      insecureSkipVerify: instanceConfig.insecureSkipVerify,
      connections: this.config.maxConnections,
      keepAliveTimeout: this.config.keepAliveTimeout,
      keepAliveMaxTimeout: this.config.keepAliveMaxTimeout,
      pipelining: this.config.pipelining,
      headersTimeout: this.config.headersTimeout,
      bodyTimeout: this.config.bodyTimeout,
      connectTimeout: this.config.connectTimeout,
    }) as InstanceDispatcher;

    // Derive GraphQL endpoint
    const graphqlEndpoint = `${normalizedUrl}/api/graphql`;

    // Create GraphQL client with empty headers (OAuth tokens added per-request)
    const graphqlClient = new GraphQLClient(graphqlEndpoint, {});

    return {
      pool,
      graphqlClient,
      graphqlEndpoint,
      baseUrl: normalizedUrl,
      insecureSkipVerify: instanceConfig.insecureSkipVerify ?? false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
  }

  /**
   * Normalize URL for consistent lookup (matches InstanceRegistry logic)
   */
  private normalizeUrl(url: string): string {
    let normalized = url;

    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // Remove /api/v4 suffix
    if (normalized.endsWith('/api/v4')) {
      normalized = normalized.slice(0, -7);
    }

    // Remove /api/graphql suffix
    if (normalized.endsWith('/api/graphql')) {
      normalized = normalized.slice(0, -12);
    }

    return normalized;
  }
}
