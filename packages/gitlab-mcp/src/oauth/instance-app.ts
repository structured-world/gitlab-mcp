/**
 * Instances a user can sign in to
 *
 * Only operator-configured instances are offered: the default GITLAB_API_URL application
 * and every registered instance with its own OAuth application. A URL supplied in a request
 * selects one of them or nothing, so credentials never go to a host the operator did not
 * configure.
 */

import { InstanceRegistry } from '../services/InstanceRegistry';
import { normalizeInstanceUrl } from '../utils/url';
import type { OAuthConfig } from './config';
import { defaultOAuthApp, type GitLabOAuthApp } from './oauth-app';

async function loadedRegistry(): Promise<InstanceRegistry> {
  const registry = InstanceRegistry.getInstance();
  if (!registry.isInitialized()) {
    await registry.initialize();
  }
  return registry;
}

/**
 * Applications a user may sign in with, default instance first. A registered instance's
 * own OAuth application takes precedence over OAUTH_CLIENT_ID for the same URL.
 */
export async function selectableOAuthApps(config: OAuthConfig): Promise<GitLabOAuthApp[]> {
  const registry = await loadedRegistry();
  const fallback = defaultOAuthApp(config);
  const apps = new Map<string, GitLabOAuthApp>([[fallback.baseUrl, fallback]]);

  for (const url of registry.getUrls()) {
    const instance = registry.getConfig(url);
    const baseUrl = normalizeInstanceUrl(url);
    if (instance?.oauth) {
      apps.set(baseUrl, {
        baseUrl,
        label: instance.label,
        clientId: instance.oauth.clientId,
        clientSecret: instance.oauth.clientSecret,
        scopes: instance.oauth.scopes ?? config.gitlabScopes,
      });
    } else if (baseUrl === fallback.baseUrl && instance?.label) {
      apps.set(baseUrl, { ...fallback, label: instance.label });
    }
  }
  return [...apps.values()];
}

/**
 * Application for a chosen instance: the default when none was chosen, undefined when the
 * URL is not one of the selectable instances.
 */
export async function oauthAppFor(
  config: OAuthConfig,
  instanceUrl: string | undefined,
): Promise<GitLabOAuthApp | undefined> {
  const apps = await selectableOAuthApps(config);
  if (instanceUrl === undefined) {
    return apps[0];
  }
  const wanted = normalizeInstanceUrl(instanceUrl);
  return apps.find((app) => app.baseUrl === wanted);
}
