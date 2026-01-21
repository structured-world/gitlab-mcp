/**
 * Context types for runtime context management
 *
 * The manage_context tool allows AI agents to view and modify
 * the current session context at runtime.
 */

import { ProfileInfo, Preset, ScopeConfig } from "../../profiles/types";

/**
 * Runtime scope information with detection metadata
 */
export interface RuntimeScope {
  /** Detected type of the namespace */
  type: "project" | "group";
  /** The primary namespace path (for single scope) */
  path: string;
  /** Additional paths when multiple projects/groups are configured */
  additionalPaths?: string[];
  /** Whether subgroups are included (for group scope) */
  includeSubgroups: boolean;
  /** Whether this scope was auto-detected */
  detected: boolean;
}

/**
 * Current session context information
 *
 * This represents the runtime state of the MCP server session,
 * including authentication, preset, and scope information.
 */
export interface SessionContext {
  /** GitLab hostname */
  host: string;
  /** Full GitLab API URL */
  apiUrl: string;
  /** Current profile name (OAuth mode only) */
  profileName?: string;
  /** Current preset name */
  presetName?: string;
  /** Read-only mode status */
  readOnly: boolean;
  /** Current scope restriction */
  scope?: RuntimeScope;
  /** OAuth mode indicator */
  oauthMode: boolean;
  /** Initial context snapshot (for reset) */
  initialContext?: Omit<SessionContext, "initialContext">;
}

/**
 * Result of a set_scope operation
 */
export interface SetScopeResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The detected/set scope */
  scope: RuntimeScope;
  /** Human-readable message */
  message: string;
}

/**
 * Result of a switch operation (preset or profile)
 */
export interface SwitchResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Previous value */
  previous?: string;
  /** New value */
  current: string;
  /** Human-readable message */
  message: string;
}

/**
 * Result of a reset operation
 */
export interface ResetResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** The restored context */
  context: SessionContext;
}

/**
 * Extended preset info for listing (includes scope if set)
 */
export interface PresetInfo {
  name: string;
  description?: string;
  readOnly: boolean;
  isBuiltIn: boolean;
  scope?: ScopeConfig;
  features?: Record<string, boolean>;
}

/**
 * Context manager state for internal use
 */
export interface ContextState {
  /** Current preset (merged with scope) */
  currentPreset?: Preset;
  /** Current preset name */
  currentPresetName?: string;
  /** Current scope enforcer config */
  currentScope?: ScopeConfig;
  /** Initial state snapshot */
  initialState?: ContextState;
}

/**
 * Re-export ProfileInfo for use in context handlers
 */
export type { ProfileInfo };
