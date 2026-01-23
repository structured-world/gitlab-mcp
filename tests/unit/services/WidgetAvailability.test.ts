/**
 * Unit tests for WidgetAvailability service
 * Tests widget availability based on GitLab tier and version
 */

import { WidgetAvailability } from "../../../src/services/WidgetAvailability";
import { ConnectionManager } from "../../../src/services/ConnectionManager";
import { WorkItemWidgetTypes } from "../../../src/graphql/workItems";
import { setupMockFetch, resetMocks } from "../../utils/testHelpers";

// Mock dependencies
jest.mock("../../../src/services/ConnectionManager");

setupMockFetch();

describe("WidgetAvailability", () => {
  let mockConnectionManager: jest.Mocked<ConnectionManager>;

  const mockInstanceInfoFree = {
    version: "18.3.0",
    tier: "free" as const,
    features: {} as any,
    detectedAt: new Date(),
  };

  const mockInstanceInfoPremium = {
    version: "18.3.0",
    tier: "premium" as const,
    features: {} as any,
    detectedAt: new Date(),
  };

  const mockInstanceInfoUltimate = {
    version: "18.3.0",
    tier: "ultimate" as const,
    features: {} as any,
    detectedAt: new Date(),
  };

  beforeEach(() => {
    resetMocks();

    mockConnectionManager = {
      getInstanceInfo: jest.fn(),
      getInstance: jest.fn(),
    } as any;

    (ConnectionManager.getInstance as jest.Mock).mockReturnValue(mockConnectionManager);
  });

  describe("widget availability by tier", () => {
    describe("free tier widgets", () => {
      beforeEach(() => {
        mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);
      });

      it("should allow all free tier widgets", () => {
        const freeWidgets = [
          WorkItemWidgetTypes.ASSIGNEES,
          WorkItemWidgetTypes.DESCRIPTION,
          WorkItemWidgetTypes.HIERARCHY,
          WorkItemWidgetTypes.LABELS,
          WorkItemWidgetTypes.MILESTONE,
          WorkItemWidgetTypes.NOTES,
          WorkItemWidgetTypes.START_AND_DUE_DATE,
          WorkItemWidgetTypes.STATUS,
          WorkItemWidgetTypes.NOTIFICATIONS,
          WorkItemWidgetTypes.CURRENT_USER_TODOS,
          WorkItemWidgetTypes.AWARD_EMOJI,
          WorkItemWidgetTypes.PARTICIPANTS,
          WorkItemWidgetTypes.DESIGNS,
          WorkItemWidgetTypes.DEVELOPMENT,
          WorkItemWidgetTypes.TIME_TRACKING,
          WorkItemWidgetTypes.ERROR_TRACKING,
          WorkItemWidgetTypes.PROGRESS,
          WorkItemWidgetTypes.COLOR,
        ];

        for (const widget of freeWidgets) {
          expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(true);
        }
      });

      it("should deny premium widgets on free tier", () => {
        const premiumWidgets = [
          WorkItemWidgetTypes.WEIGHT,
          WorkItemWidgetTypes.ITERATION,
          WorkItemWidgetTypes.LINKED_ITEMS,
          WorkItemWidgetTypes.CRM_CONTACTS,
          WorkItemWidgetTypes.EMAIL_PARTICIPANTS,
          WorkItemWidgetTypes.LINKED_RESOURCES,
        ];

        for (const widget of premiumWidgets) {
          expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(false);
        }
      });

      it("should deny ultimate widgets on free tier", () => {
        const ultimateWidgets = [
          WorkItemWidgetTypes.HEALTH_STATUS,
          WorkItemWidgetTypes.CUSTOM_FIELDS,
          WorkItemWidgetTypes.VULNERABILITIES,
          WorkItemWidgetTypes.REQUIREMENT_LEGACY,
          WorkItemWidgetTypes.TEST_REPORTS,
        ];

        for (const widget of ultimateWidgets) {
          expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(false);
        }
      });
    });

    describe("premium tier widgets", () => {
      beforeEach(() => {
        mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoPremium);
      });

      it("should allow free and premium widgets", () => {
        // Free widgets
        expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ASSIGNEES)).toBe(true);
        expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.LABELS)).toBe(true);

        // Premium widgets
        expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.WEIGHT)).toBe(true);
        expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ITERATION)).toBe(true);
        expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.LINKED_ITEMS)).toBe(true);
      });

      it("should deny ultimate-only widgets on premium tier", () => {
        const ultimateOnlyWidgets = [
          WorkItemWidgetTypes.HEALTH_STATUS,
          WorkItemWidgetTypes.CUSTOM_FIELDS,
          WorkItemWidgetTypes.VULNERABILITIES,
        ];

        for (const widget of ultimateOnlyWidgets) {
          expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(false);
        }
      });
    });

    describe("ultimate tier widgets", () => {
      beforeEach(() => {
        mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoUltimate);
      });

      it("should allow all widgets", () => {
        const allWidgets = Object.values(WorkItemWidgetTypes);

        for (const widget of allWidgets) {
          if (typeof widget === "string") {
            expect(WidgetAvailability.isWidgetAvailable(widget as any)).toBe(true);
          }
        }
      });
    });
  });

  describe("version requirements", () => {
    it("should respect minimum version requirements", () => {
      const oldVersionInfo = {
        ...mockInstanceInfoUltimate,
        version: "14.0.0", // Before work items (15.0)
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(oldVersionInfo);

      // Should deny widgets that require 15.0+
      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ASSIGNEES)).toBe(false);
      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.LABELS)).toBe(false);
    });

    it("should allow widgets when version meets requirements", () => {
      const newVersionInfo = {
        ...mockInstanceInfoUltimate,
        version: "17.5.0", // Supports custom fields (17.0+)
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(newVersionInfo);

      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.CUSTOM_FIELDS)).toBe(true);
    });

    it("should handle version-specific widgets correctly", () => {
      const versionTests = [
        {
          version: "15.9.0", // Parses to 15.9
          widget: WorkItemWidgetTypes.CRM_CONTACTS, // Requires 16.0+
          expected: false,
        },
        {
          version: "16.0.0", // Parses to 16.0
          widget: WorkItemWidgetTypes.CRM_CONTACTS,
          expected: true,
        },
        {
          version: "16.4.0", // Parses to 16.4
          widget: WorkItemWidgetTypes.LINKED_RESOURCES, // Requires 16.5+
          expected: false,
        },
        {
          version: "16.5.0", // Parses to 16.5
          widget: WorkItemWidgetTypes.LINKED_RESOURCES,
          expected: true,
        },
      ];

      for (const { version, widget, expected } of versionTests) {
        const versionInfo = {
          ...mockInstanceInfoPremium, // Use premium tier which supports these widgets
          version,
        };
        mockConnectionManager.getInstanceInfo.mockReturnValue(versionInfo);

        expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(expected);
      }
    });
  });

  describe("error handling", () => {
    it("should return false when connection not initialized", () => {
      mockConnectionManager.getInstanceInfo.mockImplementation(() => {
        throw new Error("Connection not initialized");
      });

      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ASSIGNEES)).toBe(false);
    });

    it("should return false for unknown widgets", () => {
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoUltimate);

      expect(WidgetAvailability.isWidgetAvailable("UNKNOWN_WIDGET" as any)).toBe(false);
    });

    it("should handle invalid version strings", () => {
      const invalidVersionInfo = {
        ...mockInstanceInfoUltimate,
        version: "invalid-version",
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(invalidVersionInfo);

      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ASSIGNEES)).toBe(false);
    });

    it("should handle unknown version", () => {
      const unknownVersionInfo = {
        ...mockInstanceInfoUltimate,
        version: "unknown",
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(unknownVersionInfo);

      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.ASSIGNEES)).toBe(false);
    });
  });

  describe("available widgets retrieval", () => {
    it("should return all available widgets for ultimate tier", () => {
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoUltimate);

      const availableWidgets = WidgetAvailability.getAvailableWidgets();

      expect(availableWidgets.length).toBeGreaterThan(0);
      expect(availableWidgets).toContain(WorkItemWidgetTypes.ASSIGNEES);
      expect(availableWidgets).toContain(WorkItemWidgetTypes.CUSTOM_FIELDS);
      expect(availableWidgets).toContain(WorkItemWidgetTypes.HEALTH_STATUS);
    });

    it("should return limited widgets for free tier", () => {
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);

      const availableWidgets = WidgetAvailability.getAvailableWidgets();

      expect(availableWidgets).toContain(WorkItemWidgetTypes.ASSIGNEES);
      expect(availableWidgets).toContain(WorkItemWidgetTypes.LABELS);
      expect(availableWidgets).not.toContain(WorkItemWidgetTypes.WEIGHT);
      expect(availableWidgets).not.toContain(WorkItemWidgetTypes.CUSTOM_FIELDS);
    });

    it("should return empty array when connection fails", () => {
      mockConnectionManager.getInstanceInfo.mockImplementation(() => {
        throw new Error("Connection failed");
      });

      const availableWidgets = WidgetAvailability.getAvailableWidgets();

      expect(availableWidgets).toEqual([]);
    });
  });

  describe("widget requirements", () => {
    it("should return widget requirement correctly", () => {
      const assigneesReq = WidgetAvailability.getWidgetRequirement(WorkItemWidgetTypes.ASSIGNEES);
      expect(assigneesReq).toEqual({ tier: "free", minVersion: 15.0 });

      const weightReq = WidgetAvailability.getWidgetRequirement(WorkItemWidgetTypes.WEIGHT);
      expect(weightReq).toEqual({ tier: "premium", minVersion: 15.0 });

      const customFieldsReq = WidgetAvailability.getWidgetRequirement(
        WorkItemWidgetTypes.CUSTOM_FIELDS
      );
      expect(customFieldsReq).toEqual({ tier: "ultimate", minVersion: 17.0 });
    });

    it("should return undefined for unknown widget", () => {
      const unknownReq = WidgetAvailability.getWidgetRequirement("UNKNOWN_WIDGET" as any);
      expect(unknownReq).toBeUndefined();
    });
  });

  describe("version parsing", () => {
    it("should parse version strings correctly", () => {
      const parseVersion = (WidgetAvailability as any).parseVersion;

      expect(parseVersion("18.3.0")).toBe(18.3);
      expect(parseVersion("15.11.2")).toBe(16.1); // 15 + 11/10 = 16.1
      expect(parseVersion("10.2.5")).toBe(10.2);
      expect(parseVersion("unknown")).toBe(0);
      expect(parseVersion("invalid")).toBe(0);
      expect(parseVersion("")).toBe(0);
      expect(parseVersion("abc")).toBe(0);
    });
  });

  describe("tier hierarchy", () => {
    it("should handle tier hierarchy correctly", () => {
      const testCases = [
        {
          actualTier: "free" as const,
          requiredTier: "premium" as const,
          widget: WorkItemWidgetTypes.WEIGHT,
          expected: false,
        },
        {
          actualTier: "premium" as const,
          requiredTier: "free" as const,
          widget: WorkItemWidgetTypes.ASSIGNEES,
          expected: true,
        },
        {
          actualTier: "ultimate" as const,
          requiredTier: "premium" as const,
          widget: WorkItemWidgetTypes.WEIGHT,
          expected: true,
        },
        {
          actualTier: "premium" as const,
          requiredTier: "ultimate" as const,
          widget: WorkItemWidgetTypes.CUSTOM_FIELDS,
          expected: false,
        },
      ];

      for (const { actualTier, widget, expected } of testCases) {
        const instanceInfo = {
          ...mockInstanceInfoUltimate,
          tier: actualTier,
        };
        mockConnectionManager.getInstanceInfo.mockReturnValue(instanceInfo);

        expect(WidgetAvailability.isWidgetAvailable(widget)).toBe(expected);
      }
    });
  });

  describe("widget type filtering", () => {
    it("should filter widget types correctly based on string type", () => {
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoUltimate);

      const availableWidgets = WidgetAvailability.getAvailableWidgets();

      // All returned widgets should be strings
      for (const widget of availableWidgets) {
        expect(typeof widget).toBe("string");
      }

      // Should not include any numeric enum values or other types
      expect(availableWidgets.every(widget => typeof widget === "string")).toBe(true);
    });
  });

  describe("validateWidgetParams", () => {
    it("should return null when all params are available (free tier, modern version)", () => {
      // Free tier instance with modern version - all base widget params should pass
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);

      const result = WidgetAvailability.validateWidgetParams({
        description: "test",
        assigneeIds: ["1"],
        labelIds: ["2"],
        milestoneId: "3",
      });

      expect(result).toBeNull();
    });

    it("should skip undefined/null parameters", () => {
      // Parameters that are undefined or null should be ignored
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);

      const result = WidgetAvailability.validateWidgetParams({
        description: undefined,
        assigneeIds: null,
        labelIds: undefined,
        milestoneId: undefined,
      });

      expect(result).toBeNull();
    });

    it("should skip unknown parameters (non-widget params like title)", () => {
      // Parameters not in the widget map should be ignored
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);

      const result = WidgetAvailability.validateWidgetParams({
        title: "Test title",
        state: "CLOSE",
        unknownParam: "value",
      });

      expect(result).toBeNull();
    });

    it("should detect version-restricted widget parameters", () => {
      // Old GitLab version (14.0) should fail for ASSIGNEES (requires 15.0+)
      const oldVersionInfo = {
        ...mockInstanceInfoFree,
        version: "14.0.0",
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(oldVersionInfo);

      const result = WidgetAvailability.validateWidgetParams({
        assigneeIds: ["1", "2"],
      });

      expect(result).not.toBeNull();
      expect(result!.parameter).toBe("assigneeIds");
      expect(result!.widget).toBe("ASSIGNEES");
      expect(result!.requiredVersion).toBe("15.0");
      expect(result!.detectedVersion).toBe("14.0.0");
    });

    it("should detect tier-restricted widget parameters", () => {
      // Free tier should fail for WEIGHT widget (requires premium)
      mockConnectionManager.getInstanceInfo.mockReturnValue(mockInstanceInfoFree);

      // Note: weight is not currently in PARAMETER_WIDGET_MAP since it's not yet
      // a schema parameter. This test validates the tier check logic by testing
      // the isWidgetAvailable method directly.
      expect(WidgetAvailability.isWidgetAvailable(WorkItemWidgetTypes.WEIGHT)).toBe(false);
    });

    it("should return null when connection is not initialized", () => {
      // When connection throws, validation should pass (fail at API call)
      mockConnectionManager.getInstanceInfo.mockImplementation(() => {
        throw new Error("Not initialized");
      });

      const result = WidgetAvailability.validateWidgetParams({
        description: "test",
        assigneeIds: ["1"],
      });

      expect(result).toBeNull();
    });

    it("should return first failing parameter only", () => {
      // When multiple params fail, only the first one should be reported
      const oldVersionInfo = {
        ...mockInstanceInfoFree,
        version: "14.0.0",
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(oldVersionInfo);

      const result = WidgetAvailability.validateWidgetParams({
        description: "test",
        assigneeIds: ["1"],
        labelIds: ["2"],
      });

      // Should return the first failure encountered
      expect(result).not.toBeNull();
      expect(result!.parameter).toBeDefined();
      expect(result!.widget).toBeDefined();
    });

    it("should include correct tier info in validation failure", () => {
      const oldVersionInfo = {
        ...mockInstanceInfoPremium,
        version: "14.0.0",
      };
      mockConnectionManager.getInstanceInfo.mockReturnValue(oldVersionInfo);

      const result = WidgetAvailability.validateWidgetParams({
        labelIds: ["1"],
      });

      expect(result).not.toBeNull();
      expect(result!.currentTier).toBe("premium");
      expect(result!.requiredTier).toBe("free"); // LABELS widget is free tier
    });
  });

  describe("getParameterWidgetMap", () => {
    it("should return the parameter-to-widget mapping", () => {
      const map = WidgetAvailability.getParameterWidgetMap();

      expect(map.assigneeIds).toBe("ASSIGNEES");
      expect(map.labelIds).toBe("LABELS");
      expect(map.milestoneId).toBe("MILESTONE");
      expect(map.description).toBe("DESCRIPTION");
    });

    it("should return a copy (not the original reference)", () => {
      const map1 = WidgetAvailability.getParameterWidgetMap();
      const map2 = WidgetAvailability.getParameterWidgetMap();

      expect(map1).toEqual(map2);
      expect(map1).not.toBe(map2);
    });
  });

  describe("formatVersion", () => {
    it("should format numeric versions to display strings", () => {
      const formatVersion = (WidgetAvailability as any).formatVersion;

      expect(formatVersion(15.0)).toBe("15.0");
      expect(formatVersion(17.0)).toBe("17.0");
      expect(formatVersion(16.5)).toBe("16.5");
      expect(formatVersion(18.3)).toBe("18.3");
    });
  });
});
