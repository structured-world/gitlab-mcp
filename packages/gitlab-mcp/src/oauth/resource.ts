/**
 * Protected resource identifiers
 *
 * MCP is served at the issuer root (Claude.ai custom connectors) and at `/mcp`. Each
 * is an RFC 8707 resource with its own RFC 9728 metadata document, so a client that
 * checks the metadata `resource` against the URL it connected to accepts either.
 */

/** Resource identifiers of this server: the root and the `/mcp` endpoint. */
export function protectedResources(issuer: string): [root: string, mcp: string] {
  return [issuer, `${issuer}/mcp`];
}

/** Whether `value` is one of this server's resource identifiers (exact match). */
export function isProtectedResource(issuer: string, value: string): boolean {
  return protectedResources(issuer).includes(value);
}

/** Resource a request path belongs to: `/mcp...` is the `/mcp` endpoint, anything else the root. */
export function resourceForPath(issuer: string, requestPath: string): string {
  const [root, mcp] = protectedResources(issuer);
  return requestPath === '/mcp' || requestPath.startsWith('/mcp/') ? mcp : root;
}

/** Metadata URL of a resource: RFC 9728 section 3.1 puts the well-known segment before the path. */
export function resourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}
