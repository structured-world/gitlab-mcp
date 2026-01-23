/**
 * Parse a version string into a comparable integer.
 * Uses major * 100 + minor encoding to correctly handle minor >= 10
 * (e.g., "16.11.0" → 1611, "8.14.2" → 814).
 *
 * @param version - Version string like "16.11.0-ee", "15.0", or "unknown"
 * @returns Comparable integer (0 for unparseable versions)
 * @example parseVersion("16.11.0-ee") // 1611
 * @example parseVersion("unknown") // 0
 */
export function parseVersion(version: string): number {
  if (!version || version === "unknown") return 0;

  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return 0;

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);

  return major * 100 + minor;
}
