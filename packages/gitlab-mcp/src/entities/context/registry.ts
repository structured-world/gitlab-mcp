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
        'View and manage runtime session configuration. Actions: show (current host/preset/scope/mode), list_presets (available tool configurations), list_profiles (OAuth users), whoami (token introspection with live refresh - detects permission changes and updates available tools), switch_preset (change active preset), switch_profile (change OAuth user), set_scope (restrict to namespace), reset (restore initial state). Use whoami to diagnose access issues and verify token permissions.',
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
]);

/**
 * Get read-only tool names from the registry
 * manage_context has both read and write actions, but we expose it in read-only mode
 * because the write actions (switch_preset, set_scope, reset) only affect the session,
 * not GitLab data.
 */
export function getContextReadOnlyToolNames(): string[] {
  return ['manage_context', 'get_profile'];
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
