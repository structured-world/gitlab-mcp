/**
 * Unit tests for InstanceConnectionPool
 * Tests per-instance HTTP/2 connection pooling with keepalive support
 */

// Mock undici module - must be before imports due to Jest hoisting
const mockPoolDestroy = jest.fn().mockResolvedValue(undefined);
const mockPoolStats = {
  connected: 5,
  free: 3,
  pending: 1,
  queued: 0,
  running: 2,
  size: 10,
};

const MockPool = jest.fn().mockImplementation(() => ({
  destroy: mockPoolDestroy,
  stats: mockPoolStats,
}));

jest.mock("undici", () => ({
  Pool: MockPool,
  Agent: jest.fn(),
}));

// Mock GraphQLClient
const mockSetHeaders = jest.fn();
jest.mock("../../../src/graphql/client", () => ({
  GraphQLClient: jest.fn().mockImplementation((endpoint: string) => ({
    endpoint,
    setHeaders: mockSetHeaders,
  })),
}));

// Mock logger
jest.mock("../../../src/logger", () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Now import the module under test
import { InstanceConnectionPool } from "../../../src/services/InstanceConnectionPool";
import { GitLabInstanceConfig } from "../../../src/config/instances-schema";

describe("InstanceConnectionPool", () => {
  beforeEach(async () => {
    // Reset singleton and mocks before each test
    await InstanceConnectionPool.resetInstance();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await InstanceConnectionPool.resetInstance();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = InstanceConnectionPool.getInstance();
      const instance2 = InstanceConnectionPool.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should accept custom configuration on first call", () => {
      const customConfig = {
        maxConnections: 20,
        keepAliveTimeout: 60000,
      };

      const instance = InstanceConnectionPool.getInstance(customConfig);
      expect(instance).toBeDefined();
    });

    it("should ignore configuration on subsequent calls", () => {
      const instance1 = InstanceConnectionPool.getInstance({ maxConnections: 5 });
      const instance2 = InstanceConnectionPool.getInstance({ maxConnections: 100 });

      // Same singleton instance
      expect(instance1).toBe(instance2);
    });
  });

  describe("getGraphQLClient", () => {
    const instanceConfig: GitLabInstanceConfig = {
      url: "https://gitlab.com",
      insecureSkipVerify: false,
    };

    it("should create GraphQL client for instance", () => {
      const pool = InstanceConnectionPool.getInstance();
      const client = pool.getGraphQLClient(instanceConfig);

      expect(client).toBeDefined();
      expect(client.endpoint).toBe("https://gitlab.com/api/graphql");
    });

    it("should reuse existing client for same instance", () => {
      const pool = InstanceConnectionPool.getInstance();

      const client1 = pool.getGraphQLClient(instanceConfig);
      const client2 = pool.getGraphQLClient(instanceConfig);

      expect(client1).toBe(client2);
      // Pool should only be created once
      expect(MockPool).toHaveBeenCalledTimes(1);
    });

    it("should create separate clients for different instances", () => {
      const pool = InstanceConnectionPool.getInstance();

      const config1: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      };
      const config2: GitLabInstanceConfig = {
        url: "https://git.corp.io",
        insecureSkipVerify: false,
      };

      const client1 = pool.getGraphQLClient(config1);
      const client2 = pool.getGraphQLClient(config2);

      expect(client1).not.toBe(client2);
      expect(MockPool).toHaveBeenCalledTimes(2);
    });

    it("should return proxy client when auth headers provided", () => {
      const pool = InstanceConnectionPool.getInstance();
      const authHeaders = { Authorization: "Bearer token123" };

      const client = pool.getGraphQLClient(instanceConfig, authHeaders);

      // With auth headers, returns a Proxy wrapper (not the base client)
      expect(client).toBeDefined();
      // Should NOT mutate shared client headers
      expect(mockSetHeaders).not.toHaveBeenCalled();
    });

    it("should return base client when no headers provided", () => {
      const pool = InstanceConnectionPool.getInstance();

      const client = pool.getGraphQLClient(instanceConfig);

      // Without auth headers, returns the base client directly
      expect(client).toBeDefined();
      expect(mockSetHeaders).not.toHaveBeenCalled();
    });

    it("should update lastUsedAt timestamp on access", async () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient(instanceConfig);
      const stats1 = pool.getInstanceStats(instanceConfig.url);

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      pool.getGraphQLClient(instanceConfig);
      const stats2 = pool.getInstanceStats(instanceConfig.url);

      expect(stats2!.lastUsedAt.getTime()).toBeGreaterThanOrEqual(stats1!.lastUsedAt.getTime());
    });
  });

  describe("getDispatcher", () => {
    it("should return undefined for non-existent instance", () => {
      const pool = InstanceConnectionPool.getInstance();

      const dispatcher = pool.getDispatcher("https://unknown.gitlab.com");

      expect(dispatcher).toBeUndefined();
    });

    it("should return pool for existing instance", () => {
      const pool = InstanceConnectionPool.getInstance();
      const config: GitLabInstanceConfig = { url: "https://gitlab.com", insecureSkipVerify: false };

      // Create the pool first
      pool.getGraphQLClient(config);

      const dispatcher = pool.getDispatcher("https://gitlab.com");

      expect(dispatcher).toBeDefined();
      expect(dispatcher?.stats).toEqual(mockPoolStats);
    });

    it("should update lastUsedAt when dispatcher accessed", async () => {
      const pool = InstanceConnectionPool.getInstance();
      const config: GitLabInstanceConfig = { url: "https://gitlab.com", insecureSkipVerify: false };

      pool.getGraphQLClient(config);
      const stats1 = pool.getInstanceStats(config.url);

      await new Promise(resolve => setTimeout(resolve, 10));

      pool.getDispatcher(config.url);
      const stats2 = pool.getInstanceStats(config.url);

      expect(stats2!.lastUsedAt.getTime()).toBeGreaterThanOrEqual(stats1!.lastUsedAt.getTime());
    });
  });

  describe("getStats", () => {
    it("should return empty array when no pools exist", () => {
      const pool = InstanceConnectionPool.getInstance();

      const stats = pool.getStats();

      expect(stats).toEqual([]);
    });

    it("should return stats for all pools", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });
      pool.getGraphQLClient({ url: "https://git.corp.io", insecureSkipVerify: false });

      const stats = pool.getStats();

      expect(stats).toHaveLength(2);
      expect(stats[0].baseUrl).toBe("https://gitlab.com");
      expect(stats[1].baseUrl).toBe("https://git.corp.io");
    });

    it("should include pool statistics in result", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });

      const stats = pool.getStats();

      expect(stats[0]).toMatchObject({
        baseUrl: "https://gitlab.com",
        graphqlEndpoint: "https://gitlab.com/api/graphql",
        connected: 5,
        free: 3,
        pending: 1,
        queued: 0,
        running: 2,
        size: 10,
      });
      expect(stats[0].createdAt).toBeInstanceOf(Date);
      expect(stats[0].lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe("getInstanceStats", () => {
    it("should return undefined for non-existent instance", () => {
      const pool = InstanceConnectionPool.getInstance();

      const stats = pool.getInstanceStats("https://unknown.gitlab.com");

      expect(stats).toBeUndefined();
    });

    it("should return stats for existing instance", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });

      const stats = pool.getInstanceStats("https://gitlab.com");

      expect(stats).toBeDefined();
      expect(stats!.baseUrl).toBe("https://gitlab.com");
      expect(stats!.graphqlEndpoint).toBe("https://gitlab.com/api/graphql");
    });
  });

  describe("destroyPool", () => {
    it("should destroy specific pool", async () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });
      pool.getGraphQLClient({ url: "https://git.corp.io", insecureSkipVerify: false });

      await pool.destroyPool("https://gitlab.com");

      expect(mockPoolDestroy).toHaveBeenCalledTimes(1);
      expect(pool.getInstanceStats("https://gitlab.com")).toBeUndefined();
      expect(pool.getInstanceStats("https://git.corp.io")).toBeDefined();
    });

    it("should handle non-existent pool gracefully", async () => {
      const pool = InstanceConnectionPool.getInstance();

      // Should not throw
      await pool.destroyPool("https://unknown.gitlab.com");

      expect(mockPoolDestroy).not.toHaveBeenCalled();
    });
  });

  describe("destroyAll", () => {
    it("should destroy all pools", async () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });
      pool.getGraphQLClient({ url: "https://git.corp.io", insecureSkipVerify: false });

      await pool.destroyAll();

      expect(mockPoolDestroy).toHaveBeenCalledTimes(2);
      expect(pool.getStats()).toEqual([]);
    });

    it("should handle empty pool list", async () => {
      const pool = InstanceConnectionPool.getInstance();

      // Should not throw
      await pool.destroyAll();

      expect(mockPoolDestroy).not.toHaveBeenCalled();
    });
  });

  describe("resetInstance", () => {
    it("should reset singleton instance", async () => {
      const instance1 = InstanceConnectionPool.getInstance();
      instance1.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });

      await InstanceConnectionPool.resetInstance();

      const instance2 = InstanceConnectionPool.getInstance();

      expect(instance1).not.toBe(instance2);
      expect(instance2.getStats()).toEqual([]);
    });

    it("should destroy all pools on reset", async () => {
      const pool = InstanceConnectionPool.getInstance();
      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });

      await InstanceConnectionPool.resetInstance();

      expect(mockPoolDestroy).toHaveBeenCalledTimes(1);
    });

    it("should handle reset when no instance exists", async () => {
      // First reset to ensure no instance
      await InstanceConnectionPool.resetInstance();

      // Should not throw
      await InstanceConnectionPool.resetInstance();
    });
  });

  describe("URL normalization", () => {
    it("should normalize URLs with trailing slash", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com/", insecureSkipVerify: false });

      const stats = pool.getInstanceStats("https://gitlab.com");
      expect(stats).toBeDefined();
      expect(stats!.baseUrl).toBe("https://gitlab.com");
    });

    it("should normalize URLs with /api/v4 suffix", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com/api/v4", insecureSkipVerify: false });

      const stats = pool.getInstanceStats("https://gitlab.com");
      expect(stats).toBeDefined();
    });

    it("should normalize URLs with /api/graphql suffix", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com/api/graphql", insecureSkipVerify: false });

      const stats = pool.getInstanceStats("https://gitlab.com");
      expect(stats).toBeDefined();
    });

    it("should treat differently normalized URLs as same instance", () => {
      const pool = InstanceConnectionPool.getInstance();

      const client1 = pool.getGraphQLClient({
        url: "https://gitlab.com/",
        insecureSkipVerify: false,
      });
      const client2 = pool.getGraphQLClient({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });
      const client3 = pool.getGraphQLClient({
        url: "https://gitlab.com/api/v4",
        insecureSkipVerify: false,
      });

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
      expect(MockPool).toHaveBeenCalledTimes(1);
    });
  });

  describe("TLS configuration", () => {
    it("should configure TLS verification disabled when insecureSkipVerify is true", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({
        url: "https://self-signed.gitlab.local",
        insecureSkipVerify: true,
      });

      expect(MockPool).toHaveBeenCalledWith(
        "https://self-signed.gitlab.local",
        expect.objectContaining({
          connect: { rejectUnauthorized: false },
        })
      );
    });

    it("should not pass connect options when TLS verification is enabled", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      expect(MockPool).toHaveBeenCalledWith(
        "https://gitlab.com",
        expect.objectContaining({
          connect: undefined,
        })
      );
    });
  });

  describe("pool configuration", () => {
    it("should use default configuration values", () => {
      const pool = InstanceConnectionPool.getInstance();

      pool.getGraphQLClient({ url: "https://gitlab.com", insecureSkipVerify: false });

      expect(MockPool).toHaveBeenCalledWith(
        "https://gitlab.com",
        expect.objectContaining({
          connections: 10,
          keepAliveTimeout: 30000,
          keepAliveMaxTimeout: 300000,
          pipelining: 1,
        })
      );
    });
  });
});
