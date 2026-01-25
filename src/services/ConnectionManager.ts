import { GraphQLClient } from "../graphql/client";
import { GitLabVersionDetector, GitLabInstanceInfo } from "./GitLabVersionDetector";
import { SchemaIntrospector, SchemaInfo } from "./SchemaIntrospector";
import {
  detectTokenScopes,
  logTokenScopeInfo,
  getToolScopeRequirements,
  TokenScopeInfo,
} from "./TokenScopeDetector";
import { GITLAB_BASE_URL, GITLAB_TOKEN } from "../config";
import { isOAuthEnabled } from "../oauth/index";
import { enhancedFetch } from "../utils/fetch";
import { logger } from "../logger";

interface CacheEntry {
  schemaInfo: SchemaInfo;
  instanceInfo: GitLabInstanceInfo;
  timestamp: number;
}

export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private client: GraphQLClient | null = null;
  private versionDetector: GitLabVersionDetector | null = null;
  private schemaIntrospector: SchemaIntrospector | null = null;
  private instanceInfo: GitLabInstanceInfo | null = null;
  private schemaInfo: SchemaInfo | null = null;
  private tokenScopeInfo: TokenScopeInfo | null = null;
  private isInitialized: boolean = false;
  private static introspectionCache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

  private constructor() {}

  public static getInstance(): ConnectionManager {
    ConnectionManager.instance ??= new ConnectionManager();
    return ConnectionManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const oauthMode = isOAuthEnabled();

      // In OAuth mode, token comes from request context via enhancedFetch
      // In static mode, require both base URL and token
      if (!GITLAB_BASE_URL) {
        throw new Error("GitLab base URL is required");
      }

      if (!oauthMode && !GITLAB_TOKEN) {
        throw new Error(
          "GITLAB_TOKEN is required in static authentication mode. " +
            "Run `npx @structured-world/gitlab-mcp setup` for interactive configuration, " +
            "or set the environment variable and restart. " +
            "Docs: https://gitlab-mcp.sw.foundation/guide/quick-start"
        );
      }

      // Construct GraphQL endpoint from base URL
      const endpoint = `${GITLAB_BASE_URL}/api/graphql`;

      // In OAuth mode, don't set static auth header
      // enhancedFetch will add the token from request context
      // GITLAB_TOKEN is guaranteed non-empty here (validated above for non-OAuth mode)
      const clientOptions: { headers?: Record<string, string> } = oauthMode
        ? {}
        : { headers: { "PRIVATE-TOKEN": String(GITLAB_TOKEN) } };

      this.client = new GraphQLClient(endpoint, clientOptions);

      this.versionDetector = new GitLabVersionDetector(this.client);
      this.schemaIntrospector = new SchemaIntrospector(this.client);

      // In OAuth mode, try unauthenticated version detection first
      // Many GitLab instances expose /api/v4/version without auth
      if (oauthMode) {
        logger.info("OAuth mode: attempting unauthenticated version detection");
        try {
          const versionResponse = await fetch(`${GITLAB_BASE_URL}/api/v4/version`);
          if (versionResponse.ok) {
            const versionData = (await versionResponse.json()) as {
              version: string;
              enterprise?: boolean;
            };
            logger.info(
              { version: versionData.version },
              "Detected GitLab version without authentication"
            );

            // Create basic instance info from unauthenticated response
            // Default to "premium" tier for enterprise instances - will be refined on first authenticated request
            this.instanceInfo = {
              version: versionData.version,
              tier: versionData.enterprise ? "premium" : "free",
              features: this.getDefaultFeatures(versionData.enterprise ?? false),
              detectedAt: new Date(),
            };

            // Schema introspection still deferred (requires auth for full introspection)
            logger.info(
              "OAuth mode: version detected, full introspection deferred until first authenticated request"
            );
          } else {
            logger.info(
              { status: versionResponse.status },
              "OAuth mode: unauthenticated version detection failed, deferring all introspection"
            );
          }
        } catch (error) {
          logger.info(
            { error: error instanceof Error ? error.message : String(error) },
            "OAuth mode: unauthenticated version detection failed, deferring all introspection"
          );
        }
        this.isInitialized = true;
        return;
      }

      // Step 1: Detect token scopes BEFORE GraphQL introspection
      // This prevents ugly 401 stack traces when token lacks api/read_api scope
      this.tokenScopeInfo = await detectTokenScopes();

      if (this.tokenScopeInfo) {
        // Log token scope info — derive total tools dynamically from scope requirements map
        const totalTools = Object.keys(getToolScopeRequirements()).length;
        logTokenScopeInfo(this.tokenScopeInfo, totalTools);

        // If token lacks GraphQL access, skip introspection entirely
        if (!this.tokenScopeInfo.hasGraphQLAccess) {
          // Detect version via REST (doesn't require api scope for most GitLab versions)
          this.instanceInfo = await this.detectVersionViaREST();
          this.isInitialized = true;
          return;
        }
      }

      // Step 2: Full GraphQL introspection (token has api or read_api scope)
      const cached = ConnectionManager.introspectionCache.get(endpoint);
      const now = Date.now();

      if (cached && now - cached.timestamp < ConnectionManager.CACHE_TTL) {
        logger.info("Using cached GraphQL introspection data");
        this.instanceInfo = cached.instanceInfo;
        this.schemaInfo = cached.schemaInfo;
      } else {
        logger.debug("Introspecting GitLab GraphQL schema...");

        // Detect instance info and introspect schema in parallel
        const [instanceInfo, schemaInfo] = await Promise.all([
          this.versionDetector.detectInstance(),
          this.schemaIntrospector.introspectSchema(),
        ]);

        this.instanceInfo = instanceInfo;
        this.schemaInfo = schemaInfo;

        // Cache the results
        ConnectionManager.introspectionCache.set(endpoint, {
          instanceInfo,
          schemaInfo,
          timestamp: now,
        });

        logger.info("GraphQL schema introspection completed");
      }

      this.isInitialized = true;

      logger.info(
        {
          version: this.instanceInfo?.version,
          tier: this.instanceInfo?.tier,
          features: this.instanceInfo
            ? Object.entries(this.instanceInfo.features)
                .filter(([, enabled]) => enabled)
                .map(([feature]) => feature)
            : [],
          widgetTypes: this.schemaInfo?.workItemWidgetTypes.length || 0,
          schemaTypes: this.schemaInfo?.typeDefinitions.size || 0,
        },
        "GitLab instance and schema detected"
      );
    } catch (error) {
      logger.error({ err: error as Error }, "Failed to initialize connection");
      throw error;
    }
  }

  /**
   * Ensure schema introspection has been performed.
   * In OAuth mode, this should be called within a token context.
   */
  public async ensureIntrospected(): Promise<void> {
    // Already introspected
    if (this.instanceInfo && this.schemaInfo) {
      return;
    }

    if (!this.client || !this.versionDetector || !this.schemaIntrospector) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }

    const endpoint = this.client.endpoint;

    // Check cache first
    const cached = ConnectionManager.introspectionCache.get(endpoint);
    const now = Date.now();

    if (cached && now - cached.timestamp < ConnectionManager.CACHE_TTL) {
      logger.info("Using cached GraphQL introspection data");
      this.instanceInfo = cached.instanceInfo;
      this.schemaInfo = cached.schemaInfo;
      return;
    }

    logger.debug("Introspecting GitLab GraphQL schema (deferred OAuth mode)...");

    // Detect instance info and introspect schema in parallel
    const [instanceInfo, schemaInfo] = await Promise.all([
      this.versionDetector.detectInstance(),
      this.schemaIntrospector.introspectSchema(),
    ]);

    this.instanceInfo = instanceInfo;
    this.schemaInfo = schemaInfo;

    // Cache the results
    ConnectionManager.introspectionCache.set(endpoint, {
      instanceInfo,
      schemaInfo,
      timestamp: now,
    });

    logger.info(
      {
        version: this.instanceInfo?.version,
        tier: this.instanceInfo?.tier,
        widgetTypes: this.schemaInfo?.workItemWidgetTypes.length || 0,
      },
      "GraphQL schema introspection completed (deferred)"
    );
  }

  public getClient(): GraphQLClient {
    if (!this.client) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }
    return this.client;
  }

  public getVersionDetector(): GitLabVersionDetector {
    if (!this.versionDetector) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }
    return this.versionDetector;
  }

  public getSchemaIntrospector(): SchemaIntrospector {
    if (!this.schemaIntrospector) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }
    return this.schemaIntrospector;
  }

  public getInstanceInfo(): GitLabInstanceInfo {
    if (!this.instanceInfo) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }
    return this.instanceInfo;
  }

  public getSchemaInfo(): SchemaInfo {
    if (!this.schemaInfo) {
      throw new Error("Connection not initialized. Call initialize() first.");
    }
    return this.schemaInfo;
  }

  public isFeatureAvailable(feature: keyof GitLabInstanceInfo["features"]): boolean {
    if (!this.instanceInfo) {
      return false;
    }
    return this.instanceInfo.features[feature];
  }

  public getTier(): string {
    if (!this.instanceInfo) {
      return "unknown";
    }
    return this.instanceInfo.tier;
  }

  public getVersion(): string {
    if (!this.instanceInfo) {
      return "unknown";
    }
    return this.instanceInfo.version;
  }

  public isWidgetAvailable(widgetType: string): boolean {
    if (!this.schemaIntrospector) {
      return false;
    }
    return this.schemaIntrospector.isWidgetTypeAvailable(widgetType);
  }

  /**
   * Get detected token scope info (null if detection was skipped or failed)
   */
  public getTokenScopeInfo(): TokenScopeInfo | null {
    return this.tokenScopeInfo;
  }

  /**
   * Re-detect token scopes and update internal state.
   * Returns true if scopes changed (requiring tool registry refresh).
   *
   * Used by whoami action to pick up token permission changes without restart.
   */
  public async refreshTokenScopes(): Promise<boolean> {
    // Skip in OAuth mode - scopes come from request context, not static token
    if (isOAuthEnabled()) {
      return false;
    }

    const previousScopes = this.tokenScopeInfo?.scopes ?? [];
    const previousHasGraphQL = this.tokenScopeInfo?.hasGraphQLAccess ?? false;
    const previousHasWrite = this.tokenScopeInfo?.hasWriteAccess ?? false;

    // Re-detect token scopes
    const newScopeInfo = await detectTokenScopes();

    if (!newScopeInfo) {
      // Detection failed - keep existing state
      return false;
    }

    // Check if scopes changed
    const newScopes = newScopeInfo.scopes;
    const scopesChanged =
      previousScopes.length !== newScopes.length ||
      !previousScopes.every(s => newScopes.includes(s)) ||
      previousHasGraphQL !== newScopeInfo.hasGraphQLAccess ||
      previousHasWrite !== newScopeInfo.hasWriteAccess;

    if (scopesChanged) {
      this.tokenScopeInfo = newScopeInfo;
      logger.info(
        {
          previousScopes,
          newScopes,
          hasGraphQLAccess: newScopeInfo.hasGraphQLAccess,
          hasWriteAccess: newScopeInfo.hasWriteAccess,
        },
        "Token scopes changed - tool registry will be refreshed"
      );
    }

    return scopesChanged;
  }

  /**
   * Detect GitLab version via REST API (fallback when GraphQL is not available).
   * Uses GET /api/v4/version; authentication requirements depend on instance
   * configuration. This helper always sends the configured token as a fallback.
   */
  private async detectVersionViaREST(): Promise<GitLabInstanceInfo> {
    try {
      const response = await enhancedFetch(`${GITLAB_BASE_URL}/api/v4/version`, {
        headers: {
          "PRIVATE-TOKEN": GITLAB_TOKEN ?? "",
          Accept: "application/json",
        },
        retry: false, // Don't retry version detection at startup
      });

      if (response.ok) {
        const data = (await response.json()) as {
          version: string;
          revision: string;
          enterprise?: boolean;
        };

        logger.info(
          { version: data.version, enterprise: data.enterprise },
          "Detected GitLab version via REST (GraphQL unavailable)"
        );

        return {
          version: data.version,
          tier: data.enterprise ? "premium" : "free",
          features: this.getDefaultFeatures(data.enterprise ?? false),
          detectedAt: new Date(),
        };
      }

      // Version endpoint also failed - return minimal info
      logger.info({ status: response.status }, "REST version detection failed, using defaults");
    } catch (error) {
      logger.info(
        { error: error instanceof Error ? error.message : String(error) },
        "REST version detection failed, using defaults"
      );
    }

    // Fallback: return unknown version with default features
    return {
      version: "unknown",
      tier: "free",
      features: this.getDefaultFeatures(false),
      detectedAt: new Date(),
    };
  }

  /**
   * Get default features based on whether GitLab is enterprise edition.
   * In OAuth mode without full introspection, we default to enabling most features
   * to allow tools to be available - they will fail gracefully if not actually available.
   */
  private getDefaultFeatures(isEnterprise: boolean): GitLabInstanceInfo["features"] {
    // Default to enabling most features - better to allow and fail gracefully
    // than to block tools that might actually be available
    return {
      workItems: true,
      epics: isEnterprise,
      iterations: isEnterprise,
      roadmaps: isEnterprise,
      portfolioManagement: isEnterprise,
      advancedSearch: true,
      codeReview: true,
      securityDashboard: isEnterprise,
      complianceFramework: isEnterprise,
      valueStreamAnalytics: isEnterprise,
      customFields: isEnterprise,
      okrs: isEnterprise,
      healthStatus: isEnterprise,
      weight: isEnterprise,
      multiLevelEpics: isEnterprise,
      serviceDesk: true,
      requirements: isEnterprise,
      qualityManagement: isEnterprise,
      timeTracking: true,
      crmContacts: true,
      vulnerabilities: isEnterprise,
      errorTracking: true,
      designManagement: true,
      linkedResources: true,
      emailParticipants: true,
    };
  }

  public reset(): void {
    this.client = null;
    this.versionDetector = null;
    this.schemaIntrospector = null;
    this.instanceInfo = null;
    this.schemaInfo = null;
    this.tokenScopeInfo = null;
    this.isInitialized = false;
  }
}
