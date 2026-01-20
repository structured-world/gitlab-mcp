/**
 * Structured Error Handler
 *
 * Transforms GitLab API errors into structured, actionable responses
 * that help LLMs self-correct and provide guidance for users.
 */

import { findTierFeature, GitLabTier } from "./tier-features";

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
 * The internal TierFeature interface uses camelCase (availableOn).
 * Mapping between the two happens in createTierRestrictedError.
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
 * Union type of all structured errors
 */
export type GitLabStructuredError =
  | ActionValidationError
  | TierRestrictedError
  | PermissionDeniedError
  | NotFoundError
  | ApiError;

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
 * @returns Structured error with actionable information
 */
export function handleGitLabError(
  error: GitLabApiErrorResponse,
  tool: string,
  action: string
): GitLabStructuredError {
  const { status, message, error: errorMsg, error_description } = error;
  const rawMessage = message ?? errorMsg ?? error_description ?? "Unknown error";

  // Check if this is a tier-restricted feature
  const tierFeature = findTierFeature(tool, action);

  // 403 Forbidden - could be tier restriction or permission issue
  if (status === 403) {
    if (tierFeature && tierFeature.tier !== "Free") {
      return createTierRestrictedError(tool, action, status, tierFeature);
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
  tierFeature: NonNullable<ReturnType<typeof findTierFeature>>
): TierRestrictedError {
  const alternatives: TierAlternative[] =
    tierFeature.alternatives?.map(alt => ({
      action: alt.action,
      description: alt.description,
      available_on: alt.availableOn,
    })) ?? [];

  return {
    error_code: "TIER_RESTRICTED",
    tool,
    action,
    http_status: status,
    tier_required: tierFeature.tier,
    feature_name: tierFeature.name,
    message: `${tierFeature.name} requires GitLab ${tierFeature.tier} or higher`,
    suggested_fix: `Upgrade to GitLab ${tierFeature.tier}, or use one of the alternatives`,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    docs_url: tierFeature.docs,
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
