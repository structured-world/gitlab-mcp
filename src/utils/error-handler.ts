/**
 * Structured Error Handler
 *
 * Transforms GitLab API errors into structured, actionable responses
 * that help LLMs self-correct and provide guidance for users.
 *
 * Integrates with ConnectionManager to detect tier restrictions based on
 * actual GitLab instance capabilities, not static mappings.
 */

import { ConnectionManager } from "../services/ConnectionManager.js";
import { GitLabFeatures, GitLabTier as InternalTier } from "../services/GitLabVersionDetector.js";
import { parseVersion } from "./version.js";

/**
 * Display-friendly tier type with capitalized values for API responses.
 * Distinct from InternalTier (lowercase) - converted via normalizeTier().
 */
export type GitLabTier = "Free" | "Premium" | "Ultimate";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base structured error interface
 */
export interface StructuredError {
  /** Error classification code */
  error_code: string;
  /** Tool that triggered the error */
  tool: string;
  /** Action that was attempted */
  action: string;
  /** Human-readable error message */
  message: string;
  /** Suggested fix for the error */
  suggested_fix?: string;
}

/**
 * Validation error for invalid action parameters
 */
export interface ActionValidationError extends StructuredError {
  error_code:
    | "MISSING_REQUIRED_FIELD"
    | "INVALID_ACTION"
    | "FIELD_NOT_ALLOWED"
    | "TYPE_MISMATCH"
    | "VALIDATION_ERROR";
  /** Fields that are missing but required */
  missing_fields?: string[];
  /** Fields with invalid values */
  invalid_fields?: Array<{
    field: string;
    expected: string;
    received: string;
  }>;
  /** List of valid actions for this tool */
  valid_actions?: string[];
  /** Required fields for each action */
  action_required_fields?: Record<string, string[]>;
}

/**
 * Alternative action available on a different tier
 *
 * Note: This interface uses snake_case for JSON serialization in API responses.
 */
export interface TierAlternative {
  /** Action description */
  action: string;
  /** Detailed description of the alternative */
  description: string;
  /** Tier where this alternative is available (snake_case for JSON output) */
  available_on: GitLabTier;
}

/**
 * Error for tier-restricted features
 */
export interface TierRestrictedError extends StructuredError {
  error_code: "TIER_RESTRICTED";
  /** HTTP status code from GitLab */
  http_status: number;
  /** Required tier for this feature */
  tier_required: GitLabTier;
  /** Current tier if detectable */
  current_tier?: GitLabTier;
  /** Human-readable feature name */
  feature_name: string;
  /** Alternative approaches */
  alternatives?: TierAlternative[];
  /** Documentation URL */
  docs_url?: string;
  /** Upgrade URL */
  upgrade_url?: string;
}

/**
 * Error for permission denied (not tier-related)
 */
export interface PermissionDeniedError extends StructuredError {
  error_code: "PERMISSION_DENIED";
  /** HTTP status code from GitLab */
  http_status: number;
  /** Required access level */
  required_access?: string;
  /** Alternative approaches */
  alternatives?: TierAlternative[];
}

/**
 * Error for resource not found
 */
export interface NotFoundError extends StructuredError {
  error_code: "NOT_FOUND";
  /** HTTP status code from GitLab */
  http_status: number;
  /** Resource type that wasn't found */
  resource_type?: string;
  /** Resource identifier that was searched */
  resource_id?: string;
}

/**
 * Generic API error
 */
export interface ApiError extends StructuredError {
  error_code: "API_ERROR" | "RATE_LIMITED" | "SERVER_ERROR";
  /** HTTP status code from GitLab */
  http_status: number;
  /** Raw error from GitLab */
  gitlab_error?: string;
}

/**
 * Error for version-restricted widget parameters
 */
export interface VersionRestrictedError extends StructuredError {
  error_code: "VERSION_RESTRICTED";
  /** Widget type that is restricted */
  widget: string;
  /** Parameter name that maps to the widget */
  parameter: string;
  /** Required GitLab version for this widget */
  required_version: string;
  /** Detected GitLab instance version */
  detected_version: string;
  /** Required tier (if also tier-restricted) */
  required_tier?: GitLabTier;
  /** Current tier */
  current_tier?: GitLabTier;
  /** Documentation URL */
  docs_url?: string;
}

