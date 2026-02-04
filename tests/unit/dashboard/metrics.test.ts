/**
 * Unit tests for Dashboard Metrics Collector
 * Tests metrics collection, instance status determination, and uptime formatting
 */

import {
  determineInstanceStatus,
  formatUptime,
  collectMetrics,
  DashboardMetricsSchema,
  InstanceStatusSchema,
} from "../../../src/dashboard/metrics";
import { InstanceSummary, InstanceRegistry } from "../../../src/services/InstanceRegistry";
import { getSessionManager } from "../../../src/session-manager";
import { RegistryManager } from "../../../src/registry-manager";

// Mock dependencies
jest.mock("../../../src/services/InstanceRegistry", () => ({
  InstanceRegistry: {
    getInstance: jest.fn(() => ({
      list: jest.fn(() => []),
      getConfigSource: jest.fn(() => ({ source: "none", details: "" })),
    })),
  },
}));

jest.mock("../../../src/session-manager", () => ({
  getSessionManager: jest.fn(() => ({
    activeSessionCount: 0,
  })),
}));

jest.mock("../../../src/registry-manager", () => ({
  RegistryManager: {
    getInstance: jest.fn(() => ({
      getAllToolDefinitions: jest.fn(() => []),
    })),
  },
}));

jest.mock("../../../src/oauth/index", () => ({
  isOAuthEnabled: jest.fn(() => false),
}));

jest.mock("../../../src/config", () => ({
  packageVersion: "6.52.0",
  GITLAB_READ_ONLY_MODE: false,
  GITLAB_BASE_URL: "https://gitlab.com",
  GITLAB_TOKEN: undefined,
}));

