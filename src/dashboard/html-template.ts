/**
 * Dashboard HTML Template
 *
 * Generates HTML dashboard with inline CSS for server health visualization.
 * Auto-refreshes every 30 seconds.
 */

import { DashboardMetrics, InstanceStatus, formatUptime } from "./metrics.js";

/**
 * Get status indicator symbol and color class
 */
function getStatusIndicator(status: string): { symbol: string; colorClass: string } {
  switch (status) {
    case "healthy":
      return { symbol: "●", colorClass: "status-healthy" };
    case "degraded":
      return { symbol: "○", colorClass: "status-degraded" };
    case "offline":
      return { symbol: "○", colorClass: "status-offline" };
    default:
      return { symbol: "?", colorClass: "status-unknown" };
  }
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

/**
 * Generate instance card HTML
 */
function renderInstanceCard(instance: InstanceStatus): string {
  const { symbol, colorClass } = getStatusIndicator(instance.status);
  const statusLabel = instance.status.charAt(0).toUpperCase() + instance.status.slice(1);
  const displayName = instance.label ?? new URL(instance.url).hostname;

  const warnings: string[] = [];
  if (instance.latency.avgMs > 2000) {
    warnings.push("High latency detected");
  }
  if (instance.rateLimit.queuedRequests > instance.rateLimit.queueSize * 0.5) {
    warnings.push("Queue filling up");
  }

  return `
    <div class="instance-card">
      <div class="instance-header">
        <span class="${colorClass}">${symbol}</span>
        <span class="instance-name">${escapeHtml(displayName)}</span>
        <span class="instance-status ${colorClass}">[${statusLabel}]</span>
      </div>
      <div class="instance-details">
        <div class="detail-row">
          <span class="detail-label">URL:</span>
          <span class="detail-value">${escapeHtml(instance.url)}</span>
        </div>
        ${
          instance.version
            ? `
        <div class="detail-row">
          <span class="detail-label">Version:</span>
          <span class="detail-value">${escapeHtml(instance.version)}${instance.tier ? ` | Tier: ${escapeHtml(instance.tier.charAt(0).toUpperCase() + instance.tier.slice(1))}` : ""}</span>
        </div>
        `
            : ""
        }
        <div class="detail-row">
          <span class="detail-label">Introspected:</span>
          <span class="detail-value">${instance.introspected ? "✓" : "✗"}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requests:</span>
          <span class="detail-value">${formatNumber(instance.rateLimit.activeRequests)}/${formatNumber(instance.rateLimit.maxConcurrent)} active | ${formatNumber(instance.rateLimit.queuedRequests)} queued | ${formatNumber(instance.rateLimit.totalRequests)} total</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Avg latency:</span>
          <span class="detail-value">${formatNumber(instance.latency.avgMs)}ms${instance.lastHealthCheck ? ` | Last check: ${formatRelativeTime(instance.lastHealthCheck)}` : ""}</span>
        </div>
        ${
          warnings.length > 0
            ? warnings
                .map(
                  w => `
        <div class="detail-row warning">
          <span class="warning-icon">⚠</span>
          <span class="warning-text">${escapeHtml(w)}</span>
        </div>
        `
                )
                .join("")
            : ""
        }
      </div>
    </div>
  `;
}

/**
 * Format relative time from ISO string
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes === 1) return "1m ago";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "1h ago";
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Get overall server status based on instances
 */
function getOverallStatus(instances: InstanceStatus[]): "healthy" | "degraded" | "offline" {
  if (instances.length === 0) return "healthy";

  const statuses = instances.map(i => i.status);
  if (statuses.every(s => s === "offline")) return "offline";
  if (statuses.some(s => s === "offline" || s === "degraded")) return "degraded";
  return "healthy";
}

/**
 * Generate complete HTML dashboard
 */
export function renderDashboard(metrics: DashboardMetrics): string {
  const overallStatus = getOverallStatus(metrics.instances);
  const { colorClass: statusClass } = getStatusIndicator(overallStatus);
  const statusLabel = overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1);

  const authModeDisplay =
    metrics.server.mode === "oauth"
      ? "OAuth 2.1"
      : metrics.server.mode === "token"
        ? "Static Token"
        : "None";

  const currentTime = new Date().toLocaleTimeString("en-US", { hour12: false });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>GitLab MCP Server Dashboard</title>
  <style>
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-card: #0f3460;
      --text-primary: #eee;
      --text-secondary: #aaa;
      --accent: #e94560;
      --healthy: #4ade80;
      --degraded: #fbbf24;
      --offline: #ef4444;
      --border-radius: 8px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Liberation Mono', Menlo, monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 20px;
      min-height: 100vh;
    }

    .dashboard {
      max-width: 900px;
      margin: 0 auto;
      border: 1px solid var(--bg-card);
      border-radius: var(--border-radius);
      overflow: hidden;
    }

    .header {
      background: var(--bg-secondary);
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--bg-card);
    }

    .header-title {
      font-size: 1.2em;
      font-weight: bold;
    }

    .header-status {
      font-weight: bold;
    }

    .header-meta {
      color: var(--text-secondary);
      font-size: 0.9em;
      padding: 10px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--bg-card);
    }

    .content {
      padding: 20px;
    }

    .section {
      margin-bottom: 24px;
    }

    .section:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 0.85em;
      font-weight: bold;
      color: var(--text-secondary);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .instance-card {
      background: var(--bg-card);
      border-radius: var(--border-radius);
      padding: 16px;
      margin-bottom: 12px;
    }

    .instance-card:last-child {
      margin-bottom: 0;
    }

    .instance-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-weight: bold;
    }

    .instance-name {
      flex: 1;
    }

    .instance-details {
      font-size: 0.9em;
    }

    .detail-row {
      display: flex;
      margin-bottom: 4px;
    }

    .detail-label {
      color: var(--text-secondary);
      min-width: 100px;
    }

    .detail-value {
      color: var(--text-primary);
    }

    .config-list {
      font-size: 0.9em;
    }

    .config-item {
      display: flex;
      margin-bottom: 4px;
      padding-left: 16px;
    }

    .config-item::before {
      content: "├─";
      color: var(--text-secondary);
      margin-right: 8px;
    }

    .config-item:last-child::before {
      content: "└─";
    }

    .config-key {
      color: var(--text-secondary);
      margin-right: 8px;
    }

    .sessions-list {
      font-size: 0.9em;
    }

    .session-item {
      display: flex;
      margin-bottom: 4px;
      padding-left: 16px;
    }

    .session-item::before {
      content: "├─";
      color: var(--text-secondary);
      margin-right: 8px;
    }

    .session-item:last-child::before {
      content: "└─";
    }

    .footer {
      text-align: center;
      padding: 16px;
      color: var(--text-secondary);
      font-size: 0.85em;
      border-top: 1px solid var(--bg-card);
      background: var(--bg-secondary);
    }

    .status-healthy { color: var(--healthy); }
    .status-degraded { color: var(--degraded); }
    .status-offline { color: var(--offline); }
    .status-unknown { color: var(--text-secondary); }

    .warning {
      color: var(--degraded);
      margin-top: 8px;
    }

    .warning-icon {
      margin-right: 8px;
    }

    @media (max-width: 600px) {
      body {
        padding: 10px;
      }

      .header {
        flex-direction: column;
        gap: 8px;
        text-align: center;
      }

      .detail-row {
        flex-direction: column;
      }

      .detail-label {
        min-width: auto;
      }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <span class="header-title">GitLab MCP Server v${escapeHtml(metrics.server.version)}</span>
      <span class="header-status ${statusClass}">[${statusLabel}]</span>
    </div>
    <div class="header-meta">
      Uptime: ${formatUptime(metrics.server.uptime)} | Mode: ${authModeDisplay} | Sessions: ${metrics.sessions.total}
    </div>
    <div class="content">
      <div class="section">
        <div class="section-title">Registered Instances</div>
        ${
          metrics.instances.length > 0
            ? metrics.instances.map(renderInstanceCard).join("")
            : `
        <div class="instance-card">
          <div class="instance-header">
            <span class="status-healthy">●</span>
            <span class="instance-name">No instances configured</span>
          </div>
          <div class="instance-details">
            <div class="detail-row">
              <span class="detail-value">Using default GitLab.com or GITLAB_API_URL</span>
            </div>
          </div>
        </div>
        `
        }
      </div>

      <div class="section">
        <div class="section-title">Configuration</div>
        <div class="config-list">
          <div class="config-item">
            <span class="config-key">Auth mode:</span>
            <span>${authModeDisplay}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Read-only:</span>
            <span>${metrics.server.readOnly ? "Yes" : "No"}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Tools enabled:</span>
            <span>${metrics.server.toolsEnabled}/${metrics.server.toolsTotal}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Config source:</span>
            <span>${escapeHtml(metrics.config.source)}${metrics.config.sourceDetails ? ` (${escapeHtml(metrics.config.sourceDetails)})` : ""}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Active Sessions (anonymized)</div>
        <div class="sessions-list">
          ${
            metrics.sessions.total > 0
              ? `
          <div class="session-item">
            <span>Total: ${metrics.sessions.total} session${metrics.sessions.total === 1 ? "" : "s"}</span>
          </div>
          ${Object.entries(metrics.sessions.byInstance)
            .map(
              ([url, count]) => `
          <div class="session-item">
            <span>${escapeHtml(new URL(url).hostname)}: ${count} session${count === 1 ? "" : "s"}</span>
          </div>
          `
            )
            .join("")}
          `
              : `
          <div class="session-item">
            <span>No active sessions</span>
          </div>
          `
          }
        </div>
      </div>
    </div>
    <div class="footer">
      Auto-refresh: 30s | Last updated: ${currentTime}
    </div>
  </div>
</body>
</html>`;
}