/**
 * Timeout error for API requests that exceeded the timeout limit
 */
export interface TimeoutError extends StructuredError {
  error_code: "TIMEOUT";
  /** Timeout duration in milliseconds */
  timeout_ms: number;
  /** Whether the request can be retried (idempotent operation) */
  retryable: boolean;
}

/**
 * Union type of all structured errors
 */
export type GitLabStructuredError =
  | ActionValidationError
  | TierRestrictedError
  | VersionRestrictedError
  | PermissionDeniedError
  | NotFoundError
  | ApiError
  | TimeoutError;

// ============================================================================
// Tier Restriction Detection
// ============================================================================

/**
 * Information about a tier-restricted feature
 */
interface TierRestrictionInfo {
  /** Feature key from GitLabFeatures */
  feature: keyof GitLabFeatures;
  /** Human-readable feature name */
  name: string;
  /** Required tier for this feature */
  requiredTier: GitLabTier;
  /** Current instance tier */
  currentTier?: GitLabTier;
  /** Alternative approaches */
  alternatives: TierAlternative[];
  /** Documentation URL */
  docsUrl: string;
}

/**
 * Mapping of features to their metadata (name, docs, alternatives)
 * Used for generating helpful error messages
 */
const FEATURE_METADATA: Record<
  keyof GitLabFeatures,
  {
    name: string;
    requiredTier: GitLabTier;
    docsUrl: string;
    alternatives: TierAlternative[];
  }
> = {
  workItems: {
    name: "Work Items",
    requiredTier: "Free",
    docsUrl: "https://docs.gitlab.com/ee/user/project/work_items/",
    alternatives: [],
  },
  epics: {
    name: "Epics",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/group/epics/",
    alternatives: [
      {
        action: "Use issues for tracking",
        description: "Create issues with labels to organize work instead of epics",
        available_on: "Free",
      },
      {
        action: "Use milestones",
        description: "Group related issues under milestones for release planning",
        available_on: "Free",
      },
    ],
  },
  iterations: {
    name: "Iterations",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/group/iterations/",
    alternatives: [
      {
        action: "Use milestones",
        description: "Use milestones to track time-boxed work periods",
        available_on: "Free",
      },
    ],
  },
  roadmaps: {
    name: "Roadmaps",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/group/roadmap/",
    alternatives: [
      {
        action: "Use milestone views",
        description: "View milestones timeline for basic roadmap functionality",
        available_on: "Free",
      },
    ],
  },
  portfolioManagement: {
    name: "Portfolio Management",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/group/planning_hierarchy/",
    alternatives: [
      {
        action: "Use group-level milestones",
        description: "Track progress across projects using group milestones",
        available_on: "Free",
      },
    ],
  },
  advancedSearch: {
    name: "Advanced Search",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/search/advanced_search.html",
    alternatives: [
      {
        action: "Use basic search",
        description: "Use standard GitLab search functionality",
        available_on: "Free",
      },
    ],
  },
  codeReview: {
    name: "Code Review Analytics",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/analytics/code_review_analytics.html",
    alternatives: [],
  },
  securityDashboard: {
    name: "Security Dashboard",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/application_security/security_dashboard/",
    alternatives: [],
  },
  complianceFramework: {
    name: "Compliance Framework",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/project/settings/compliance_frameworks.html",
    alternatives: [],
  },
  valueStreamAnalytics: {
    name: "Value Stream Analytics",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/group/value_stream_analytics/",
    alternatives: [],
  },
  customFields: {
    name: "Custom Fields",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/project/working_with_projects.html",
    alternatives: [
      {
        action: "Use labels",
        description: "Use labels to categorize and tag work items",
        available_on: "Free",
      },
    ],
  },
  okrs: {
    name: "OKRs (Objectives and Key Results)",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/okrs/",
    alternatives: [
      {
        action: "Use issues with labels",
        description: "Track objectives as issues with specific labels",
        available_on: "Free",
      },
    ],
  },
  healthStatus: {
    name: "Health Status",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#health-status",
    alternatives: [
      {
        action: "Use labels for status",
        description: "Create labels like 'on-track', 'at-risk', 'needs-attention'",
        available_on: "Free",
      },
    ],
  },
  weight: {
    name: "Issue Weight",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/project/issues/issue_weight.html",
    alternatives: [
      {
        action: "Use labels for estimation",
        description: "Create labels like 'size::S', 'size::M', 'size::L' for estimation",
        available_on: "Free",
      },
    ],
  },
  multiLevelEpics: {
    name: "Multi-level Epics",
    requiredTier: "Ultimate",
    docsUrl:
      "https://docs.gitlab.com/ee/user/group/epics/manage_epics.html#multi-level-child-epics",
    alternatives: [
      {
        action: "Use flat epics",
        description: "Organize work with single-level epics (Premium)",
        available_on: "Premium",
      },
    ],
  },
  serviceDesk: {
    name: "Service Desk",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/project/service_desk/",
    alternatives: [],
  },
  requirements: {
    name: "Requirements Management",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/project/requirements/",
    alternatives: [
      {
        action: "Use issues",
        description: "Track requirements as issues with a dedicated label",
        available_on: "Free",
      },
    ],
  },
  qualityManagement: {
    name: "Quality Management",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/ci/testing/",
    alternatives: [],
  },
  timeTracking: {
    name: "Time Tracking",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/project/time_tracking.html",
    alternatives: [],
  },
  crmContacts: {
    name: "CRM Contacts",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/crm/",
    alternatives: [],
  },
  vulnerabilities: {
    name: "Vulnerability Management",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/user/application_security/vulnerabilities/",
    alternatives: [],
  },
  errorTracking: {
    name: "Error Tracking",
    requiredTier: "Ultimate",
    docsUrl: "https://docs.gitlab.com/ee/operations/error_tracking.html",
    alternatives: [],
  },
  designManagement: {
    name: "Design Management",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/project/issues/design_management.html",
    alternatives: [],
  },
  linkedResources: {
    name: "Linked Resources",
    requiredTier: "Premium",
    docsUrl: "https://docs.gitlab.com/ee/user/project/issues/related_issues.html",
    alternatives: [],
  },
  emailParticipants: {
    name: "Email Participants",
    requiredTier: "Premium",
    docsUrl:
      "https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#add-an-email-participant",
    alternatives: [],
  },
};

