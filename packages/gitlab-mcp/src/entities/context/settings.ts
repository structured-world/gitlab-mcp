/**
 * Native settings of the connection (OpenAI structured settings, `openai/settings`).
 *
 * The page shows the account's defaults for new chats: the working preset, read-only
 * mode, the default project or group, and which tool groups are on. Every value goes
 * through the configuration service, so the page, manage_context and tool execution agree.
 * Nothing here can loosen what the server's operator configured.
 */

import { GITLAB_BASE_URL, GITLAB_READ_ONLY_MODE } from '../../config';
import {
  ConfigurationError,
  currentCaller,
  getConfigurationService,
  resolveCaller,
  type Caller,
} from '../../configuration';
import { TOOL_GROUPS, type ToolGroup } from '../../configuration/groups';
import type { AccountSettingsPatch } from '../../configuration/service';
import { findNamespaceType } from '../../utils/namespace';
import { getContextManager } from './context-manager';

export const SETTINGS_READ_TOOL = 'get_settings';
export const SETTINGS_UPDATE_TOOL = 'update_settings';
export const CONNECTION_CHECK_TOOL = 'check_connection';
export const SETTINGS_PANEL_TOOL = 'open_settings_panel';

/** Value of the preset field when the account uses no preset. */
const NO_PRESET = 'none';
const GROUP_PREFIX = 'tools_';

type SettingValue = string | number | boolean;

interface SettingProperty {
  type: 'string' | 'boolean';
  title: string;
  description?: string;
  enum?: string[];
  maxLength?: number;
}

interface LayoutItem {
  kind: 'property' | 'tool';
  property?: string;
  tool?: string;
  description?: string;
}

export interface SettingsReadResult {
  schema: { type: 'object'; properties: Record<string, SettingProperty>; required: string[] };
  values: Record<string, SettingValue>;
  layout: Array<{ kind: 'group'; title: string; items: LayoutItem[] }>;
}

export const SETTINGS_READ_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    schema: { type: 'object' },
    values: { type: 'object' },
    layout: { type: 'array', items: { type: 'object' } },
  },
  required: ['schema', 'values', 'layout'],
};

export const SETTINGS_UPDATE_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    set: {
      type: 'object',
      description: 'Settings to change, by name; settings left out keep their value.',
      minProperties: 1,
      additionalProperties: { type: ['string', 'number', 'boolean'] },
    },
  },
  required: ['set'],
  additionalProperties: false,
};

export const SETTINGS_UPDATE_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: { values: { type: 'object' } },
  required: ['values'],
};

function caller(): Caller {
  return currentCaller() ?? resolveCaller(undefined, GITLAB_BASE_URL);
}

/** Tool groups this server offers; groups its operator switched off are not listed. */
async function offeredGroups(): Promise<ToolGroup[]> {
  const { RegistryManager } = await import('../../registry-manager');
  const loaded = new Set(RegistryManager.getInstance().getRegistryKeys());
  return TOOL_GROUPS.filter((group) => group.registries.some((key) => loaded.has(key)));
}

