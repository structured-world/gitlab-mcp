/**
 * Unit tests for Dashboard HTML Template
 * Tests HTML rendering and content formatting
 */

import { renderDashboard } from "../../../src/dashboard/html-template";
import { DashboardMetrics } from "../../../src/dashboard/metrics";

describe("Dashboard HTML Template", () => {
  // Helper to create mock metrics
  function createMockMetrics(overrides: Partial<DashboardMetrics> = {}): DashboardMetrics {
    return {
      server: {
        version: "6.52.0",
        uptime: 3600,
        mode: "oauth",
        readOnly: false,
        toolsEnabled: 44,
        toolsTotal: 44,
      },
      instances: [],
      sessions: {
        total: 5,
        byInstance: {},
      },
      config: {
        source: "env",
        sourceDetails: "GITLAB_API_URL",
        oauthEnabled: true,
      },
      ...overrides,
    };
  }

  describe("renderDashboard", () => {
    it("should render valid HTML document", () => {
      const metrics = createMockMetrics();
      const html = renderDashboard(metrics);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
    });

    it("should include server version in title", () => {
      const metrics = createMockMetrics();
      const html = renderDashboard(metrics);

      expect(html).toContain("GitLab MCP Server");
      expect(html).toContain("6.52.0");
    });

    it("should include auto-refresh meta tag", () => {
      const metrics = createMockMetrics();
      const html = renderDashboard(metrics);

      expect(html).toContain('meta http-equiv="refresh" content="30"');
    });

    it("should display session count", () => {
      const metrics = createMockMetrics({ sessions: { total: 12, byInstance: {} } });
      const html = renderDashboard(metrics);

      expect(html).toContain("Sessions: 12");
    });

    it("should display auth mode for OAuth", () => {
      const metrics = createMockMetrics({
        server: { ...createMockMetrics().server, mode: "oauth" },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("OAuth 2.1");
    });

    it("should display auth mode for Static Token", () => {
      const metrics = createMockMetrics({
        server: { ...createMockMetrics().server, mode: "token" },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("Static Token");
    });

    it("should display auth mode for None", () => {
      const metrics = createMockMetrics({
        server: { ...createMockMetrics().server, mode: "none" },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("Mode: None");
    });

    it("should display instance cards when instances are configured", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "GitLab.com",
            status: "healthy",
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
            latency: { avgMs: 142 },
            lastHealthCheck: new Date().toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("GitLab.com");
      expect(html).toContain("https://gitlab.com");
      expect(html).toContain("17.2.0");
      expect(html).toContain("[Healthy]");
    });

    it("should display degraded status indicator", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://slow.gitlab.com",
            label: "Slow GitLab",
            status: "degraded",
            version: "16.0.0",
            tier: "free",
            introspected: false,
            rateLimit: {
              activeRequests: 2,
              maxConcurrent: 20,
              queuedRequests: 3,
              queueSize: 50,
              totalRequests: 56,
              rejectedRequests: 0,
            },
            latency: { avgMs: 2341 },
            lastHealthCheck: new Date().toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("[Degraded]");
    });

    it("should display offline status indicator", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://offline.gitlab.com",
            label: null,
            status: "offline",
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
            latency: { avgMs: 0 },
            lastHealthCheck: null,
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("[Offline]");
    });

    it("should display warning for high latency", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://slow.gitlab.com",
            label: "Slow",
            status: "degraded",
            version: "16.0.0",
            tier: "free",
            introspected: false,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 100,
              rejectedRequests: 0,
            },
            latency: { avgMs: 3000 },
            lastHealthCheck: new Date().toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("High latency detected");
    });

    it("should escape HTML in labels to prevent XSS", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "<script>alert('xss')</script>",
            status: "healthy",
            version: "17.0.0",
            tier: "ultimate",
            introspected: true,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 0,
              rejectedRequests: 0,
            },
            latency: { avgMs: 0 },
            lastHealthCheck: null,
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("should display no instances message when none configured", () => {
      const metrics = createMockMetrics({ instances: [] });
      const html = renderDashboard(metrics);

      expect(html).toContain("No instances configured");
    });

    it("should display configuration section", () => {
      const metrics = createMockMetrics({
        server: {
          ...createMockMetrics().server,
          readOnly: true,
          toolsEnabled: 30,
          toolsTotal: 44,
        },
        config: {
          source: "file",
          sourceDetails: "/etc/gitlab-mcp/instances.yaml",
          oauthEnabled: true,
        },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("Read-only:");
      expect(html).toContain("Yes");
      expect(html).toContain("Tools enabled:");
      expect(html).toContain("30/44");
      expect(html).toContain("Config source:");
      expect(html).toContain("file");
    });

    it("should display sessions section", () => {
      const metrics = createMockMetrics({
        sessions: {
          total: 12,
          byInstance: {
            "https://gitlab.com": 8,
            "https://git.corp.io": 4,
          },
        },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("Active Sessions");
      expect(html).toContain("Total: 12 sessions");
    });

    it("should display no sessions message when none active", () => {
      const metrics = createMockMetrics({
        sessions: {
          total: 0,
          byInstance: {},
        },
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("No active sessions");
    });

    it("should include CSS styles", () => {
      const metrics = createMockMetrics();
      const html = renderDashboard(metrics);

      expect(html).toContain("<style>");
      expect(html).toContain("--bg-primary");
      expect(html).toContain("--healthy");
      expect(html).toContain("--degraded");
      expect(html).toContain("--offline");
    });

    it("should include footer with refresh info", () => {
      const metrics = createMockMetrics();
      const html = renderDashboard(metrics);

      expect(html).toContain("Auto-refresh: 30s");
      expect(html).toContain("Last updated:");
    });

    it("should handle unknown status gracefully", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "Test",
            status: "unknown" as "healthy", // Cast to bypass type check for testing
            version: "17.0.0",
            tier: "free",
            introspected: false,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 0,
              rejectedRequests: 0,
            },
            latency: { avgMs: 0 },
            lastHealthCheck: null,
          },
        ],
      });
      const html = renderDashboard(metrics);

      // Should show unknown status indicator (?)
      expect(html).toContain("status-unknown");
    });

    it("should handle invalid URL in instance gracefully", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "not-a-valid-url",
            label: null,
            status: "healthy",
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
            latency: { avgMs: 0 },
            lastHealthCheck: null,
          },
        ],
      });
      const html = renderDashboard(metrics);

      // Should fall back to raw URL when parsing fails
      expect(html).toContain("not-a-valid-url");
    });

    it("should display queue filling warning when queue is over 50%", () => {
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://busy.gitlab.com",
            label: "Busy",
            status: "degraded",
            version: "17.0.0",
            tier: "premium",
            introspected: true,
            rateLimit: {
              activeRequests: 50,
              maxConcurrent: 100,
              queuedRequests: 300, // 60% of queueSize
              queueSize: 500,
              totalRequests: 1000,
              rejectedRequests: 0,
            },
            latency: { avgMs: 500 },
            lastHealthCheck: new Date().toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("Queue filling up");
    });

    it("should format lastHealthCheck as hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "Test",
            status: "healthy",
            version: "17.0.0",
            tier: "free",
            introspected: true,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 100,
              rejectedRequests: 0,
            },
            latency: { avgMs: 50 },
            lastHealthCheck: twoHoursAgo.toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("2h ago");
    });

    it("should format lastHealthCheck as days ago", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "Test",
            status: "offline",
            version: "17.0.0",
            tier: "free",
            introspected: true,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 100,
              rejectedRequests: 0,
            },
            latency: { avgMs: 50 },
            lastHealthCheck: threeDaysAgo.toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("3d ago");
    });

    it("should format lastHealthCheck as 1h ago", () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const metrics = createMockMetrics({
        instances: [
          {
            url: "https://gitlab.com",
            label: "Test",
            status: "healthy",
            version: "17.0.0",
            tier: "free",
            introspected: true,
            rateLimit: {
              activeRequests: 0,
              maxConcurrent: 100,
              queuedRequests: 0,
              queueSize: 500,
              totalRequests: 100,
              rejectedRequests: 0,
            },
            latency: { avgMs: 50 },
            lastHealthCheck: oneHourAgo.toISOString(),
          },
        ],
      });
      const html = renderDashboard(metrics);

      expect(html).toContain("1h ago");
    });

    it("should handle invalid URL in sessions byInstance gracefully", () => {
      const metrics = createMockMetrics({
        sessions: {
          total: 5,
          byInstance: {
            "invalid-url": 3,
            "https://gitlab.com": 2,
          },
        },
      });
      const html = renderDashboard(metrics);

      // Should fall back to raw URL when parsing fails
      expect(html).toContain("invalid-url");
      expect(html).toContain("gitlab.com");
    });
  });
});
