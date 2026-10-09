/**
 * RFC 6749 §5.1: omitted scope means the original requested grant was issued.
 * https://www.rfc-editor.org/rfc/rfc6749#section-5.1
 * Persisted flows predating scope tracking remain unknown when both are absent.
 */
export function grantedGitlabScopes(
  scope: string | undefined,
  requested: string[] | undefined,
): string[] | undefined {
  return scope === undefined ? requested : scope.split(/\s+/).filter(Boolean);
}
