/**
 * Dashboard Metrics Collector
 *
 * Aggregates metrics from various services:
 * - Instance Registry (GitLab instances, rate limits)
 * - Session Manager (active sessions)
 * - Server configuration (auth mode, tools, read-only)
 */

import { z } from "zod";
import { InstanceRegistry, InstanceSummary } from "../services/InstanceRegistry.js";
import { getSessionManager } from "../session-manager.js";
import { packageVersion, GITLAB_READ_ONLY_MODE, GITLAB_BASE_URL, GITLAB_TOKEN } from "../config.js";
import { isOAuthEnabled } from "../oauth/index.js";
import { RegistryManager } from "../registry-manager.js";
import { ConnectionStatus } from "../config/instances-schema.js";

/**
 * Server startup timestamp for uptime calculation
 */
const serverStartTime = Date.now();

/**
 * Instance status with calculated health metrics
 */
export const InstanceStatusSchema = z.object({
  url: z.string().describe("GitLab instance URL"),
  label: z.string().nullable().describe("Human-readable label for UI display"),
  status: z.enum(["healthy", "degraded", "offline"]).describe("Instance health status"),
  version: z.string().nullable().describe("GitLab version"),
  tier: z.string().nullable().describe("Instance tier (free/premium/ultimate)"),
  introspected: z.boolean().describe("Whether schema introspection was successful"),
  rateLimit: z
    .object({
      activeRequests: z.number().describe("Current number of active requests"),
      maxConcurrent: z.number().describe("Maximum concurrent requests allowed"),
      queuedRequests: z.number().describe("Current number of queued requests"),
      queueSize: z.number().describe("Maximum queue size"),
      totalRequests: z.number().describe("Total requests processed"),
      rejectedRequests: z.number().describe("Total requests rejected due to full queue"),
    })
    .describe("Rate limit metrics for this instance"),
  latency: z
    .object({
      avgMs: z.number().describe("Average queue wait time in milliseconds"),
    })
    .describe("Latency metrics"),
  lastHealthCheck: z.string().nullable().describe("ISO timestamp of last health check"),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

/**
 * Complete dashboard metrics
 */
export const DashboardMetricsSchema = z.object({
  server: z
    .object({
      version: z.string().describe("Server version"),
      uptime: z.number().describe("Server uptime in seconds"),
      mode: z.enum(["oauth", "token", "none"]).describe("Authentication mode"),
      readOnly: z.boolean().describe("Whether server is in read-only mode"),
      toolsEnabled: z.number().describe("Number of enabled tools"),
      toolsTotal: z.number().describe("Total number of available tools"),
    })
    .describe("Server information"),
  instances: z.array(InstanceStatusSchema).describe("Registered GitLab instances"),
  sessions: z
    .object({
      total: z.number().describe("Total active sessions"),
      byInstance: z.record(z.string(), z.number()).describe("Sessions per instance URL"),
    })
    .describe("Session statistics (anonymized)"),
  config: z
    .object({
      source: z.string().describe("Configuration source type"),
      sourceDetails: z.string().describe("Configuration source details"),
      oauthEnabled: z.boolean().describe("Whether OAuth is enabled"),
    })
    .describe("Configuration information"),
});

export type DashboardMetrics = z.infer<typeof DashboardMetricsSchema>;

/**
 * Determine instance health status based on metrics
 *
 * Status criteria:
 * - offline: No successful request in last 5 minutes
 * - degraded: High latency (>2000ms), queue >50% capacity, or high error rate
 * - healthy: Normal operation
 */
export function determineInstanceStatus(instance: InstanceSummary): ConnectionStatus {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  // Check for offline status: no health check or check too old
  if (instance.lastHealthCheck === null) {
    // No health check yet - consider healthy if recently registered
    return "healthy";
  }

  const lastCheckMs = instance.lastHealthCheck.getTime();
  if (lastCheckMs < fiveMinutesAgo) {
    return "offline";
  }

  // Check for degraded status
  const metrics = instance.rateLimit;

  // High average queue wait time (>2000ms)
  if (metrics.avgQueueWaitMs > 2000) {
    return "degraded";
  }

  // Queue > 50% capacity
  if (metrics.queuedRequests > metrics.queueSize * 0.5) {
    return "degraded";
  }

  // High rejection rate (>10% of total requests)
  if (metrics.requestsTotal > 0 && metrics.requestsRejected / metrics.requestsTotal > 0.1) {
    return "degraded";
  }

  return "healthy";
}

/**
 * Convert InstanceSummary to InstanceStatus for dashboard
 */
function toInstanceStatus(summary: InstanceSummary): InstanceStatus {
  const status = determineInstanceStatus(summary);

  return {
    url: summary.url,
    label: summary.label ?? null,
    status,
    version: summary.introspection.version,
    tier: summary.introspection.tier,
    introspected: summary.introspection.version !== null && !summary.introspection.isExpired,
    rateLimit: {
      activeRequests: summary.rateLimit.activeRequests,
      maxConcurrent: summary.rateLimit.maxConcurrent,
      queuedRequests: summary.rateLimit.queuedRequests,
      queueSize: summary.rateLimit.queueSize,
      totalRequests: summary.rateLimit.requestsTotal,
      rejectedRequests: summary.rateLimit.requestsRejected,
    },
    latency: {
      avgMs: summary.rateLimit.avgQueueWaitMs,
    },
    lastHealthCheck: summary.lastHealthCheck?.toISOString() ?? null,
  };
}

/**
 * Get authentication mode string
 */
function getAuthMode(): "oauth" | "token" | "none" {
  if (isOAuthEnabled()) {
    return "oauth";
  }

  // Check for static token using config constant
  if (GITLAB_TOKEN) {
    return "token";
  }

  return "none";
}

/**
 * Get tool counts from registry
 */
function getToolCounts(): { enabled: number; total: number } {
  try {
    const registry = RegistryManager.getInstance();
    const tools = registry.getAllToolDefinitions();
    return {
      enabled: tools.length,
      total: tools.length, // In current implementation, all available tools are enabled
    };
  } catch {
    return { enabled: 0, total: 0 };
  }
}

/**
 * Collect all dashboard metrics
 */
export function collectMetrics(): DashboardMetrics {
  const instanceRegistry = InstanceRegistry.getInstance();
  const sessionManager = getSessionManager();

  // Get instances
  const instanceSummaries = instanceRegistry.list();
  const instances = instanceSummaries.map(toInstanceStatus);

  // If no instances registered, create a default entry for GITLAB_BASE_URL
  if (instances.length === 0 && GITLAB_BASE_URL) {
    instances.push({
      url: GITLAB_BASE_URL,
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
    });
  }

  // Get config source
  const configSource = instanceRegistry.getConfigSource();

  // Get tool counts
  const toolCounts = getToolCounts();

  // Calculate uptime
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

  // Session counts by instance (anonymized - just counts, no user info)
  // Note: Current SessionManager doesn't track per-instance sessions
  // This would require extending the architecture to track which instance each session uses
  const sessionsByInstance: Record<string, number> = {};

  return {
    server: {
      version: packageVersion,
      uptime: uptimeSeconds,
      mode: getAuthMode(),
      readOnly: GITLAB_READ_ONLY_MODE,
      toolsEnabled: toolCounts.enabled,
      toolsTotal: toolCounts.total,
    },
    instances,
    sessions: {
      total: sessionManager.activeSessionCount,
      byInstance: sessionsByInstance,
    },
    config: {
      source: configSource.source,
      sourceDetails: configSource.details,
      oauthEnabled: isOAuthEnabled(),
    },
  };
}

/**
 * Format uptime as human-readable string
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}
