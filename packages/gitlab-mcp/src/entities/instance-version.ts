import { ConnectionManager } from '../services/ConnectionManager';
import type { GitLabTier } from '../services/GitLabVersionDetector';
import { getGitLabApiUrlFromContext } from '../oauth/token-context';
import { parseVersion } from '../utils/version';

/**
 * Whether the GitLab instance serving the current request is at least `minVersion`.
 * Used where a version gate cannot live in tool requirements, e.g. a parameter
 * whose availability differs per action. The version is detected at startup, so
 * this is an in-memory read; an unknown version fails open.
 */
export function instanceAtLeast(minVersion: string): boolean {
  const version = currentInstance()?.version ?? 'unknown';
  return version === 'unknown' || parseVersion(version) >= parseVersion(minVersion);
}

/** Detected version/tier of the instance serving the current request, if known. */
export function currentInstance(): { version: string; tier: GitLabTier } | undefined {
  try {
    return ConnectionManager.getInstance().getInstanceInfo(getGitLabApiUrlFromContext());
  } catch {
    // Connection not initialised: nothing is known yet.
    return undefined;
  }
}

/**
 * Whether the GraphQL schema of the instance serving the current request has the
 * type, field and argument. Lets a handler pick its native query or a fallback
 * from what the instance actually exposes (version, edition and feature flags
 * alike). True when the schema is not known yet (fail-open to the native path).
 */
export function graphqlSupports(typeName: string, fieldName?: string, argName?: string): boolean {
  let index;
  try {
    index = ConnectionManager.getInstance().getSchemaInfo(getGitLabApiUrlFromContext()).fieldIndex;
  } catch {
    return true;
  }
  if (!index) return true;
  const fields = index.get(typeName);
  if (!fields) return false;
  if (!fieldName) return true;
  const field = fields.get(fieldName);
  if (!field) return false;
  return !argName || field.args.has(argName);
}

/** Throw a clear error when the instance is older than `minVersion` for `feature`. */
export function assertInstanceAtLeast(minVersion: string, feature: string): void {
  if (!instanceAtLeast(minVersion)) {
    throw new Error(`${feature} requires GitLab ${minVersion}+`);
  }
}
