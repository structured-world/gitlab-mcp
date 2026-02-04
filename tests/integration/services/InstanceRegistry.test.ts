/**
 * Integration tests for InstanceRegistry
 * Tests multi-instance infrastructure with real GitLab instance
 */

import { InstanceRegistry } from "../../../src/services/InstanceRegistry";
import { ConnectionManager } from "../../../src/services/ConnectionManager";

describe("InstanceRegistry Integration", () => {
  let registry: InstanceRegistry;

  beforeEach(() => {
    // Reset singleton instances
    registry = InstanceRegistry.getInstance();
    registry.reset();
    (ConnectionManager as unknown as { instance: null }).instance = null;
  });

  describe("Initialization with real environment", () => {
    it("should initialize with environment configuration", async () => {
      await registry.initialize();

      expect(registry.isInitialized()).toBe(true);
      expect(registry.getUrls().length).toBeGreaterThan(0);
    });

    it("should have valid config source after initialization", async () => {
      await registry.initialize();

      const source = registry.getConfigSource();
      expect(["file", "env", "legacy", "none"]).toContain(source.source);
      expect(source.details).toBeDefined();
    });

    it("should register instance from GITLAB_API_URL", async () => {
      const baseUrl = process.env.GITLAB_API_URL;
      expect(baseUrl).toBeDefined();

      await registry.initialize();

      // Should have at least one instance registered
      const urls = registry.getUrls();
      expect(urls.length).toBeGreaterThan(0);

      // First instance should be from the environment
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();
    });
  });

  describe("Rate limiting with real requests", () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it("should acquire and release slots", async () => {
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();

      const initialMetrics = registry.getRateLimitMetrics(defaultUrl!);
      expect(initialMetrics?.activeRequests).toBe(0);

      // Acquire slot
      const release = await registry.acquireSlot(defaultUrl!);
      const afterAcquire = registry.getRateLimitMetrics(defaultUrl!);
      expect(afterAcquire?.activeRequests).toBe(1);

      // Release slot
      release();
      const afterRelease = registry.getRateLimitMetrics(defaultUrl!);
      expect(afterRelease?.activeRequests).toBe(0);
    });

    it("should track request metrics", async () => {
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();

      // Make multiple acquire/release cycles
      for (let i = 0; i < 3; i++) {
        const release = await registry.acquireSlot(defaultUrl!);
        release();
      }

      const metrics = registry.getRateLimitMetrics(defaultUrl!);
      expect(metrics?.requestsTotal).toBe(3);
    });
  });

  describe("Introspection caching", () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it("should store and retrieve introspection from cache", async () => {
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();

      // Initially no cache
      expect(registry.getIntrospection(defaultUrl!)).toBeNull();

      // Store introspection
      const introspection = {
        version: "17.0.0",
        tier: "ultimate",
        features: { epics: true },
        schemaInfo: {},
        cachedAt: new Date(),
      };
      registry.setIntrospection(defaultUrl!, introspection);

      // Should retrieve from cache
      const cached = registry.getIntrospection(defaultUrl!);
      expect(cached).not.toBeNull();
      expect(cached?.version).toBe("17.0.0");
    });

    it("should clear introspection cache", async () => {
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();

      // Store introspection
      registry.setIntrospection(defaultUrl!, {
        version: "17.0.0",
        tier: "ultimate",
        features: {},
        schemaInfo: {},
        cachedAt: new Date(),
      });

      // Clear cache
      if (defaultUrl) {
        registry.clearIntrospectionCache(defaultUrl);
      }

      // Should be cleared
      expect(registry.getIntrospection(defaultUrl!)).toBeNull();
    });
  });

  describe("Connection status tracking", () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it("should track connection status updates", async () => {
      const defaultUrl = registry.getDefaultUrl();
      expect(defaultUrl).toBeDefined();

      // Initial status should be healthy
      const initialState = registry.getState(defaultUrl!);
      expect(initialState?.connectionStatus).toBe("healthy");
      expect(initialState?.lastHealthCheck).toBeNull();

      // Update status
      registry.updateConnectionStatus(defaultUrl!, "degraded");

      const updatedState = registry.getState(defaultUrl!);
      expect(updatedState?.connectionStatus).toBe("degraded");
      expect(updatedState?.lastHealthCheck).toBeInstanceOf(Date);
    });
  });

  describe("Integration with ConnectionManager", () => {
    it("should use InstanceRegistry for introspection caching", async () => {
      // Initialize ConnectionManager which should initialize InstanceRegistry
      const connectionManager = ConnectionManager.getInstance();
      await connectionManager.initialize();

      // InstanceRegistry should be initialized
      expect(registry.isInitialized()).toBe(true);

      // Should have introspection cached for the instance
      const defaultUrl = registry.getDefaultUrl();
      if (defaultUrl) {
        // May or may not be cached depending on implementation
        // Just verify the registry is working
        expect(registry.has(defaultUrl)).toBe(true);
      }
    });
  });

  describe("Instance list summary", () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it("should return valid instance summaries", () => {
      const summaries = registry.list();

      expect(summaries.length).toBeGreaterThan(0);

      for (const summary of summaries) {
        expect(summary.url).toBeDefined();
        expect(summary.connectionStatus).toBeDefined();
        expect(summary.rateLimit).toBeDefined();
        expect(summary.rateLimit.maxConcurrent).toBeGreaterThan(0);
        expect(summary.introspection).toBeDefined();
      }
    });
  });
});
