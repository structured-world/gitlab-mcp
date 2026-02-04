/**
 * Namespace Tier Detector
 *
 * Detects GitLab tier (free/premium/ultimate) per namespace.
 * CRITICAL: Tier is per-NAMESPACE, not per-instance!
 * On gitlab.com, one user can access Free group and Ultimate group simultaneously.
 *
 * Features:
 * - Per-session namespace tier caching (5 min TTL)
 * - GraphQL query for namespace tier detection
 * - Feature availability mapping per tier
 */

import { logDebug, logWarn } from "../logger.js";
import { NamespaceTierInfo } from "../oauth/types.js";
import { getTokenContext } from "../oauth/token-context.js";
import { enhancedFetch } from "../utils/fetch.js";
import { GITLAB_BASE_URL } from "../config";

/**
 * Cache TTL for namespace tier (5 minutes)
 */
const NAMESPACE_TIER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory namespace tier cache
 * Key: `${sessionId}:${namespacePath}`
 */
const namespaceTierCache = new Map<string, NamespaceTierInfo>();

/**
 * GraphQL query to get namespace tier
 */
const NAMESPACE_TIER_QUERY = `
  query GetNamespaceTier($fullPath: ID!) {
    namespace(fullPath: $fullPath) {
      id
      fullPath

      ... on Group {
        plan
      }

      ... on Project {
        group {
          plan
        }
      }
    }
  }
`;

/**
 * Feature availability per tier
 */
const TIER_FEATURES: Record<string, Record<string, boolean>> = {
  free: {
    issues: true,
    mergeRequests: true,
    wiki: true,
    snippets: true,
    epics: false,
    iterations: false,
    roadmaps: false,
    okrs: false,
    healthStatus: false,
    weight: false,
    multiLevelEpics: false,
    portfolioManagement: false,
    requirements: false,
    securityDashboard: false,
    complianceFramework: false,
  },
  premium: {
    issues: true,
    mergeRequests: true,
    wiki: true,
    snippets: true,
    epics: true,
    iterations: true,
    roadmaps: true,
    okrs: false,
    healthStatus: true,
    weight: true,
    multiLevelEpics: true,
    portfolioManagement: true,
    requirements: true,
    securityDashboard: false,
    complianceFramework: true,
  },
  ultimate: {
    issues: true,
    mergeRequests: true,
    wiki: true,
    snippets: true,
    epics: true,
    iterations: true,
    roadmaps: true,
    okrs: true,
    healthStatus: true,
    weight: true,
    multiLevelEpics: true,
    portfolioManagement: true,
    requirements: true,
    securityDashboard: true,
    complianceFramework: true,
  },
};

/**
 * Normalize plan name to tier
 */
function normalizeTier(plan: string | null | undefined): "free" | "premium" | "ultimate" {
  if (!plan) return "free";

  const normalized = plan.toLowerCase();

  if (normalized.includes("ultimate") || normalized.includes("gold")) {
    return "ultimate";
  }
  if (normalized.includes("premium") || normalized.includes("silver")) {
    return "premium";
  }
  if (normalized.includes("bronze") || normalized.includes("starter")) {
    return "premium"; // Bronze/Starter maps to Premium tier features
  }

  return "free";
}

/**
 * Get features for a tier
 */
export function getFeaturesForTier(tier: "free" | "premium" | "ultimate"): Record<string, boolean> {
  return { ...TIER_FEATURES[tier] };
}

/**
 * Build cache key from session ID and namespace path
 */
function buildCacheKey(sessionId: string, namespacePath: string): string {
  return `${sessionId}:${namespacePath}`;
}

/**
 * Get cached namespace tier info
 */
function getCachedTier(sessionId: string, namespacePath: string): NamespaceTierInfo | null {
  const key = buildCacheKey(sessionId, namespacePath);
  const cached = namespaceTierCache.get(key);

  if (!cached) return null;

  // Check TTL
  const age = Date.now() - cached.cachedAt.getTime();
  if (age > NAMESPACE_TIER_CACHE_TTL_MS) {
    namespaceTierCache.delete(key);
    logDebug("Namespace tier cache expired", {
      sessionId,
      namespacePath,
      ageMs: age,
    });
    return null;
  }

  return cached;
}

/**
 * Set cached namespace tier info
 */
function setCachedTier(
  sessionId: string,
  namespacePath: string,
  tierInfo: NamespaceTierInfo
): void {
  const key = buildCacheKey(sessionId, namespacePath);
  namespaceTierCache.set(key, tierInfo);

  logDebug("Namespace tier cached", {
    sessionId,
    namespacePath,
    tier: tierInfo.tier,
  });
}

