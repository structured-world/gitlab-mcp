/**
 * Context tools registry
 *
 * Registers the manage_context CQRS tool with the tool registry system.
 */

import * as z from "zod";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { ManageContextSchema } from "./schema";
import { handleManageContext } from "./handlers";

/**
 * Context tools registry - 1 CQRS tool with 7 actions
 *
 * manage_context: Runtime context management
 *   - show: Display current context (Query)
 *   - list_presets: List available presets (Query)
 *   - list_profiles: List available profiles - OAuth only (Query)
 *   - switch_preset: Change active preset (Command)
 *   - switch_profile: Change active profile - OAuth only (Command)
 *   - set_scope: Set namespace scope with auto-detection (Command)
 *   - reset: Restore initial context (Command)
 */
export const contextToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  [
    "manage_context",
    {
      name: "manage_context",
      description:
        "CONTEXT: Manage runtime session context. Actions: " +
        "'show' returns current context (host, preset, scope, mode); " +
        "'list_presets' lists available presets with descriptions; " +
        "'list_profiles' lists OAuth profiles (OAuth mode only); " +
        "'switch_preset' changes active preset by name; " +
        "'switch_profile' changes OAuth profile (OAuth mode only); " +
        "'set_scope' restricts operations to a namespace (auto-detects group vs project); " +
        "'reset' restores initial context from session start.",
      inputSchema: z.toJSONSchema(ManageContextSchema),
      // No gate - context management is always available
      handler: async (args: unknown) => {
        const input = ManageContextSchema.parse(args);
        return handleManageContext(input);
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
  return ["manage_context"];
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