/**
 * Detect if the error is due to a tier restriction
 *
 * Uses ConnectionManager to check actual instance capabilities
 * and analyzes tool parameters for context-aware detection
 */
function detectTierRestriction(
  tool: string,
  action: string,
  toolArgs?: Record<string, unknown>
): TierRestrictionInfo | null {
  let connectionManager: ConnectionManager;
  try {
    connectionManager = ConnectionManager.getInstance();
  } catch {
    // Connection not initialized - cannot detect tier
    return null;
  }

  // Get current tier for the error response
  const currentTierRaw = connectionManager.getTier();
  const currentTier = normalizeTier(currentTierRaw);

  // Check for work item type restrictions
  if (tool === "browse_work_items" || tool === "manage_work_item") {
    const restriction = checkWorkItemTypeRestriction(connectionManager, toolArgs, currentTier);
    if (restriction) return restriction;
  }

  // Check for iterations
  if (tool === "browse_iterations") {
    if (!connectionManager.isFeatureAvailable("iterations")) {
      return createRestrictionInfo("iterations", currentTier);
    }
  }

  // Check for group webhooks (tool name pattern)
  if ((tool === "browse_webhooks" || tool === "manage_webhook") && toolArgs?.scope === "group") {
    // Group webhooks require Premium - check if we have serviceDesk (Premium feature) as proxy
    if (!connectionManager.isFeatureAvailable("serviceDesk")) {
      return {
        feature: "serviceDesk", // Using serviceDesk as proxy for Premium tier
        name: "Group Webhooks",
        requiredTier: "Premium",
        currentTier,
        alternatives: [
          {
            action: "Use project-level webhooks",
            description: "Configure webhooks on individual projects instead",
            available_on: "Free",
          },
        ],
        docsUrl: "https://docs.gitlab.com/ee/user/project/integrations/webhooks.html",
      };
    }
  }

  return null;
}

/**
 * Check if work item types in the request require higher tier
 */