describe("Dashboard Metrics", () => {
  describe("determineInstanceStatus", () => {
    // Helper to create mock InstanceSummary
    function createMockInstance(overrides: Partial<InstanceSummary> = {}): InstanceSummary {
      return {
        url: "https://gitlab.example.com",
        label: "Example GitLab",
        connectionStatus: "healthy",
        lastHealthCheck: new Date(),
        hasOAuth: false,
        rateLimit: {
          activeRequests: 5,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          requestsTotal: 100,
          requestsQueued: 0,
          requestsRejected: 0,
          avgQueueWaitMs: 50,
        },
        introspection: {
          version: "17.2.0",
          tier: "ultimate",
          cachedAt: new Date(),
          isExpired: false,
        },
        ...overrides,
      };
    }

    it("should return healthy for instance with normal metrics", () => {
      const instance = createMockInstance();
      const status = determineInstanceStatus(instance);
      expect(status).toBe("healthy");
    });

    it("should return healthy for instance with no health check yet", () => {
      const instance = createMockInstance({
        lastHealthCheck: null,
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("healthy");
    });

    it("should return offline for instance with old health check (>5 min)", () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const instance = createMockInstance({
        lastHealthCheck: sixMinutesAgo,
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("offline");
    });

    it("should return degraded for instance with high latency (>2000ms)", () => {
      const instance = createMockInstance({
        rateLimit: {
          ...createMockInstance().rateLimit,
          avgQueueWaitMs: 2500,
        },
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("degraded");
    });

    it("should return degraded when queue is over 50% capacity", () => {
      const instance = createMockInstance({
        rateLimit: {
          ...createMockInstance().rateLimit,
          queuedRequests: 300, // 60% of 500
          queueSize: 500,
        },
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("degraded");
    });

    it("should return degraded when rejection rate is over 10%", () => {
      const instance = createMockInstance({
        rateLimit: {
          ...createMockInstance().rateLimit,
          requestsTotal: 100,
          requestsRejected: 15, // 15% rejection rate
        },
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("degraded");
    });

    it("should return healthy when rejection rate is under 10%", () => {
      const instance = createMockInstance({
        rateLimit: {
          ...createMockInstance().rateLimit,
          requestsTotal: 100,
          requestsRejected: 5, // 5% rejection rate
        },
      });
      const status = determineInstanceStatus(instance);
      expect(status).toBe("healthy");
    });
  });

  describe("formatUptime", () => {
    it("should format 0 seconds as 0m", () => {
      expect(formatUptime(0)).toBe("0m");
    });

    it("should format seconds less than a minute as 0m", () => {
      expect(formatUptime(30)).toBe("0m");
    });

    it("should format minutes correctly", () => {
      expect(formatUptime(60)).toBe("1m");
      expect(formatUptime(120)).toBe("2m");
      expect(formatUptime(59 * 60)).toBe("59m");
    });

    it("should format hours and minutes correctly", () => {
      expect(formatUptime(3600)).toBe("1h");
      expect(formatUptime(3660)).toBe("1h 1m");
      expect(formatUptime(7200)).toBe("2h");
      expect(formatUptime(7260)).toBe("2h 1m");
    });

    it("should format days, hours, and minutes correctly", () => {
      expect(formatUptime(86400)).toBe("1d");
      expect(formatUptime(86400 + 3600)).toBe("1d 1h");
      expect(formatUptime(86400 + 3600 + 60)).toBe("1d 1h 1m");
      expect(formatUptime(2 * 86400 + 14 * 3600 + 32 * 60)).toBe("2d 14h 32m");
    });
  });

  describe("DashboardMetricsSchema", () => {
    it("should validate a complete metrics object", () => {
      const metrics = {
        server: {
          version: "6.52.0",
          uptime: 228720,
          mode: "oauth" as const,
          readOnly: false,
          toolsEnabled: 44,
          toolsTotal: 44,
        },
        instances: [
          {
            url: "https://gitlab.com",
            label: "GitLab.com",
            status: "healthy" as const,
            version: "17.2.0",
            tier: "ultimate",
            introspected: true,
            rateLimit: {
              activeRequests: 23,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 1247,
              rejectedRequests: 0,
            },
            latency: {
              avgMs: 142,
            },
            lastHealthCheck: "2024-01-15T14:30:15Z",
          },
        ],
        sessions: {
          total: 12,
          byInstance: {
            "https://gitlab.com": 8,
          },
        },
        config: {
          source: "env",
          sourceDetails: "GITLAB_API_URL",
          oauthEnabled: true,
        },
      };

      const result = DashboardMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(true);
    });

    it("should fail validation for invalid mode", () => {
      const metrics = {
        server: {
          version: "6.52.0",
          uptime: 228720,
          mode: "invalid_mode",
          readOnly: false,
          toolsEnabled: 44,
          toolsTotal: 44,
        },
        instances: [],
        sessions: {
          total: 0,
          byInstance: {},
        },
        config: {
          source: "none",
          sourceDetails: "",
          oauthEnabled: false,
        },
      };

      const result = DashboardMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(false);
    });
  });

  describe("InstanceStatusSchema", () => {
    it("should validate a complete instance status", () => {
      const instance = {
        url: "https://gitlab.com",
        label: "GitLab.com",
        status: "healthy" as const,
        version: "17.2.0",
        tier: "ultimate",
        introspected: true,
        rateLimit: {
          activeRequests: 23,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          totalRequests: 1247,
          rejectedRequests: 0,
        },
        latency: {
          avgMs: 142,
        },
        lastHealthCheck: "2024-01-15T14:30:15Z",
      };

      const result = InstanceStatusSchema.safeParse(instance);
      expect(result.success).toBe(true);
    });

    it("should validate instance with null values", () => {
      const instance = {
        url: "https://gitlab.com",
        label: null,
        status: "offline" as const,
        version: null,
        tier: null,
        introspected: false,
        rateLimit: {
          activeRequests: 0,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          totalRequests: 0,
          rejectedRequests: 0,
        },
        latency: {
          avgMs: 0,
        },
        lastHealthCheck: null,
      };

      const result = InstanceStatusSchema.safeParse(instance);
      expect(result.success).toBe(true);
    });

    it("should fail validation for invalid status", () => {
      const instance = {
        url: "https://gitlab.com",
        label: null,
        status: "unknown",
        version: null,
        tier: null,
        introspected: false,
        rateLimit: {
          activeRequests: 0,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          totalRequests: 0,
          rejectedRequests: 0,
        },
        latency: {
          avgMs: 0,
        },
        lastHealthCheck: null,
      };

      const result = InstanceStatusSchema.safeParse(instance);
      expect(result.success).toBe(false);
    });
  });

  describe("collectMetrics", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return valid dashboard metrics structure", () => {
      const metrics = collectMetrics();

      // Verify structure
      expect(metrics).toHaveProperty("server");
      expect(metrics).toHaveProperty("instances");
      expect(metrics).toHaveProperty("sessions");
      expect(metrics).toHaveProperty("config");

      // Verify server info
      expect(metrics.server.version).toBe("6.52.0");
      expect(typeof metrics.server.uptime).toBe("number");
      expect(metrics.server.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should create default instance when no instances registered", () => {
      const metrics = collectMetrics();

      // Should have default gitlab.com instance
      expect(metrics.instances.length).toBe(1);
      expect(metrics.instances[0].url).toBe("https://gitlab.com");
      expect(metrics.instances[0].status).toBe("healthy");
    });

    it("should return auth mode as none when no auth configured", () => {
      const metrics = collectMetrics();
      expect(metrics.server.mode).toBe("none");
    });

    it("should return zero tool counts when registry throws", () => {
      (RegistryManager.getInstance as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Registry not initialized");
      });

      const metrics = collectMetrics();
      expect(metrics.server.toolsEnabled).toBe(0);
      expect(metrics.server.toolsTotal).toBe(0);
    });

    it("should include config source from InstanceRegistry", () => {
      (InstanceRegistry.getInstance as jest.Mock).mockReturnValueOnce({
        list: jest.fn(() => []),
        getConfigSource: jest.fn(() => ({
          source: "file",
          details: "/etc/gitlab-mcp/config.yaml",
        })),
      });

      const metrics = collectMetrics();
      expect(metrics.config.source).toBe("file");
      expect(metrics.config.sourceDetails).toBe("/etc/gitlab-mcp/config.yaml");
    });

    it("should include active session count", () => {
      (getSessionManager as jest.Mock).mockReturnValueOnce({
        activeSessionCount: 5,
      });

      const metrics = collectMetrics();
      expect(metrics.sessions.total).toBe(5);
    });

    it("should convert InstanceSummary to InstanceStatus correctly", () => {
      const mockSummary: InstanceSummary = {
        url: "https://gitlab.example.com",
        label: "Example GitLab",
        connectionStatus: "healthy",
        lastHealthCheck: new Date(),
        hasOAuth: true,
        rateLimit: {
          activeRequests: 10,
          maxConcurrent: 100,
          queuedRequests: 2,
          queueSize: 500,
          requestsTotal: 1000,
          requestsQueued: 50,
          requestsRejected: 5,
          avgQueueWaitMs: 100,
        },
        introspection: {
          version: "17.2.0",
          tier: "ultimate",
          cachedAt: new Date(),
          isExpired: false,
        },
      };

      (InstanceRegistry.getInstance as jest.Mock).mockReturnValueOnce({
        list: jest.fn(() => [mockSummary]),
        getConfigSource: jest.fn(() => ({ source: "env", details: "" })),
      });

      const metrics = collectMetrics();

      expect(metrics.instances.length).toBe(1);
      const instance = metrics.instances[0];
      expect(instance.url).toBe("https://gitlab.example.com");
      expect(instance.label).toBe("Example GitLab");
      expect(instance.version).toBe("17.2.0");
      expect(instance.tier).toBe("ultimate");
      expect(instance.introspected).toBe(true);
      expect(instance.rateLimit.activeRequests).toBe(10);
      expect(instance.rateLimit.totalRequests).toBe(1000);
      expect(instance.latency.avgMs).toBe(100);
    });

    it("should mark introspected as false when version is null", () => {
      const mockSummary: InstanceSummary = {
        url: "https://gitlab.example.com",
        label: undefined,
        connectionStatus: "healthy",
        lastHealthCheck: new Date(),
        hasOAuth: false,
        rateLimit: {
          activeRequests: 0,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          requestsTotal: 0,
          requestsQueued: 0,
          requestsRejected: 0,
          avgQueueWaitMs: 0,
        },
        introspection: {
          version: null,
          tier: null,
          cachedAt: null,
          isExpired: false,
        },
      };

      (InstanceRegistry.getInstance as jest.Mock).mockReturnValueOnce({
        list: jest.fn(() => [mockSummary]),
        getConfigSource: jest.fn(() => ({ source: "env", details: "" })),
      });

      const metrics = collectMetrics();
      expect(metrics.instances[0].introspected).toBe(false);
      expect(metrics.instances[0].label).toBeNull();
    });

    it("should mark introspected as false when cache is expired", () => {
      const mockSummary: InstanceSummary = {
        url: "https://gitlab.example.com",
        label: undefined,
        connectionStatus: "healthy",
        lastHealthCheck: new Date(),
        hasOAuth: false,
        rateLimit: {
          activeRequests: 0,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          requestsTotal: 0,
          requestsQueued: 0,
          requestsRejected: 0,
          avgQueueWaitMs: 0,
        },
        introspection: {
          version: "17.0.0",
          tier: "free",
          cachedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
          isExpired: true,
        },
      };

      (InstanceRegistry.getInstance as jest.Mock).mockReturnValueOnce({
        list: jest.fn(() => [mockSummary]),
        getConfigSource: jest.fn(() => ({ source: "env", details: "" })),
      });

      const metrics = collectMetrics();
      expect(metrics.instances[0].introspected).toBe(false);
    });
  });
});
