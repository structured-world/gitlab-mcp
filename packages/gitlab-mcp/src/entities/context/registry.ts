/**
 * Context tools registry
 *
 * Registers the manage_context CQRS tool with the tool registry system.
 */

import * as z from 'zod';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { ManageContextSchema } from './schema';
import { handleManageContext } from './handlers';
import { ContextOutputSchema } from './output-schema';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { ACCOUNT_PROFILE_OUTPUT_SCHEMA, getAccountProfile } from './profile';
import {
  CONNECTION_CHECK_TOOL,
  SETTINGS_READ_OUTPUT_SCHEMA,
  SETTINGS_READ_TOOL,
  SETTINGS_UPDATE_INPUT_SCHEMA,
  SETTINGS_UPDATE_OUTPUT_SCHEMA,
  SETTINGS_PANEL_TOOL,
  SETTINGS_UPDATE_TOOL,
  readSettings,
  updateSettings,
} from './settings';
import { CONNECTION_CHECK_OUTPUT_SCHEMA, checkConnection } from './connection-check';
import { SETTINGS_PANEL_URI } from './settings-panel';
import {
  SCOPE_SEARCH_INPUT_SCHEMA,
  SCOPE_SEARCH_OUTPUT_SCHEMA,
  SCOPE_SEARCH_TOOL,
  findScopeTargets,
} from './scope-search';

/**
 * Context tools registry - 1 CQRS tool with 8 actions
 *
 * manage_context: Runtime context management
 *   - show: Display current context (Query)
 *   - list_presets: List available presets (Query)
 *   - list_profiles: List available profiles - OAuth only (Query)
 *   - whoami: Token introspection and capability discovery (Query)
 *   - switch_preset: Change active preset (Command)
 *   - switch_profile: Change active profile - OAuth only (Command)
 *   - set_scope: Set namespace scope with auto-detection (Command)
 *   - reset: Restore initial context (Command)
 */
export const contextToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  [
    'manage_context',
    {
      name: 'manage_context',
      description:
        'View and manage runtime session configuration. Actions: show (current host/preset/scope/mode), list_presets (available tool configurations), list_profiles (OAuth users), whoami (token introspection with live refresh - detects permission changes and updates available tools), switch_preset (change active preset), switch_profile (change OAuth user), set_scope (restrict to namespace), clear_scope (work everywhere in this session, keeping its preset and read-only mode), reset (restore initial state). Use whoami to diagnose access issues and verify token permissions.',
      inputSchema: z.toJSONSchema(ManageContextSchema),
      outputSchema: ToolSchema.shape.outputSchema.parse({
        ...z.toJSONSchema(ContextOutputSchema, { target: 'draft-7' }),
        type: 'object',
      }),
      resultFormat: 'mcp',
      // No gate - context management is always available
      handler: async (args: unknown) => {
        const input = ManageContextSchema.parse(args);
        const data = await handleManageContext(input);
        return {
          // Retain the documented Claude text payload. Context responses are small;
          // large entity/log results keep their existing single text representation.
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: { action: input.action, data },
        };
      },
    },
  ],
  [
    'get_profile',
    {
      name: 'get_profile',
      title: 'GitLab account',
      description:
        'Identify the GitLab account this connection uses: a stable account id, display name, email when GitLab provides it, and the username with its instance.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: ACCOUNT_PROFILE_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      // Marks the tool as the host's source of the connection's account profile.
      _meta: { 'openai/profile': true },
      resultFormat: 'mcp',
      handler: async () => {
        const profile = await getAccountProfile();
        return {
          content: [{ type: 'text', text: JSON.stringify(profile) }],
          structuredContent: profile,
        };
      },
    },
  ],
  [
    SETTINGS_READ_TOOL,
    {
      name: SETTINGS_READ_TOOL,
      title: 'GitLab settings',
      description:
        "Show this connection's settings for new chats: working preset, read-only mode, default project or group, and which tool groups are on, with what each can be set to.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: SETTINGS_READ_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      resultFormat: 'mcp',
      handler: async () => settingsResult(await readSettings()),
    },
  ],
  [
    SETTINGS_UPDATE_TOOL,
    {
      name: SETTINGS_UPDATE_TOOL,
      title: 'Change GitLab settings',
      description:
        "Change this connection's settings for new chats. Pass only the settings to change, by the names get_settings lists; the others keep their value. Nothing is saved when any value is invalid. Returns the saved values.",
      inputSchema: SETTINGS_UPDATE_INPUT_SCHEMA,
      outputSchema: SETTINGS_UPDATE_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      resultFormat: 'mcp',
      handler: async (args: unknown) => {
        const { set } = args as { set: Record<string, string | number | boolean> };
        return settingsResult(await updateSettings(set));
      },
    },
  ],
  [
    CONNECTION_CHECK_TOOL,
    {
      name: CONNECTION_CHECK_TOOL,
      title: 'Check connection',
      description:
        'Check the GitLab connection: which account it uses, whether GitLab answers, the restrictions in effect, and what to do about problems.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: CONNECTION_CHECK_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      resultFormat: 'mcp',
      handler: async () => settingsResult(await checkConnection()),
    },
  ],
  [
    SETTINGS_PANEL_TOOL,
    {
      name: SETTINGS_PANEL_TOOL,
      title: 'GitLab connection panel',
      description:
        'Open the GitLab connection panel to search projects and groups, choose where this chat or new chats work, and check the connection.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: {
        ui: { resourceUri: SETTINGS_PANEL_URI },
        // Alias read by hosts that predate the standard key.
        'openai/outputTemplate': SETTINGS_PANEL_URI,
      },
      resultFormat: 'mcp',
      handler: () =>
        Promise.resolve({
          content: [
            {
              type: 'text',
              text: 'Opened the GitLab connection panel. Clients without app panels change the same settings with get_settings, update_settings and manage_context set_scope.',
            },
          ],
          structuredContent: { opened: true },
        }),
    },
  ],
  [
    SCOPE_SEARCH_TOOL,
    {
      name: SCOPE_SEARCH_TOOL,
      title: 'Find projects and groups',
      description:
        'Find projects you are a member of and groups you can see by name or path, to choose a working scope.',
      inputSchema: SCOPE_SEARCH_INPUT_SCHEMA,
      outputSchema: SCOPE_SEARCH_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      resultFormat: 'mcp',
      handler: async (args: unknown) => {
        const { query } = args as { query: string };
        return settingsResult(await findScopeTargets(query));
      },
    },
  ],
]);

function settingsResult(data: object): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * Get read-only tool names from the registry
 * manage_context has both read and write actions, but we expose it in read-only mode
 * because the write actions (switch_preset, set_scope, reset) only affect the session,
 * not GitLab data.
 */
export function getContextReadOnlyToolNames(): string[] {
  // update_settings changes only this server's settings, never GitLab data.
  return [
    'manage_context',
    'get_profile',
    SETTINGS_READ_TOOL,
    SETTINGS_UPDATE_TOOL,
    CONNECTION_CHECK_TOOL,
    SETTINGS_PANEL_TOOL,
    SCOPE_SEARCH_TOOL,
  ];
}

/**
 * Get all tool definitions from the registry
 */
export function getContextToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(contextToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 * Context tools are always available since they don't modify GitLab data
 */
export function getFilteredContextTools(_readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  return getContextToolDefinitions();
}
