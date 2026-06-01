// Transport mode constants and type
const TransportModeObj = {
  STDIO: 'stdio',
  SSE: 'sse',
  STREAMABLE_HTTP: 'streamable-http',
  DUAL: 'dual',
} as const;

export { TransportModeObj as TransportMode };
export type TransportMode = (typeof TransportModeObj)[keyof typeof TransportModeObj];

// Common GitLab API response types
export interface GitLabAPIResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
}

// Tool definition interface
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Feature gate metadata for USE_* environment variables
export interface FeatureGate {
  envVar: string; // e.g., "USE_LABELS"
  defaultValue: boolean; // Default when env var is not set
}

// Tier/version/admin requirement for a tool, one of its actions, or one of its
// parameters. All fields optional: absent tier defaults to 'free', absent
// minVersion to '8.0', absent requiresAdmin to false. Consulted by the registry
// (via InstanceCapabilities) to filter out unsupported tools and strip
// restricted parameters, instead of letting them fail at call time. (Action-level
// entries also drive tier-badge documentation.)
export interface ToolRequirement {
  tier?: 'free' | 'premium' | 'ultimate';
  minVersion?: string;
  /** Forward-looking gate for admin-only operations (#431/#432 soft-delete restore). */
  requiresAdmin?: boolean;
  notes?: string;
}

// Version/tier/admin requirements declared on a tool definition. Carries the same
// action- and parameter-level granularity the registry needs: `default` applies
// to the whole tool, `actions` overrides per discriminated-union action, and
// `parameters` gates individual schema properties (stripped when unmet).
export interface ToolRequirements {
  default: ToolRequirement;
  actions?: Record<string, ToolRequirement>;
  parameters?: Record<string, ToolRequirement>;
}

// Enhanced tool definition interface that includes handler function
export interface EnhancedToolDefinition extends ToolDefinition {
  handler: (args: unknown) => Promise<unknown>;
  gate?: FeatureGate; // Optional - tools without gate are always enabled
  /**
   * Version/tier/admin requirements for this tool. When the detected instance
   * does not meet them, the registry filters the tool (or strips gated
   * parameters) from the catalog rather than surfacing an opaque call-time API
   * error. Tools without requirements fall through to a conservative gate.
   */
  requirements?: ToolRequirements;
  /**
   * Mark the tool as idempotent (safe to retry on failure).
   * If not specified, idempotency is inferred from tool name:
   * - browse_*, list_*, get_*, download_* are considered idempotent (read-only)
   * - manage_* are considered non-idempotent (write operations)
   * Set explicitly to override the default behavior.
   */
  idempotent?: boolean;
}

// Tool registry type for storing enhanced tool definitions
export type ToolRegistry = Map<string, EnhancedToolDefinition>;
