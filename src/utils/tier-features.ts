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
 *
 * NOTE: This map only includes features for which tools have been implemented.
 * As new tools are added, their tier restrictions should be added here.
 */
export const TIER_FEATURES: Record<string, TierFeature> = {
  // ============================================================================
  // Premium Features
  // ============================================================================

  // Group webhooks require Premium tier
  group_webhooks: {
    name: "Group Webhooks",
    tier: "Premium",
    tools: ["list_webhooks:group", "manage_webhook:group"],
    alternatives: [
      {
        action: "Use project-level webhooks",
        description: "Configure webhooks on individual projects instead",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/project/integrations/webhooks.html",
  },

  // Epics require Premium tier (available via browse_work_items with type=epic)
  epics: {
    name: "Epics",
    tier: "Premium",
    tools: ["browse_work_items:epic", "manage_work_item:epic"],
    alternatives: [
      {
        action: "Use issues for tracking",
        description: "Create issues to track work items instead of epics",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/group/epics/",
  },

  // Iterations require Premium tier
  iterations: {
    name: "Iterations",
    tier: "Premium",
    tools: ["list_group_iterations"],
    alternatives: [
      {
        action: "Use milestones",
        description: "Use browse_milestones to track time-boxed work",
        availableOn: "Free",
      },
    ],
    docs: "https://docs.gitlab.com/ee/user/group/iterations/",
  },

  // ============================================================================
  // Ultimate Features
  // ============================================================================

  // NOTE: The following Ultimate features do not have implemented tools yet:
  // - Code Owners API (browse_code_owners)
  // - Security Dashboard (browse_vulnerabilities, browse_security_findings)
  // - Dependency Scanning (browse_dependency_list)
  // - Protected Branches API (browse_protected_branches, manage_protected_branch)
  // - MR Approvals API (manage_merge_request:approve, browse_merge_requests:approvals)
  // - Merge Trains (manage_merge_request:merge_train)
  //
  // When these tools are implemented, add their tier restrictions here.
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