function checkWorkItemTypeRestriction(
  connectionManager: ConnectionManager,
  toolArgs?: Record<string, unknown>,
  currentTier?: GitLabTier
): TierRestrictionInfo | null {
  if (!toolArgs) return null;

  // Extract work item types from various parameter formats
  const types = extractWorkItemTypes(toolArgs);

  // Check for EPIC
  if (types.includes("EPIC")) {
    if (!connectionManager.isFeatureAvailable("epics")) {
      return createRestrictionInfo("epics", currentTier);
    }
  }

  // Check for OBJECTIVE/KEY_RESULT (OKRs)
  if (types.includes("OBJECTIVE") || types.includes("KEY_RESULT")) {
    if (!connectionManager.isFeatureAvailable("okrs")) {
      return createRestrictionInfo("okrs", currentTier);
    }
  }

  // Check for REQUIREMENT
  if (types.includes("REQUIREMENT")) {
    if (!connectionManager.isFeatureAvailable("requirements")) {
      return createRestrictionInfo("requirements", currentTier);
    }
  }

  return null;
}

/**
 * Extract work item types from tool arguments
 */
function extractWorkItemTypes(toolArgs: Record<string, unknown>): string[] {
  const types: string[] = [];

  // Handle 'types' array parameter (browse_work_items)
  if (Array.isArray(toolArgs.types)) {
    types.push(...toolArgs.types.map(t => String(t).toUpperCase()));
  }

  // Handle 'workItemType' string parameter (manage_work_item)
  if (typeof toolArgs.workItemType === "string") {
    types.push(toolArgs.workItemType.toUpperCase());
  }

  // Handle 'type' string parameter (alternative naming)
  if (typeof toolArgs.type === "string") {
    types.push(toolArgs.type.toUpperCase());
  }

  return types;
}

/**
 * Create TierRestrictionInfo from feature key
 */
function createRestrictionInfo(
  feature: keyof GitLabFeatures,
  currentTier?: GitLabTier
): TierRestrictionInfo {
  const metadata = FEATURE_METADATA[feature];
  return {
    feature,
    name: metadata.name,
    requiredTier: metadata.requiredTier,
    currentTier,
    alternatives: metadata.alternatives,
    docsUrl: metadata.docsUrl,
  };
}

/**
 * Normalize tier string to display GitLabTier type.
 * Converts InternalTier (lowercase: "free", "premium", "ultimate")
 * to display GitLabTier (capitalized: "Free", "Premium", "Ultimate").
 */
export function normalizeTier(tier: string | InternalTier): GitLabTier {
  const lower = tier.toLowerCase();
  if (lower === "ultimate" || lower === "gold") return "Ultimate";
  if (lower === "premium" || lower === "silver") return "Premium";
  return "Free";
}

// ============================================================================
// Error Handler
// ============================================================================

/**
 * Raw GitLab API error shape
 */
export interface GitLabApiErrorResponse {
  status: number;
  message?: string;
  error?: string;
  error_description?: string;
}

/**
 * Transform a GitLab API error into a structured error response
 *
 * @param error - Raw error from GitLab API
 * @param tool - Tool name that triggered the error
 * @param action - Action that was attempted
 * @param toolArgs - Original tool arguments (used for parameter-aware tier detection)
 * @returns Structured error with actionable information
 */
export function handleGitLabError(
  error: GitLabApiErrorResponse,
  tool: string,
  action: string,
  toolArgs?: Record<string, unknown>
): GitLabStructuredError {
  const { status, message, error: errorMsg, error_description } = error;
  const rawMessage = message ?? errorMsg ?? error_description ?? "Unknown error";

  // 403 Forbidden - could be tier restriction or permission issue
  if (status === 403) {
    // Check for tier restrictions using ConnectionManager and tool parameters
    const tierRestriction = detectTierRestriction(tool, action, toolArgs);
    if (tierRestriction) {
      return createTierRestrictedError(tool, action, status, tierRestriction);
    }

    return createPermissionDeniedError(tool, action, status, rawMessage);
  }

  // 404 Not Found - resource doesn't exist or no access
  if (status === 404) {
    return createNotFoundError(tool, action, status, rawMessage);
  }

  // 429 Rate Limited
  if (status === 429) {
    return {
      error_code: "RATE_LIMITED",
      tool,
      action,
      http_status: status,
      message: "Rate limit exceeded. Please wait before retrying.",
      suggested_fix: "Wait a few minutes and try again, or reduce request frequency",
      gitlab_error: rawMessage,
    };
  }

  // 5xx Server Errors
  if (status >= 500) {
    return {
      error_code: "SERVER_ERROR",
      tool,
      action,
      http_status: status,
      message: "GitLab server error. The service may be temporarily unavailable.",
      suggested_fix: "Wait and retry. If the problem persists, check GitLab status page.",
      gitlab_error: rawMessage,
    };
  }

  // Generic API error for other status codes
  return {
    error_code: "API_ERROR",
    tool,
    action,
    http_status: status,
    message: rawMessage,
    suggested_fix: "Check the GitLab API documentation for this endpoint",
    gitlab_error: rawMessage,
  };
}

