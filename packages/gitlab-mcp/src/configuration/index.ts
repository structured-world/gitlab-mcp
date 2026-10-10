/**
 * The process's configuration service, wired to the settings store of the deployment,
 * the preset loader and per-session tool-list notifications.
 */

import { isOAuthEnabled } from '../oauth/config';
import { sessionStore } from '../oauth/session-store';
import { ProfileLoader } from '../profiles/loader';
import { ConfigurationService } from './service';
import { LocalSettingsFile, localSettingsPath, type SettingsStore } from './settings-store';

export { ConfigurationError } from './service';
export type { ResolvedConfiguration } from './service';
export { resolveCaller, runWithCaller, currentCaller, type Caller } from './caller';

let settingsStore: Promise<SettingsStore> | undefined;

/**
 * OAuth deployments and those with a configured session storage keep settings with the
 * sessions, shared by every replica; a local server keeps them in the user's config dir.
 */
function storeOfDeployment(): Promise<SettingsStore> {
  settingsStore ??= (async () => {
    if (isOAuthEnabled() || process.env.OAUTH_STORAGE_TYPE) {
      await sessionStore.initialize();
      return {
        get: (accountKey) => sessionStore.getAccountSettings(accountKey),
        put: (accountKey, settings, expectedVersion) =>
          sessionStore.putAccountSettings(accountKey, settings, expectedVersion),
      };
    }
    return new LocalSettingsFile(localSettingsPath());
  })();
  return settingsStore;
}

let service: ConfigurationService | undefined;

export function getConfigurationService(): ConfigurationService {
  if (!service) {
    const loader = new ProfileLoader();
    service = new ConfigurationService(
      storeOfDeployment,
      { load: (name) => loader.loadPreset(name) },
      async (sessionKeys) => {
        const { getSessionManager } = await import('../session-manager');
        await getSessionManager().notifyToolsListChanged(sessionKeys);
      },
    );
  }
  return service;
}

/** Drop the service and its store (tests). */
export function resetConfigurationService(): void {
  service = undefined;
  settingsStore = undefined;
}
