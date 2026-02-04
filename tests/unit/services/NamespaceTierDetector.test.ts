/**
 * Unit tests for NamespaceTierDetector
 *
 * Tests namespace tier detection, caching, and feature availability mapping.
 * Mocks external dependencies (token context, fetch) for isolated unit testing.
 */

import {
  getFeaturesForTier,
  clearNamespaceTierCache,
  getNamespaceTier,
  isFeatureAvailable,
  getNamespaceTierCacheMetrics,
} from "../../../src/services/NamespaceTierDetector";
import * as tokenContext from "../../../src/oauth/token-context";
import * as fetchUtils from "../../../src/utils/fetch";

// Mock dependencies
jest.mock("../../../src/oauth/token-context");
jest.mock("../../../src/utils/fetch");
jest.mock("../../../src/logger", () => ({
  logDebug: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));
jest.mock("../../../src/config", () => ({
  GITLAB_BASE_URL: "https://gitlab.com",
}));

const mockedGetTokenContext = tokenContext.getTokenContext as jest.MockedFunction<
  typeof tokenContext.getTokenContext
>;
const mockedEnhancedFetch = fetchUtils.enhancedFetch as jest.MockedFunction<
  typeof fetchUtils.enhancedFetch
>;

describe("NamespaceTierDetector", () => {
  beforeEach(() => {
    // Clear all mocks and cache before each test
    jest.clearAllMocks();
    clearNamespaceTierCache();
  });

  describe("getFeaturesForTier", () => {
    // Tests feature availability mapping for each tier level

    it("should return correct features for free tier", () => {
      const features = getFeaturesForTier("free");

      // Free tier has basic features
      expect(features.issues).toBe(true);
      expect(features.mergeRequests).toBe(true);
      expect(features.wiki).toBe(true);
      expect(features.snippets).toBe(true);

      // Free tier lacks premium features
      expect(features.epics).toBe(false);
      expect(features.iterations).toBe(false);
      expect(features.roadmaps).toBe(false);
      expect(features.healthStatus).toBe(false);
      expect(features.weight).toBe(false);
      expect(features.requirements).toBe(false);

      // Free tier lacks ultimate features
      expect(features.okrs).toBe(false);
      expect(features.securityDashboard).toBe(false);
    });

    it("should return correct features for premium tier", () => {
      const features = getFeaturesForTier("premium");

      // Premium has all free features
      expect(features.issues).toBe(true);
      expect(features.mergeRequests).toBe(true);
      expect(features.wiki).toBe(true);

      // Premium has additional planning features
      expect(features.epics).toBe(true);
      expect(features.iterations).toBe(true);
      expect(features.roadmaps).toBe(true);
      expect(features.healthStatus).toBe(true);
      expect(features.weight).toBe(true);
      expect(features.multiLevelEpics).toBe(true);
      expect(features.portfolioManagement).toBe(true);
      expect(features.requirements).toBe(true);
      expect(features.complianceFramework).toBe(true);

      // Premium lacks ultimate-only features
      expect(features.okrs).toBe(false);
      expect(features.securityDashboard).toBe(false);
    });

    it("should return correct features for ultimate tier", () => {
      const features = getFeaturesForTier("ultimate");

      // Ultimate has all features enabled
      expect(features.issues).toBe(true);
      expect(features.mergeRequests).toBe(true);
      expect(features.wiki).toBe(true);
      expect(features.epics).toBe(true);
      expect(features.iterations).toBe(true);
      expect(features.roadmaps).toBe(true);
      expect(features.okrs).toBe(true);
      expect(features.healthStatus).toBe(true);
      expect(features.weight).toBe(true);
      expect(features.multiLevelEpics).toBe(true);
      expect(features.portfolioManagement).toBe(true);
      expect(features.requirements).toBe(true);
      expect(features.securityDashboard).toBe(true);
      expect(features.complianceFramework).toBe(true);
    });

    it("should return a copy of features (not a reference)", () => {
      // Verify immutability - modifying returned object should not affect internal state
      const features1 = getFeaturesForTier("free");
      features1.issues = false; // Modify returned object

      const features2 = getFeaturesForTier("free");
      expect(features2.issues).toBe(true); // Original should be unchanged
    });
  });

  describe("clearNamespaceTierCache", () => {
    // Tests cache clearing functionality for session-specific and global clearing

    it("should clear cache for specific session", async () => {
      // Setup: Create entries for two sessions
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "token-1",
        gitlabUserId: 1,
        gitlabUsername: "user1",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "ultimate" } },
        }),
      } as Response);

      await getNamespaceTier("namespace-a");
      await getNamespaceTier("namespace-b");

      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-2",
        gitlabToken: "token-2",
        gitlabUserId: 2,
        gitlabUsername: "user2",
        apiUrl: "https://gitlab.com",
      });

      await getNamespaceTier("namespace-c");

      // Verify initial state
      let metrics = getNamespaceTierCacheMetrics();
      expect(metrics.totalEntries).toBe(3);
      expect(metrics.entriesBySession.get("session-1")).toBe(2);
      expect(metrics.entriesBySession.get("session-2")).toBe(1);

      // Clear only session-1
      clearNamespaceTierCache("session-1");

      // Verify session-1 entries cleared, session-2 remains
      metrics = getNamespaceTierCacheMetrics();
      expect(metrics.totalEntries).toBe(1);
      expect(metrics.entriesBySession.get("session-1")).toBeUndefined();
      expect(metrics.entriesBySession.get("session-2")).toBe(1);
    });

    it("should clear all cache when no session specified", async () => {
      // Setup: Create entries for multiple sessions
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "token-1",
        gitlabUserId: 1,
        gitlabUsername: "user1",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "premium" } },
        }),
      } as Response);

      await getNamespaceTier("namespace-a");

      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-2",
        gitlabToken: "token-2",
        gitlabUserId: 2,
        gitlabUsername: "user2",
        apiUrl: "https://gitlab.com",
      });

      await getNamespaceTier("namespace-b");

      // Verify entries exist
      expect(getNamespaceTierCacheMetrics().totalEntries).toBe(2);

      // Clear all
      clearNamespaceTierCache();

      // Verify all cleared
      expect(getNamespaceTierCacheMetrics().totalEntries).toBe(0);
    });
  });

  describe("getNamespaceTier", () => {
    // Tests tier detection from GraphQL API with caching behavior

    it("should return free tier when no token context available", async () => {
      // Tests fallback behavior when OAuth context is not set
      mockedGetTokenContext.mockReturnValue(undefined);

      const result = await getNamespaceTier("some-namespace");

      expect(result.tier).toBe("free");
      expect(result.features.epics).toBe(false);
      expect(result.cachedAt).toBeInstanceOf(Date);

      // Should not make API call
      expect(mockedEnhancedFetch).not.toHaveBeenCalled();
    });

    it("should use context apiUrl when available", async () => {
      // Tests that apiUrl from context is used for GraphQL endpoint
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "token",
        gitlabUserId: 1,
        gitlabUsername: "user",
        apiUrl: "https://custom-gitlab.example.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "premium" } },
        }),
      } as Response);

      await getNamespaceTier("some-namespace");

      // Verify custom URL was used
      expect(mockedEnhancedFetch).toHaveBeenCalledWith(
        "https://custom-gitlab.example.com/api/graphql",
        expect.anything()
      );
    });

    it("should query GraphQL and return correct tier for group namespace", async () => {
      // Tests tier detection for a group with "ultimate" plan
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.example.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            namespace: {
              id: "gid://gitlab/Group/1",
              fullPath: "my-group",
              plan: "ultimate",
            },
          },
        }),
      } as Response);

      const result = await getNamespaceTier("my-group");

      expect(result.tier).toBe("ultimate");
      expect(result.features.okrs).toBe(true);
      expect(result.features.securityDashboard).toBe(true);
      expect(result.cachedAt).toBeInstanceOf(Date);

      // Verify GraphQL call
      expect(mockedEnhancedFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/graphql",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("should query GraphQL and return correct tier for project namespace", async () => {
      // Tests tier detection for a project (uses group.plan from parent group)
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            namespace: {
              id: "gid://gitlab/Project/42",
              fullPath: "my-group/my-project",
              group: {
                plan: "premium",
              },
            },
          },
        }),
      } as Response);

      const result = await getNamespaceTier("my-group/my-project");

      expect(result.tier).toBe("premium");
      expect(result.features.epics).toBe(true);
      expect(result.features.okrs).toBe(false); // Premium doesn't have OKRs
    });

    it("should use cached result on subsequent calls", async () => {
      // Tests that caching works - second call should not trigger API request
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "premium" } },
        }),
      } as Response);

      // First call - should hit API
      const result1 = await getNamespaceTier("cached-namespace");
      expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await getNamespaceTier("cached-namespace");
      expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1); // Still 1, no new call

      // Results should be identical
      expect(result1.tier).toBe(result2.tier);
      expect(result1.cachedAt.getTime()).toBe(result2.cachedAt.getTime());
    });

    it("should expire cache after TTL (5 minutes)", async () => {
      // Tests that cache entries are invalidated after TTL expires
      jest.useFakeTimers();

      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-ttl",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "ultimate" } },
        }),
      } as Response);

      // First call - caches the result
      await getNamespaceTier("ttl-test-namespace");
      expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1);

      // Advance time by 4 minutes - cache should still be valid
      jest.advanceTimersByTime(4 * 60 * 1000);
      await getNamespaceTier("ttl-test-namespace");
      expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1); // Still cached

      // Advance time past 5 minute TTL (total 6 minutes)
      jest.advanceTimersByTime(2 * 60 * 1000);

      // This call should trigger a new API request because cache expired
      await getNamespaceTier("ttl-test-namespace");
      expect(mockedEnhancedFetch).toHaveBeenCalledTimes(2); // New call after expiry

      jest.useRealTimers();
    });

    it("should return free tier on API error", async () => {
      // Tests graceful degradation when API call fails
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const result = await getNamespaceTier("error-namespace");

      expect(result.tier).toBe("free");
      expect(result.features.epics).toBe(false);
    });

    it("should return free tier on network error", async () => {
      // Tests graceful degradation on network failures
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockRejectedValue(new Error("Network error"));

      const result = await getNamespaceTier("network-error-namespace");

      expect(result.tier).toBe("free");
    });

    it("should return free tier on GraphQL errors", async () => {
      // Tests handling of GraphQL-level errors in response
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [{ message: "Namespace not found" }],
          data: { namespace: null },
        }),
      } as Response);

      const result = await getNamespaceTier("nonexistent-namespace");

      // When namespace not found, returns free tier
      expect(result.tier).toBe("free");
    });

    it("should normalize plan names correctly", async () => {
      // Tests normalization of legacy plan names (gold, silver, bronze)
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      // Test "gold" -> "ultimate"
      mockedEnhancedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "gold" } },
        }),
      } as Response);

      let result = await getNamespaceTier("gold-plan-group");
      expect(result.tier).toBe("ultimate");

      // Clear cache for next test
      clearNamespaceTierCache();

      // Test "silver" -> "premium"
      mockedEnhancedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "silver" } },
        }),
      } as Response);

      result = await getNamespaceTier("silver-plan-group");
      expect(result.tier).toBe("premium");

      clearNamespaceTierCache();

      // Test "bronze" -> "premium" (bronze/starter maps to premium features)
      mockedEnhancedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "bronze" } },
        }),
      } as Response);

      result = await getNamespaceTier("bronze-plan-group");
      expect(result.tier).toBe("premium");

      clearNamespaceTierCache();

      // Test "starter" -> "premium"
      mockedEnhancedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "starter" } },
        }),
      } as Response);

      result = await getNamespaceTier("starter-plan-group");
      expect(result.tier).toBe("premium");
    });

    it("should return free tier for null/undefined plan", async () => {
      // Tests handling of namespaces without a plan
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: null } },
        }),
      } as Response);

      const result = await getNamespaceTier("no-plan-namespace");
      expect(result.tier).toBe("free");
    });
  });

  describe("getNamespaceTier with empty base URL", () => {
    // Isolated tests for empty base URL scenario
    it("should return free tier when both apiUrl and GITLAB_BASE_URL are empty", async () => {
      // Use isolateModules to test with different config
      await jest.isolateModulesAsync(async () => {
        // Mock config with empty GITLAB_BASE_URL
        jest.doMock("../../../src/config", () => ({
          GITLAB_BASE_URL: "",
        }));
        jest.doMock("../../../src/logger", () => ({
          logDebug: jest.fn(),
          logWarn: jest.fn(),
          logError: jest.fn(),
          logInfo: jest.fn(),
        }));
        jest.doMock("../../../src/utils/fetch", () => ({
          enhancedFetch: jest.fn(),
        }));
        jest.doMock("../../../src/oauth/token-context", () => ({
          getTokenContext: jest.fn().mockReturnValue({
            sessionId: "session-empty-url",
            gitlabToken: "token",
            gitlabUserId: 1,
            gitlabUsername: "user",
            apiUrl: "", // Empty apiUrl
          }),
        }));

        // Import fresh module with new mocks
        const { getNamespaceTier: getNamespaceTierFresh } =
          await import("../../../src/services/NamespaceTierDetector");

        const result = await getNamespaceTierFresh("test-namespace");
        expect(result.tier).toBe("free");
      });
    });
  });

  describe("isFeatureAvailable", () => {
    // Tests feature availability checking for specific namespaces

    it("should return true for available features", async () => {
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-1",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "ultimate" } },
        }),
      } as Response);

      // Ultimate tier should have OKRs
      const hasOkrs = await isFeatureAvailable("ultimate-group", "okrs");
      expect(hasOkrs).toBe(true);

      // Ultimate tier should have security dashboard
      const hasSecDash = await isFeatureAvailable("ultimate-group", "securityDashboard");
      expect(hasSecDash).toBe(true);
    });

    it("should return false for unavailable features", async () => {
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-2",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "free" } },
        }),
      } as Response);

      // Free tier should not have epics
      const hasEpics = await isFeatureAvailable("free-group", "epics");
      expect(hasEpics).toBe(false);

      // Free tier should not have OKRs
      const hasOkrs = await isFeatureAvailable("free-group", "okrs");
      expect(hasOkrs).toBe(false);
    });

    it("should return false for unknown features", async () => {
      // Tests that unknown feature names return false (safe default)
      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-3",
        gitlabToken: "test-token",
        gitlabUserId: 123,
        gitlabUsername: "testuser",
        apiUrl: "https://gitlab.com",
      });

      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "ultimate" } },
        }),
      } as Response);

      // Even ultimate tier returns false for unknown features
      const hasUnknown = await isFeatureAvailable("any-group", "nonExistentFeature");
      expect(hasUnknown).toBe(false);
    });
  });

  describe("getNamespaceTierCacheMetrics", () => {
    // Tests cache metrics reporting

    it("should return empty metrics for empty cache", () => {
      const metrics = getNamespaceTierCacheMetrics();

      expect(metrics.totalEntries).toBe(0);
      expect(metrics.entriesBySession.size).toBe(0);
    });

    it("should return correct metrics for populated cache", async () => {
      // Setup: Add entries from multiple sessions
      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "premium" } },
        }),
      } as Response);

      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-a",
        gitlabToken: "token-a",
        gitlabUserId: 1,
        gitlabUsername: "user-a",
        apiUrl: "https://gitlab.com",
      });

      await getNamespaceTier("ns1");
      await getNamespaceTier("ns2");
      await getNamespaceTier("ns3");

      mockedGetTokenContext.mockReturnValue({
        sessionId: "session-b",
        gitlabToken: "token-b",
        gitlabUserId: 2,
        gitlabUsername: "user-b",
        apiUrl: "https://gitlab.com",
      });

      await getNamespaceTier("ns4");
      await getNamespaceTier("ns5");

      // Verify metrics
      const metrics = getNamespaceTierCacheMetrics();
      expect(metrics.totalEntries).toBe(5);
      expect(metrics.entriesBySession.get("session-a")).toBe(3);
      expect(metrics.entriesBySession.get("session-b")).toBe(2);
    });

    it("should correctly count entries by session ID", async () => {
      // Tests that sessionId is correctly extracted from cache keys
      mockedEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { namespace: { plan: "free" } },
        }),
      } as Response);

      mockedGetTokenContext.mockReturnValue({
        sessionId: "complex-session-id-with-colons:and:special:chars",
        gitlabToken: "token",
        gitlabUserId: 1,
        gitlabUsername: "user",
        apiUrl: "https://gitlab.com",
      });

      await getNamespaceTier("test-namespace");

      const metrics = getNamespaceTierCacheMetrics();
      // Session ID extraction uses first colon as delimiter
      // Key format: `${sessionId}:${namespacePath}`
      // With sessionId "complex-session-id-with-colons:and:special:chars" and namespace "test-namespace"
      // The key is "complex-session-id-with-colons:and:special:chars:test-namespace"
      // split(":")[0] gives "complex-session-id-with-colons"
      expect(metrics.totalEntries).toBe(1);
    });
  });
});