/**
 * Create a tier-restricted error response
 */
function createTierRestrictedError(
  tool: string,
  action: string,
  status: number,
  restriction: TierRestrictionInfo
): TierRestrictedError {
  return {
    error_code: "TIER_RESTRICTED",
    tool,
    action,
    http_status: status,
    tier_required: restriction.requiredTier,
    current_tier: restriction.currentTier,
    feature_name: restriction.name,
    message: `${restriction.name} requires GitLab ${restriction.requiredTier} or higher`,
    suggested_fix:
      restriction.alternatives.length > 0
        ? `Upgrade to GitLab ${restriction.requiredTier}, or use one of the alternatives`
        : `Upgrade to GitLab ${restriction.requiredTier} to access this feature`,
    alternatives: restriction.alternatives.length > 0 ? restriction.alternatives : undefined,
    docs_url: restriction.docsUrl,
    upgrade_url: "https://about.gitlab.com/pricing/",
  };
}

/**
 * Create a permission denied error response
 */
function createPermissionDeniedError(
  tool: string,
  action: string,
  status: number,
  rawMessage: string
): PermissionDeniedError {
  const baseSuggestedFix =
    "Check your access level for this project/group. Reporter access or higher may be required.";

  // Include raw message if it provides additional context
  const suggestedFix =
    rawMessage && rawMessage !== "Unknown error" && !rawMessage.includes("403")
      ? `${baseSuggestedFix} GitLab message: ${rawMessage}`
      : baseSuggestedFix;

  return {
    error_code: "PERMISSION_DENIED",
    tool,
    action,
    http_status: status,
    message: "You don't have permission for this action",
    suggested_fix: suggestedFix,
    alternatives: [
      {
        action: "Verify your access level",
        description: "Check your role in the project settings or contact a project maintainer",
        available_on: "Free",
      },
    ],
  };
}

/**
 * Create a not found error response
 */
