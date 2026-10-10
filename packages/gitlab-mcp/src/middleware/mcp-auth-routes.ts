/**
 * Routes of the MCP transports that require OAuth: Streamable HTTP (`/`, `/mcp`) and the
 * SSE transport (`/sse`, `/messages`), which runs tools too.
 */

import type { Express, RequestHandler } from 'express';

export const MCP_TRANSPORT_PATHS = ['/', '/mcp', '/sse', '/messages'];

/**
 * Run `authenticate` before every MCP transport route. Exact routes, not a mount: a mount
 * strips its path from `req.path`, from which the check derives the protected resource.
 */
export function authenticateMcpTransports(app: Express, authenticate: RequestHandler): void {
  app.all(MCP_TRANSPORT_PATHS, authenticate);
}
