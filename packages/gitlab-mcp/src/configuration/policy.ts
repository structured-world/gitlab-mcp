/**
 * The restrictions a caller's preset, account settings and session overrides put on
 * tool use. They narrow what the operator's configuration already filtered at the
 * registry; nothing here can bring back a tool or action the operator removed.
 */

import type { Preset, ScopeConfig } from '../profiles/types';
import { enforceArgsScope, ScopeEnforcer, ScopeViolationError } from '../profiles/scope-enforcer';
import type { AccountSettings, WorkingScope } from './types';
import { targetlessRestriction } from './scope-targets';

/** A session's choice to work without the account's default scope. */
export const EVERYWHERE = 'everywhere';

/** Overrides of the current MCP session; they replace the account's choice for it. */
export interface SessionOverrides {
  preset?: string;
  readOnly?: boolean;
  scope?: WorkingScope | typeof EVERYWHERE;
  /** Local profile chosen with manage_context switch_profile (OAuth mode). */
  profile?: string;
}

export interface EffectivePolicy {
  presetName?: string;
  readOnly: boolean;
  disabledGroups: ReadonlySet<string>;
  /** Preset whitelist; undefined allows every tool. */
  allowedTools?: ReadonlySet<string>;
  deniedTools?: RegExp;
  /** Tool name -> actions the preset denies. */
  deniedActions: ReadonlyMap<string, ReadonlySet<string>>;
  scope?: ScopeConfig;
  scopeEnforcer?: ScopeEnforcer;
}

/**
 * Tools that configure or diagnose the caller's own connection. Settings never restrict
 * them, and they answer while GitLab is unreachable: that is when they are needed.
 */
export const CONFIGURATION_TOOLS: ReadonlySet<string> = new Set([
  'manage_context',
  'get_settings',
  'update_settings',
  'check_connection',
  'open_settings_panel',
  // Choosing a new scope means searching outside the current one.
  'find_scope_targets',
]);

export function scopeConfigOf(scope: WorkingScope): ScopeConfig {
  return scope.type === 'project'
    ? { project: scope.path }
    : { group: scope.path, includeSubgroups: scope.includeSubgroups };
}

/** The preset the caller works with: the session's choice, else the account's. */
export function selectedPreset(
  account: AccountSettings,
  session: SessionOverrides,
): string | undefined {
  return session.preset ?? account.preset;
}

/**
 * Combine the selected preset (already loaded), the account settings and the session
 * overrides. A session's own choice of preset, read-only mode or scope replaces the
 * account's; groups the account switched off stay off in every session.
 */
export function buildPolicy(
  preset: Preset | undefined,
  account: AccountSettings,
  session: SessionOverrides,
): EffectivePolicy {
  const disabledGroups = new Set(account.disabledToolGroups ?? []);
  for (const [feature, enabled] of Object.entries(preset?.features ?? {})) {
    if (enabled === false) disabledGroups.add(feature);
  }
  const deniedActions = new Map<string, Set<string>>();
  for (const entry of preset?.denied_actions ?? []) {
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const tool = entry.slice(0, separator);
    const actions = deniedActions.get(tool) ?? new Set<string>();
    actions.add(entry.slice(separator + 1));
    deniedActions.set(tool, actions);
  }
  // A preset's own scope belongs to the preset and still applies when the chat works
  // everywhere; only the account's default scope is dropped.
  const working = session.scope ?? account.scope;
  const scope = working && working !== EVERYWHERE ? scopeConfigOf(working) : preset?.scope;
  return {
    presetName: selectedPreset(account, session),
    readOnly: (session.readOnly ?? account.readOnly ?? false) || preset?.read_only === true,
    disabledGroups,
    allowedTools: preset?.allowed_tools?.length ? new Set(preset.allowed_tools) : undefined,
    deniedTools: preset?.denied_tools_regex ? new RegExp(preset.denied_tools_regex) : undefined,
    deniedActions,
    scope,
    scopeEnforcer: scope ? new ScopeEnforcer(scope) : undefined,
  };
}

/** What a tool is, as far as the policy is concerned. */
export interface ToolFacts {
  name: string;
  /** Tool group id; undefined for core and context tools. */
  group?: string;
  readOnly: boolean;
}

/** Why the policy hides a tool from the caller, or null when it may use it. */
export function toolRestriction(policy: EffectivePolicy, tool: ToolFacts): string | null {
  if (CONFIGURATION_TOOLS.has(tool.name)) return null;
  if (policy.readOnly && !tool.readOnly) return 'read-only mode is on';
  if (tool.group !== undefined && policy.disabledGroups.has(tool.group)) {
    return `the '${tool.group}' tool group is turned off`;
  }
  if (policy.allowedTools && !policy.allowedTools.has(tool.name)) {
    return `preset '${policy.presetName}' does not include it`;
  }
  if (policy.deniedTools?.test(tool.name)) {
    return `preset '${policy.presetName}' excludes it`;
  }
  return null;
}

/**
 * Why the policy refuses this call, or null when it may run: the tool restriction, an
 * action the preset denies, or a project or group outside the working scope.
 */
export function callRestriction(
  policy: EffectivePolicy,
  tool: ToolFacts,
  args: Record<string, unknown>,
): string | null {
  const restriction = toolRestriction(policy, tool);
  if (restriction) return restriction;
  if (CONFIGURATION_TOOLS.has(tool.name)) return null;
  const action = typeof args.action === 'string' ? args.action : undefined;
  if (action !== undefined && policy.deniedActions.get(tool.name)?.has(action)) {
    return `preset '${policy.presetName}' denies the '${action}' action`;
  }
  if (policy.scopeEnforcer) {
    try {
      enforceArgsScope(policy.scopeEnforcer, args);
    } catch (error: unknown) {
      if (error instanceof ScopeViolationError) return error.message;
      throw error;
    }
  }
  if (policy.scope) {
    const targetless = targetlessRestriction(tool.name, args, policy.scope);
    if (targetless) return targetless;
  }
  return null;
}
