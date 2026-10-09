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

/**
 * Resource identifier a client-supplied `resource` parameter names, or undefined when it
 * names none of ours. An origin-only resource also matches with a trailing `/`, the same
 * URI per RFC 3986 section 6.2.3.
 */
export function matchProtectedResource(issuer: string, value: string): string | undefined {
  return protectedResources(issuer).find(
    (resource) =>
      resource === value || (new URL(resource).pathname === '/' && `${resource}/` === value),
  );
}

/** Resource tokens are issued for when the client did not name one. */
export function defaultResource(issuer: string): string {
  return protectedResources(issuer)[1];
}

/** MCP scopes this server grants (advertised as `scopes_supported`). */
export const MCP_SCOPES: readonly string[] = ['mcp:tools', 'mcp:resources'];

/**
 * Scopes granted for a requested `scope` value. Unknown values are ignored and an empty
 * result grants the full set; RFC 6749 section 3.3 allows both, and the token response
 * always reports the granted scope.
 */
export function grantedMcpScopes(requested: string | undefined): string[] {
  const asked = (requested ?? '').split(' ').filter((scope) => MCP_SCOPES.includes(scope));
  return asked.length > 0 ? [...new Set(asked)] : [...MCP_SCOPES];
}

/** Resource a request path belongs to: `/mcp...` is the `/mcp` endpoint, anything else the root. */
export function resourceForPath(issuer: string, requestPath: string): string {
  const [root, mcp] = protectedResources(issuer);
  return requestPath === '/mcp' || requestPath.startsWith('/mcp/') ? mcp : root;
}

/** `wellKnown` inserted between the origin and the path of `identifier`. */
function insertWellKnown(identifier: string, wellKnown: string): string {
  const url = new URL(identifier);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/${wellKnown}${path}`;
}

/** Metadata URL of a resource: RFC 9728 section 3.1 puts the well-known segment before the path. */
export function resourceMetadataUrl(resource: string): string {
  return insertWellKnown(resource, 'oauth-protected-resource');
}

/** Metadata URL of an issuer, built the same way (RFC 8414 section 3.1). */
export function authorizationServerMetadataUrl(issuer: string): string {
  return insertWellKnown(issuer, 'oauth-authorization-server');
}

/** Resource whose metadata document is served at `requestPath`, if any. */
export function resourceForMetadataPath(issuer: string, requestPath: string): string | undefined {
  return protectedResources(issuer).find(
    (resource) => new URL(resourceMetadataUrl(resource)).pathname === requestPath,
  );
}
