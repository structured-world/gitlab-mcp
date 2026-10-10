/**
 * The configuration service: the one place that reads and changes what a caller works
 * with. Native settings, manage_context and the settings panel all go through it, so the
 * same choice means the same thing everywhere and takes effect in tool execution.
 */

import type { Preset } from '../profiles/types';
import type { Caller } from './caller';
import { TOOL_GROUP_IDS } from './groups';
import {
  buildPolicy,
  selectedPreset,
  type EVERYWHERE,
  type EffectivePolicy,
  type SessionOverrides,
} from './policy';
import type { SettingsStore } from './settings-store';
import {
  AccountSettingsSchema,
  type AccountSettings,
  type AccountSettingsRecord,
  type WorkingScope,
} from './types';

/** A request the configuration cannot honour; nothing was changed. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export interface PresetSource {
  /** Load a preset; rejects for an unknown name. */
  load(name: string): Promise<Preset>;
}

/**
 * Field values to set; `null` removes the field and the operator default applies again.
 * `toolGroups` and `scopeIncludeSubgroups` are changes to the settings as saved at write
 * time, so they merge with concurrent edits of other groups or of the scope.
 */
export type ScopePatch = Omit<WorkingScope, 'includeSubgroups'> & { includeSubgroups?: boolean };

export interface AccountSettingsPatch {
  preset?: string | null;
  readOnly?: boolean | null;
  disabledToolGroups?: string[] | null;
  /**
   * A group scope without includeSubgroups keeps the choice saved at write time (included
   * when none was saved), so it does not overwrite a concurrent change of that choice.
   */
  scope?: ScopePatch | null;
  /** Tool group id -> whether it is on. */
  toolGroups?: Record<string, boolean>;
  /** For a saved group scope: whether its subgroups are included. */
  scopeIncludeSubgroups?: boolean;
}

export interface SessionOverridesPatch {
  preset?: string | null;
  readOnly?: boolean | null;
  scope?: WorkingScope | typeof EVERYWHERE | null;
  profile?: string | null;
}

export interface ResolvedConfiguration {
  caller: Caller;
  /** Stored account settings; version 0 when the account never saved any. */
  account: AccountSettings;
  accountVersion: number;
  session: SessionOverrides;
  policy: EffectivePolicy;
  /** The selected preset could not be loaded; the caller works read-only until it is fixed. */
  presetUnavailable?: string;
}

/** Concurrent edits of different fields are merged; this bounds the retries. */
const MAX_WRITE_ATTEMPTS = 5;

/** The account patch applied to the settings saved now, its changes included. */
function applyAccountPatch(
  saved: AccountSettings,
  { toolGroups, scopeIncludeSubgroups, scope, ...fields }: AccountSettingsPatch,
): AccountSettings {
  const next = applyPatch(saved, fields);
  if (scope === null) delete next.scope;
  else if (scope) next.scope = scopeAtWrite(scope, saved.scope);
  if (toolGroups) {
    const disabled = disabledGroupsAtWrite(next.disabledToolGroups, toolGroups);
    if (disabled.length > 0) next.disabledToolGroups = disabled;
    else delete next.disabledToolGroups;
  }
  if (scopeIncludeSubgroups !== undefined && next.scope?.type === 'group') {
    next.scope = { ...next.scope, includeSubgroups: scopeIncludeSubgroups };
  }
  return next;
}

/** A new scope; a group without a subgroup choice keeps the one saved for a group scope. */
function scopeAtWrite(scope: ScopePatch, saved: WorkingScope | undefined): WorkingScope {
  // Only a saved group scope says anything about subgroups; a project's flag is always false.
  const savedChoice = saved?.type === 'group' ? saved.includeSubgroups : undefined;
  return {
    ...scope,
    includeSubgroups: scope.type === 'group' && (scope.includeSubgroups ?? savedChoice ?? true),
  };
}

/** The groups turned off after these toggles are applied to the saved ones, sorted. */
function disabledGroupsAtWrite(
  saved: string[] | undefined,
  toggles: Record<string, boolean>,
): string[] {
  const disabled = new Set(saved ?? []);
  for (const [group, enabled] of Object.entries(toggles)) {
    if (enabled) disabled.delete(group);
    else disabled.add(group);
  }
  return [...disabled].sort((a, b) => a.localeCompare(b));
}

