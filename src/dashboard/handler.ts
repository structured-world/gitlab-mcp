/**
 * Dashboard HTTP Handler
 *
 * Handles GET / requests and returns:
 * - HTML dashboard when Accept header includes text/html or wildcard
 * - JSON metrics when Accept header is application/json
 */

import { Request, Response } from "express";
import { collectMetrics, DashboardMetrics } from "./metrics.js";
import { renderDashboard } from "./html-template.js";
import { logDebug } from "../logger.js";

// Determine if request prefers HTML response
//
// Returns true for:
// - Accept: text/html
// - Accept: */* (browser default)
// - No Accept header (treat as browser)
//
// Returns false for:
// - Accept: application/json
function prefersHtml(req: Request): boolean {
  const accept = req.headers.accept ?? "*/*";

  // Explicit JSON request
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return false;
  }

  // HTML or wildcard (browser default)
  return accept.includes("text/html") || accept.includes("*/*");
}

/**
 * Dashboard endpoint handler
 *
 * Returns server health dashboard as HTML or JSON based on Accept header.
 * Safe for MCP clients - they use POST /mcp or SSE endpoints, not GET /.
 *
 * @param req - Express request
 * @param res - Express response
 */
export function dashboardHandler(req: Request, res: Response): void {
  const metrics = collectMetrics();

  logDebug("Dashboard request", {
    accept: req.headers.accept,
    prefersHtml: prefersHtml(req),
  });

  if (prefersHtml(req)) {
    res.type("text/html").send(renderDashboard(metrics));
  } else {
    res.json(metrics);
  }
}

/**
 * Get dashboard metrics without rendering
 * Useful for programmatic access or testing
 */
export function getMetrics(): DashboardMetrics {
  return collectMetrics();
}
