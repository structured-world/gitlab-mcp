import { WorkItemWidgetType, WorkItemWidgetTypes } from "../graphql/workItems";
import { ConnectionManager } from "./ConnectionManager";
import { GitLabTier } from "./GitLabVersionDetector";
import { parseVersion } from "../utils/version";
import { logger } from "../logger";

interface WidgetRequirement {
  tier: GitLabTier;
  minVersion: string;
}

/**
 * Result of a widget parameter availability check
 */
export interface WidgetValidationFailure {
  parameter: string;
  widget: WorkItemWidgetType;
  requiredVersion: string;
  detectedVersion: string;
  requiredTier: GitLabTier;
  currentTier: GitLabTier;
}

const TIER_HIERARCHY: Record<GitLabTier, number> = {
  free: 0,
  premium: 1,
  ultimate: 2,
};

/**
 * Maps manage_work_item input parameters to their corresponding widget types.
 * Includes both current schema parameters and those planned for #135.
 * Parameters not yet in ManageWorkItemSchema are harmless here — validation
 * only triggers when the parameter is actually present in the handler input.
 */
const PARAMETER_WIDGET_MAP: Record<string, WorkItemWidgetType> = {
  // Basic widget parameters
  assigneeIds: WorkItemWidgetTypes.ASSIGNEES,
  labelIds: WorkItemWidgetTypes.LABELS,
  milestoneId: WorkItemWidgetTypes.MILESTONE,
  description: WorkItemWidgetTypes.DESCRIPTION,
  // Free tier: dates
  startDate: WorkItemWidgetTypes.START_AND_DUE_DATE,
  dueDate: WorkItemWidgetTypes.START_AND_DUE_DATE,
  isFixed: WorkItemWidgetTypes.START_AND_DUE_DATE,
  // Free tier: hierarchy
  parentId: WorkItemWidgetTypes.HIERARCHY,
  childrenIds: WorkItemWidgetTypes.HIERARCHY,
  // Free tier: time tracking
  timeEstimate: WorkItemWidgetTypes.TIME_TRACKING,
  timeSpent: WorkItemWidgetTypes.TIME_TRACKING,
  // Premium tier
  weight: WorkItemWidgetTypes.WEIGHT,
  iterationId: WorkItemWidgetTypes.ITERATION,
  progressCurrentValue: WorkItemWidgetTypes.PROGRESS,
  // Ultimate tier
  healthStatus: WorkItemWidgetTypes.HEALTH_STATUS,
  color: WorkItemWidgetTypes.COLOR,
};

