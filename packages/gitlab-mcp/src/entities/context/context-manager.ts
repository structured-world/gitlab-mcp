/**
 * Context Manager - the manage_context view of the caller's configuration
 *
 * Every action applies to the caller of the running tool call and to its current MCP
 * session: another user's or another chat's context never changes. Presets and scopes are
 * session overrides of the configuration service, so they take effect in tool execution;
 * the account defaults are changed through the settings tools.
 */

import { GITLAB_BASE_URL, GITLAB_READ_ONLY_MODE } from '../../config';
import { logInfo, logError } from '../../logger';
import { ProfileLoader } from '../../profiles/loader';
import { ProfileInfo, ScopeConfig } from '../../profiles/types';
import { findNamespaceType } from '../../utils/namespace';
import {
  currentCaller,
  getConfigurationService,
  resolveCaller,
  type Caller,
  type ResolvedConfiguration,
} from '../../configuration';
import { EVERYWHERE } from '../../configuration/policy';
import {
  PresetInfo,
  ResetResult,
  RuntimeScope,
  SessionContext,
  SetScopeResult,
  SwitchResult,
} from './types';

function isOAuthMode(): boolean {
  return process.env.OAUTH_ENABLED === 'true';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Convert a scope configuration to the runtime view shown to the caller. */
export function runtimeScopeOf(scope: ScopeConfig, detected: boolean): RuntimeScope {
  if (scope.project) {
    return { type: 'project', path: scope.project, includeSubgroups: false, detected };
  }
  if (scope.group ?? scope.namespace) {
    return {
      type: 'group',
      path: (scope.group ?? scope.namespace) as string,
      includeSubgroups: scope.includeSubgroups !== false,
      detected,
    };
  }
  if (scope.projects && scope.projects.length > 0) {
    return {
      type: 'project',
      path: scope.projects[0],
      additionalPaths: scope.projects.length > 1 ? scope.projects.slice(1) : undefined,
      includeSubgroups: false,
      detected,
    };
  }
  if (scope.groups && scope.groups.length > 0) {
    return {
      type: 'group',
      path: scope.groups[0],
      additionalPaths: scope.groups.length > 1 ? scope.groups.slice(1) : undefined,
      includeSubgroups: scope.includeSubgroups !== false,
      detected,
    };
  }
  logError('Invalid scope configuration: no usable scope fields found', { scope });
  throw new Error(
    'Invalid scope configuration: expected project, group, namespace, projects, or groups to be defined',
  );
}

export class ContextManager {
  private static instance: ContextManager | null = null;

  private readonly profileLoader = new ProfileLoader();

  static getInstance(): ContextManager {
    ContextManager.instance ??= new ContextManager();
    return ContextManager.instance;
  }

  /** Reset the singleton instance (for testing) */
  static resetInstance(): void {
    ContextManager.instance = null;
  }

  /** The caller of the running tool call; the server's own token outside one. */
  private caller(): Caller {
    return currentCaller() ?? resolveCaller(undefined, GITLAB_BASE_URL);
  }

  /** What the operator configured, before any account or session choice. */
  private operatorContext(caller: Caller): Omit<SessionContext, 'initialContext'> {
    return {
      host: hostOf(caller.instanceUrl),
      apiUrl: caller.instanceUrl,
      readOnly: GITLAB_READ_ONLY_MODE,
      oauthMode: isOAuthMode(),
    };
  }

  private contextOf(caller: Caller, resolved: ResolvedConfiguration): SessionContext {
    const operator = this.operatorContext(caller);
    const scope = resolved.policy.scope;
    return {
      ...operator,
      readOnly: operator.readOnly || resolved.policy.readOnly,
      presetName: resolved.policy.presetName,
      profileName: resolved.session.profile,
      scope: scope
        ? runtimeScopeOf(
            scope,
            resolved.session.scope !== undefined && resolved.session.scope !== EVERYWHERE,
          )
        : undefined,
      initialContext: operator,
    };
  }

  /** The caller's current context: operator settings narrowed by account and session. */
  async getContext(): Promise<SessionContext> {
    const caller = this.caller();
    return this.contextOf(caller, await getConfigurationService().resolve(caller));
  }

  async listPresets(): Promise<PresetInfo[]> {
    const profiles = await this.profileLoader.listProfiles();
    return profiles
      .filter((p) => p.isPreset)
      .map((p) => ({
        name: p.name,
        description: p.description,
        readOnly: p.readOnly,
        isBuiltIn: p.isBuiltIn,
      }));
  }

  async listProfiles(): Promise<ProfileInfo[]> {
    if (!isOAuthMode()) {
      throw new Error('list_profiles is only available in OAuth mode');
    }
    const profiles = await this.profileLoader.listProfiles();
    return profiles.filter((p) => !p.isPreset);
  }

  /** Use a preset in the current session; the account default stays as it is. */
  async switchPreset(presetName: string): Promise<SwitchResult> {
    const caller = this.caller();
    const service = getConfigurationService();
    const previous = (await service.resolve(caller)).policy.presetName;
    try {
      await service.updateSession(caller, { preset: presetName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('Failed to switch preset', { error: message, preset: presetName });
      throw new Error(`Failed to switch to preset '${presetName}': ${message}`, { cause: error });
    }
    logInfo('Switched preset for session', { previous, current: presetName });
    return {
      success: true,
      previous,
      current: presetName,
      message: `Switched this session to preset '${presetName}'`,
    };
  }

  /** API URL of the caller's active local profile, or null when none is active. */
  async getCurrentProfileUrl(): Promise<string | null> {
    const name = (await getConfigurationService().resolve(this.caller())).session.profile;
    if (!name) return null;
    const profile = await this.profileLoader.loadProfile(name);
    return profile.api_url ?? `https://${profile.host}`;
  }

  async switchProfile(profileName: string): Promise<SwitchResult> {
    if (!isOAuthMode()) {
      throw new Error('switch_profile is only available in OAuth mode');
    }
    const caller = this.caller();
    const service = getConfigurationService();
    const previous = (await service.resolve(caller)).session.profile;
    try {
      await this.profileLoader.loadProfile(profileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('Failed to switch profile', { error: message, profile: profileName });
      throw new Error(`Failed to switch to profile '${profileName}': ${message}`, { cause: error });
    }
    await service.updateSession(caller, { profile: profileName });
    logInfo('Switched profile', { previous, current: profileName });
    return {
      success: true,
      previous,
      current: profileName,
      message: `Switched to profile '${profileName}'`,
    };
  }

  /** Limit the current session to a project or group, detecting which one it is. */
  async setScope(namespace: string, includeSubgroups: boolean = true): Promise<SetScopeResult> {
    try {
      // Confirmed by GitLab, so a typo is reported instead of becoming a guessed scope.
      const type = await findNamespaceType(namespace);
      if (!type) {
        throw new Error(
          `No project or group '${namespace}' was found on GitLab, or GitLab could not be reached`,
        );
      }
      const scope = {
        type,
        path: namespace,
        includeSubgroups: type === 'group' ? includeSubgroups : false,
      };
      await getConfigurationService().updateSession(this.caller(), { scope });
      logInfo('Scope set with auto-detection', { namespace, type, includeSubgroups });
      return {
        success: true,
        scope: { ...scope, detected: true },
        message: `Scope set to ${type} '${namespace}'${
          type === 'group' && includeSubgroups ? ' (including subgroups)' : ''
        }`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('Failed to set scope', { error: message, namespace });
      throw new Error(`Failed to set scope for '${namespace}': ${message}`, { cause: error });
    }
  }

  /**
   * Let the current session work everywhere the account has access: its own scope and the
   * account's default scope no longer apply to it. Its other overrides stay.
   */
  async clearScope(): Promise<ResetResult> {
    await getConfigurationService().updateSession(this.caller(), { scope: EVERYWHERE });
    logInfo('Session scope cleared');
    return {
      success: true,
      message: 'This session now works everywhere the account has access',
      context: await this.getContext(),
    };
  }

  /** Drop the session's preset, scope and profile: the account settings apply again. */
  async reset(): Promise<ResetResult> {
    await getConfigurationService().resetSession(this.caller());
    logInfo('Session context reset');
    return {
      success: true,
      message: 'Session context reset to the account settings',
      context: await this.getContext(),
    };
  }

  /**
   * Switch to a different GitLab instance
   *
   * IMPORTANT: In OAuth mode, instance switching is BLOCKED because
   * the session is tied to a specific instance. Users must re-authenticate
   * to use a different instance.
   *
   * In static token mode the server's connection is shared by its sessions, so the
   * switch is too; it triggers:
   * 1. Re-introspection for the new instance
   * 2. Clearing namespace tier cache
   * 3. Tool re-validation against new schema
   */
  async switchInstance(instanceUrl: string): Promise<SwitchResult> {
    if (isOAuthMode()) {
      throw new Error(
        'Cannot switch instances in OAuth mode. ' +
          'Please re-authenticate with the desired GitLab instance.',
      );
    }

    // Import dynamically to avoid circular dependencies
    const { InstanceRegistry } = await import('../../services/InstanceRegistry.js');
    const { clearNamespaceTierCache } = await import('../../services/NamespaceTierDetector.js');
    const { ConnectionManager } = await import('../../services/ConnectionManager.js');
    const { sendToolsListChangedNotification } = await import('../../server');

    const registry = InstanceRegistry.getInstance();
    if (!registry.isInitialized()) {
      await registry.initialize();
    }

    const instance = registry.get(instanceUrl);
    if (!instance) {
      throw new Error(
        `Instance not configured: ${instanceUrl}. ` +
          "Use 'instances list' to see configured instances.",
      );
    }

    const connectionManager = ConnectionManager.getInstance();
    const previousUrl = connectionManager.getCurrentInstanceUrl() ?? GITLAB_BASE_URL;
    const before = this.caller();

    try {
      clearNamespaceTierCache();
      await connectionManager.reinitialize(instanceUrl);

      // The server's token now acts on the new instance, which is another account: every
      // chat keeps its overrides there, without the scope that named the previous
      // instance's projects.
      const after = resolveCaller(before.sessionKey, instanceUrl);
      await getConfigurationService().moveSessions(before.accountKey, after.accountKey);

      logInfo('Switched GitLab instance', {
        previous: previousUrl,
        current: instanceUrl,
        label: instance.config.label,
      });

      await sendToolsListChangedNotification();

      return {
        success: true,
        previous: previousUrl,
        current: instanceUrl,
        message: `Switched to instance '${instance.config.label ?? instanceUrl}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('Failed to switch instance', { error: message, instanceUrl });
      throw new Error(`Failed to switch to instance '${instanceUrl}': ${message}`, {
        cause: error,
      });
    }
  }
}

export function getContextManager(): ContextManager {
  return ContextManager.getInstance();
}
