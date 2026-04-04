/** Strip trailing slashes, known API path suffixes, and default ports so
 *  equivalent URLs (e.g. `https://host/`, `https://host/api/v4`,
 *  `https://host:443`) map to the same key.
 *  Used by both ConnectionManager and InstanceRegistry for consistent lookups. */
export function normalizeInstanceUrl(url: string): string {
  if (!url) return url;

  const trimTrailingSlashes = (value: string): string => {
    let end = value.length - 1;
    while (end >= 0 && value.codePointAt(end) === 47 /* '/' */) {
      end -= 1;
    }
    return end < value.length - 1 ? value.slice(0, end + 1) : value;
  };

  // Strip trailing slashes (single-pass scan, no regex — avoids ReDoS)
  let normalized = trimTrailingSlashes(url);
  // Strip known API path suffixes
  if (normalized.endsWith('/api/v4')) {
    normalized = normalized.slice(0, -7);
  } else if (normalized.endsWith('/api/graphql')) {
    normalized = normalized.slice(0, -12);
  }
  // Trim again — suffix removal can expose new trailing slashes
  // (e.g. "https://host//api/v4" → "https://host/")
  normalized = trimTrailingSlashes(normalized);

  // Strip default ports so equivalent URLs (e.g. https://host vs https://host:443)
  // map to the same key in instances/inflight caches.
  // Node's URL constructor normalizes default ports automatically —
  // reconstruct via origin + pathname to get the canonical form.
  try {
    const u = new URL(normalized);
    // Re-strip API suffixes from parsed pathname — URL constructor drops
    // query/hash but preserves path, so "https://host/api/v4?token=x"
    // would otherwise keep the suffix after parsing.
    let pathname = trimTrailingSlashes(u.pathname);
    if (pathname.endsWith('/api/v4')) {
      pathname = pathname.slice(0, -7);
    } else if (pathname.endsWith('/api/graphql')) {
      pathname = pathname.slice(0, -12);
    }
    pathname = trimTrailingSlashes(pathname);
    return `${u.origin}${pathname}`;
  } catch {
    return normalized;
  }
}
