import { GraphQLClient } from "../graphql/client";
import { gql } from "graphql-tag";
import { enhancedFetch } from "../utils/fetch";
import { logger } from "../logger";
import { parseVersion } from "../utils/version";

export type GitLabTier = "free" | "premium" | "ultimate";

export interface GitLabFeatures {
  // Core features
  workItems: boolean;
  epics: boolean;
  iterations: boolean;
  roadmaps: boolean;
  portfolioManagement: boolean;
  advancedSearch: boolean;
  codeReview: boolean;
  securityDashboard: boolean;
  complianceFramework: boolean;
  valueStreamAnalytics: boolean;
  customFields: boolean;
  okrs: boolean;
  healthStatus: boolean;
  weight: boolean;
  multiLevelEpics: boolean;
  serviceDesk: boolean;
  requirements: boolean;
  qualityManagement: boolean;

  // Widget-specific features
  timeTracking: boolean;
  crmContacts: boolean;
  vulnerabilities: boolean;
  errorTracking: boolean;
  designManagement: boolean;
  linkedResources: boolean;
  emailParticipants: boolean;
}

export interface GitLabInstanceInfo {
  version: string;
  tier: GitLabTier;
  features: GitLabFeatures;
  detectedAt: Date;
}

interface VersionMetadata {
  version: string;
  revision: string;
  kas?: {
    enabled: boolean;
    version?: string;
  };
  enterprise?: boolean;
}

const VERSION_QUERY = gql`
  query GetVersionInfo {
    metadata {
      version
      revision
      kas {
        enabled
        version
      }
      enterprise
    }
    currentUser {
      id
      username
      name
    }
  }
`;

const LICENSE_QUERY = gql`
  query GetLicenseInfo {
    currentLicense {
      id
      type
      plan
      expiresAt
      activatedAt
      lastSync
      billableUsersCount
      maximumUserCount
      usersInLicenseCount
    }
  }
`;

const FEATURE_DETECTION_QUERY = gql`
  query DetectFeatures($groupPath: String!) {
    group(fullPath: $groupPath) {
      id
      epicsEnabled
      iterationsEnabled: iterationCadences(first: 1) {
        nodes {
          id
        }
      }
      workItemTypesEnabled: workItemTypes {
        nodes {
          id
          name
        }
      }
    }
  }
`;

export class GitLabVersionDetector {
  private client: GraphQLClient;
  private cachedInfo: GitLabInstanceInfo | null = null;
  private testGroupPath: string = "test";

  constructor(client: GraphQLClient) {
    this.client = client;
  }

  public getCachedInfo(): GitLabInstanceInfo | null {
    return this.cachedInfo;
  }

  public async detectInstance(): Promise<GitLabInstanceInfo> {
    if (this.cachedInfo && this.isRecentCache(this.cachedInfo.detectedAt)) {
      return this.cachedInfo;
    }

    const version = await this.detectVersion();
    const tier = await this.detectTier();
    const features = this.determineFeatures(version, tier);

    this.cachedInfo = {
      version,
      tier,
      features,
      detectedAt: new Date(),
    };

    return this.cachedInfo;
  }

  private async detectVersion(): Promise<string> {
    try {
      const response = await this.client.request<{ metadata: VersionMetadata }>(VERSION_QUERY);
      return response.metadata.version;
    } catch (error) {
      logger.warn(
        `Failed to detect GitLab version via GraphQL, trying alternative methods: ${error instanceof Error ? error.message : String(error)}`
      );
      return await this.detectVersionFallback();
    }
  }