function createNotFoundError(
  tool: string,
  action: string,
  status: number,
  rawMessage: string
): NotFoundError {
  // Try to extract resource info from the message
  let resourceType: string | undefined;
  let resourceId: string | undefined;

  const lowerMessage = rawMessage.toLowerCase();

  if (lowerMessage.includes("project")) {
    resourceType = "project";
  } else if (lowerMessage.includes("merge request") || lowerMessage.includes("mr")) {
    resourceType = "merge_request";
  } else if (lowerMessage.includes("issue")) {
    resourceType = "issue";
  } else if (lowerMessage.includes("pipeline")) {
    resourceType = "pipeline";
  } else if (lowerMessage.includes("branch")) {
    resourceType = "branch";
  } else if (lowerMessage.includes("user")) {
    resourceType = "user";
  }

  // Try to extract path-like identifier first (e.g., "'group/project'")
  const pathMatch = rawMessage.match(/['"]([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+)['"]/);
  if (pathMatch) {
    resourceId = pathMatch[1];
  }

  // Try to extract numeric ID from the message (e.g., "Project 12345 not found")
  // Strategy: Look for numbers that appear after resource keywords, or are > 3 digits
  // This avoids matching HTTP status codes like "404 Not Found"
  if (!resourceId) {
    // First try: look for ID after resource type keyword (e.g., "Project 123")
    const contextMatch = rawMessage.match(
      /(?:project|issue|merge.?request|mr|pipeline|branch|user|group)\s+#?(\d+)/i
    );
    if (contextMatch) {
      resourceId = contextMatch[1];
    } else {
      // Fallback: match numbers with 4+ digits (unlikely to be status codes)
      const longIdMatch = rawMessage.match(/\b(\d{4,})\b/);
      if (longIdMatch) {
        resourceId = longIdMatch[1];
      }
    }
  }

  return {
    error_code: "NOT_FOUND",
    tool,
    action,
    http_status: status,
    message: "Resource not found or you don't have access to it",
    suggested_fix:
      "Verify the ID/path is correct and you have at least Reporter access to the project",
    resource_type: resourceType,
    resource_id: resourceId,
  };
}

// ============================================================================
// Validation Error Helpers
// ============================================================================

/**
 * Create a validation error for missing required fields
 */
export function createMissingFieldsError(
  tool: string,
  action: string,
  missingFields: string[],
  actionRequiredFields?: Record<string, string[]>
): ActionValidationError {
  return {
    error_code: "MISSING_REQUIRED_FIELD",
    tool,
    action,
    message: `Missing required field(s): ${missingFields.join(", ")}`,
    missing_fields: missingFields,
    suggested_fix: `Add required fields: ${missingFields.join(", ")}`,
    action_required_fields: actionRequiredFields,
  };
}

/**
 * Create a validation error for invalid action
 */
export function createInvalidActionError(
  tool: string,
  action: string,
  validActions: string[]
): ActionValidationError {
  return {
    error_code: "INVALID_ACTION",
    tool,
    action,
    message: `Invalid action '${action}'. Valid actions are: ${validActions.join(", ")}`,
    suggested_fix: `Use one of the valid actions: ${validActions.join(", ")}`,
    valid_actions: validActions,
  };
}

/**
 * Create a validation error for type mismatch
 */
export function createTypeMismatchError(
  tool: string,
  action: string,
  field: string,
  expected: string,
  received: string
): ActionValidationError {
  return {
    error_code: "TYPE_MISMATCH",
    tool,
    action,
    message: `Type mismatch for field '${field}': expected ${expected}, got ${received}`,
    invalid_fields: [{ field, expected, received }],
    suggested_fix: `Provide a ${expected} value for '${field}'`,
  };
}

/**
 * Create a generic validation error from Zod error
 */
export function createValidationError(
  tool: string,
  action: string,
  zodMessage: string
): ActionValidationError {
  return {
    error_code: "VALIDATION_ERROR",
    tool,
    action,
    message: zodMessage,
    suggested_fix: "Check the tool documentation for correct parameter format",
  };
}

// ============================================================================
// Timeout Error Helper
// ============================================================================

/**
 * Create a timeout error response
 *
 * @param tool - Tool name that triggered the timeout
 * @param action - Action that was attempted
 * @param timeoutMs - Timeout duration in milliseconds
 * @param retryable - Whether the operation is idempotent and can be retried
 */
export function createTimeoutError(
  tool: string,
  action: string,
  timeoutMs: number,
  retryable: boolean = false
): TimeoutError {
  const retryHint = retryable
    ? " This is a read-only operation - you can safely retry."
    : " This is a write operation - check if it completed before retrying.";

  return {
    error_code: "TIMEOUT",
    tool,
    action,
    timeout_ms: timeoutMs,
    retryable,
    message: `Request timed out after ${timeoutMs}ms`,
    suggested_fix: `The GitLab server is slow to respond. Try again later or increase GITLAB_API_HEADERS_TIMEOUT_MS / GITLAB_API_BODY_TIMEOUT_MS / GITLAB_TOOL_TIMEOUT_MS.${retryHint}`,
  };
}

// ============================================================================
// Version Restricted Error Helper
// ============================================================================

/**
 * Create a version-restricted error for widget parameters
 *
 * @param tool - Tool name that triggered the error
 * @param action - Action that was attempted
 * @param widget - Widget type that is restricted
 * @param parameter - Parameter name that maps to the widget
 * @param requiredVersion - Minimum required GitLab version
 * @param detectedVersion - Detected GitLab instance version
 * @param requiredTier - Required tier (if also tier-restricted)
 * @param currentTier - Current instance tier
 */
export function createVersionRestrictedError(
  tool: string,
  action: string,
  widget: string,
  parameter: string,
  requiredVersion: string,
  detectedVersion: string,
  requiredTier?: GitLabTier,
  currentTier?: GitLabTier
): VersionRestrictedError {
  // Determine which constraints are violated
  const tierHierarchy: Record<GitLabTier, number> = { Free: 0, Premium: 1, Ultimate: 2 };
  const isTierInsufficient =
    requiredTier && currentTier && tierHierarchy[requiredTier] > tierHierarchy[currentTier];

  // Determine which constraints are actually violated
  const isVersionSufficient = parseVersion(detectedVersion) >= parseVersion(requiredVersion);
  let suggestedFix: string;
  let message: string;

  if (isTierInsufficient && isVersionSufficient) {
    // Only tier is insufficient
    message = `Widget '${widget}' (parameter '${parameter}') requires GitLab ${requiredTier} tier (current: ${currentTier})`;
    suggestedFix = `Upgrade to GitLab ${requiredTier} tier to use the '${parameter}' parameter`;
  } else if (isTierInsufficient) {
    // Both version and tier are insufficient
    message = `Widget '${widget}' (parameter '${parameter}') requires GitLab >= ${requiredVersion} and ${requiredTier} tier (detected: ${detectedVersion}, tier: ${currentTier})`;
    suggestedFix = `Upgrade GitLab to version ${requiredVersion}+ and ${requiredTier} tier to use the '${parameter}' parameter`;
  } else {
    // Only version is insufficient
    message = `Widget '${widget}' (parameter '${parameter}') requires GitLab >= ${requiredVersion} (detected: ${detectedVersion})`;
    suggestedFix = `Upgrade GitLab to version ${requiredVersion} or higher to use the '${parameter}' parameter`;
  }

  return {
    error_code: "VERSION_RESTRICTED",
    tool,
    action,
    widget,
    parameter,
    required_version: requiredVersion,
    detected_version: detectedVersion,
    required_tier: isTierInsufficient ? requiredTier : undefined,
    current_tier: isTierInsufficient ? currentTier : undefined,
    message,
    suggested_fix: suggestedFix,
    docs_url: "https://docs.gitlab.com/ee/user/project/work_items/",
  };
}

/**
 * Extract HTTP status code and message from GitLab API error string
 * Matches patterns like:
 *   - "GitLab API error: 403 Forbidden - message"
 *   - "GitLab API error: 403 Forbidden"
 *   - "GitLab API error: 403"
 *   - "Failed to execute tool 'name': GitLab API error: 403 Forbidden"
 *
 * Exported for direct unit testing.
 */
export function parseGitLabApiError(
  errorMessage: string
): { status: number; message: string } | null {
  // Match GitLab API error anywhere in the string (handles wrapped errors)
  // Pattern: "GitLab API error: <status> [<statusText>] [- <details>]"
  // Status text uses [\w\s]+? to match word chars and spaces (non-greedy)
  // Separator is " - " (space-hyphen-space) to avoid matching hyphens in status text
  const match = errorMessage.match(/GitLab API error:\s*(\d+)(?:\s+([\w\s]+?))?(?:\s+-\s+(.*))?$/);
  if (!match) return null;

  const status = parseInt(match[1], 10);
  const statusText = match[2]?.trim() ?? "";
  const details = match[3]?.trim() ?? "";

  let message: string;
  if (statusText && details) {
    message = `${status} ${statusText} - ${details}`;
  } else if (statusText) {
    message = `${status} ${statusText}`;
  } else if (details) {
    message = `${status} - ${details}`;
  } else {
    message = `${status}`;
  }

  return { status, message };
}

/**
 * Parse timeout error from error message
 * Returns timeout value in ms if the error is a timeout error, null otherwise
 */
export function parseTimeoutError(errorMessage: string): number | null {
  const match = errorMessage.match(/GitLab API timeout after (\d+)ms/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Custom Error Class
// ============================================================================

/**
 * Custom error class for structured tool errors
 *
 * Allows throwing structured errors that can be caught and serialized
 */
export class StructuredToolError extends Error {
  public readonly structuredError: GitLabStructuredError;

  constructor(structuredError: GitLabStructuredError) {
    super(structuredError.message);
    this.name = "StructuredToolError";
    this.structuredError = structuredError;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StructuredToolError);
    }
  }

  /**
   * Get the structured error as a plain object
   */
  toJSON(): GitLabStructuredError {
    return this.structuredError;
  }
}

/**
 * Check if an error is a StructuredToolError
 */
export function isStructuredToolError(error: unknown): error is StructuredToolError {
  return error instanceof StructuredToolError;
}
