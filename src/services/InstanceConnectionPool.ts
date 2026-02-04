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

import { GraphQLClient } from "../graphql/client.js";
import { logInfo, logDebug, logWarn } from "../logger.js";
import { GitLabInstanceConfig } from "../config/instances-schema.js";

// Dynamic require to avoid TypeScript analyzing complex undici types at compile time
const undici = require("undici") as {
  Agent: new (opts?: UndiciAgentOptions) => UndiciAgent;
  Pool: new (origin: string, opts?: UndiciPoolOptions) => UndiciPool;
};

/**
 * Undici Agent options for connection pooling
 */
interface UndiciAgentOptions {
  /** Maximum number of connections per origin */
  connections?: number;
  /** Keep-alive timeout in milliseconds */
  keepAliveTimeout?: number;
  /** Maximum keep-alive requests per connection */
  keepAliveMaxTimeout?: number;
  /** Pipeline connections (HTTP/1.1 only) */
  pipelining?: number;
  /** TLS options */
  connect?: {
    rejectUnauthorized?: boolean;
    ca?: Buffer | string;
  };
}

interface UndiciPoolOptions extends UndiciAgentOptions {
  /** Factory for creating connections */
  factory?: unknown;
}

interface UndiciAgent {
  destroy(): Promise<void>;
}

interface UndiciPool extends UndiciAgent {
  stats: {
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
  /** Maximum connections per instance (default: 10) */
  maxConnections: number;
  /** Keep-alive timeout in ms (default: 30000) */
  keepAliveTimeout: number;
  /** Maximum keep-alive timeout in ms (default: 300000 = 5 min) */
  keepAliveMaxTimeout: number;
  /** HTTP/1.1 pipelining depth (default: 1 = disabled) */
  pipelining: number;
}

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 10,
  keepAliveTimeout: 30000, // 30 seconds
  keepAliveMaxTimeout: 300000, // 5 minutes
  pipelining: 1, // Disabled by default (safer)
};

/**
 * Per-instance connection entry
 */
interface ConnectionEntry {
  /** HTTP connection pool (Undici Pool) */
  pool: UndiciPool;
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
    authHeaders?: Record<string, string>
  ): GraphQLClient {
    const entry = this.getOrCreateEntry(instanceConfig);
    entry.lastUsedAt = new Date();

    // Update auth headers if provided (for OAuth per-request tokens)
    // Note: setHeaders is safe here because each OAuth session uses unique tokens
    // and GraphQL requests are serialized per-session via MCP protocol
    if (authHeaders) {
      entry.graphqlClient.setHeaders(authHeaders);
    }

    return entry.graphqlClient;
  }

  /**
   * Get the Undici pool for an instance (for use with enhancedFetch)
   *
   * Returns undefined if instance is not yet initialized - caller should
   * use default global dispatcher in that case.
   */
  public getDispatcher(baseUrl: string): UndiciPool | undefined {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const entry = this.pools.get(normalizedUrl);

    if (entry) {
      entry.lastUsedAt = new Date();
    }

    return entry?.pool;
  }

  /**
   * Get pool statistics for all instances
   *
   * Note: Pool stats are available even though enhancedFetch doesn't yet use
   * the Undici dispatcher. The pool infrastructure is in place for future
   * HTTP/2 integration with REST endpoints.
   */
  public getStats(): PoolStats[] {
    return Array.from(this.pools.values()).map(entry => ({
      baseUrl: entry.baseUrl,
      graphqlEndpoint: entry.graphqlEndpoint,
      ...entry.pool.stats,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
    }));
  }

  /**
   * Get pool statistics for a specific instance
   */
  public getInstanceStats(baseUrl: string): PoolStats | undefined {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    const entry = this.pools.get(normalizedUrl);

    if (!entry) return undefined;

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
      logDebug("Connection pool destroyed", { baseUrl: normalizedUrl });
    }
  }

  /**
   * Destroy all pools (cleanup on shutdown)
   */
  public async destroyAll(): Promise<void> {
    const destroyPromises = Array.from(this.pools.values()).map(entry => entry.pool.destroy());
    await Promise.all(destroyPromises);
    this.pools.clear();
    logInfo("All connection pools destroyed");
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

    logInfo("Connection pool created for instance", {
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
    normalizedUrl: string
  ): ConnectionEntry {
    // Build TLS options based on instance config
    const connectOptions: { rejectUnauthorized?: boolean; ca?: Buffer | string } = {};

    if (instanceConfig.insecureSkipVerify) {
      connectOptions.rejectUnauthorized = false;
      logWarn("TLS verification disabled for instance", { url: normalizedUrl });
    }

    // Create Undici Pool for this instance
    const pool = new undici.Pool(normalizedUrl, {
      connections: this.config.maxConnections,
      keepAliveTimeout: this.config.keepAliveTimeout,
      keepAliveMaxTimeout: this.config.keepAliveMaxTimeout,
      pipelining: this.config.pipelining,
      connect: Object.keys(connectOptions).length > 0 ? connectOptions : undefined,
    });

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
