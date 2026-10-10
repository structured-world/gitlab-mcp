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

/**
 * Resource a `resource` request parameter names: undefined when absent, null when it must be
 * refused with invalid_target. RFC 8707 section 2 lets the parameter repeat; a token here has
 * one audience, so every value must name the same resource of this server, and a request the
 * server cannot issue one token for is refused (same section).
 * https://www.rfc-editor.org/rfc/rfc8707#section-2
 */
export function resourceParameter(issuer: string, value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  let named: string | undefined;
  for (const entry of Array.isArray(value) ? value : [value]) {
    const match = typeof entry === 'string' ? matchProtectedResource(issuer, entry) : undefined;
    if (match === undefined || (named !== undefined && named !== match)) return null;
    named = match;
  }
  return named ?? null;
}

/** Resource tokens are issued for when the client did not name one. */
export function defaultResource(issuer: string): string {
  return protectedResources(issuer)[1];
}

/**
 * Client authentication methods the token and revocation endpoints support (advertised
 * for both, the only ones /register accepts).
 */
export const TOKEN_ENDPOINT_AUTH_METHODS: readonly string[] = [
  'none',
  'client_secret_basic',
  'client_secret_post',
];

/** MCP scopes this server grants (advertised as `scopes_supported`). */
export const MCP_SCOPES: readonly string[] = ['mcp:tools', 'mcp:resources'];

/**
 * Scopes granted for a requested `scope` value. Unknown values are ignored and an empty
 * result grants the full set: RFC 6749 section 3.3 lets the server "fully or partially
 * ignore the scope requested by the client" and apply its default, and the token response
 * always reports the granted scope.
 * https://www.rfc-editor.org/rfc/rfc6749#section-3.3
 * A request of only unknown values (`openid`, `offline_access`, which many clients send by
 * default) is therefore not refused with `invalid_scope`: it gains nothing a request
 * without `scope` would not get, and refusing it would break those clients.
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
