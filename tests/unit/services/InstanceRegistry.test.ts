/**
 * Unit tests for InstanceRegistry
 * Tests singleton instance registry managing multiple GitLab instances
 */

import { InstanceRegistry } from "../../../src/services/InstanceRegistry";
import { GitLabInstanceConfig } from "../../../src/config/instances-schema";

// Mock the loadInstancesConfig function
jest.mock("../../../src/config/instances-loader", () => ({
  loadInstancesConfig: jest.fn().mockResolvedValue({
    instances: [{ url: "https://gitlab.com", label: "GitLab.com", insecureSkipVerify: false }],
    source: "none" as const,
    sourceDetails: "default",
  }),
}));

describe("InstanceRegistry", () => {
  let registry: InstanceRegistry;

  beforeEach(() => {
    // Get fresh instance and reset it before each test
    registry = InstanceRegistry.getInstance();
    registry.reset();
  });

  describe("Singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = InstanceRegistry.getInstance();
      const instance2 = InstanceRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should maintain state between getInstance calls", () => {
      const instance1 = InstanceRegistry.getInstance();
      instance1.register({
        url: "https://test.gitlab.com",
        insecureSkipVerify: false,
      });

      const instance2 = InstanceRegistry.getInstance();
      expect(instance2.has("https://test.gitlab.com")).toBe(true);
    });
  });

  describe("initialize", () => {
    it("should load instances from configuration", async () => {
      await registry.initialize();

      expect(registry.isInitialized()).toBe(true);
      expect(registry.has("https://gitlab.com")).toBe(true);
    });

    it("should skip initialization if already initialized", async () => {
      await registry.initialize();

      // Register another instance
      registry.register({
        url: "https://new.gitlab.com",
        insecureSkipVerify: false,
      });

      // Initialize again
      await registry.initialize();

      // Should still have the new instance (not reset)
      expect(registry.has("https://new.gitlab.com")).toBe(true);
    });
  });

  describe("register", () => {
    it("should register new instance", () => {
      const config: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        label: "GitLab.com",
        insecureSkipVerify: false,
      };

      registry.register(config);

      expect(registry.has("https://gitlab.com")).toBe(true);
    });

    it("should update existing instance on re-registration", () => {
      registry.register({
        url: "https://gitlab.com",
        label: "Old Label",
        insecureSkipVerify: false,
      });

      registry.register({
        url: "https://gitlab.com",
        label: "New Label",
        insecureSkipVerify: false,
      });

      const config = registry.getConfig("https://gitlab.com");
      expect(config?.label).toBe("New Label");
    });

    it("should create rate limiter with instance-specific config", () => {
      registry.register({
        url: "https://gitlab.com",
        rateLimit: {
          maxConcurrent: 50,
          queueSize: 200,
          queueTimeout: 30000,
        },
        insecureSkipVerify: false,
      });

      const metrics = registry.getRateLimitMetrics("https://gitlab.com");
      expect(metrics?.maxConcurrent).toBe(50);
      expect(metrics?.queueSize).toBe(200);
    });

    it("should create rate limiter with default config when not specified", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const metrics = registry.getRateLimitMetrics("https://gitlab.com");
      expect(metrics?.maxConcurrent).toBe(100); // Default value
    });
  });

  describe("URL normalization", () => {
    it("should normalize URL with trailing slash", () => {
      registry.register({
        url: "https://gitlab.com/",
        insecureSkipVerify: false,
      });

      expect(registry.has("https://gitlab.com")).toBe(true);
      expect(registry.has("https://gitlab.com/")).toBe(true);
    });

    it("should normalize URL with /api/v4 suffix", () => {
      registry.register({
        url: "https://gitlab.com/api/v4",
        insecureSkipVerify: false,
      });

      expect(registry.has("https://gitlab.com")).toBe(true);
      expect(registry.has("https://gitlab.com/api/v4")).toBe(true);
    });

    it("should normalize URL with /api/graphql suffix", () => {
      registry.register({
        url: "https://gitlab.com/api/graphql",
        insecureSkipVerify: false,
      });

      expect(registry.has("https://gitlab.com")).toBe(true);
      expect(registry.has("https://gitlab.com/api/graphql")).toBe(true);
    });

    it("should treat normalized URLs as same instance", () => {
      registry.register({
        url: "https://gitlab.com",
        label: "Original",
        insecureSkipVerify: false,
      });

      registry.register({
        url: "https://gitlab.com/api/v4",
        label: "With API suffix",
        insecureSkipVerify: false,
      });

      // Should update, not create second instance
      expect(registry.getUrls()).toHaveLength(1);
      expect(registry.getConfig("https://gitlab.com")?.label).toBe("With API suffix");
    });
  });

  describe("get / getConfig / getState", () => {
    beforeEach(() => {
      registry.register({
        url: "https://gitlab.com",
        label: "GitLab.com",
        insecureSkipVerify: false,
      });
    });

    it("should return entry for registered instance", () => {
      const entry = registry.get("https://gitlab.com");
      expect(entry).toBeDefined();
      expect(entry?.config.label).toBe("GitLab.com");
    });

    it("should return undefined for unregistered instance", () => {
      const entry = registry.get("https://unknown.gitlab.com");
      expect(entry).toBeUndefined();
    });

    it("should return config for registered instance", () => {
      const config = registry.getConfig("https://gitlab.com");
      expect(config?.label).toBe("GitLab.com");
    });

    it("should return state for registered instance", () => {
      const state = registry.getState("https://gitlab.com");
      expect(state?.connectionStatus).toBe("healthy");
      expect(state?.lastHealthCheck).toBeNull();
    });
  });

  describe("list", () => {
    it("should return summaries of all instances", () => {
      registry.register({
        url: "https://gitlab.com",
        label: "GitLab.com",
        insecureSkipVerify: false,
      });
      registry.register({
        url: "https://git.corp.io",
        label: "Corporate",
        insecureSkipVerify: false,
      });

      const list = registry.list();

      expect(list).toHaveLength(2);
      expect(list.map(i => i.url)).toContain("https://gitlab.com");
      expect(list.map(i => i.url)).toContain("https://git.corp.io");
    });

    it("should include rate limit metrics in summary", () => {
      registry.register({
        url: "https://gitlab.com",
        rateLimit: {
          maxConcurrent: 50,
          queueSize: 200,
          queueTimeout: 30000,
        },
        insecureSkipVerify: false,
      });

      const list = registry.list();
      const summary = list[0];

      expect(summary.rateLimit.maxConcurrent).toBe(50);
      expect(summary.rateLimit.activeRequests).toBe(0);
    });

    it("should include introspection info in summary", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const list = registry.list();
      const summary = list[0];

      expect(summary.introspection.version).toBeNull();
      expect(summary.introspection.cachedAt).toBeNull();
    });
  });

  describe("has / unregister", () => {
    it("should return true for registered instance", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      expect(registry.has("https://gitlab.com")).toBe(true);
    });

    it("should return false for unregistered instance", () => {
      expect(registry.has("https://unknown.gitlab.com")).toBe(false);
    });

    it("should unregister instance and return true", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const result = registry.unregister("https://gitlab.com");

      expect(result).toBe(true);
      expect(registry.has("https://gitlab.com")).toBe(false);
    });

    it("should return false when unregistering non-existent instance", () => {
      const result = registry.unregister("https://unknown.gitlab.com");
      expect(result).toBe(false);
    });
  });

  describe("getUrls / getDefaultUrl", () => {
    it("should return all registered URLs", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });
      registry.register({
        url: "https://git.corp.io",
        insecureSkipVerify: false,
      });

      const urls = registry.getUrls();

      expect(urls).toHaveLength(2);
      expect(urls).toContain("https://gitlab.com");
      expect(urls).toContain("https://git.corp.io");
    });

    it("should return first URL as default", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });
      registry.register({
        url: "https://git.corp.io",
        insecureSkipVerify: false,
      });

      expect(registry.getDefaultUrl()).toBe("https://gitlab.com");
    });

    it("should return undefined when no instances registered", () => {
      expect(registry.getDefaultUrl()).toBeUndefined();
    });
  });

  describe("acquireSlot (rate limiting)", () => {
    it("should acquire slot for registered instance", async () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const release = await registry.acquireSlot("https://gitlab.com");

      const metrics = registry.getRateLimitMetrics("https://gitlab.com");
      expect(metrics?.activeRequests).toBe(1);

      release();

      const metricsAfter = registry.getRateLimitMetrics("https://gitlab.com");
      expect(metricsAfter?.activeRequests).toBe(0);
    });

    it("should return noop for unregistered instance", async () => {
      const release = await registry.acquireSlot("https://unknown.gitlab.com");

      // Should not throw
      release();
    });
  });

  describe("Introspection caching", () => {
    beforeEach(() => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });
    });

    it("should return null when no introspection cached", () => {
      const introspection = registry.getIntrospection("https://gitlab.com");
      expect(introspection).toBeNull();
    });

    it("should store and retrieve introspection", () => {
      const introspectionData = {
        version: "17.2.0",
        tier: "ultimate",
        features: { epics: true, iterations: true },
        schemaInfo: {},
        cachedAt: new Date(),
      };

      registry.setIntrospection("https://gitlab.com", introspectionData);

      const cached = registry.getIntrospection("https://gitlab.com");
      expect(cached?.version).toBe("17.2.0");
      expect(cached?.tier).toBe("ultimate");
    });

    it("should return null for expired introspection", () => {
      const expiredDate = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

      registry.setIntrospection("https://gitlab.com", {
        version: "17.2.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: expiredDate,
      });

      const cached = registry.getIntrospection("https://gitlab.com");
      expect(cached).toBeNull();
    });

    it("should return introspection within TTL", () => {
      const recentDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

      registry.setIntrospection("https://gitlab.com", {
        version: "17.2.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: recentDate,
      });

      const cached = registry.getIntrospection("https://gitlab.com");
      expect(cached).not.toBeNull();
    });

    it("should ignore setIntrospection for unregistered instance", () => {
      registry.setIntrospection("https://unknown.gitlab.com", {
        version: "17.2.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: new Date(),
      });

      // Should not throw, just log warning
      expect(registry.getIntrospection("https://unknown.gitlab.com")).toBeNull();
    });

    it("should clear introspection for specific instance", () => {
      registry.setIntrospection("https://gitlab.com", {
        version: "17.2.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: new Date(),
      });

      registry.clearIntrospectionCache("https://gitlab.com");

      expect(registry.getIntrospection("https://gitlab.com")).toBeNull();
    });

    it("should clear introspection for all instances", () => {
      registry.register({
        url: "https://git.corp.io",
        insecureSkipVerify: false,
      });

      registry.setIntrospection("https://gitlab.com", {
        version: "17.2.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: new Date(),
      });

      registry.setIntrospection("https://git.corp.io", {
        version: "16.8.0",
        tier: "premium",
        features: {},
        schemaInfo: {},
        cachedAt: new Date(),
      });

      registry.clearIntrospectionCache();

      expect(registry.getIntrospection("https://gitlab.com")).toBeNull();
      expect(registry.getIntrospection("https://git.corp.io")).toBeNull();
    });
  });

  describe("updateConnectionStatus", () => {
    beforeEach(() => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });
    });

    it("should update connection status", () => {
      registry.updateConnectionStatus("https://gitlab.com", "degraded");

      const state = registry.getState("https://gitlab.com");
      expect(state?.connectionStatus).toBe("degraded");
    });

    it("should update lastHealthCheck timestamp", () => {
      const before = registry.getState("https://gitlab.com")?.lastHealthCheck;
      expect(before).toBeNull();

      registry.updateConnectionStatus("https://gitlab.com", "healthy");

      const after = registry.getState("https://gitlab.com")?.lastHealthCheck;
      expect(after).toBeInstanceOf(Date);
    });

    it("should ignore update for unregistered instance", () => {
      // Should not throw
      registry.updateConnectionStatus("https://unknown.gitlab.com", "offline");
    });
  });

  describe("getConfigSource", () => {
    it("should return config source info", async () => {
      await registry.initialize();

      const source = registry.getConfigSource();
      expect(source.source).toBeDefined();
      expect(source.details).toBeDefined();
    });
  });

  describe("reset", () => {
    it("should clear all instances", async () => {
      await registry.initialize();
      expect(registry.getUrls().length).toBeGreaterThan(0);

      registry.reset();

      expect(registry.getUrls()).toHaveLength(0);
      expect(registry.isInitialized()).toBe(false);
    });
  });

  describe("getGraphQLClient", () => {
    it("should return undefined for non-existent instance", () => {
      const client = registry.getGraphQLClient("https://nonexistent.gitlab.com");
      expect(client).toBeUndefined();
    });

    it("should return GraphQL client for registered instance", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const client = registry.getGraphQLClient("https://gitlab.com");
      expect(client).toBeDefined();
    });

    it("should pass auth headers to connection pool", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      const authHeaders = { Authorization: "Bearer test-token" };
      const client = registry.getGraphQLClient("https://gitlab.com", authHeaders);
      expect(client).toBeDefined();
    });
  });

  describe("getConnectionPoolStats", () => {
    it("should return pool stats array", () => {
      const stats = registry.getConnectionPoolStats();
      expect(Array.isArray(stats)).toBe(true);
    });
  });

  describe("getInstancePoolStats", () => {
    it("should return undefined for non-existent instance", () => {
      const stats = registry.getInstancePoolStats("https://nonexistent.gitlab.com");
      expect(stats).toBeUndefined();
    });

    it("should return stats for instance with active pool", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      // Create pool by getting GraphQL client
      registry.getGraphQLClient("https://gitlab.com");

      const stats = registry.getInstancePoolStats("https://gitlab.com");
      expect(stats).toBeDefined();
      expect(stats?.baseUrl).toBe("https://gitlab.com");
    });
  });

  describe("getDispatcher", () => {
    it("should return undefined for unregistered instance", () => {
      const dispatcher = registry.getDispatcher("https://unknown.gitlab.com");
      expect(dispatcher).toBeUndefined();
    });

    it("should return dispatcher for registered instance with pool", () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      // Create pool by getting GraphQL client
      registry.getGraphQLClient("https://gitlab.com");

      const dispatcher = registry.getDispatcher("https://gitlab.com");
      expect(dispatcher).toBeDefined();
    });

    it("should lazily create pool for registered instance without existing pool", () => {
      // Register instance but don't call getGraphQLClient
      registry.register({
        url: "https://lazy.gitlab.com",
        insecureSkipVerify: false,
      });

      // getDispatcher should lazily create the pool
      const dispatcher = registry.getDispatcher("https://lazy.gitlab.com");
      expect(dispatcher).toBeDefined();
    });
  });

  describe("resetWithPools", () => {
    it("should reset registry and destroy connection pools", async () => {
      registry.register({
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      });

      // Create pool
      registry.getGraphQLClient("https://gitlab.com");

      await registry.resetWithPools();

      expect(registry.isInitialized()).toBe(false);
      expect(registry.getUrls()).toHaveLength(0);
    });
  });
});