function applyPatch<T extends object>(base: T, patch: object): T {
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

export class ConfigurationService {
  /** Session overrides by account and session: another account never sees them. */
  private readonly overrides = new Map<string, SessionOverrides>();
  /** Sessions of each account on this replica, to notify them of account changes. */
  private readonly accountSessions = new Map<string, Set<string>>();

  constructor(
    private readonly store: () => Promise<SettingsStore>,
    private readonly presets: PresetSource,
    private readonly notify: (sessionKeys: string[]) => Promise<void>,
  ) {}

  /** The caller's settings and the policy they produce. */
  async resolve(caller: Caller): Promise<ResolvedConfiguration> {
    this.track(caller);
    const record = await (await this.store()).get(caller.accountKey);
    const account = record?.settings ?? {};
    const session = this.overrides.get(this.overrideKey(caller)) ?? {};
    const resolved = {
      caller,
      account,
      accountVersion: record?.version ?? 0,
      session,
    };
    const presetName = selectedPreset(account, session);
    if (presetName === undefined) {
      return { ...resolved, policy: buildPolicy(undefined, account, session) };
    }
    try {
      const preset = await this.presets.load(presetName);
      return { ...resolved, policy: buildPolicy(preset, account, session) };
    } catch {
      // The preset was removed after it was selected. Ignoring it could widen access (it may
      // have been read-only); failing every call would lock the caller out of the settings
      // that fix it. Read-only keeps both safe. Its scope and tool limits are not kept: the
      // caller chose the preset and may always choose none, so working read-only without
      // them is narrower than what the caller can set itself.
      const policy = buildPolicy(undefined, account, { ...session, readOnly: true });
      return { ...resolved, policy: { ...policy, presetName }, presetUnavailable: presetName };
    }
  }

  /**
   * Change the account's settings. Fields left out keep their stored value, also when
   * another session saved meanwhile: a conflicting write re-reads and re-applies the
   * patch. Every value is validated before anything is written.
   */
  async updateAccount(caller: Caller, patch: AccountSettingsPatch): Promise<AccountSettingsRecord> {
    await this.validate(patch);
    const store = await this.store();
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const current = await store.get(caller.accountKey);
      const next = AccountSettingsSchema.safeParse(
        applyAccountPatch(current?.settings ?? {}, patch),
      );
      if (!next.success) throw new ConfigurationError(next.error.issues[0].message);
      const stored = await store.put(caller.accountKey, next.data, current?.version ?? 0);
      if (stored) {
        await this.notify([...this.track(caller)]);
        return stored;
      }
    }
    throw new ConfigurationError('The settings kept changing meanwhile; try again');
  }

  /** Change what the caller's current session uses; other sessions keep theirs. */
  async updateSession(caller: Caller, patch: SessionOverridesPatch): Promise<SessionOverrides> {
    await this.validate(patch);
    const key = this.overrideKey(caller);
    const next = applyPatch(this.overrides.get(key) ?? {}, patch);
    if (Object.keys(next).length === 0) this.overrides.delete(key);
    else this.overrides.set(key, next);
    this.track(caller);
    await this.notify([caller.sessionKey]);
    return next;
  }

  /** Drop the session's overrides: it uses the account settings again. */
  async resetSession(caller: Caller): Promise<void> {
    this.overrides.delete(this.overrideKey(caller));
    await this.notify([caller.sessionKey]);
  }

  /**
   * Move every session of an account to another account key, keeping their overrides
   * except the scope. A static token's account is keyed by its instance, so a switch of
   * instance re-keys every chat; their scopes named projects of the previous instance.
   */
  async moveSessions(fromAccountKey: string, toAccountKey: string): Promise<void> {
    if (fromAccountKey === toAccountKey) return;
    const sessions = [...(this.accountSessions.get(fromAccountKey) ?? [])];
    this.accountSessions.delete(fromAccountKey);
    const moved = this.accountSessions.get(toAccountKey) ?? new Set<string>();
    for (const sessionKey of sessions) {
      const old = `${fromAccountKey}\n${sessionKey}`;
      const kept = applyPatch(this.overrides.get(old) ?? {}, { scope: null });
      this.overrides.delete(old);
      if (Object.keys(kept).length > 0) this.overrides.set(`${toAccountKey}\n${sessionKey}`, kept);
      moved.add(sessionKey);
    }
    this.accountSessions.set(toAccountKey, moved);
    await this.notify(sessions);
  }

  /** Forget a closed session. */
  forgetSession(sessionKey: string): void {
    for (const [accountKey, sessions] of this.accountSessions) {
      if (!sessions.delete(sessionKey)) continue;
      this.overrides.delete(`${accountKey}\n${sessionKey}`);
      if (sessions.size === 0) this.accountSessions.delete(accountKey);
    }
  }

  private async validate(patch: AccountSettingsPatch | SessionOverridesPatch): Promise<void> {
    if (typeof patch.preset === 'string') await this.loadPreset(patch.preset);
    const groups = [
      ...(('disabledToolGroups' in patch ? patch.disabledToolGroups : undefined) ?? []),
      ...Object.keys(('toolGroups' in patch ? patch.toolGroups : undefined) ?? {}),
    ];
    const unknown = groups.filter((group) => !TOOL_GROUP_IDS.has(group));
    if (unknown.length > 0) {
      throw new ConfigurationError(`Unknown tool group: ${unknown.join(', ')}`);
    }
  }

  private async loadPreset(name: string): Promise<Preset> {
    try {
      return await this.presets.load(name);
    } catch (error: unknown) {
      throw new ConfigurationError(
        `Unknown preset '${name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private overrideKey(caller: Caller): string {
    return `${caller.accountKey}\n${caller.sessionKey}`;
  }

  /** Record the caller's session under its account; returns the account's sessions. */
  private track(caller: Caller): Set<string> {
    const sessions = this.accountSessions.get(caller.accountKey) ?? new Set<string>();
    sessions.add(caller.sessionKey);
    this.accountSessions.set(caller.accountKey, sessions);
    return sessions;
  }
}
