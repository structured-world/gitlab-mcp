/**
 * The process's configuration service, wired to the settings store of the deployment,
 * the preset loader and per-session tool-list notifications.
 */

import { logWarn } from '../logger';
import { isOAuthEnabled } from '../oauth/config';
import { sessionStore } from '../oauth/session-store';
import { ProfileLoader } from '../profiles/loader';
import { ConfigurationService } from './service';
import { LocalSettingsFile, localSettingsDir, type SettingsStore } from './settings-store';

export { ConfigurationError } from './service';
export type { ResolvedConfiguration } from './service';
export { resolveCaller, runWithCaller, currentCaller, type Caller } from './caller';

let settingsStore: Promise<SettingsStore> | undefined;

/**
 * Settings live with the sessions when that storage can keep them (file or PostgreSQL),
 * shared by every replica using it. Otherwise (a local server, sessions held in memory as
 * the OAuth default, or a database package older than the server) they live in the
 * local settings directory, so saved settings survive a restart and calls keep working.
 */
function storeOfDeployment(): Promise<SettingsStore> {
  settingsStore ??= (async (): Promise<SettingsStore> => {
    const sessionsStored = isOAuthEnabled() || Boolean(process.env.OAUTH_STORAGE_TYPE);
    if (sessionsStored && sessionStore.keepsAccountSettings()) {
      await sessionStore.initialize();
      return {
        get: (accountKey) => sessionStore.getAccountSettings(accountKey),
        put: (accountKey, settings, expectedVersion) =>
          sessionStore.putAccountSettings(accountKey, settings, expectedVersion),
      };
    }
    if (sessionsStored && sessionStore.getBackendType() !== 'memory') {
      logWarn(
        'The session storage cannot keep account settings; upgrade @structured-world/gitlab-mcp-db to the version of this server. Settings are kept in the local settings directory meanwhile.',
        { backend: sessionStore.getBackendType() },
      );
    }
    return new LocalSettingsFile(localSettingsDir());
  })().catch((error: unknown) => {
    // A failed open is retried by the next request instead of failing until restart.
    settingsStore = undefined;
    throw error;
  });
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
