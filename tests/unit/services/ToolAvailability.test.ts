/**
 * Tool Availability Unit Tests
 * Tests tier-based tool filtering with mocked GitLab instances
 */

import { ToolAvailability } from "../../../src/services/ToolAvailability";
import { ConnectionManager } from "../../../src/services/ConnectionManager";
import {
  GitLabInstanceInfo,
  GitLabTier,
  GitLabFeatures,
} from "../../../src/services/GitLabVersionDetector";

// Helper to create feature objects based on tier
function createFeatures(tier: GitLabTier): GitLabFeatures {
  // Base features available in all tiers
  const baseFeatures = {
    workItems: true,
    timeTracking: true,
    codeReview: true,
    serviceDesk: true,
    designManagement: true,
    errorTracking: true,
  };

  if (tier === "free") {
    return {
      ...baseFeatures,
      // Free tier - most features disabled
      epics: false,
      iterations: false,
      roadmaps: false,
      portfolioManagement: false,
      securityDashboard: false,
      complianceFramework: false,
      valueStreamAnalytics: false,
      customFields: false,
      okrs: false,
      healthStatus: false,
      weight: false,
      multiLevelEpics: false,
      requirements: false,
      qualityManagement: false,
      crmContacts: false,
      vulnerabilities: false,
      linkedResources: false,
      emailParticipants: false,
      advancedSearch: false,
    };
  }

  if (tier === "premium") {
    return {
      ...baseFeatures,
      // Premium tier - adds these features
      epics: true,
      iterations: true,
      roadmaps: true,
      weight: true,
      linkedResources: true,
      emailParticipants: true,
      advancedSearch: true,
      valueStreamAnalytics: true,
      crmContacts: true,
      // Ultimate-only features still disabled
      portfolioManagement: false,
      securityDashboard: false,
      complianceFramework: false,
      customFields: false,
      okrs: false,
      healthStatus: false,
      multiLevelEpics: false,
      requirements: false,
      qualityManagement: false,
      vulnerabilities: false,
    };
  }

  // Ultimate tier - all features enabled
  return {
    ...baseFeatures,
    epics: true,
    iterations: true,
    roadmaps: true,
    portfolioManagement: true,
    securityDashboard: true,
    complianceFramework: true,
    valueStreamAnalytics: true,
    customFields: true,
    okrs: true,
    healthStatus: true,
    weight: true,
    multiLevelEpics: true,
    requirements: true,
    qualityManagement: true,
    crmContacts: true,
    vulnerabilities: true,
    linkedResources: true,
    emailParticipants: true,
    advancedSearch: true,
  };
}

// Mock the ConnectionManager
jest.mock("../../../src/services/ConnectionManager");
const mockConnectionManager = ConnectionManager as jest.Mocked<typeof ConnectionManager>;

