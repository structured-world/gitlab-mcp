/**
 * Schema definitions for manage_context tool
 *
 * CQRS pattern with 7 actions:
 * - show: Display current context (Query)
 * - list_presets: List available presets (Query)
 * - list_profiles: List available profiles - OAuth only (Query)
 * - switch_preset: Change active preset (Command)
 * - switch_profile: Change active profile - OAuth only (Command)
 * - set_scope: Set namespace scope with auto-detection (Command)
 * - reset: Restore initial context (Command)
 */

import { z } from "zod";

// ============================================================================
// Action Schemas
// ============================================================================

/**
 * Show current context - returns complete session information
 */
const ShowContextSchema = z.object({
  action: z
    .literal("show")
    .describe("Display current context including host, preset, scope, and mode"),
});

/**
 * List available presets (built-in + user-defined)
 */
const ListPresetsSchema = z.object({
  action: z.literal("list_presets").describe("List all available presets with descriptions"),
});

/**
 * List available profiles (OAuth mode only)
 */
const ListProfilesSchema = z.object({
  action: z
    .literal("list_profiles")
    .describe("List available OAuth profiles - only works in OAuth mode"),
});

/**
 * Switch to a different preset
 */
const SwitchPresetSchema = z.object({
  action: z.literal("switch_preset").describe("Switch to a different preset configuration"),
  preset: z.string().min(1).describe("Name of the preset to activate"),
});

/**
 * Switch to a different profile (OAuth mode only)
 */
const SwitchProfileSchema = z.object({
  action: z
    .literal("switch_profile")
    .describe("Switch to a different OAuth profile - OAuth mode only"),
  profile: z.string().min(1).describe("Name of the profile to activate"),
});

/**
 * Set namespace scope with auto-detection
 */
const SetScopeSchema = z.object({
  action: z.literal("set_scope").describe("Set scope to restrict operations to a namespace"),
  namespace: z
    .string()
    .min(1)
    .describe("Namespace path (e.g., 'my-group' or 'group/project') - type is auto-detected"),
  includeSubgroups: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include subgroups when scope is a group (default: true)"),
});

/**
 * Reset context to initial state
 */
const ResetContextSchema = z.object({
  action: z.literal("reset").describe("Reset context to initial state from session start"),
});

// ============================================================================
// Combined Schema (Discriminated Union)
// ============================================================================

/**
 * ManageContextSchema - discriminated union of all context management actions
 */
export const ManageContextSchema = z.discriminatedUnion("action", [
  ShowContextSchema,
  ListPresetsSchema,
  ListProfilesSchema,
  SwitchPresetSchema,
  SwitchProfileSchema,
  SetScopeSchema,
  ResetContextSchema,
]);

// ============================================================================
// TypeScript Types
// ============================================================================

export type ManageContextInput = z.infer<typeof ManageContextSchema>;
export type ShowContextInput = z.infer<typeof ShowContextSchema>;
export type ListPresetsInput = z.infer<typeof ListPresetsSchema>;
export type ListProfilesInput = z.infer<typeof ListProfilesSchema>;
export type SwitchPresetInput = z.infer<typeof SwitchPresetSchema>;
export type SwitchProfileInput = z.infer<typeof SwitchProfileSchema>;
export type SetScopeInput = z.infer<typeof SetScopeSchema>;
export type ResetContextInput = z.infer<typeof ResetContextSchema>;
