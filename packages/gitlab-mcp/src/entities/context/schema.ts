/**
 * Schema definitions for manage_context tool
 *
 * CQRS pattern with 11 actions:
 * - show: Display current context (Query)
 * - list_presets: List available presets (Query)
 * - whoami: Token introspection and capability discovery (Query)
 * - list_accounts: GitLab accounts this connection can use (Query)
 * - switch_preset: Change active preset (Command)
 * - set_scope: Set namespace scope with auto-detection (Command)
 * - clear_scope: Work everywhere in this session (Command)
 * - reset: Restore initial context (Command)
 * - switch_account: Work with another account in this chat (Command)
 * - link_account: Sign in with another account and link it (Command)
 * - unlink_account: Remove a linked account (Command)
 */

import { z } from 'zod';

// ============================================================================
// Action Schemas
// ============================================================================

/**
 * Show current context - returns complete session information
 */
const ShowContextSchema = z.object({
  action: z
    .literal('show')
    .describe('Display current context including host, preset, scope, and mode'),
});

/**
 * List available presets (built-in + user-defined)
 */
const ListPresetsSchema = z.object({
  action: z.literal('list_presets').describe('List all available presets with descriptions'),
});

/**
 * Switch to a different preset
 */
const SwitchPresetSchema = z.object({
  action: z.literal('switch_preset').describe('Switch to a different preset configuration'),
  preset: z.string().min(1).describe('Name of the preset to activate'),
});

/**
 * Set namespace scope with auto-detection
 */
const SetScopeSchema = z.object({
  action: z.literal('set_scope').describe('Set scope to restrict operations to a namespace'),
  namespace: z
    .string()
    .min(1)
    .describe("Namespace path (e.g., 'my-group' or 'group/project') - type is auto-detected"),
  includeSubgroups: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include subgroups when scope is a group (default: true)'),
});

/**
 * Work everywhere in this session, keeping its other overrides
 */
const ClearScopeSchema = z.object({
  action: z
    .literal('clear_scope')
    .describe(
      "Work everywhere the account has access in this session: drops this session's scope and the account's default scope for it; preset and read-only mode stay",
    ),
});

/**
 * Reset context to initial state
 */
const ResetContextSchema = z.object({
  action: z.literal('reset').describe('Reset context to initial state from session start'),
});

/**
 * Get current authentication status, token capabilities, and server configuration.
 * Re-introspects the token to detect permission changes and automatically refreshes
 * available tools if scopes have changed. Use to diagnose access issues or verify
 * that new token permissions are active.
 */
const WhoamiSchema = z.object({
  action: z
    .literal('whoami')
    .describe(
      'Get authentication status, token capabilities, and server configuration. ' +
        'Re-introspects token to detect permission changes - if scopes changed, ' +
        'automatically refreshes available tools (scopesRefreshed=true in response). ' +
        'Use to diagnose access issues or verify new token permissions are active.',
    ),
});

const ListAccountsSchema = z.object({
  action: z
    .literal('list_accounts')
    .describe(
      'List the GitLab accounts this connection can use, on one or several instances, and which one this chat works with',
    ),
});

const SwitchAccountSchema = z.object({
  action: z
    .literal('switch_account')
    .describe(
      'Work with another of the listed accounts in this chat; other chats keep theirs. Tools, settings and permissions follow that account and its instance',
    ),
  account: z.string().min(1).describe('Account id from list_accounts'),
});

const LinkAccountSchema = z.object({
  action: z
    .literal('link_account')
    .describe(
      'Sign in with another GitLab account, on this or another configured instance, and link it to this connection. Returns a sign-in link the user opens in the browser',
    ),
  instance: z
    .string()
    .optional()
    .describe(
      "Instance URL of the account to link (e.g. 'https://gitlab.com'); default: this connection's instance",
    ),
});

const UnlinkAccountSchema = z.object({
  action: z
    .literal('unlink_account')
    .describe('Remove a linked account from this connection and end its GitLab sign-in'),
  account: z.string().min(1).describe('Account id from list_accounts'),
});

// ============================================================================
// Combined Schema (Discriminated Union)
// ============================================================================

/**
 * ManageContextSchema - discriminated union of all context management actions
 */
export const ManageContextSchema = z.discriminatedUnion('action', [
  ShowContextSchema,
  ListPresetsSchema,
  SwitchPresetSchema,
  SetScopeSchema,
  ClearScopeSchema,
  ResetContextSchema,
  WhoamiSchema,
  ListAccountsSchema,
  SwitchAccountSchema,
  LinkAccountSchema,
  UnlinkAccountSchema,
]);

// ============================================================================
// TypeScript Types
// ============================================================================

export type ManageContextInput = z.infer<typeof ManageContextSchema>;
export type ShowContextInput = z.infer<typeof ShowContextSchema>;
export type ListPresetsInput = z.infer<typeof ListPresetsSchema>;
export type SwitchPresetInput = z.infer<typeof SwitchPresetSchema>;
export type SetScopeInput = z.infer<typeof SetScopeSchema>;
export type ClearScopeInput = z.infer<typeof ClearScopeSchema>;
export type ResetContextInput = z.infer<typeof ResetContextSchema>;
export type WhoamiInput = z.infer<typeof WhoamiSchema>;
export type SwitchAccountInput = z.infer<typeof SwitchAccountSchema>;
export type LinkAccountInput = z.infer<typeof LinkAccountSchema>;
export type UnlinkAccountInput = z.infer<typeof UnlinkAccountSchema>;
