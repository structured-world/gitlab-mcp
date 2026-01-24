import { ConnectionManager } from "./ConnectionManager";
import { GitLabTier } from "./GitLabVersionDetector";
import { logger } from "../logger";
import { parseVersion } from "../utils/version";

interface ToolRequirement {
  minVersion: string;
  requiredTier: "free" | "premium" | "ultimate";
  notes?: string;
}

/**
 * Action-level tier requirement
 */
interface ActionRequirement {
  tier: "free" | "premium" | "ultimate";
  minVersion: string;
  notes?: string;
}

/**
 * Parameter-level tier/version requirement.
 * Same structure as ActionRequirement; aliased for semantic clarity
 * when used in parameterRequirements map.
 */
type ParameterRequirement = ActionRequirement;

/**
 * Tool with action-level requirements (for consolidated tools)
 */
interface ToolActionRequirements {
  /** Default requirement when action is not specified */
  default: ActionRequirement;
  /** Action-specific requirements (override default) */
  actions?: Record<string, ActionRequirement>;
}

export class ToolAvailability {
  /** Tier hierarchy for comparison: free < premium < ultimate */
  private static readonly TIER_ORDER: Record<string, number> = {
    free: 0,
    premium: 1,
    ultimate: 2,
  };

  // ============================================================================
  // Consolidated Tools with Action-Level Requirements
  // ============================================================================

