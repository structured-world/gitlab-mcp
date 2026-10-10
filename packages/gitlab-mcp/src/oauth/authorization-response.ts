/**
 * Authorization response redirects
 *
 * Every response from the authorization endpoint to the client's redirect URI, success or
 * error, carries `iss` so the client can tell which server answered (RFC 9207 section 2).
 */

/**
 * Build the redirect to a client's redirect URI with the given response parameters plus
 * `iss`. Empty or undefined values are omitted (an absent client `state` stays absent).
 */
export function authorizationRedirect(
  redirectUri: string,
  issuer: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(name, value);
    }
  }
  url.searchParams.set('iss', issuer);
  return url.toString();
}
