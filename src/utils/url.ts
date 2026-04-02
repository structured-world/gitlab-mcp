/** Strip trailing slashes and known API path suffixes so equivalent URLs
 *  (e.g. `https://host/`, `https://host/api/v4`) map to the same key.
 *  Note: InstanceRegistry has an equivalent private normalizeUrl() method —
 *  consolidating them is tracked but deferred to avoid touching InstanceRegistry in this PR. */
export function normalizeInstanceUrl(url: string): string {
  if (!url) return url;
  // Strip trailing slashes (single-pass scan, no regex — avoids ReDoS)
  let normalized = url;
  let end = normalized.length - 1;
  while (end >= 0 && normalized.charCodeAt(end) === 47 /* '/' */) {
    end -= 1;
  }
  if (end < normalized.length - 1) {
    normalized = normalized.slice(0, end + 1);
  }
  // Strip known API path suffixes
  if (normalized.endsWith('/api/v4')) {
    normalized = normalized.slice(0, -7);
  } else if (normalized.endsWith('/api/graphql')) {
    normalized = normalized.slice(0, -12);
  }
  return normalized;
}
