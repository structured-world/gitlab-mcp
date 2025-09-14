import { WorkItemWidgetType } from '../graphql/workItems';
import { ConnectionManager } from './ConnectionManager';
import { GitLabTier } from './GitLabVersionDetector';

interface WidgetRequirement {
  tier: GitLabTier | 'free';
  minVersion: number;
}

export class WidgetAvailability {
  private static widgetRequirements: Record<WorkItemWidgetType, WidgetRequirement> = {
    // Free tier widgets (available to all)
    [WorkItemWidgetType.ASSIGNEES]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.DESCRIPTION]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.HIERARCHY]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.LABELS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.MILESTONE]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.NOTES]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.START_AND_DUE_DATE]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.STATUS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.NOTIFICATIONS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.CURRENT_USER_TODOS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.AWARD_EMOJI]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.PARTICIPANTS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.DESIGNS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.DEVELOPMENT]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.TIME_TRACKING]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.ERROR_TRACKING]: { tier: 'free', minVersion: 15.0 },

    // Premium tier widgets
    [WorkItemWidgetType.WEIGHT]: { tier: 'premium', minVersion: 15.0 },
    [WorkItemWidgetType.ITERATION]: { tier: 'premium', minVersion: 15.0 },
    [WorkItemWidgetType.LINKED_ITEMS]: { tier: 'premium', minVersion: 15.0 },
    [WorkItemWidgetType.CRM_CONTACTS]: { tier: 'premium', minVersion: 16.0 },
    [WorkItemWidgetType.EMAIL_PARTICIPANTS]: { tier: 'premium', minVersion: 16.0 },
    [WorkItemWidgetType.LINKED_RESOURCES]: { tier: 'premium', minVersion: 16.5 },

    // Ultimate tier widgets
    [WorkItemWidgetType.HEALTH_STATUS]: { tier: 'ultimate', minVersion: 15.0 },
    [WorkItemWidgetType.CUSTOM_FIELDS]: { tier: 'ultimate', minVersion: 17.0 },
    [WorkItemWidgetType.VULNERABILITIES]: { tier: 'ultimate', minVersion: 15.0 },

    // Legacy widgets (may not be available)
    [WorkItemWidgetType.PROGRESS]: { tier: 'free', minVersion: 15.0 },
    [WorkItemWidgetType.REQUIREMENT_LEGACY]: { tier: 'ultimate', minVersion: 13.1 },
    [WorkItemWidgetType.TEST_REPORTS]: { tier: 'ultimate', minVersion: 13.6 },
    [WorkItemWidgetType.COLOR]: { tier: 'free', minVersion: 15.0 },
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
      const version = this.parseVersion(instanceInfo.version);
      if (version < requirement.minVersion) {
        return false;
      }

      // Check tier requirement
      if (requirement.tier === 'free') {
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
    } catch (error) {
      // If connection not initialized, assume widget not available
      return false;
    }
  }

  public static getAvailableWidgets(): WorkItemWidgetType[] {
    return Object.values(WorkItemWidgetType).filter((widget) => this.isWidgetAvailable(widget));
  }

  public static getWidgetRequirement(widget: WorkItemWidgetType): WidgetRequirement | undefined {
    return this.widgetRequirements[widget];
  }

  private static parseVersion(version: string): number {
    if (version === 'unknown') return 0;

    const match = version.match(/^(\d+)\.(\d+)/);
    if (!match) return 0;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);

    return major + minor / 10;
  }
}
