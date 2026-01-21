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
      expect(TIER_FEATURES.group_webhooks).toBeDefined();
      expect(TIER_FEATURES.group_webhooks.tier).toBe("Premium");
      expect(TIER_FEATURES.epics).toBeDefined();
      expect(TIER_FEATURES.epics.tier).toBe("Premium");
      expect(TIER_FEATURES.iterations).toBeDefined();
      expect(TIER_FEATURES.iterations.tier).toBe("Premium");
    });

    it("should have docs URLs for all features", () => {
      for (const feature of Object.values(TIER_FEATURES)) {
        expect(feature.docs).toBeDefined();
        expect(feature.docs).toContain("https://");
      }
    });

    it("should have tools array for all features", () => {
      for (const feature of Object.values(TIER_FEATURES)) {
        expect(Array.isArray(feature.tools)).toBe(true);
        expect(feature.tools.length).toBeGreaterThan(0);
      }
    });

    it("should have valid tier values", () => {
      const validTiers: GitLabTier[] = ["Free", "Premium", "Ultimate"];
      for (const feature of Object.values(TIER_FEATURES)) {
        expect(validTiers).toContain(feature.tier);
      }
    });
  });

  describe("findTierFeature", () => {
    it("should find feature by tool name", () => {
      const feature = findTierFeature("list_group_iterations");
      expect(feature).not.toBeNull();
      expect(feature?.name).toBe("Iterations");
      expect(feature?.tier).toBe("Premium");
    });

    it("should find feature by tool:action", () => {
      const feature = findTierFeature("list_webhooks", "group");
      expect(feature).not.toBeNull();
      expect(feature?.name).toBe("Group Webhooks");
    });

    it("should find epic feature by tool:action", () => {
      const feature = findTierFeature("browse_work_items", "epic");
      expect(feature).not.toBeNull();
      expect(feature?.name).toBe("Epics");
      expect(feature?.tier).toBe("Premium");
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
      // browse_work_items:epic is in the list, so it should match
      const featureWithAction = findTierFeature("browse_work_items", "epic");
      // browse_work_items alone is not tier-restricted
      const featureWithoutAction = findTierFeature("browse_work_items");

      expect(featureWithAction).not.toBeNull();
      expect(featureWithoutAction).toBeNull();
    });
  });

  describe("getRequiredTier", () => {
    it("should return Premium for Premium features", () => {
      expect(getRequiredTier("list_group_iterations")).toBe("Premium");
    });

    it("should return Premium for group webhooks", () => {
      expect(getRequiredTier("list_webhooks", "group")).toBe("Premium");
      expect(getRequiredTier("manage_webhook", "group")).toBe("Premium");
    });

    it("should return Free for tools not in the map", () => {
      expect(getRequiredTier("browse_merge_requests")).toBe("Free");
      expect(getRequiredTier("unknown_tool")).toBe("Free");
    });

    it("should check tool:action combination", () => {
      expect(getRequiredTier("browse_work_items", "epic")).toBe("Premium");
      expect(getRequiredTier("browse_work_items", "issue")).toBe("Free");
    });
  });

  describe("getFeatureDocsUrl", () => {
    it("should return specific docs URL for known features", () => {
      const url = getFeatureDocsUrl("list_group_iterations");
      expect(url).toBe("https://docs.gitlab.com/ee/user/group/iterations/");
    });

    it("should return generic docs URL for unknown features", () => {
      const url = getFeatureDocsUrl("unknown_tool");
      expect(url).toBe("https://docs.gitlab.com/ee/api/");
    });

    it("should check tool:action combination for docs URL", () => {
      const url = getFeatureDocsUrl("browse_work_items", "epic");
      expect(url).toContain("epics");
    });
  });

  describe("alternatives", () => {
    it("should provide alternatives for Premium features", () => {
      const feature = TIER_FEATURES.group_webhooks;
      expect(feature.alternatives).toBeDefined();
      expect(feature.alternatives!.length).toBeGreaterThan(0);

      // Check alternative structure
      const alt = feature.alternatives![0];
      expect(alt.action).toBeDefined();
      expect(alt.description).toBeDefined();
      expect(alt.availableOn).toBeDefined();
    });

    it("should have Free tier alternatives for Premium features", () => {
      const feature = TIER_FEATURES.group_webhooks;
      const freeAlternatives = feature.alternatives?.filter(a => a.availableOn === "Free");
      expect(freeAlternatives?.length).toBeGreaterThan(0);
    });

    it("should provide alternatives for epics feature", () => {
      const feature = TIER_FEATURES.epics;
      expect(feature.alternatives).toBeDefined();
      expect(feature.alternatives!.length).toBeGreaterThan(0);

      // Should have Free alternative
      const hasFree = feature.alternatives?.some(a => a.availableOn === "Free");
      expect(hasFree).toBe(true);
    });
  });
});
