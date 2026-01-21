/**
 * Context Manager - manages runtime session context
 *
 * Singleton class that maintains the current session state including:
 * - Current preset and its settings
 * - Scope restrictions (project/group)
 * - OAuth profile (in OAuth mode)
 *
 * Integrates with:
 * - ProfileLoader for preset/profile loading
 * - ScopeEnforcer for scope validation
 * - detectNamespaceType for auto-detection
 */

import { GITLAB_BASE_URL, GITLAB_READ_ONLY_MODE } from "../../config";
import { logger } from "../../logger";
import { ProfileLoader } from "../../profiles/loader";
import { ScopeEnforcer } from "../../profiles/scope-enforcer";
import { Preset, ProfileInfo, ScopeConfig } from "../../profiles/types";
import { sendToolsListChangedNotification } from "../../server";
import { detectNamespaceType } from "../../utils/namespace";
import {
  PresetInfo,
  ResetResult,
  RuntimeScope,
  SessionContext,
  SetScopeResult,
  SwitchResult,
} from "./types";

/**
 * Check if OAuth mode is enabled
 */
function isOAuthMode(): boolean {
  return process.env.OAUTH_ENABLED === "true";
}

/**
 * Get GitLab host from API URL
 */
function getHost(): string {
  try {
    const url = new URL(GITLAB_BASE_URL);
    return url.hostname;
  } catch {
    return GITLAB_BASE_URL;
  }
}

/**
 * Context Manager class
 *
 * Manages the runtime session context for the MCP server.
 * Uses singleton pattern to ensure consistent state across the session.
 */
export class ContextManager {
  private static instance: ContextManager | null = null;

  private profileLoader: ProfileLoader;
  private currentPreset: Preset | null = null;
  private currentPresetName: string | null = null;
  private currentScope: ScopeConfig | null = null;
  private currentScopeEnforcer: ScopeEnforcer | null = null;
  private currentProfileName: string | null = null;
  private initialContext: SessionContext | null = null;