  private static actionRequirements: Record<string, ToolActionRequirements> = {
    // Core tools
    browse_projects: {
      default: { tier: "free", minVersion: "8.0" },
    },
    browse_namespaces: {
      default: { tier: "free", minVersion: "9.0" },
    },
    browse_commits: {
      default: { tier: "free", minVersion: "8.0" },
    },
    browse_events: {
      default: { tier: "free", minVersion: "9.0" },
    },
    browse_users: {
      default: { tier: "free", minVersion: "8.0" },
    },
    browse_todos: {
      default: { tier: "free", minVersion: "8.0" },
    },
    browse_iterations: {
      default: { tier: "premium", minVersion: "13.1", notes: "Iterations/Sprints" },
    },
    manage_project: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        create: { tier: "free", minVersion: "8.0" },
        fork: { tier: "free", minVersion: "8.0" },
        update: { tier: "free", minVersion: "8.0" },
        delete: { tier: "free", minVersion: "8.0" },
        archive: { tier: "free", minVersion: "8.0" },
        unarchive: { tier: "free", minVersion: "8.0" },
        transfer: { tier: "free", minVersion: "8.0" },
      },
    },
    manage_namespace: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        create: { tier: "free", minVersion: "8.0" },
        update: { tier: "free", minVersion: "8.0" },
        delete: { tier: "free", minVersion: "8.0" },
      },
    },

    // Merge Requests
    browse_merge_requests: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        approvals: { tier: "premium", minVersion: "10.6", notes: "MR approvals" },
      },
    },
    browse_mr_discussions: {
      default: { tier: "free", minVersion: "8.0" },
    },
    manage_merge_request: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        create: { tier: "free", minVersion: "8.0" },
        update: { tier: "free", minVersion: "8.0" },
        merge: { tier: "free", minVersion: "8.0" },
        approve: { tier: "premium", minVersion: "10.6", notes: "MR approvals" },
        unapprove: { tier: "premium", minVersion: "10.6", notes: "MR approvals" },
        get_approval_state: { tier: "premium", minVersion: "13.8", notes: "MR approval state" },
      },
    },
    manage_mr_discussion: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        comment: { tier: "free", minVersion: "8.0" },
        thread: { tier: "free", minVersion: "11.0" },
        reply: { tier: "free", minVersion: "11.0" },
        update: { tier: "free", minVersion: "8.0" },
        apply_suggestion: { tier: "free", minVersion: "13.0" },
        apply_suggestions: { tier: "free", minVersion: "13.0" },
        resolve: { tier: "free", minVersion: "10.0", notes: "Resolve discussion threads" },
        suggest: { tier: "free", minVersion: "10.5", notes: "Code suggestions" },
      },
    },
    manage_draft_notes: {
      default: { tier: "free", minVersion: "13.2" },
    },

    // Work Items
    browse_work_items: {
      default: { tier: "free", minVersion: "15.0" },
    },
    manage_work_item: {
      default: { tier: "free", minVersion: "15.0" },
    },

    // Labels
    browse_labels: {
      default: { tier: "free", minVersion: "8.0" },
    },
    manage_label: {
      default: { tier: "free", minVersion: "8.0" },
    },

    // Wiki
    browse_wiki: {
      default: { tier: "free", minVersion: "9.0" },
    },
    manage_wiki: {
      default: { tier: "free", minVersion: "9.0" },
    },

    // Pipelines
    browse_pipelines: {
      default: { tier: "free", minVersion: "9.0" },
    },
    manage_pipeline: {
      default: { tier: "free", minVersion: "9.0" },
    },
    manage_pipeline_job: {
      default: { tier: "free", minVersion: "9.0" },
    },

    // Variables
    browse_variables: {
      default: { tier: "free", minVersion: "9.0" },
    },
    manage_variable: {
      default: { tier: "free", minVersion: "9.0" },
    },

    // Milestones
    browse_milestones: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        burndown: { tier: "premium", minVersion: "12.0", notes: "Burndown charts" },
      },
    },
    manage_milestone: {
      default: { tier: "free", minVersion: "8.0" },
    },

    // Files
    browse_files: {
      default: { tier: "free", minVersion: "8.0" },
    },
    manage_files: {
      default: { tier: "free", minVersion: "8.0" },
    },

    // Snippets
    browse_snippets: {
      default: { tier: "free", minVersion: "8.15" },
    },
    manage_snippet: {
      default: { tier: "free", minVersion: "8.15" },
    },

    // Webhooks
    browse_webhooks: {
      default: { tier: "free", minVersion: "8.0", notes: "Project webhooks" },
    },
    manage_webhook: {
      default: { tier: "free", minVersion: "8.0", notes: "Project webhooks" },
      actions: {
        create_group: { tier: "premium", minVersion: "10.4", notes: "Group webhooks" },
        update_group: { tier: "premium", minVersion: "10.4", notes: "Group webhooks" },
        delete_group: { tier: "premium", minVersion: "10.4", notes: "Group webhooks" },
      },
    },

    // Integrations
    browse_integrations: {
      default: { tier: "free", minVersion: "8.0" },
    },
    manage_integration: {
      default: { tier: "free", minVersion: "8.0" },
    },

    // Todos
    manage_todos: {
      default: { tier: "free", minVersion: "8.0" },
    },

    // Releases
    browse_releases: {
      default: { tier: "free", minVersion: "11.7" },
    },
    manage_release: {
      default: { tier: "free", minVersion: "11.7" },
    },

    // Refs (branches and tags)
    browse_refs: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        list_branches: { tier: "free", minVersion: "8.0" },
        get_branch: { tier: "free", minVersion: "8.0" },
        list_tags: { tier: "free", minVersion: "8.0" },
        get_tag: { tier: "free", minVersion: "8.0" },
        list_protected_branches: { tier: "free", minVersion: "8.11" },
        get_protected_branch: { tier: "free", minVersion: "8.11" },
        list_protected_tags: { tier: "premium", minVersion: "11.3", notes: "Protected tags" },
      },
    },
    manage_ref: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        create_branch: { tier: "free", minVersion: "8.0" },
        delete_branch: { tier: "free", minVersion: "8.0" },
        protect_branch: { tier: "free", minVersion: "8.11" },
        unprotect_branch: { tier: "free", minVersion: "8.11" },
        update_branch_protection: {
          tier: "free",
          minVersion: "11.9",
          notes: "PATCH endpoint; code owners require Premium",
        },
        create_tag: { tier: "free", minVersion: "8.0" },
        delete_tag: { tier: "free", minVersion: "8.0" },
        protect_tag: { tier: "premium", minVersion: "11.3", notes: "Protected tags" },
        unprotect_tag: { tier: "premium", minVersion: "11.3", notes: "Protected tags" },
      },
    },

    // Members (team management)
    browse_members: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        list_project: { tier: "free", minVersion: "8.0" },
        list_group: { tier: "free", minVersion: "8.0" },
        get_project: { tier: "free", minVersion: "8.0" },
        get_group: { tier: "free", minVersion: "8.0" },
        list_all_project: { tier: "free", minVersion: "12.4", notes: "Includes inherited members" },
        list_all_group: { tier: "free", minVersion: "12.4", notes: "Includes inherited members" },
      },
    },
    manage_member: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        add_to_project: { tier: "free", minVersion: "8.0" },
        add_to_group: { tier: "free", minVersion: "8.0" },
        remove_from_project: { tier: "free", minVersion: "8.0" },
        remove_from_group: { tier: "free", minVersion: "8.0" },
        update_project: { tier: "free", minVersion: "8.0" },
        update_group: {
          tier: "free",
          minVersion: "8.0",
          notes: "member_role_id requires Ultimate",
        },
      },
    },

    // Search (read-only)
    browse_search: {
      default: { tier: "free", minVersion: "8.0" },
      actions: {
        global: { tier: "free", minVersion: "8.0", notes: "Global search across GitLab instance" },
        project: { tier: "free", minVersion: "8.0", notes: "Project-scoped search" },
        group: { tier: "free", minVersion: "10.5", notes: "Group-scoped search" },
      },
    },
  };

  // ============================================================================
  // Per-Parameter Tier Requirements
  // ============================================================================

  /**
   * Parameter-level requirements for tools with tier-gated parameters.
   * Parameters listed here will be stripped from the JSON Schema when the
   * detected instance tier/version is insufficient.
   */
  private static parameterRequirements: Record<string, Record<string, ParameterRequirement>> = {
    manage_work_item: {
      weight: { tier: "premium", minVersion: "15.0", notes: "Work item weight widget" },
      iterationId: { tier: "premium", minVersion: "15.0", notes: "Iteration widget" },
      healthStatus: { tier: "ultimate", minVersion: "15.0", notes: "Health status widget" },
    },
  };

  /**
   * Get list of parameter names that should be REMOVED from the schema
   * for the current instance tier and version.
   *
   * @param toolName - Tool name to check parameter requirements for
   * @returns Array of parameter names that should be stripped from the schema
   */
  public static getRestrictedParameters(
    toolName: string,
    cachedInstanceInfo?: { tier: GitLabTier; version: string }
  ): string[] {
    const paramReqs = this.parameterRequirements[toolName];
    if (!paramReqs) return [];

    let instanceTier: GitLabTier;
    let instanceVersion: number;
    let rawVersion: string;

    if (cachedInstanceInfo) {
      instanceTier = cachedInstanceInfo.tier;
      rawVersion = cachedInstanceInfo.version;
      instanceVersion = parseVersion(rawVersion);
    } else {
      const connectionManager = ConnectionManager.getInstance();
      try {
        const instanceInfo = connectionManager.getInstanceInfo();
        instanceTier = instanceInfo.tier;
        rawVersion = instanceInfo.version;
        instanceVersion = parseVersion(rawVersion);
      } catch {
        // Connection not initialized - don't restrict anything
        return [];
      }
    }

    const restricted: string[] = [];
    const actualTierLevel = this.TIER_ORDER[instanceTier] ?? 0;

    for (const [paramName, req] of Object.entries(paramReqs)) {
      const requiredTierLevel = this.TIER_ORDER[req.tier] ?? 0;
      const requiredVersion = parseVersion(req.minVersion);

      // Parameter is restricted if tier is insufficient OR version is too low
      if (actualTierLevel < requiredTierLevel || instanceVersion < requiredVersion) {
        restricted.push(paramName);
      }
    }

    if (restricted.length > 0) {
      logger.debug(
        `Tool '${toolName}': restricted parameters for tier=${instanceTier}, version=${rawVersion}: [${restricted.join(", ")}]`
      );
    }

    return restricted;
  }

  /**
   * Get requirement for a tool, optionally with action
   */
  public static getActionRequirement(
    toolName: string,
    action?: string
  ): ActionRequirement | undefined {
    const toolReq = this.actionRequirements[toolName];
    if (!toolReq) return undefined;

    // If action specified, check action-specific requirement first
    if (action && toolReq.actions?.[action]) {
      return toolReq.actions[action];
    }

    return toolReq.default;
  }

  /**
   * Get the highest tier required by any action of a tool
   */
  public static getHighestTier(toolName: string): "free" | "premium" | "ultimate" {
    const toolReq = this.actionRequirements[toolName];
    if (!toolReq) return "free";

    let highest = toolReq.default.tier;

    if (toolReq.actions) {
      for (const actionReq of Object.values(toolReq.actions)) {
        if (this.TIER_ORDER[actionReq.tier] > this.TIER_ORDER[highest]) {
          highest = actionReq.tier;
        }
      }
    }

    return highest;
  }

  /**
   * Get all actions that require a specific tier or higher
   */
  public static getTierRestrictedActions(toolName: string, tier: "premium" | "ultimate"): string[] {
    const toolReq = this.actionRequirements[toolName];
    if (!toolReq?.actions) return [];

    const minLevel = this.TIER_ORDER[tier];

    return Object.entries(toolReq.actions)
      .filter(([, req]) => this.TIER_ORDER[req.tier] >= minLevel)
      .map(([action]) => action);
  }

  public static isToolAvailable(toolName: string, action?: string): boolean {
    const connectionManager = ConnectionManager.getInstance();

    // Add null check as extra safety
    if (!connectionManager) {
      logger.debug(`Tool availability check for '${toolName}': ConnectionManager instance is null`);
      return false;
    }

    try {
      const instanceInfo = connectionManager.getInstanceInfo();

      const actionReq = this.getActionRequirement(toolName, action);
      if (actionReq) {
        const version = parseVersion(instanceInfo.version);
        if (version < parseVersion(actionReq.minVersion)) {
          return false;
        }
        return this.isTierSufficient(instanceInfo.tier, actionReq.tier);
      }

      // Tool not found in requirements - unknown tool
      logger.debug(`Tool '${toolName}' not found in requirements database`);
      return parseVersion(instanceInfo.version) >= parseVersion("15.0");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // In OAuth mode, introspection is deferred until first authenticated request.
      // Allow all tools initially - they'll be properly filtered on actual use.
      if (errorMessage.includes("Connection not initialized")) {
        logger.debug(
          `Tool availability check for '${toolName}': instance info not available yet, allowing`
        );
        return true;
      }

      logger.warn(`Failed to check tool availability for '${toolName}': ${errorMessage}`);
      return false;
    }
  }

  public static getAvailableTools(): string[] {
    return Object.keys(this.actionRequirements).filter(tool => this.isToolAvailable(tool));
  }

  public static getToolRequirement(toolName: string, action?: string): ToolRequirement | undefined {
    const actionReq = this.getActionRequirement(toolName, action);
    if (actionReq) {
      return {
        minVersion: actionReq.minVersion,
        requiredTier: actionReq.tier,
        notes: actionReq.notes,
      };
    }
    return undefined;
  }

  public static getUnavailableReason(toolName: string, action?: string): string | null {
    const connectionManager = ConnectionManager.getInstance();

    try {
      const instanceInfo = connectionManager.getInstanceInfo();
      const actionReq = this.getActionRequirement(toolName, action);

      if (!actionReq) {
        return `Tool '${toolName}' is not recognized`;
      }

      const version = parseVersion(instanceInfo.version);
      if (version < parseVersion(actionReq.minVersion)) {
        return `Requires GitLab ${actionReq.minVersion}+, current version is ${instanceInfo.version}`;
      }

      if (!this.isTierSufficient(instanceInfo.tier, actionReq.tier)) {
        return `Requires GitLab ${actionReq.tier} tier or higher, current tier is ${instanceInfo.tier}`;
      }

      return null; // Tool is available
    } catch {
      return "GitLab connection not initialized";
    }
  }

  private static isTierSufficient(
    actualTier: GitLabTier,
    requiredTier: "free" | "premium" | "ultimate"
  ): boolean {
    const tierHierarchy: Record<string, number> = {
      free: 0,
      premium: 1,
      ultimate: 2,
    };

    const actualLevel = tierHierarchy[actualTier] ?? 0;
    const requiredLevel = tierHierarchy[requiredTier] ?? 0;

    return actualLevel >= requiredLevel;
  }

  public static filterToolsByAvailability(tools: string[]): string[] {
    return tools.filter(tool => this.isToolAvailable(tool));
  }

  public static getToolsByTier(tier: "free" | "premium" | "ultimate"): string[] {
    return Object.entries(this.actionRequirements)
      .filter(([, req]) => req.default.tier === tier)
      .map(([toolName]) => toolName);
  }

  public static getToolsByMinVersion(minVersion: string): string[] {
    const minVer = parseVersion(minVersion);
    return Object.entries(this.actionRequirements)
      .filter(([, req]) => parseVersion(req.default.minVersion) >= minVer)
      .map(([toolName]) => toolName);
  }
}
