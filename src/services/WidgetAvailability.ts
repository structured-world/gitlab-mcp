import { WorkItemWidgetType, WorkItemWidgetTypes } from "../graphql/workItems";
import { ConnectionManager } from "./ConnectionManager";
import { GitLabTier } from "./GitLabVersionDetector";

interface WidgetRequirement {
  tier: GitLabTier | "free";
  minVersion: number;
}

/**
 * Result of a widget parameter availability check
 */
export interface WidgetValidationFailure {
  parameter: string;
  widget: WorkItemWidgetType;
  requiredVersion: string;
  detectedVersion: string;
  requiredTier: GitLabTier | "free";
  currentTier: GitLabTier;
}

/**
 * Maps manage_work_item input parameters to their corresponding widget types.
 * This is the source of truth for which parameters require which widgets.
 */
const PARAMETER_WIDGET_MAP: Record<string, WorkItemWidgetType> = {
  // Free tier widgets
  assigneeIds: WorkItemWidgetTypes.ASSIGNEES,
  labelIds: WorkItemWidgetTypes.LABELS,
  milestoneId: WorkItemWidgetTypes.MILESTONE,
  description: WorkItemWidgetTypes.DESCRIPTION,
  startDate: WorkItemWidgetTypes.START_AND_DUE_DATE,
  dueDate: WorkItemWidgetTypes.START_AND_DUE_DATE,
  color: WorkItemWidgetTypes.COLOR,
  // Premium tier widgets
  weight: WorkItemWidgetTypes.WEIGHT,
  iterationId: WorkItemWidgetTypes.ITERATION,
  linkedItemIds: WorkItemWidgetTypes.LINKED_ITEMS,
  // Ultimate tier widgets
  healthStatus: WorkItemWidgetTypes.HEALTH_STATUS,
};

export class WidgetAvailability {
  private static widgetRequirements: Record<WorkItemWidgetType, WidgetRequirement> = {
    // Free tier widgets (available to all)
    [WorkItemWidgetTypes.ASSIGNEES]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.DESCRIPTION]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.HIERARCHY]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.LABELS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.MILESTONE]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.NOTES]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.START_AND_DUE_DATE]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.STATUS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.NOTIFICATIONS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.CURRENT_USER_TODOS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.AWARD_EMOJI]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.PARTICIPANTS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.DESIGNS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.DEVELOPMENT]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.TIME_TRACKING]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.ERROR_TRACKING]: { tier: "free", minVersion: 15.0 },

    // Premium tier widgets
    [WorkItemWidgetTypes.WEIGHT]: { tier: "premium", minVersion: 15.0 },
    [WorkItemWidgetTypes.ITERATION]: { tier: "premium", minVersion: 15.0 },
    [WorkItemWidgetTypes.LINKED_ITEMS]: { tier: "premium", minVersion: 15.0 },
    [WorkItemWidgetTypes.CRM_CONTACTS]: { tier: "premium", minVersion: 16.0 },
    [WorkItemWidgetTypes.EMAIL_PARTICIPANTS]: { tier: "premium", minVersion: 16.0 },
    [WorkItemWidgetTypes.LINKED_RESOURCES]: { tier: "premium", minVersion: 16.5 },

    // Ultimate tier widgets
    [WorkItemWidgetTypes.HEALTH_STATUS]: { tier: "ultimate", minVersion: 15.0 },
    [WorkItemWidgetTypes.CUSTOM_FIELDS]: { tier: "ultimate", minVersion: 17.0 },
    [WorkItemWidgetTypes.VULNERABILITIES]: { tier: "ultimate", minVersion: 15.0 },

    // Legacy widgets (may not be available)
    [WorkItemWidgetTypes.PROGRESS]: { tier: "free", minVersion: 15.0 },
    [WorkItemWidgetTypes.REQUIREMENT_LEGACY]: { tier: "ultimate", minVersion: 13.1 },
    [WorkItemWidgetTypes.TEST_REPORTS]: { tier: "ultimate", minVersion: 13.6 },
    [WorkItemWidgetTypes.COLOR]: { tier: "free", minVersion: 15.0 },
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

      // Check version requirement using tuple comparison (handles minor >= 10)
      const version = this.parseVersion(instanceInfo.version);
      const minVersion = this.minVersionToComparable(requirement.minVersion);
      if (version < minVersion) {
        return false;
      }

      // Check tier requirement
      if (requirement.tier === "free") {
        return true; // Available to all tiers
      }

      const tierHierarchy: Record<GitLabTier, number> = {
        free: 0,
        premium: 1,
        ultimate: 2,
      };

      const requiredTierLevel = tierHierarchy[requirement.tier as GitLabTier];
      const actualTierLevel = tierHierarchy[instanceInfo.tier];

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

    const parsedVersion = this.parseVersion(instanceVersion);

    for (const [paramName, paramValue] of Object.entries(params)) {
      // Skip undefined/null parameters (not provided by user)
      if (paramValue === undefined || paramValue === null) continue;

      const widgetType = PARAMETER_WIDGET_MAP[paramName];
      if (!widgetType) continue; // Not a widget parameter

      const requirement = this.widgetRequirements[widgetType];
      if (!requirement) continue; // Unknown widget

      // Check version requirement using tuple comparison (handles minor >= 10)
      const minVersion = this.minVersionToComparable(requirement.minVersion);
      if (parsedVersion < minVersion) {
        return {
          parameter: paramName,
          widget: widgetType,
          requiredVersion: this.formatVersion(requirement.minVersion),
          detectedVersion: instanceVersion,
          requiredTier: requirement.tier,
          currentTier: instanceTier,
        };
      }

      // Check tier requirement
      if (requirement.tier !== "free") {
        const tierHierarchy: Record<GitLabTier, number> = {
          free: 0,
          premium: 1,
          ultimate: 2,
        };

        const requiredTierLevel = tierHierarchy[requirement.tier as GitLabTier];
        const actualTierLevel = tierHierarchy[instanceTier];

        if (actualTierLevel < requiredTierLevel) {
          return {
            parameter: paramName,
            widget: widgetType,
            requiredVersion: this.formatVersion(requirement.minVersion),
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

  /**
   * Parse a version string into a comparable integer.
   * Uses major * 100 + minor encoding to correctly handle minor >= 10
   * (e.g., "16.11.0" → 1611, not 17.1 as float math would give).
   */
  private static parseVersion(version: string): number {
    if (version === "unknown") return 0;

    const match = version.match(/^(\d+)\.(\d+)/);
    if (!match) return 0;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);

    return major * 100 + minor;
  }

  /**
   * Convert a stored minVersion float (e.g., 16.5) to the comparable integer format.
   * minVersion values use the convention major.minor as a float (max minor = 9).
   */
  private static minVersionToComparable(minVersion: number): number {
    const major = Math.floor(minVersion);
    const minor = Math.round((minVersion - major) * 10);
    return major * 100 + minor;
  }

  /**
   * Format a stored minVersion float to a displayable string (e.g., 17.0 → "17.0")
   */
  private static formatVersion(minVersion: number): string {
    const major = Math.floor(minVersion);
    const minor = Math.round((minVersion - major) * 10);
    return `${major}.${minor}`;
  }
}
