/**
 * Unit tests for Dashboard Metrics Collector
 * Tests metrics collection, instance status determination, and uptime formatting
 */

import {
  determineInstanceStatus,
  formatUptime,
  DashboardMetricsSchema,
  InstanceStatusSchema,
} from "../../../src/dashboard/metrics";
import { InstanceSummary } from "../../../src/services/InstanceRegistry";

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
});
