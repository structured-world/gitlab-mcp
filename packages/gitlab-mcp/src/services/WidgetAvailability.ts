import { WorkItemWidgetType, WorkItemWidgetTypes } from '../graphql/workItems';
import { ConnectionManager } from './ConnectionManager';
import { GitLabTier } from './GitLabVersionDetector';
import { parseVersion } from '../utils/version';
import { effectiveMinVersion } from './InstanceCapabilities';
import { logDebug } from '../logger';

interface WidgetRequirement {
  tier: GitLabTier;
  /** Declared only when newer than MIN_SUPPORTED_VERSION. */
  minVersion?: string;
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
  addLabelIds: WorkItemWidgetTypes.LABELS,
  removeLabelIds: WorkItemWidgetTypes.LABELS,
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
  // Free tier: linked items
  linkType: WorkItemWidgetTypes.LINKED_ITEMS,
  targetId: WorkItemWidgetTypes.LINKED_ITEMS,
  // Premium tier
  weight: WorkItemWidgetTypes.WEIGHT,
  iterationId: WorkItemWidgetTypes.ITERATION,
  progressCurrentValue: WorkItemWidgetTypes.PROGRESS,
  // Ultimate tier
  healthStatus: WorkItemWidgetTypes.HEALTH_STATUS,
  color: WorkItemWidgetTypes.COLOR,
  verificationStatus: WorkItemWidgetTypes.VERIFICATION_STATUS,
};

export class WidgetAvailability {
  private static widgetRequirements: Record<WorkItemWidgetType, WidgetRequirement> = {
    // Free tier widgets (available to all)
    [WorkItemWidgetTypes.ASSIGNEES]: { tier: 'free' },
    [WorkItemWidgetTypes.DESCRIPTION]: { tier: 'free' },
    [WorkItemWidgetTypes.HIERARCHY]: { tier: 'free' },
    [WorkItemWidgetTypes.LABELS]: { tier: 'free' },
    [WorkItemWidgetTypes.MILESTONE]: { tier: 'free' },
    [WorkItemWidgetTypes.NOTES]: { tier: 'free' },
    [WorkItemWidgetTypes.START_AND_DUE_DATE]: { tier: 'free' },
    [WorkItemWidgetTypes.STATUS]: { tier: 'free' },
    [WorkItemWidgetTypes.NOTIFICATIONS]: { tier: 'free' },
    [WorkItemWidgetTypes.CURRENT_USER_TODOS]: { tier: 'free' },
    [WorkItemWidgetTypes.AWARD_EMOJI]: { tier: 'free' },
    [WorkItemWidgetTypes.PARTICIPANTS]: { tier: 'free' },
    [WorkItemWidgetTypes.DESIGNS]: { tier: 'free' },
    [WorkItemWidgetTypes.DEVELOPMENT]: { tier: 'free' },
    [WorkItemWidgetTypes.TIME_TRACKING]: { tier: 'free' },
    [WorkItemWidgetTypes.ERROR_TRACKING]: { tier: 'free' },

    // Free tier widgets (linked items available on CE)
    [WorkItemWidgetTypes.LINKED_ITEMS]: { tier: 'free' },

    // Premium tier widgets
    [WorkItemWidgetTypes.WEIGHT]: { tier: 'premium' },
    [WorkItemWidgetTypes.ITERATION]: { tier: 'premium' },
    [WorkItemWidgetTypes.PROGRESS]: { tier: 'premium' },
    [WorkItemWidgetTypes.CRM_CONTACTS]: { tier: 'premium' },
    [WorkItemWidgetTypes.EMAIL_PARTICIPANTS]: { tier: 'premium' },
    [WorkItemWidgetTypes.LINKED_RESOURCES]: { tier: 'premium', minVersion: '16.5' },

    // Ultimate tier widgets
    [WorkItemWidgetTypes.HEALTH_STATUS]: { tier: 'ultimate' },
    [WorkItemWidgetTypes.COLOR]: { tier: 'ultimate' },
    [WorkItemWidgetTypes.CUSTOM_FIELDS]: { tier: 'ultimate', minVersion: '17.0' },
    [WorkItemWidgetTypes.VULNERABILITIES]: { tier: 'ultimate' },

    // Legacy widgets (may not be available)
    [WorkItemWidgetTypes.REQUIREMENT_LEGACY]: { tier: 'ultimate' },
    [WorkItemWidgetTypes.TEST_REPORTS]: { tier: 'ultimate' },
    [WorkItemWidgetTypes.VERIFICATION_STATUS]: { tier: 'ultimate' },
  };

  public static isWidgetAvailable(widget: WorkItemWidgetType, instanceUrl?: string): boolean {
    const connectionManager = ConnectionManager.getInstance();

    try {
      const instanceInfo = connectionManager.getInstanceInfo(instanceUrl);
      const requirement = this.widgetRequirements[widget];

      if (!requirement) {
        // Unknown widget, assume not available
        return false;
      }

      // Check version requirement
      const version = parseVersion(instanceInfo.version);
      if (version < parseVersion(effectiveMinVersion(requirement))) {
        return false;
      }

      // Check tier requirement
      if (requirement.tier === 'free') {
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

  public static getAvailableWidgets(instanceUrl?: string): WorkItemWidgetType[] {
    return Object.values(WorkItemWidgetTypes).filter(
      (widget): widget is WorkItemWidgetType =>
        typeof widget === 'string' && this.isWidgetAvailable(widget, instanceUrl),
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
   * @param instanceUrl - Optional instance URL to validate against. When omitted,
   *   falls back to ConnectionManager.currentInstanceUrl. Callers in request context
   *   (e.g. workitems handler) should pass the per-request URL to avoid cross-instance
   *   leakage in concurrent OAuth traffic.
   * @returns WidgetValidationFailure for the first unavailable parameter, or null if all valid
   */
  public static validateWidgetParams(
    params: Record<string, unknown>,
    instanceUrl?: string,
  ): WidgetValidationFailure | null {
    const connectionManager = ConnectionManager.getInstance();

    let instanceVersion: string;
    let instanceTier: GitLabTier;

    try {
      const instanceInfo = connectionManager.getInstanceInfo(instanceUrl);
      instanceVersion = instanceInfo.version;
      instanceTier = instanceInfo.tier;
    } catch {
      // Connection not initialized - skip validation (will fail at API call)
      return null;
    }

    const parsedVersion = parseVersion(instanceVersion);
    if (parsedVersion === 0) {
      logDebug('Widget param validation skipped: version could not be parsed', { instanceVersion });
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
      const requiredVersion = effectiveMinVersion(requirement);
      if (parsedVersion < parseVersion(requiredVersion)) {
        return {
          parameter: paramName,
          widget: widgetType,
          requiredVersion,
          detectedVersion: instanceVersion,
          requiredTier: requirement.tier,
          currentTier: instanceTier,
        };
      }

      // Check tier requirement
      if (requirement.tier !== 'free') {
        const requiredTierLevel = TIER_HIERARCHY[requirement.tier];
        const actualTierLevel = TIER_HIERARCHY[instanceTier];

        if (actualTierLevel < requiredTierLevel) {
          return {
            parameter: paramName,
            widget: widgetType,
            requiredVersion,
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
