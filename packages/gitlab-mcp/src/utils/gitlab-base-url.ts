/**
 * Which GitLab instance a REST call goes to. Every tool builds its URLs from here, so a
 * call reaches the instance of its caller.
 */

import { logWarn } from '../logger';
import { isOAuthEnabled, getGitLabApiUrlFromContext } from '../oauth/index';
import { normalizeInstanceUrl } from './url';

/**
 * The instance the server's own token works with now. The connection manager reports
 * it (it changes on switch_instance); it registers itself because it depends on the
 * HTTP layer that depends on this module.
 */
let activeInstanceUrl: () => string | null = () => null;

export function setActiveInstanceSource(source: () => string | null): void {
  activeInstanceUrl = source;
}

/**
 * Base URL of the GitLab instance this call goes to (e.g. "https://gitlab.com"): the
 * OAuth token's instance, else the instance the server's own token works with now,
 * else GITLAB_API_URL as configured at the time of the call.
 */
export function getGitLabBaseUrl(): string {
  if (isOAuthEnabled()) {
    const apiUrl = getGitLabApiUrlFromContext();
    if (apiUrl) {
      return normalizeInstanceUrl(apiUrl);
    }
    logWarn('OAuth mode: no API URL in context, falling back to global config');
  }
  const active = activeInstanceUrl();
  if (active) return active;
  // An unset or empty GITLAB_API_URL means gitlab.com, as in the startup configuration.
  const configured = process.env.GITLAB_API_URL;
  return configured ? normalizeInstanceUrl(configured) : 'https://gitlab.com';
}