  private constructor() {
    this.profileLoader = new ProfileLoader();
    this.captureInitialContext();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ContextManager {
    ContextManager.instance ??= new ContextManager();
    return ContextManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    ContextManager.instance = null;
  }

  /**
   * Capture initial context for reset functionality
   */
  private captureInitialContext(): void {
    this.initialContext = {
      host: getHost(),
      apiUrl: GITLAB_BASE_URL,
      readOnly: GITLAB_READ_ONLY_MODE,
      oauthMode: isOAuthMode(),
      presetName: this.currentPresetName ?? undefined,
      profileName: this.currentProfileName ?? undefined,
      scope: this.currentScope
        ? this.scopeConfigToRuntimeScope(this.currentScope, false)
        : undefined,
    };

    logger.debug({ initialContext: this.initialContext }, "Captured initial context");
  }

  /**
   * Convert ScopeConfig to RuntimeScope
   */
  private scopeConfigToRuntimeScope(scope: ScopeConfig, detected: boolean): RuntimeScope {
    // Determine the primary scope type and path
    if (scope.project) {
      return {
        type: "project",
        path: scope.project,
        includeSubgroups: false,
        detected,
      };
    }

    if (scope.group) {
      return {
        type: "group",
        path: scope.group,
        includeSubgroups: scope.includeSubgroups !== false,
        detected,
      };
    }

    if (scope.namespace) {
      // Namespace is treated as group by default
      return {
        type: "group",
        path: scope.namespace,
        includeSubgroups: scope.includeSubgroups !== false,
        detected,
      };
    }

    // Multiple projects - first one as primary, rest as additional
    if (scope.projects && scope.projects.length > 0) {
      return {
        type: "project",
        path: scope.projects[0],
        additionalPaths: scope.projects.length > 1 ? scope.projects.slice(1) : undefined,
        includeSubgroups: false,
        detected,
      };
    }

    // Multiple groups - first one as primary, rest as additional
    if (scope.groups && scope.groups.length > 0) {
      return {
        type: "group",
        path: scope.groups[0],
        additionalPaths: scope.groups.length > 1 ? scope.groups.slice(1) : undefined,
        includeSubgroups: scope.includeSubgroups !== false,
        detected,
      };
    }

    // Invalid scope - should not happen with valid ScopeConfig (validated by Zod)
    logger.error({ scope }, "Invalid scope configuration: no usable scope fields found");
    throw new Error(
      "Invalid scope configuration: expected project, group, namespace, projects, or groups to be defined"
    );
  }

  /**
   * Get current session context
   */
  getContext(): SessionContext {
    const context: SessionContext = {
      host: getHost(),
      apiUrl: GITLAB_BASE_URL,
      readOnly: GITLAB_READ_ONLY_MODE,
      oauthMode: isOAuthMode(),
      presetName: this.currentPresetName ?? undefined,
      profileName: this.currentProfileName ?? undefined,
      scope: this.currentScope
        ? this.scopeConfigToRuntimeScope(this.currentScope, false)
        : undefined,
      initialContext: this.initialContext ?? undefined,
    };

    return context;
  }

  /**
   * List available presets
   */
  async listPresets(): Promise<PresetInfo[]> {
    const profiles = await this.profileLoader.listProfiles();

    // Filter to only presets (built-in profiles without host/auth)
    const presets: PresetInfo[] = profiles
      .filter(p => p.isPreset)
      .map(p => ({
        name: p.name,
        description: p.description,
        readOnly: p.readOnly,
        isBuiltIn: p.isBuiltIn,
      }));

    // Add current preset if not in list
    if (this.currentPresetName && this.currentPreset) {
      const exists = presets.some(p => p.name === this.currentPresetName);
      if (!exists) {
        presets.unshift({
          name: this.currentPresetName,
          description: this.currentPreset.description,
          readOnly: this.currentPreset.read_only ?? false,
          isBuiltIn: false,
        });
      }
    }

    return presets;
  }

  /**
   * List available profiles (OAuth mode only)
   */
  async listProfiles(): Promise<ProfileInfo[]> {
    if (!isOAuthMode()) {
      throw new Error("list_profiles is only available in OAuth mode");
    }

    const profiles = await this.profileLoader.listProfiles();

    // Filter to only full profiles (with host/auth)
    return profiles.filter(p => !p.isPreset);
  }

  /**
   * Switch to a different preset
   *
   * After a successful switch, sends a tools/list_changed notification
   * to inform connected clients that available tools may have changed
   * (e.g., read-only presets disable write tools).
   */
  async switchPreset(presetName: string): Promise<SwitchResult> {
    const previousPreset = this.currentPresetName;

    try {
      const preset = await this.profileLoader.loadPreset(presetName);

      this.currentPreset = preset;
      this.currentPresetName = presetName;

      // Apply scope from preset if defined; otherwise clear any previous scope
      if (preset.scope) {
        this.currentScope = preset.scope;
        this.currentScopeEnforcer = new ScopeEnforcer(preset.scope);
      } else {
        this.currentScope = null;
        this.currentScopeEnforcer = null;
      }

      logger.info({ previous: previousPreset, current: presetName }, "Switched preset");

      // Notify clients that tool list may have changed
      // (e.g., read-only presets disable write tools)
      await sendToolsListChangedNotification();

      return {
        success: true,
        previous: previousPreset ?? undefined,
        current: presetName,
        message: `Switched to preset '${presetName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, preset: presetName }, "Failed to switch preset");
      throw new Error(`Failed to switch to preset '${presetName}': ${message}`);
    }
  }

  /**
   * Switch to a different profile (OAuth mode only)
   */
  async switchProfile(profileName: string): Promise<SwitchResult> {
    if (!isOAuthMode()) {
      throw new Error("switch_profile is only available in OAuth mode");
    }

    const previousProfile = this.currentProfileName;

    try {
      // Validate profile exists
      await this.profileLoader.loadProfile(profileName);

      this.currentProfileName = profileName;

      logger.info({ previous: previousProfile, current: profileName }, "Switched profile");

      return {
        success: true,
        previous: previousProfile ?? undefined,
        current: profileName,
        message: `Switched to profile '${profileName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, profile: profileName }, "Failed to switch profile");
      throw new Error(`Failed to switch to profile '${profileName}': ${message}`);
    }
  }

  /**
   * Set scope with auto-detection
   */
  async setScope(namespace: string, includeSubgroups: boolean = true): Promise<SetScopeResult> {
    try {
      // Auto-detect namespace type
      const namespaceType = await detectNamespaceType(namespace);

      // Build scope config based on detected type
      let scopeConfig: ScopeConfig;
      if (namespaceType === "project") {
        scopeConfig = {
          project: namespace,
          includeSubgroups: false,
        };
      } else {
        scopeConfig = {
          group: namespace,
          includeSubgroups,
        };
      }

      // Update current scope
      this.currentScope = scopeConfig;
      this.currentScopeEnforcer = new ScopeEnforcer(scopeConfig);

      const runtimeScope: RuntimeScope = {
        type: namespaceType,
        path: namespace,
        includeSubgroups: namespaceType === "group" ? includeSubgroups : false,
        detected: true,
      };

      logger.info(
        { namespace, type: namespaceType, includeSubgroups },
        "Scope set with auto-detection"
      );

      return {
        success: true,
        scope: runtimeScope,
        message: `Scope set to ${namespaceType} '${namespace}'${
          namespaceType === "group" && includeSubgroups ? " (including subgroups)" : ""
        }`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, namespace }, "Failed to set scope");
      throw new Error(`Failed to set scope for '${namespace}': ${message}`);
    }
  }

  /**
   * Reset context to initial state
   */
  reset(): ResetResult {
    if (!this.initialContext) {
      throw new Error("No initial context captured - cannot reset");
    }

    // Clear runtime state
    this.currentPreset = null;
    this.currentPresetName = null;
    this.currentScope = null;
    this.currentScopeEnforcer = null;
    this.currentProfileName = null;

    // Recapture initial context
    this.captureInitialContext();

    logger.info("Context reset to initial state");

    return {
      success: true,
      message: "Context reset to initial state",
      context: this.getContext(),
    };
  }

  /**
   * Get current scope enforcer (if scope is set)
   */
  getScopeEnforcer(): ScopeEnforcer | null {
    return this.currentScopeEnforcer;
  }

  /**
   * Check if current context has scope restrictions
   */
  hasScope(): boolean {
    return this.currentScope !== null;
  }

  /**
   * Get current preset (if set)
   */
  getCurrentPreset(): Preset | null {
    return this.currentPreset;
  }

  /**
   * Get current preset name (if set)
   */
  getCurrentPresetName(): string | null {
    return this.currentPresetName;
  }
}

// Export convenience function
export function getContextManager(): ContextManager {
  return ContextManager.getInstance();
}
