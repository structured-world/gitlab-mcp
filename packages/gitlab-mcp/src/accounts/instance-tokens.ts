/**
 * Static tokens of the configured instances. A static token belongs to one instance: the
 * server's own token to its instance, a configured instance's token variable to that
 * instance. A request is authenticated with the token of the instance it goes to.
 */

import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { InstanceRegistry } from '../services/InstanceRegistry';
import { normalizeInstanceUrl } from '../utils/url';

/**
 * The static token for an instance: the server's own token for its instance, else the
 * token variable configured for that instance; undefined when there is none. The server's
 * own instance is the one GITLAB_API_URL names, so a configured instance without a token
 * variable has no token even when it is the only one configured: GITLAB_TOKEN never goes
 * to a host other than the server's own.
 */
export function configuredInstanceToken(instanceUrl: string): string | undefined {
  const url = normalizeInstanceUrl(instanceUrl);
  if (url === serverInstance()) return GITLAB_TOKEN;
  const registry = InstanceRegistry.getInstance();
  if (!registry.isInitialized()) return undefined;
  const tokenEnv = registry.getConfig(url)?.tokenEnv;
  const token = tokenEnv ? process.env[tokenEnv] : undefined;
  // A variable that is set but empty holds no token.
  return token === '' ? undefined : token;
}

/**
 * The configured instance a request URL goes to: the server's own instance or a registered
 * one whose base URL the request URL starts with (the longest, for subpath deployments).
 */
export function configuredInstanceFor(requestUrl: string): string | undefined {
  let match = belongsTo(requestUrl, serverInstance()) ? serverInstance() : undefined;
  const registry = InstanceRegistry.getInstance();
  if (!registry.isInitialized()) return match;
  // Registry keys are normalized when instances register.
  for (const base of registry.getUrls()) {
    if (belongsTo(requestUrl, base) && (!match || base.length > match.length)) match = base;
  }
  return match;
}

/** Whether `requestUrl` is `base` or a path below it (segment-wise, not a string prefix). */
function belongsTo(requestUrl: string, base: string | undefined): boolean {
  if (!base || !requestUrl.startsWith(base)) return false;
  const next = requestUrl.charAt(base.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

let normalizedServerInstance: string | undefined;

/** The server's own instance, normalized once: it is read on every request. */
function serverInstance(): string | undefined {
  if (normalizedServerInstance === undefined && GITLAB_BASE_URL) {
    normalizedServerInstance = normalizeInstanceUrl(GITLAB_BASE_URL);
  }
  return normalizedServerInstance;
}
