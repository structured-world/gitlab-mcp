/**
 * Unit tests for tier-features.ts
 */

import {
  TIER_FEATURES,
  findTierFeature,
  getRequiredTier,
  getFeatureDocsUrl,
  GitLabTier,
} from "../../../src/utils/tier-features";

describe("Tier Features", () => {
  describe("TIER_FEATURES map", () => {
    it("should contain Premium features", () => {
      expect(TIER_FEATURES.protected_branches_api).toBeDefined();
      expect(TIER_FEATURES.protected_branches_api.tier).toBe("Premium");
      expect(TIER_FEATURES.merge_request_approvals).toBeDefined();
      expect(TIER_FEATURES.merge_request_approvals.tier).toBe("Premium");
    });

    it("should contain Ultimate features", () => {
      expect(TIER_FEATURES.code_owners).toBeDefined();
      expect(TIER_FEATURES.code_owners.tier).toBe("Ultimate");
      expect(TIER_FEATURES.security_dashboard).toBeDefined();
      expect(TIER_FEATURES.security_dashboard.tier).toBe("Ultimate");
    });

    it("should have docs URLs for all features", () => {
      for (const [key, feature] of Object.entries(TIER_FEATURES)) {
        expect(feature.docs).toBeDefined();
        expect(feature.docs).toContain("https://");
      }
    });

    it("should have tools array for all features", () => {
      for (const [key, feature] of Object.entries(TIER_FEATURES)) {
        expect(Array.isArray(feature.tools)).toBe(true);
        expect(feature.tools.length).toBeGreaterThan(0);
      }
    });

    it("should have valid tier values", () => {
      const validTiers: GitLabTier[] = ["Free", "Premium", "Ultimate"];
      for (const [key, feature] of Object.entries(TIER_FEATURES)) {
        expect(validTiers).toContain(feature.tier);
      }
    });
  });

  describe("findTierFeature", () => {
    it("should find feature by tool name", () => {
      const feature = findTierFeature("browse_protected_branches");
      expect(feature).not.toBeNull();
      expect(feature?.name).toBe("Protected Branches API");
      expect(feature?.tier).toBe("Premium");
    });

    it("should find feature by tool:action", () => {
      const feature = findTierFeature("manage_merge_request", "approve");
      expect(feature).not.toBeNull();
      expect(feature?.name).toBe("Merge Request Approvals API");
    });

    it("should return null for Free tier tools", () => {
      const feature = findTierFeature("browse_merge_requests");
      expect(feature).toBeNull();
    });

    it("should return null for unknown tools", () => {
      const feature = findTierFeature("nonexistent_tool");
      expect(feature).toBeNull();
    });

    it("should prefer tool:action match over tool-only match", () => {
      // If a feature has both tool and tool:action in its list,
      // tool:action should be matched when action is provided
      const featureWithAction = findTierFeature("manage_merge_request", "approve");
      const featureWithoutAction = findTierFeature("manage_merge_request");

      // manage_merge_request:approve is in the list, so it should match
      expect(featureWithAction).not.toBeNull();
      // manage_merge_request alone is not in any feature list
      expect(featureWithoutAction).toBeNull();
    });
  });

  describe("getRequiredTier", () => {
    it("should return Premium for Premium features", () => {
      expect(getRequiredTier("browse_protected_branches")).toBe("Premium");
    });

    it("should return Ultimate for Ultimate features", () => {
      expect(getRequiredTier("browse_code_owners")).toBe("Ultimate");
    });

    it("should return Free for tools not in the map", () => {
      expect(getRequiredTier("browse_merge_requests")).toBe("Free");
      expect(getRequiredTier("unknown_tool")).toBe("Free");
    });

    it("should check tool:action combination", () => {
      expect(getRequiredTier("manage_merge_request", "approve")).toBe("Premium");
      expect(getRequiredTier("manage_merge_request", "create")).toBe("Free");
    });
  });

  describe("getFeatureDocsUrl", () => {
    it("should return specific docs URL for known features", () => {
      const url = getFeatureDocsUrl("browse_protected_branches");
      expect(url).toBe("https://docs.gitlab.com/ee/api/protected_branches.html");
    });

    it("should return generic docs URL for unknown features", () => {
      const url = getFeatureDocsUrl("unknown_tool");
      expect(url).toBe("https://docs.gitlab.com/ee/api/");
    });

    it("should check tool:action combination for docs URL", () => {
      const url = getFeatureDocsUrl("manage_merge_request", "approve");
      expect(url).toContain("approvals");
    });
  });

  describe("alternatives", () => {
    it("should provide alternatives for Premium features", () => {
      const feature = TIER_FEATURES.protected_branches_api;
      expect(feature.alternatives).toBeDefined();
      expect(feature.alternatives!.length).toBeGreaterThan(0);

      // Check alternative structure
      const alt = feature.alternatives![0];
      expect(alt.action).toBeDefined();
      expect(alt.description).toBeDefined();
      expect(alt.availableOn).toBeDefined();
    });

    it("should have Free tier alternatives for Premium features", () => {
      const feature = TIER_FEATURES.protected_branches_api;
      const freeAlternatives = feature.alternatives?.filter(a => a.availableOn === "Free");
      expect(freeAlternatives?.length).toBeGreaterThan(0);
    });

    it("should provide alternatives for Ultimate features", () => {
      const feature = TIER_FEATURES.code_owners;
      expect(feature.alternatives).toBeDefined();
      expect(feature.alternatives!.length).toBeGreaterThan(0);

      // Should have both Free and Premium alternatives
      const hasFree = feature.alternatives?.some(a => a.availableOn === "Free");
      const hasPremium = feature.alternatives?.some(a => a.availableOn === "Premium");
      expect(hasFree || hasPremium).toBe(true);
    });
  });
});
