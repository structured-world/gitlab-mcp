/**
 * GitLab Tier Feature Map
 *
 * Maps GitLab features to their required tiers and provides alternatives
 * for users on lower tiers. Used for tier-aware error handling.
 *
 * Tier hierarchy: Free < Premium < Ultimate
 */

export type GitLabTier = "Free" | "Premium" | "Ultimate";

export interface TierFeature {
  /** Human-readable feature name */
  name: string;
  /** Minimum required tier */
  tier: GitLabTier;
  /** Tools/actions that require this feature */
  tools: string[];
  /** Alternative approaches available on lower tiers */
  alternatives?: Array<{
    action: string;
    description: string;
    availableOn: GitLabTier;
  }>;
  /** Documentation URL */
  docs: string;
}

/**
 * Map of tier-restricted features in GitLab
 *
 * Key: feature identifier
 * Value: feature details including tier requirement and alternatives
 */
export const TIER_FEATURES: Record<string, TierFeature> = {
  // ============================================================================
  // Premium Features
  // ============================================================================

  protected_branches_api: {
    name: "Protected Branches API",
    tier: "Premium",
    tools: ["browse_protected_branches", "manage_protected_branch"],
    alternatives: [
      {
        action: "Configure via UI",
        description: "Use Settings > Repository > Protected branches in GitLab UI",
        availableOn: "Free",
      },
      {
        action: "Check branch via browse_commits",
        description: "List commits to verify branch exists and see recent activity",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/api/protected_branches.html",
  },

  merge_request_approvals: {
    name: "Merge Request Approvals API",
    tier: "Premium",
    tools: ["manage_merge_request:approve", "browse_merge_requests:approvals"],
    alternatives: [
      {
        action: "Use comments for informal approval",
        description: "Add a comment like 'LGTM' or 'Approved' to indicate review",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/project/merge_requests/approvals/",
  },

  group_webhooks: {
    name: "Group Webhooks",
    tier: "Premium",
    tools: ["manage_webhook:group"],
    alternatives: [
      {
        action: "Use project-level webhooks",
        description: "Configure webhooks on individual projects instead",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/project/integrations/webhooks.html",
  },

  merge_trains: {
    name: "Merge Trains",
    tier: "Premium",
    tools: ["manage_merge_request:merge_train"],
    alternatives: [
      {
        action: "Use standard merge",
        description: "Merge requests manually without merge train",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/ci/pipelines/merge_trains.html",
  },

  // ============================================================================
  // Ultimate Features
  // ============================================================================

  code_owners: {
    name: "Code Owners",
    tier: "Ultimate",
    tools: ["browse_code_owners"],
    alternatives: [
      {
        action: "Read CODEOWNERS file directly",
        description: "Use browse_files to read .gitlab/CODEOWNERS or CODEOWNERS file",
        availableOn: "Free",
      },
      {
        action: "Use merge request approvers",
        description: "Configure approvers in MR settings",
        availableOn: "Premium",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/project/codeowners/",
  },

  security_dashboard: {
    name: "Security Dashboard",
    tier: "Ultimate",
    tools: ["browse_vulnerabilities", "browse_security_findings"],
    alternatives: [
      {
        action: "Use CI job artifacts",
        description: "Check security scanner job artifacts in pipeline",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/application_security/security_dashboard/",
  },

  epic_boards: {
    name: "Epic Boards",
    tier: "Ultimate",
    tools: ["browse_epics:board"],
    alternatives: [
      {
        action: "Use issue boards",
        description: "Create boards for issues instead of epics",
        availableOn: "Free",
      },
      {
        action: "List epics without board view",
        description: "Use browse_work_items with type=epic to list epics",
        availableOn: "Premium",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/group/epics/",
  },

  dependency_scanning: {
    name: "Dependency Scanning",
    tier: "Ultimate",
    tools: ["browse_dependency_list"],
    alternatives: [
      {
        action: "Check package files directly",
        description: "Use browse_files to read package.json, Gemfile, etc.",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/application_security/dependency_scanning/",
  },
};

/**
 * Find tier feature by tool name and optional action
 *
 * @param tool - Tool name (e.g., "browse_protected_branches")
 * @param action - Optional action name (e.g., "approve")
 * @returns TierFeature if found, null otherwise
 */
export function findTierFeature(tool: string, action?: string): TierFeature | null {
  const toolWithAction = action ? `${tool}:${action}` : null;

  for (const feature of Object.values(TIER_FEATURES)) {
    // Check for exact tool:action match first
    if (toolWithAction && feature.tools.includes(toolWithAction)) {
      return feature;
    }
    // Check for tool-only match
    if (feature.tools.includes(tool)) {
      return feature;
    }
  }

  return null;
}

/**
 * Check if a tool requires a specific tier
 *
 * @param tool - Tool name
 * @param action - Optional action name
 * @returns Required tier or "Free" if no restriction
 */
export function getRequiredTier(tool: string, action?: string): GitLabTier {
  const feature = findTierFeature(tool, action);
  return feature?.tier ?? "Free";
}

/**
 * Get documentation URL for a tier-restricted feature
 *
 * @param tool - Tool name
 * @param action - Optional action name
 * @returns Documentation URL or generic GitLab API docs
 */
export function getFeatureDocsUrl(tool: string, action?: string): string {
  const feature = findTierFeature(tool, action);
  return feature?.docs ?? "https://docs.gitlab.com/ee/api/";
}
