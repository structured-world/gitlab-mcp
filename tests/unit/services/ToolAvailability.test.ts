/**
 * Tool Availability Unit Tests
 * Tests tier-based tool filtering with mocked GitLab instances
 */

import { ToolAvailability } from "../../../src/services/ToolAvailability";
import { ConnectionManager } from "../../../src/services/ConnectionManager";
import { GitLabInstanceInfo, GitLabTier, GitLabFeatures } from "../../../src/services/GitLabVersionDetector";

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
        "search_repositories",
        "get_project",
        "create_branch",
        "get_commit",
        "list_merge_requests",
        "create_merge_request",
        "merge_merge_request",
        "list_work_items",
        "create_work_item",
        "list_milestones",
        "list_pipelines",
        "get_pipeline",
        "list_wiki_pages",
        "create_wiki_page",
      ];

      freeTools.forEach(toolName => {
        expect(ToolAvailability.isToolAvailable(toolName)).toBe(true);
        expect(ToolAvailability.getUnavailableReason(toolName)).toBe(null);
      });
    });

    it("should block premium-only tools", () => {
      // Premium tools will be tested when implemented per WORK.md
      const premiumTools: string[] = [];

      // Premium tools tests will be added when tools are implemented
    });

    it("should block ultimate-only tools", () => {
      // Ultimate tools will be tested when implemented per WORK.md
      const ultimateTools: string[] = [];

      // Ultimate tools tests will be added when tools are implemented
    });

    it("should provide correct tool counts by tier", () => {
      const freeToolCount = ToolAvailability.getToolsByTier("free").length;
      const premiumToolCount = ToolAvailability.getToolsByTier("premium").length;
      const ultimateToolCount = ToolAvailability.getToolsByTier("ultimate").length;

      expect(freeToolCount).toBeGreaterThan(50); // Should have many free tools
      expect(premiumToolCount).toBeGreaterThan(10); // Should have premium tools
      expect(ultimateToolCount).toBeGreaterThan(15); // Should have ultimate tools

      // Log counts for visibility
      console.log(`Free tools: ${freeToolCount}, Premium tools: ${premiumToolCount}, Ultimate tools: ${ultimateToolCount}`);
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
      const freeAndPremiumTools = [
        "list_projects",        // Free
        "merge_merge_request",  // Free
        "add_to_merge_train",   // Premium
        "list_epics",           // Premium
        "create_epic",          // Premium
        "list_iterations",      // Premium
        "get_merge_request_approvals", // Premium
      ];

      freeAndPremiumTools.forEach(toolName => {
        expect(ToolAvailability.isToolAvailable(toolName)).toBe(true);
        expect(ToolAvailability.getUnavailableReason(toolName)).toBe(null);
      });
    });

    it("should still block ultimate-only tools", () => {
      const ultimateTools = [
        "security_dashboard",
        "list_vulnerabilities",
        "compliance_framework",
        "audit_events",
        "list_requirements",
        "run_sast_scan",
        "productivity_analytics",
      ];

      // Ultimate tools tests will be added when tools are implemented
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

    it("should allow all tier tools", () => {
      const allTierTools = [
        "list_projects",        // Free
        "add_to_merge_train",   // Premium
        "security_dashboard",   // Ultimate
        "list_vulnerabilities", // Ultimate
        "compliance_framework", // Ultimate
        "audit_events",         // Ultimate
        "list_requirements",    // Ultimate
        "run_sast_scan",        // Ultimate
      ];

      allTierTools.forEach(toolName => {
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
          workItems: false, // Not available in 10.0
          epics: false,     // Not available in 10.0
        },
        detectedAt: new Date(),
      };

      mockInstance.getInstanceInfo.mockReturnValue(oldInstanceInfo);

      // Work Items require 15.0+
      expect(ToolAvailability.isToolAvailable("list_work_items")).toBe(false);
      const reason = ToolAvailability.getUnavailableReason("list_work_items");
      expect(reason?.toLowerCase()).toContain("version");

      // But basic tools from 8.0 should work
      expect(ToolAvailability.isToolAvailable("list_projects")).toBe(true);
      expect(ToolAvailability.isToolAvailable("get_project")).toBe(true);
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
      expect(ToolAvailability.isToolAvailable("list_work_items")).toBe(true);
      expect(ToolAvailability.isToolAvailable("create_work_item")).toBe(true);

      // But premium features should still be blocked
      expect(ToolAvailability.isToolAvailable("list_epics")).toBe(false);
      expect(ToolAvailability.getUnavailableReason("list_epics")).toContain("premium tier");
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

      expect(ToolAvailability.isToolAvailable("list_projects")).toBe(false);
      expect(ToolAvailability.getUnavailableReason("list_projects")).toContain("GitLab connection not initialized");
    });
  });
});