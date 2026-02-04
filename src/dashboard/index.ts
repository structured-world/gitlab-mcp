/**
 * Dashboard Module Index
 *
 * Exports dashboard-related functionality for server integration.
 */

// Handler
export { dashboardHandler, getMetrics } from "./handler.js";

// Metrics
export {
  collectMetrics,
  formatUptime,
  determineInstanceStatus,
  DashboardMetricsSchema,
  InstanceStatusSchema,
} from "./metrics.js";
export type { DashboardMetrics, InstanceStatus } from "./metrics.js";

// HTML Template
export { renderDashboard } from "./html-template.js";