async function settingsPage(): Promise<SettingsReadResult> {
  const who = caller();
  const [resolved, presets, groups] = await Promise.all([
    getConfigurationService().resolve(who),
    getContextManager().listPresets(),
    offeredGroups(),
  ]);
  const account = resolved.account;
  const disabled = new Set(account.disabledToolGroups ?? []);
  const presetNames = presets.map((preset) => preset.name);
  // A saved preset that no longer exists stays visible, so the page shows what applies.
  if (account.preset && !presetNames.includes(account.preset)) presetNames.push(account.preset);

  const properties: Record<string, SettingProperty> = {
    preset: {
      type: 'string',
      title: 'Working preset',
      description: resolved.presetUnavailable
        ? `The saved preset '${resolved.presetUnavailable}' no longer exists; the connection works read-only until you choose another one.`
        : 'Which tools and actions new chats start with.',
      enum: [NO_PRESET, ...presetNames],
    },
    readOnly: {
      type: 'boolean',
      title: 'Read-only',
      description: GITLAB_READ_ONLY_MODE
        ? 'Set by the server administrator; it cannot be turned off here.'
        : 'Only read from GitLab: tools that change anything are turned off.',
    },
    scope: {
      type: 'string',
      title: 'Default project or group',
      description:
        'A project or group path such as my-group/my-project. New chats work only there; leave empty to work everywhere you have access.',
      maxLength: 255,
    },
    scopeIncludeSubgroups: {
      type: 'boolean',
      title: 'Include subgroups',
      description: 'For a group: also allow projects in its subgroups.',
    },
  };
  const values: Record<string, SettingValue> = {
    preset: account.preset ?? NO_PRESET,
    readOnly: GITLAB_READ_ONLY_MODE || account.readOnly === true,
    scope: account.scope?.path ?? '',
    scopeIncludeSubgroups: account.scope?.includeSubgroups ?? true,
  };
  for (const group of groups) {
    properties[GROUP_PREFIX + group.id] = { type: 'boolean', title: group.title };
    values[GROUP_PREFIX + group.id] = !disabled.has(group.id);
  }

  return {
    schema: { type: 'object', properties, required: Object.keys(properties) },
    values,
    layout: [
      {
        kind: 'group',
        title: `Connection: ${who.accountLabel} on ${hostOf(who.instanceUrl)}`,
        items: [
          {
            kind: 'tool',
            tool: CONNECTION_CHECK_TOOL,
            description: 'Check the account, its permissions and whether GitLab is reachable.',
          },
          {
            kind: 'tool',
            tool: SETTINGS_PANEL_TOOL,
            description: 'Search projects and groups and preview what the connection can do.',
          },
        ],
      },
      {
        kind: 'group',
        title: 'Defaults for new chats',
        items: ['preset', 'readOnly', 'scope', 'scopeIncludeSubgroups'].map((property) => ({
          kind: 'property' as const,
          property,
        })),
      },
      {
        kind: 'group',
        title: 'Tool groups (groups the server administrator turned off are not listed)',
        items: groups.map((group) => ({
          kind: 'property' as const,
          property: GROUP_PREFIX + group.id,
        })),
      },
    ],
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The settings page: field schema, current values and layout. */
export async function readSettings(): Promise<SettingsReadResult> {
  return settingsPage();
}

/**
 * Apply a patch from the settings page. Every changed field is checked first; when any is
 * invalid nothing is saved. Returns the values as saved.
 */
export async function updateSettings(
  set: Record<string, SettingValue>,
): Promise<{ values: Record<string, SettingValue> }> {
  const page = await settingsPage();
  validateSettings(set, page.schema.properties);

  const patch: AccountSettingsPatch = {};
  if (typeof set.preset === 'string') {
    patch.preset = set.preset === NO_PRESET ? null : set.preset;
  }
  if (typeof set.readOnly === 'boolean') {
    if (GITLAB_READ_ONLY_MODE && !set.readOnly) {
      throw new ConfigurationError(
        'Read-only mode is set by the server administrator and cannot be turned off',
      );
    }
    patch.readOnly = set.readOnly;
  }
  if (typeof set.scope === 'string') {
    // Without an explicit choice the subgroup flag is taken from the settings saved at
    // write time, not from this page, which another chat may have changed since.
    const includeSubgroups =
      typeof set.scopeIncludeSubgroups === 'boolean' ? set.scopeIncludeSubgroups : undefined;
    patch.scope = await scopeSetting(set.scope.trim(), includeSubgroups);
  } else if (typeof set.scopeIncludeSubgroups === 'boolean') {
    // A change of the saved scope, applied to it as saved at write time.
    patch.scopeIncludeSubgroups = set.scopeIncludeSubgroups;
  }
  const groupChanges = Object.entries(set).filter(([name]) => name.startsWith(GROUP_PREFIX));
  if (groupChanges.length > 0) {
    // Each toggle is applied to the groups saved at write time: a concurrent toggle of
    // another group, or a group the operator hid, keeps its choice.
    patch.toolGroups = Object.fromEntries(
      groupChanges.map(([name, enabled]) => [name.slice(GROUP_PREFIX.length), enabled === true]),
    );
  }

  await getConfigurationService().updateAccount(caller(), patch);
  return { values: (await settingsPage()).values };
}

/** Every changed field must exist on the page and match its type and choices. */
function validateSettings(
  set: Record<string, SettingValue>,
  properties: SettingsReadResult['schema']['properties'],
): void {
  for (const [name, value] of Object.entries(set)) {
    const property = properties[name];
    if (!property) throw new ConfigurationError(`Unknown setting: ${name}`);
    if (typeof value !== property.type) {
      throw new ConfigurationError(`Setting ${name} must be a ${property.type}`);
    }
    if (property.enum && !property.enum.includes(value as string)) {
      throw new ConfigurationError(`Setting ${name} must be one of: ${property.enum.join(', ')}`);
    }
  }
}

/** The default scope for a path; an empty path clears it. */
async function scopeSetting(
  path: string,
  includeSubgroups: boolean | undefined,
): Promise<AccountSettingsPatch['scope']> {
  if (path === '') return null;
  // The path is checked against GitLab, so a typo is reported instead of saved as a guess.
  const type = await findNamespaceType(path);
  if (!type) {
    throw new ConfigurationError(
      `No project or group '${path}' was found on GitLab, or GitLab could not be reached`,
    );
  }
  return type === 'group'
    ? { type, path, includeSubgroups }
    : { type, path, includeSubgroups: false };
}