/**
 * Clear namespace tier cache for a session
 * Called when user switches instances or session expires
 */
export function clearNamespaceTierCache(sessionId?: string): void {
  if (sessionId) {
    // Clear only for specific session
    const prefix = `${sessionId}:`;
    for (const key of namespaceTierCache.keys()) {
      if (key.startsWith(prefix)) {
        namespaceTierCache.delete(key);
      }
    }
    logDebug("Namespace tier cache cleared for session", { sessionId });
  } else {
    // Clear entire cache
    namespaceTierCache.clear();
    logDebug("All namespace tier caches cleared");
  }
}

/**
 * Query GitLab for namespace tier via GraphQL
 */
async function queryNamespaceTier(
  namespacePath: string,
  token: string,
  baseUrl: string
): Promise<NamespaceTierInfo> {
  const graphqlUrl = `${baseUrl}/api/graphql`;

  try {
    const response = await enhancedFetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: NAMESPACE_TIER_QUERY,
        variables: { fullPath: namespacePath },
      }),
    });

    if (!response.ok) {
      logWarn("Failed to query namespace tier", {
        namespacePath,
        status: response.status,
      });
      // Return free tier as fallback
      return {
        tier: "free",
        features: getFeaturesForTier("free"),
        cachedAt: new Date(),
      };
    }

    const result = (await response.json()) as {
      data?: {
        namespace?: {
          plan?: string;
          group?: { plan?: string };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (result.errors?.length) {
      logWarn("GraphQL errors querying namespace tier", {
        namespacePath,
        errors: result.errors.map(e => e.message),
      });
    }

    // Extract plan from response
    const namespace = result.data?.namespace;
    const plan = namespace?.plan ?? namespace?.group?.plan ?? null;
    const tier = normalizeTier(plan);

    return {
      tier,
      features: getFeaturesForTier(tier),
      cachedAt: new Date(),
    };
  } catch (error) {
    logWarn("Error querying namespace tier", {
      namespacePath,
      err: error instanceof Error ? error : new Error(String(error)),
    });

    // Return free tier as fallback
    return {
      tier: "free",
      features: getFeaturesForTier("free"),
      cachedAt: new Date(),
    };
  }
}

/**
 * Get namespace tier with caching
 * Uses current token context for session ID and token
 *
 * @param namespacePath - Full path of the namespace (e.g., "gitlab-org" or "gitlab-org/gitlab")
 * @returns Namespace tier info with features
 */
export async function getNamespaceTier(namespacePath: string): Promise<NamespaceTierInfo> {
  const context = getTokenContext();

  if (!context) {
    logWarn("No token context available for namespace tier detection");
    return {
      tier: "free",
      features: getFeaturesForTier("free"),
      cachedAt: new Date(),
    };
  }

  const { sessionId, gitlabToken, apiUrl } = context;
  const baseUrl = apiUrl || GITLAB_BASE_URL;

  if (!baseUrl) {
    logWarn("No base URL available for namespace tier detection");
    return {
      tier: "free",
      features: getFeaturesForTier("free"),
      cachedAt: new Date(),
    };
  }

  // Check cache first
  const cached = getCachedTier(sessionId, namespacePath);
  if (cached) {
    logDebug("Namespace tier from cache", {
      namespacePath,
      tier: cached.tier,
    });
    return cached;
  }

  // Query GitLab
  const tierInfo = await queryNamespaceTier(namespacePath, gitlabToken, baseUrl);

  // Cache result
  setCachedTier(sessionId, namespacePath, tierInfo);

  return tierInfo;
}

/**
 * Check if a feature is available for a namespace
 *
 * @param namespacePath - Full path of the namespace
 * @param feature - Feature name to check
 * @returns true if feature is available
 */
export async function isFeatureAvailable(namespacePath: string, feature: string): Promise<boolean> {
  const tierInfo = await getNamespaceTier(namespacePath);
  return tierInfo.features[feature] ?? false;
}

/**
 * Get namespace tier metrics (for monitoring)
 */
export function getNamespaceTierCacheMetrics(): {
  totalEntries: number;
  entriesBySession: Map<string, number>;
} {
  const entriesBySession = new Map<string, number>();

  for (const key of namespaceTierCache.keys()) {
    const sessionId = key.split(":")[0];
    entriesBySession.set(sessionId, (entriesBySession.get(sessionId) ?? 0) + 1);
  }

  return {
    totalEntries: namespaceTierCache.size,
    entriesBySession,
  };
}
