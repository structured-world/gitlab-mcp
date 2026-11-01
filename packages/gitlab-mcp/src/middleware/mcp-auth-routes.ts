/**
 * Routes of the MCP transports that require OAuth: Streamable HTTP (`/`, `/mcp`) and the
 * SSE transport (`/sse`, `/messages`), which runs tools too.
 */

import type { Express, Request, RequestHandler } from 'express';

export const MCP_TRANSPORT_PATHS = ['/', '/mcp', '/sse', '/messages'];
// Match Express's default case-insensitive, optional-trailing-slash route behavior.
const transportPath = new RegExp(
  `^(?:${MCP_TRANSPORT_PATHS.map((path) => (path === '/' ? path : `${path}/?`)).join('|')})$`,
  'i',
);

/** Root streaming GETs belong to MCP, even when the public dashboard is enabled.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server
 */
export function isMcpTransportRequest(req: Request, dashboardEnabled: boolean): boolean {
  if (!transportPath.test(req.path)) return false;
  if (req.path !== '/' || (req.method !== 'GET' && req.method !== 'HEAD') || !dashboardEnabled)
    return true;
  return (
    Boolean(req.headers['mcp-session-id']) ||
    /(?:^|,)\s*text\/event-stream\s*(?:;|,|$)/i.test(req.headers.accept ?? '')
  );
}

/**
 * Run `authenticate` before every MCP transport route. Exact routes, not a mount: a mount
 * strips its path from `req.path`, from which the check derives the protected resource.
 */
export function authenticateMcpTransports(app: Express, authenticate: RequestHandler): void {
  app.all(MCP_TRANSPORT_PATHS, authenticate);
}
