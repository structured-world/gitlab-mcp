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

// ============================================================================
// Whoami Types
// ============================================================================

/**
 * Token type classification
 */
export type WhoamiTokenType =
  | "personal_access_token"
  | "project_access_token"
  | "group_access_token"
  | "oauth"
  | "unknown";

/**
 * User identity information
 */
export interface WhoamiUserInfo {
  /** GitLab user ID */
  id: number;
  /** GitLab username */
  username: string;
  /** Full display name */
  name: string;
  /** User email (if accessible) */
  email?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Whether user has admin privileges */
  isAdmin?: boolean;
  /** User account state */
  state: "active" | "blocked" | "deactivated";
}

/**
 * Token information
 */
export interface WhoamiTokenInfo {
  /** Token type classification */
  type: WhoamiTokenType;
  /** Token name (if available) */
  name: string | null;
  /** Token scopes */
  scopes: string[];
  /** Token expiration date (ISO string or null if never expires) */
  expiresAt: string | null;
  /** Days until token expires (negative if expired, null if never expires) */
  daysUntilExpiry: number | null;
  /** Whether token is currently valid */
  isValid: boolean;
  /** Whether token has GraphQL API access (api or read_api scope) */
  hasGraphQLAccess: boolean;
  /** Whether token has write access (api scope) */
  hasWriteAccess: boolean;
}

/**
 * Server configuration information
 */
export interface WhoamiServerInfo {
  /** GitLab hostname */
  host: string;
  /** Full API URL */
  apiUrl: string;
  /** GitLab version string */
  version: string;
  /** GitLab tier (free/premium/ultimate) */
  tier: "free" | "premium" | "ultimate" | "unknown";
  /** GitLab edition (EE/CE) */
  edition: "EE" | "CE" | "unknown";
  /** Whether server is in read-only mode */
  readOnlyMode: boolean;
  /** Whether OAuth is enabled for this server */
  oauthEnabled: boolean;
}

/**
 * Tool filtering statistics - explains why tools may be unavailable
 */
export interface WhoamiCapabilities {
  /** Whether browse/read operations are available */
  canBrowse: boolean;
  /** Whether manage/write operations are available */
  canManage: boolean;
  /** Whether GraphQL API is accessible */
  canAccessGraphQL: boolean;
  /** Number of tools currently available */
  availableToolCount: number;
  /** Total number of registered tools (before filtering) */
  totalToolCount: number;
  /** Tools filtered due to insufficient token scopes */
  filteredByScopes: number;
  /** Tools filtered due to read-only mode */
  filteredByReadOnly: number;
  /** Tools filtered due to GitLab tier restrictions */
  filteredByTier: number;
  /** Tools filtered due to denied tools regex */
  filteredByDeniedRegex: number;
  /** Tools filtered due to all actions being denied */
  filteredByActionDenial: number;
}

/**
 * Recommendation action type
 */
export type WhoamiRecommendationAction =
  | "create_new_token"
  | "add_scope"
  | "enable_oauth"
  | "contact_admin"
  | "renew_token";

/**
 * Actionable recommendation for improving access
 */
export interface WhoamiRecommendation {
  /** Recommended action type */
  action: WhoamiRecommendationAction;
  /** Human-readable message explaining the recommendation */
  message: string;
  /** URL to take action (e.g., token creation page) */
  url?: string;
  /** Priority of this recommendation */
  priority: "high" | "medium" | "low";
}

/**
 * Current context information for whoami response
 */
export interface WhoamiContextInfo {
  /** Currently active preset name */
  activePreset: string | null;
  /** Currently active OAuth profile name */
  activeProfile: string | null;
  /** Current scope restriction */
  scope: RuntimeScope | null;
}

/**
 * Complete whoami result containing all introspection data
 */
export interface WhoamiResult {
  /** Current user identity (null if token invalid or user info inaccessible) */
  user: WhoamiUserInfo | null;
  /** Token information (null if detection failed) */
  token: WhoamiTokenInfo | null;
  /** Server configuration */
  server: WhoamiServerInfo;
  /** Tool capabilities and filtering statistics */
  capabilities: WhoamiCapabilities;
  /** Current runtime context */
  context: WhoamiContextInfo;
  /** Warning messages about current state */
  warnings: string[];
  /** Actionable recommendations for improving access */
  recommendations: WhoamiRecommendation[];
  /**
   * True if token scopes were refreshed and tool availability changed.
   * When true, the available tools list has been updated - new tools may now be accessible.
   * The MCP server automatically sends a tools/list_changed notification to the client.
   */
  scopesRefreshed: boolean;
}