  private async detectVersionFallback(): Promise<string> {
    try {
      const baseUrl = this.client.endpoint.replace("/api/graphql", "");
      const response = await enhancedFetch(`${baseUrl}/api/v4/version`);
      if (response.ok) {
        const data = (await response.json()) as { version: string };
        return data.version;
      }
    } catch (error) {
      logger.warn(
        `Failed to detect version via REST API: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return "unknown";
  }

  private async detectTier(): Promise<GitLabTier> {
    try {
      interface LicenseResponse {
        currentLicense: {
          plan?: string;
        };
      }
      const response = await this.client.request<LicenseResponse>(LICENSE_QUERY);

      if (response.currentLicense) {
        const plan = response.currentLicense.plan?.toLowerCase() ?? "";

        if (plan.includes("ultimate") || plan.includes("gold")) {
          return "ultimate";
        } else if (plan.includes("premium") || plan.includes("silver")) {
          return "premium";
        }
      }
    } catch (error) {
      logger.debug(
        `License query not available, attempting feature detection: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return await this.detectTierByFeatures();
  }

  private async detectTierByFeatures(): Promise<GitLabTier> {
    try {
      interface FeatureResponse {
        group: {
          epicsEnabled?: boolean;
          iterationsEnabled?: { nodes: unknown[] };
          workItemTypesEnabled?: {
            nodes: Array<{ name: string }>;
          };
        };
      }
      const response = await this.client.request<FeatureResponse>(FEATURE_DETECTION_QUERY, {
        groupPath: this.testGroupPath,
      });

      const group = response.group;

      if (group?.epicsEnabled) {
        const hasIterations = (group.iterationsEnabled?.nodes?.length ?? 0) > 0;

        const hasAdvancedWorkItems =
          group.workItemTypesEnabled?.nodes?.some(type =>
            ["OBJECTIVE", "KEY_RESULT", "REQUIREMENT"].includes(type.name)
          ) ?? false;

        if (hasAdvancedWorkItems) {
          return "ultimate";
        } else if (hasIterations) {
          return "premium";
        } else {
          return "premium";
        }
      }
    } catch (error) {
      logger.debug(
        `Feature detection failed, assuming free tier: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return "free";
  }

  private determineFeatures(version: string, tier: GitLabTier): GitLabFeatures {
    const v = parseVersion(version);

    const features: GitLabFeatures = {
      // Core features aligned with WORK.md Feature Availability Matrix
      workItems: v >= 1500,
      epics: tier !== "free" && v >= 1002,
      iterations: tier !== "free" && v >= 1301,
      roadmaps: tier !== "free" && v >= 1008,
      portfolioManagement: tier === "ultimate" && v >= 1200,
      advancedSearch: tier !== "free" && v >= 1100,
      codeReview: tier !== "free" && v >= 1100,
      securityDashboard: tier === "ultimate" && v >= 1101,
      complianceFramework: tier === "ultimate" && v >= 1300,
      valueStreamAnalytics: tier !== "free" && v >= 1203,
      customFields: tier === "ultimate" && v >= 1700,
      okrs: tier === "ultimate" && v >= 1507,
      healthStatus: tier === "ultimate" && v >= 1301,
      weight: tier !== "free" && v >= 1200,
      multiLevelEpics: tier === "ultimate" && v >= 1107,
      serviceDesk: tier !== "free" && v >= 901,
      requirements: tier === "ultimate" && v >= 1301,
      qualityManagement: tier === "ultimate" && v >= 1300,

      // Widget-specific features aligned with WORK.md
      timeTracking: tier !== "free" && v >= 814,
      crmContacts: tier === "ultimate" && v >= 1400,
      vulnerabilities: tier === "ultimate" && v >= 1205,
      errorTracking: tier === "ultimate" && v >= 1207,
      designManagement: tier !== "free" && v >= 1202,
      linkedResources: tier !== "free" && v >= 1605,
      emailParticipants: tier !== "free" && v >= 1600,
    };

    return features;
  }

  private isRecentCache(detectedAt: Date): boolean {
    const cacheLifetime = 24 * 60 * 60 * 1000;
    return Date.now() - detectedAt.getTime() < cacheLifetime;
  }

  public isFeatureAvailable(feature: keyof GitLabFeatures): boolean {
    if (!this.cachedInfo) {
      throw new Error("Instance info not detected yet. Call detectInstance() first.");
    }

    return this.cachedInfo.features[feature];
  }

  public getTier(): GitLabTier {
    if (!this.cachedInfo) {
      throw new Error("Instance info not detected yet. Call detectInstance() first.");
    }

    return this.cachedInfo.tier;
  }

  public getVersion(): string {
    if (!this.cachedInfo) {
      throw new Error("Instance info not detected yet. Call detectInstance() first.");
    }

    return this.cachedInfo.version;
  }
}