export class WidgetAvailability {
  private static widgetRequirements: Record<WorkItemWidgetType, WidgetRequirement> = {
    // Free tier widgets (available to all)
    [WorkItemWidgetTypes.ASSIGNEES]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.DESCRIPTION]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.HIERARCHY]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.LABELS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.MILESTONE]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.NOTES]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.START_AND_DUE_DATE]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.STATUS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.NOTIFICATIONS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.CURRENT_USER_TODOS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.AWARD_EMOJI]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.PARTICIPANTS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.DESIGNS]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.DEVELOPMENT]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.TIME_TRACKING]: { tier: "free", minVersion: "15.0" },
    [WorkItemWidgetTypes.ERROR_TRACKING]: { tier: "free", minVersion: "15.0" },

    // Free tier widgets (linked items available on CE)
    [WorkItemWidgetTypes.LINKED_ITEMS]: { tier: "free", minVersion: "15.0" },

    // Premium tier widgets
    [WorkItemWidgetTypes.WEIGHT]: { tier: "premium", minVersion: "15.0" },
    [WorkItemWidgetTypes.ITERATION]: { tier: "premium", minVersion: "15.0" },
    [WorkItemWidgetTypes.PROGRESS]: { tier: "premium", minVersion: "15.0" },
    [WorkItemWidgetTypes.CRM_CONTACTS]: { tier: "premium", minVersion: "16.0" },
    [WorkItemWidgetTypes.EMAIL_PARTICIPANTS]: { tier: "premium", minVersion: "16.0" },
    [WorkItemWidgetTypes.LINKED_RESOURCES]: { tier: "premium", minVersion: "16.5" },

    // Ultimate tier widgets
    [WorkItemWidgetTypes.HEALTH_STATUS]: { tier: "ultimate", minVersion: "15.0" },
    [WorkItemWidgetTypes.COLOR]: { tier: "ultimate", minVersion: "15.0" },
    [WorkItemWidgetTypes.CUSTOM_FIELDS]: { tier: "ultimate", minVersion: "17.0" },
    [WorkItemWidgetTypes.VULNERABILITIES]: { tier: "ultimate", minVersion: "15.0" },

    // Legacy widgets (may not be available)
    [WorkItemWidgetTypes.REQUIREMENT_LEGACY]: { tier: "ultimate", minVersion: "13.1" },
    [WorkItemWidgetTypes.TEST_REPORTS]: { tier: "ultimate", minVersion: "13.6" },
  };

  public static isWidgetAvailable(widget: WorkItemWidgetType): boolean {
    const connectionManager = ConnectionManager.getInstance();

    try {
      const instanceInfo = connectionManager.getInstanceInfo();
      const requirement = this.widgetRequirements[widget];

      if (!requirement) {
        // Unknown widget, assume not available
        return false;
      }

      // Check version requirement
      const version = parseVersion(instanceInfo.version);
      const minVersion = parseVersion(requirement.minVersion);
      if (version < minVersion) {
        return false;
      }

      // Check tier requirement
      if (requirement.tier === "free") {
        return true; // Available to all tiers
      }

      const requiredTierLevel = TIER_HIERARCHY[requirement.tier];
      const actualTierLevel = TIER_HIERARCHY[instanceInfo.tier];

      return actualTierLevel >= requiredTierLevel;
    } catch {
      // If connection not initialized, assume widget not available
      return false;
    }
  }

  public static getAvailableWidgets(): WorkItemWidgetType[] {
    return Object.values(WorkItemWidgetTypes).filter(
      (widget): widget is WorkItemWidgetType =>
        typeof widget === "string" && this.isWidgetAvailable(widget as WorkItemWidgetType)
    );
  }

  public static getWidgetRequirement(widget: WorkItemWidgetType): WidgetRequirement | undefined {
    return this.widgetRequirements[widget];
  }

  /**
   * Validate widget parameters against the detected GitLab instance version and tier.
   * Returns the first unavailable widget parameter, or null if all are available.
   *
   * @param params - Object with parameter names as keys (only defined/present params checked)
   * @returns WidgetValidationFailure for the first unavailable parameter, or null if all valid
   */
  public static validateWidgetParams(
    params: Record<string, unknown>
  ): WidgetValidationFailure | null {
    const connectionManager = ConnectionManager.getInstance();

    let instanceVersion: string;
    let instanceTier: GitLabTier;

    try {
      const instanceInfo = connectionManager.getInstanceInfo();
      instanceVersion = instanceInfo.version;
      instanceTier = instanceInfo.tier;
    } catch {
      // Connection not initialized - skip validation (will fail at API call)
      return null;
    }

    const parsedVersion = parseVersion(instanceVersion);
    if (parsedVersion === 0) {
      logger.debug(
        `Widget param validation skipped: version "${instanceVersion}" could not be parsed`
      );
      return null;
    }

    for (const [paramName, paramValue] of Object.entries(params)) {
      // Skip undefined/null parameters (not provided by user)
      if (paramValue === undefined || paramValue === null) continue;

      const widgetType = PARAMETER_WIDGET_MAP[paramName];
      if (!widgetType) continue; // Not a widget parameter

      const requirement = this.widgetRequirements[widgetType];
      if (!requirement) continue; // Unknown widget

      // Check version requirement
      const minVersion = parseVersion(requirement.minVersion);
      if (parsedVersion < minVersion) {
        return {
          parameter: paramName,
          widget: widgetType,
          requiredVersion: requirement.minVersion,
          detectedVersion: instanceVersion,
          requiredTier: requirement.tier,
          currentTier: instanceTier,
        };
      }

      // Check tier requirement
      if (requirement.tier !== "free") {
        const requiredTierLevel = TIER_HIERARCHY[requirement.tier];
        const actualTierLevel = TIER_HIERARCHY[instanceTier];

        if (actualTierLevel < requiredTierLevel) {
          return {
            parameter: paramName,
            widget: widgetType,
            requiredVersion: requirement.minVersion,
            detectedVersion: instanceVersion,
            requiredTier: requirement.tier,
            currentTier: instanceTier,
          };
        }
      }
    }

    return null;
  }

  /**
   * Get the parameter-to-widget mapping (for testing and external use)
   */
  public static getParameterWidgetMap(): Record<string, WorkItemWidgetType> {
    return { ...PARAMETER_WIDGET_MAP };
  }
}
