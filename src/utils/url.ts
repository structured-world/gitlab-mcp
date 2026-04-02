/** Strip trailing slashes and known API path suffixes so equivalent URLs
 *  (e.g. `https://host/`, `https://host/api/v4`) map to the same key.
 *  Note: InstanceRegistry has an equivalent private normalizeUrl() method —
 *  consolidating them is tracked but deferred to avoid touching InstanceRegistry in this PR. */
export function normalizeInstanceUrl(url: string): string {
  if (!url) return url;
  // Strip trailing slashes first (no regex — avoids ReDoS on pathological input)
  let normalized = url;
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  // Strip known API path suffixes
  if (normalized.endsWith('/api/v4')) {
    normalized = normalized.slice(0, -7);
  } else if (normalized.endsWith('/api/graphql')) {
    normalized = normalized.slice(0, -12);
  }
  return normalized;
}