describe("ToolAvailability - Tier-based Filtering", () => {
  let mockInstance: jest.MockedObject<ConnectionManager>;

  beforeEach(() => {
    mockInstance = {
      getInstanceInfo: jest.fn(),
      getInstance: jest.fn().mockReturnValue(mockInstance),
    } as any;

    mockConnectionManager.getInstance.mockReturnValue(mockInstance);
    jest.clearAllMocks();
  });

  describe("Free Tier GitLab Instance", () => {
    beforeEach(() => {
      const freeInstanceInfo: GitLabInstanceInfo = {
        version: "18.3.0",
        tier: "free" as GitLabTier,
        features: createFeatures("free"),
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(freeInstanceInfo);
    });

    it("should allow free tier tools", () => {
      const freeTools = [
        "browse_projects",
        "browse_search",
        "manage_ref",
        "browse_commits",
        "browse_merge_requests",
        "manage_merge_request",
        "browse_work_items",
        "manage_work_item",
        "browse_milestones",
        "browse_pipelines",
        "browse_wiki",
        "manage_wiki",
      ];

      freeTools.forEach(toolName => {
        expect(ToolAvailability.isToolAvailable(toolName)).toBe(true);
        expect(ToolAvailability.getUnavailableReason(toolName)).toBe(null);
      });
    });

    it("should block premium-only tools", () => {
      // browse_iterations requires premium tier
      expect(ToolAvailability.isToolAvailable("browse_iterations")).toBe(false);
    });

    it("should provide correct tool counts by tier", () => {
      const freeToolCount = ToolAvailability.getToolsByTier("free").length;
      const premiumToolCount = ToolAvailability.getToolsByTier("premium").length;

      // Most consolidated tools have free default tier
      expect(freeToolCount).toBeGreaterThan(30);
      // Only browse_iterations has premium default
      expect(premiumToolCount).toBe(1);
    });
  });

  describe("Premium Tier GitLab Instance", () => {
    beforeEach(() => {
      const premiumInstanceInfo: GitLabInstanceInfo = {
        version: "18.3.0",
        tier: "premium" as GitLabTier,
        features: createFeatures("premium"),
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(premiumInstanceInfo);
    });

    it("should allow free and premium tier tools", () => {
      const freeAndPremiumTools = ["browse_projects", "manage_merge_request", "browse_iterations"];

      freeAndPremiumTools.forEach(toolName => {
        expect(ToolAvailability.isToolAvailable(toolName)).toBe(true);
        expect(ToolAvailability.getUnavailableReason(toolName)).toBe(null);
      });
    });

    it("should allow premium actions on premium tier", () => {
      expect(ToolAvailability.isToolAvailable("browse_merge_requests", "approvals")).toBe(true);
      expect(ToolAvailability.isToolAvailable("browse_milestones", "burndown")).toBe(true);
    });
  });

  describe("Ultimate Tier GitLab Instance", () => {
    beforeEach(() => {
      const ultimateInstanceInfo: GitLabInstanceInfo = {
        version: "18.3.0",
        tier: "ultimate" as GitLabTier,
        features: createFeatures("ultimate"),
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(ultimateInstanceInfo);
    });

    it("should allow all registered tools", () => {
      const allTools = [
        "browse_projects",
        "browse_iterations",
        "browse_merge_requests",
        "manage_merge_request",
        "browse_work_items",
        "browse_refs",
        "manage_ref",
        "browse_members",
        "manage_member",
        "browse_search",
      ];

      allTools.forEach(toolName => {
        expect(ToolAvailability.isToolAvailable(toolName)).toBe(true);
        expect(ToolAvailability.getUnavailableReason(toolName)).toBe(null);
      });
    });
  });

  describe("Version Requirements", () => {
    it("should block tools when version is too old", () => {
      const oldInstanceInfo: GitLabInstanceInfo = {
        version: "10.0.0", // Old version
        tier: "ultimate" as GitLabTier,
        features: {
          ...createFeatures("free"),
          workItems: false,
          epics: false,
        },
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(oldInstanceInfo);

      // Work Items require 15.0+
      expect(ToolAvailability.isToolAvailable("browse_work_items")).toBe(false);
      const reason = ToolAvailability.getUnavailableReason("browse_work_items");
      expect(reason).toContain("15.0+");

      // But basic tools from 8.0 should work
      expect(ToolAvailability.isToolAvailable("browse_projects")).toBe(true);
      expect(ToolAvailability.isToolAvailable("browse_commits")).toBe(true);
    });

    it("should allow tools when version meets requirements", () => {
      const modernInstanceInfo: GitLabInstanceInfo = {
        version: "18.0.0",
        tier: "free" as GitLabTier,
        features: createFeatures("free"),
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(modernInstanceInfo);

      // Work Items should be available (version 18.0 >= required 15.0)
      expect(ToolAvailability.isToolAvailable("browse_work_items")).toBe(true);
      expect(ToolAvailability.isToolAvailable("manage_work_item")).toBe(true);

      // But premium features should still be blocked
      expect(ToolAvailability.isToolAvailable("browse_iterations")).toBe(false);
      expect(ToolAvailability.getUnavailableReason("browse_iterations")).toContain("premium tier");
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown tools gracefully", () => {
      mockInstance.getInstanceInfo.mockReturnValue({
        version: "18.3.0",
        tier: "ultimate" as GitLabTier,
        features: createFeatures("ultimate"),
        detectedAt: new Date(),
      });

      expect(ToolAvailability.isToolAvailable("unknown_tool")).toBe(true);
      expect(ToolAvailability.getUnavailableReason("unknown_tool")).toContain("not recognized");
    });

    it("should handle missing connection manager gracefully", () => {
      mockConnectionManager.getInstance.mockReturnValue(null as any);

      expect(ToolAvailability.isToolAvailable("browse_projects")).toBe(false);
      expect(ToolAvailability.getUnavailableReason("browse_projects")).toContain(
        "GitLab connection not initialized"
      );
    });
  });

  describe("Action-Level Tier Requirements", () => {
    describe("getActionRequirement", () => {
      it("should return default requirement when no action specified", () => {
        const req = ToolAvailability.getActionRequirement("browse_projects");
        expect(req).toBeDefined();
        expect(req?.tier).toBe("free");
      });

      it("should return action-specific requirement when action has higher tier", () => {
        const req = ToolAvailability.getActionRequirement("browse_merge_requests", "approvals");
        expect(req).toBeDefined();
        expect(req?.tier).toBe("premium");
      });

      it("should return default requirement for action without override", () => {
        const req = ToolAvailability.getActionRequirement("browse_merge_requests", "list");
        expect(req).toBeDefined();
        expect(req?.tier).toBe("free");
      });

      it("should return undefined for unknown tool", () => {
        const req = ToolAvailability.getActionRequirement("unknown_tool_xyz");
        expect(req).toBeUndefined();
      });
    });

    describe("getHighestTier", () => {
      it("should return free for tools with all free actions", () => {
        const tier = ToolAvailability.getHighestTier("browse_projects");
        expect(tier).toBe("free");
      });

      it("should return premium for tools with premium actions", () => {
        const tier = ToolAvailability.getHighestTier("browse_merge_requests");
        expect(tier).toBe("premium");
      });

      it("should return premium for browse_milestones with burndown action", () => {
        const tier = ToolAvailability.getHighestTier("browse_milestones");
        expect(tier).toBe("premium");
      });

      it("should return free for unknown tools", () => {
        const tier = ToolAvailability.getHighestTier("totally_unknown_tool");
        expect(tier).toBe("free");
      });
    });

    describe("getTierRestrictedActions", () => {
      it("should return premium actions for tool with mixed tiers", () => {
        const actions = ToolAvailability.getTierRestrictedActions(
          "browse_merge_requests",
          "premium"
        );
        expect(actions).toContain("approvals");
      });

      it("should return empty array for tool with all free actions", () => {
        const actions = ToolAvailability.getTierRestrictedActions("browse_projects", "premium");
        expect(actions).toEqual([]);
      });

      it("should return empty array for unknown tool", () => {
        const actions = ToolAvailability.getTierRestrictedActions("unknown_tool", "premium");
        expect(actions).toEqual([]);
      });

      it("should include ultimate actions when querying for premium", () => {
        const premiumAndAbove = ToolAvailability.getTierRestrictedActions(
          "browse_milestones",
          "premium"
        );
        expect(premiumAndAbove).toContain("burndown");
      });
    });

    describe("isToolAvailable with action", () => {
      beforeEach(() => {
        mockInstance.getInstanceInfo.mockReturnValue({
          version: "18.3.0",
          tier: "free" as GitLabTier,
          features: createFeatures("free"),
          detectedAt: new Date(),
        });
      });

      it("should allow free action on free tier", () => {
        const available = ToolAvailability.isToolAvailable("browse_merge_requests", "list");
        expect(available).toBe(true);
      });

      it("should block premium action on free tier", () => {
        const available = ToolAvailability.isToolAvailable("browse_merge_requests", "approvals");
        expect(available).toBe(false);
      });

      it("should block action when version is too old", () => {
        mockInstance.getInstanceInfo.mockReturnValue({
          version: "7.0.0",
          tier: "ultimate" as GitLabTier,
          features: createFeatures("ultimate"),
          detectedAt: new Date(),
        });

        // browse_merge_requests requires version 8.0+
        const available = ToolAvailability.isToolAvailable("browse_merge_requests", "list");
        expect(available).toBe(false);
      });

      it("should allow action when version meets requirements", () => {
        mockInstance.getInstanceInfo.mockReturnValue({
          version: "18.0.0",
          tier: "premium" as GitLabTier,
          features: createFeatures("premium"),
          detectedAt: new Date(),
        });

        const available = ToolAvailability.isToolAvailable("browse_merge_requests", "approvals");
        expect(available).toBe(true);
      });
    });

    describe("getToolRequirement with action", () => {
      it("should return requirement for tool without action", () => {
        const req = ToolAvailability.getToolRequirement("browse_merge_requests");
        expect(req).toBeDefined();
        expect(req?.requiredTier).toBe("free");
      });

      it("should return action-specific requirement when action specified", () => {
        const req = ToolAvailability.getToolRequirement("browse_merge_requests", "approvals");
        expect(req).toBeDefined();
        expect(req?.requiredTier).toBe("premium");
      });

      it("should return default requirement for action without override", () => {
        const req = ToolAvailability.getToolRequirement("browse_merge_requests", "list");
        expect(req).toBeDefined();
        expect(req?.requiredTier).toBe("free");
      });

      it("should return undefined for unknown tools", () => {
        const req = ToolAvailability.getToolRequirement("completely_unknown_tool_xyz");
        expect(req).toBeUndefined();
      });
    });

    describe("getAvailableTools", () => {
      beforeEach(() => {
        mockInstance.getInstanceInfo.mockReturnValue({
          version: "18.3.0",
          tier: "ultimate" as GitLabTier,
          features: createFeatures("ultimate"),
          detectedAt: new Date(),
        });
      });

      it("should include consolidated tools from actionRequirements", () => {
        const tools = ToolAvailability.getAvailableTools();
        expect(tools).toContain("browse_merge_requests");
        expect(tools).toContain("browse_projects");
        expect(tools).toContain("browse_iterations");
        expect(tools).toContain("manage_project");
      });

      it("should not include duplicate tools", () => {
        const tools = ToolAvailability.getAvailableTools();
        const uniqueTools = new Set(tools);
        expect(tools.length).toBe(uniqueTools.size);
      });
    });
  });

  describe("getRestrictedParameters - Per-parameter tier gating", () => {
    it("should restrict premium parameters on free tier", () => {
      const freeInstanceInfo: GitLabInstanceInfo = {
        version: "17.0.0",
        tier: "free" as GitLabTier,
        features: createFeatures("free"),
        detectedAt: new Date(),
      };
      mockInstance.getInstanceInfo.mockReturnValue(freeInstanceInfo);

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item");

      expect(restricted).toContain("weight");
      expect(restricted).toContain("iterationId");
      expect(restricted).toContain("healthStatus");
    });

    it("should restrict only ultimate parameters on premium tier", () => {
      const premiumInstanceInfo: GitLabInstanceInfo = {
        version: "17.0.0",
        tier: "premium" as GitLabTier,
        features: createFeatures("premium"),
        detectedAt: new Date(),
      };
      mockInstance.getInstanceInfo.mockReturnValue(premiumInstanceInfo);

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item");

      expect(restricted).not.toContain("weight");
      expect(restricted).not.toContain("iterationId");
      expect(restricted).toContain("healthStatus");
    });

    it("should restrict nothing on ultimate tier", () => {
      const ultimateInstanceInfo: GitLabInstanceInfo = {
        version: "17.0.0",
        tier: "ultimate" as GitLabTier,
        features: createFeatures("ultimate"),
        detectedAt: new Date(),
      };
      mockInstance.getInstanceInfo.mockReturnValue(ultimateInstanceInfo);

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item");

      expect(restricted).toHaveLength(0);
    });

    it("should restrict parameters when version is too low", () => {
      const oldInstanceInfo: GitLabInstanceInfo = {
        version: "14.0.0",
        tier: "ultimate" as GitLabTier,
        features: createFeatures("ultimate"),
        detectedAt: new Date(),
      };
      mockInstance.getInstanceInfo.mockReturnValue(oldInstanceInfo);

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item");

      expect(restricted).toContain("weight");
      expect(restricted).toContain("iterationId");
      expect(restricted).toContain("healthStatus");
    });

    it("should return empty array for tools without parameter requirements", () => {
      const freeInstanceInfo: GitLabInstanceInfo = {
        version: "17.0.0",
        tier: "free" as GitLabTier,
        features: createFeatures("free"),
        detectedAt: new Date(),
      };
      mockInstance.getInstanceInfo.mockReturnValue(freeInstanceInfo);

      const restricted = ToolAvailability.getRestrictedParameters("browse_projects");

      expect(restricted).toHaveLength(0);
    });

    it("should return empty array when connection is not initialized", () => {
      mockInstance.getInstanceInfo.mockImplementation(() => {
        throw new Error("Connection not initialized");
      });

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item");

      expect(restricted).toHaveLength(0);
    });

    it("should use cachedInstanceInfo when provided instead of ConnectionManager", () => {
      mockInstance.getInstanceInfo.mockImplementation(() => {
        throw new Error("Should not be called");
      });

      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item", {
        tier: "free",
        version: "17.0.0",
      });

      expect(restricted).toContain("weight");
      expect(restricted).toContain("iterationId");
      expect(restricted).toContain("healthStatus");
      expect(mockInstance.getInstanceInfo).not.toHaveBeenCalled();
    });

    it("should respect tier from cachedInstanceInfo", () => {
      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item", {
        tier: "premium",
        version: "17.0.0",
      });

      expect(restricted).not.toContain("weight");
      expect(restricted).not.toContain("iterationId");
      expect(restricted).toContain("healthStatus");
    });

    it("should respect version from cachedInstanceInfo", () => {
      const restricted = ToolAvailability.getRestrictedParameters("manage_work_item", {
        tier: "ultimate",
        version: "14.0.0",
      });

      expect(restricted).toContain("weight");
      expect(restricted).toContain("iterationId");
      expect(restricted).toContain("healthStatus");
    });
  });
});
