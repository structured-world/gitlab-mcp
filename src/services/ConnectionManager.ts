import { GraphQLClient } from '../graphql/client';
import { GitLabVersionDetector, GitLabInstanceInfo } from './GitLabVersionDetector';
import { SchemaIntrospector, SchemaInfo } from './SchemaIntrospector';
import {
  detectTokenScopes,
  logTokenScopeInfo,
  getToolScopeRequirements,
  TokenScopeInfo,
} from './TokenScopeDetector';
import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { isOAuthEnabled, getGitLabApiUrlFromContext } from '../oauth/index';
import { enhancedFetch } from '../utils/fetch';
import { logInfo, logDebug, logError } from '../logger';
import { InstanceRegistry } from './InstanceRegistry';
import { CachedIntrospection } from '../config/instances-schema';

export { normalizeInstanceUrl } from '../utils/url';
import { normalizeInstanceUrl } from '../utils/url';

interface CacheEntry {
  schemaInfo: SchemaInfo;
  instanceInfo: GitLabInstanceInfo;
  timestamp: number;
}

/**
 * Per-URL instance state. Each GitLab URL gets isolated client, detectors,
 * and introspection data — no shared mutable fields to overwrite.
 */
export interface InstanceState {
  client: GraphQLClient;
  versionDetector: GitLabVersionDetector;
  schemaIntrospector: SchemaIntrospector;
  instanceInfo: GitLabInstanceInfo | null;
  schemaInfo: SchemaInfo | null;
  tokenScopeInfo: TokenScopeInfo | null;
  isInitialized: boolean;
  /** Tracks which instance URL the cached instanceInfo/schemaInfo belongs to */
  introspectedInstanceUrl: string | null;
}

export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  /** Per-URL isolated state — each initialize(url) creates its own entry */
  private instances = new Map<string, InstanceState>();
  /** The "active" instance URL — used as default for no-arg getClient()/getInstanceInfo() */
  private currentInstanceUrl: string | null = null;
  /** Deduplication map: prevents thundering herd on concurrent ensureIntrospected() calls */
  private introspectionPromises = new Map<string, Promise<void>>();
  private static introspectionCache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
  /** In-flight initialize promises keyed by instance URL — prevents concurrent initialize()
   *  calls for the same URL from doing duplicate work when HealthMonitor's timeout races. */
  private initializePromises = new Map<string, Promise<void>>();
  /** Tracks the most recently requested URL so stale inits don't overwrite currentInstanceUrl.
   *  E.g. init(A) starts, init(B) starts, A finishes last — A must not rebind to itself. */
  private latestRequestedUrl: string | null = null;

  private constructor() {}

  public static getInstance(): ConnectionManager {
    ConnectionManager.instance ??= new ConnectionManager();
    return ConnectionManager.instance;
  }

  public async initialize(instanceUrl?: string): Promise<void> {
    const url = normalizeInstanceUrl(instanceUrl ?? GITLAB_BASE_URL);
    this.latestRequestedUrl = url;

    // Already initialized for this URL — nothing to do
    const existing = this.instances.get(url);
    if (existing?.isInitialized) {
      // Update currentInstanceUrl to the requested URL
      this.currentInstanceUrl = url;
      return;
    }

    // Deduplicate concurrent initialize() calls for the same URL.
    // HealthMonitor calls clearInflight(url) after timeout to prevent a hung
    // doInitialize() from blocking all future reconnect attempts.
    const inflight = this.initializePromises.get(url);
    if (inflight) {
      return inflight;
    }

    const promise = this.doInitialize(url);
    this.initializePromises.set(url, promise);
    try {
      await promise;
      // Only update currentInstanceUrl if:
      // 1. This is still OUR promise AND this is the most recently requested URL
      //    (prevents stale init A from overwriting after newer init B took over), OR
      // 2. No currentInstanceUrl is set AND init succeeded — bootstrap fallback
      //    so no-arg callers have a URL even if this wasn't the latest request.
      const isOurPromise = this.initializePromises.get(url) === promise;
      const initSucceeded = this.instances.get(url)?.isInitialized === true;
      if (
        (isOurPromise && url === this.latestRequestedUrl) ||
        (!this.currentInstanceUrl && initSucceeded)
      ) {
        this.currentInstanceUrl = url;
      }
    } finally {
      // Guard: only delete if this is still OUR promise (clearInflight from a
      // timed-out attempt A must not wipe retry B's fresh promise).
      if (this.initializePromises.get(url) === promise) {
        this.initializePromises.delete(url);
      }
    }
  }

  private async doInitialize(baseUrl: string): Promise<void> {
    let state: InstanceState | undefined;
    try {
      const oauthMode = isOAuthEnabled();

      // Initialize InstanceRegistry for multi-instance support
      const registry = InstanceRegistry.getInstance();
      if (!registry.isInitialized()) {
        await registry.initialize();
      }

      // In OAuth mode, token comes from request context via enhancedFetch
      // In static mode, require both base URL and token
      if (!baseUrl) {
        throw new Error('GitLab base URL is required');
      }

      if (!oauthMode && !GITLAB_TOKEN) {
        throw new Error(
          'GITLAB_TOKEN is required in static authentication mode. ' +
            'Run `npx @structured-world/gitlab-mcp setup` for interactive configuration, ' +
            'or set the environment variable and restart. ' +
            'Docs: https://gitlab-mcp.sw.foundation/guide/quick-start',
        );
      }

      // Construct GraphQL endpoint from base URL
      const endpoint = `${baseUrl}/api/graphql`;

      // In OAuth mode, don't set static auth header
      // enhancedFetch will add the token from request context
      // GITLAB_TOKEN is guaranteed non-empty here (validated above for non-OAuth mode)
      const clientOptions: { headers?: Record<string, string> } = oauthMode
        ? {}
        : { headers: { 'PRIVATE-TOKEN': String(GITLAB_TOKEN) } };

      const client = new GraphQLClient(endpoint, clientOptions);
      const versionDetector = new GitLabVersionDetector(client);
      const schemaIntrospector = new SchemaIntrospector(client);

      // Create per-URL state entry (assigned to outer `let state` for catch guard)
      state = {
        client,
        versionDetector,
        schemaIntrospector,
        instanceInfo: null,
        schemaInfo: null,
        tokenScopeInfo: null,
        isInitialized: false,
        introspectedInstanceUrl: null,
      };
      this.instances.set(baseUrl, state);

      // In OAuth mode, try unauthenticated version detection first
      // Many GitLab instances expose /api/v4/version without auth
      if (oauthMode) {
        // This request is intentionally unauthenticated because many GitLab
        // instances expose /api/v4/version without authentication.
        // skipAuth prevents enhancedFetch from emitting OAuth "no token context"
        // warnings for this deliberate version probe.
        logInfo('OAuth mode: attempting unauthenticated version detection');
        try {
          const versionResponse = await enhancedFetch(`${baseUrl}/api/v4/version`, {
            retry: false,
            skipAuth: true,
          });
          if (versionResponse.ok) {
            const versionData = (await versionResponse.json()) as {
              version: string;
              enterprise?: boolean;
            };
            logInfo('Detected GitLab version without authentication', {
              version: versionData.version,
            });

            // Create basic instance info from unauthenticated response
            // Default to "premium" tier for enterprise instances - will be refined on first authenticated request
            state.instanceInfo = {
              version: versionData.version,
              tier: versionData.enterprise ? 'premium' : 'free',
              features: this.getDefaultFeatures(versionData.enterprise ?? false),
              detectedAt: new Date(),
            };

            // Schema introspection still deferred (requires auth for full introspection)
            logInfo(
              'OAuth mode: version detected, full introspection deferred until first authenticated request',
            );
          } else {
            logInfo(
              'OAuth mode: unauthenticated version detection failed, deferring all introspection',
              {
                status: versionResponse.status,
              },
            );
          }
        } catch (error) {
          // Intentionally swallowed: the version probe is a best-effort optimization
          // in OAuth mode. Even if GitLab is unreachable here, the OAuth client is
          // ready — actual connectivity is verified when the first authenticated
          // request arrives. HealthMonitor may also detect unreachability via its
          // immediate post-initialization probe and subsequent periodic health checks.
          logInfo(
            'OAuth mode: unauthenticated version detection failed, deferring all introspection',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        // Verify state is still ours (reinitialize may have replaced it during async work)
        if (this.instances.get(baseUrl) !== state) return;
        state.isInitialized = true;
        return;
      }

      // Step 1: Detect token scopes BEFORE GraphQL introspection
      // This prevents ugly 401 stack traces when token lacks api/read_api scope
      state.tokenScopeInfo = await detectTokenScopes(baseUrl);

      if (state.tokenScopeInfo) {
        // Log token scope info — derive total tools dynamically from scope requirements map
        const totalTools = Object.keys(getToolScopeRequirements()).length;
        logTokenScopeInfo(state.tokenScopeInfo, totalTools, baseUrl);

        // If token lacks GraphQL access, skip introspection entirely
        if (!state.tokenScopeInfo.hasGraphQLAccess) {
          // Detect version via REST (doesn't require api scope for most GitLab versions)
          state.instanceInfo = await this.detectVersionViaREST(baseUrl);
          state.isInitialized = true;
          return;
        }
      }

      // Step 2: Full GraphQL introspection (token has api or read_api scope)
      const cached = ConnectionManager.introspectionCache.get(endpoint);
      const now = Date.now();

      if (cached && now - cached.timestamp < ConnectionManager.CACHE_TTL) {
        // Verify state is still ours (reinitialize may have replaced it during prior awaits)
        if (this.instances.get(baseUrl) !== state) return;
        logInfo('Using cached GraphQL introspection data');
        state.instanceInfo = cached.instanceInfo;
        state.schemaInfo = cached.schemaInfo;
        state.introspectedInstanceUrl = baseUrl;
      } else {
        logDebug('Introspecting GitLab GraphQL schema...');

        // Detect instance info and introspect schema in parallel
        const [instanceInfo, schemaInfo] = await Promise.all([
          versionDetector.detectInstance(),
          schemaIntrospector.introspectSchema(),
        ]);

        // Verify this state entry is still ours (reinitialize may have replaced it)
        if (this.instances.get(baseUrl) !== state) return;

        state.instanceInfo = instanceInfo;
        state.schemaInfo = schemaInfo;
        state.introspectedInstanceUrl = baseUrl;

        // Cache the results
        ConnectionManager.introspectionCache.set(endpoint, {
          instanceInfo,
          schemaInfo,
          timestamp: now,
        });

        logInfo('GraphQL schema introspection completed');
      }

      state.isInitialized = true;

      logInfo('GitLab instance and schema detected', {
        version: state.instanceInfo?.version,
        tier: state.instanceInfo?.tier,
        features: state.instanceInfo
          ? Object.entries(state.instanceInfo.features)
              .filter(([, enabled]) => enabled)
              .map(([feature]) => feature)
          : [],
        widgetTypes: state.schemaInfo?.workItemWidgetTypes.length || 0,
        schemaTypes: state.schemaInfo?.typeDefinitions.size || 0,
      });
    } catch (error) {
      // Guard: only delete if this is still OUR state entry — a concurrent retry
      // (after clearInflight) may have already replaced it with a fresh one.
      if (state && this.instances.get(baseUrl) === state) {
        this.instances.delete(baseUrl);
      }
      logError('Failed to initialize connection', { err: error as Error });
      throw error;
    }
  }

  /**
   * Ensure schema introspection has been performed.
   * In OAuth mode, this should be called within a token context.
   * Supports per-instance introspection caching via InstanceRegistry.
   *
   * Uses Promise-based deduplication to prevent thundering herd when
   * multiple concurrent requests trigger introspection simultaneously.
   */
  public async ensureIntrospected(explicitUrl?: string): Promise<void> {
    // Use explicit URL if provided (handler knows the effective URL),
    // otherwise fall back to OAuth context / current instance
    const instanceUrl = normalizeInstanceUrl(
      explicitUrl ?? getGitLabApiUrlFromContext() ?? this.currentInstanceUrl ?? GITLAB_BASE_URL,
    );

    const state = this.instances.get(instanceUrl);
    if (!state?.client || !state.versionDetector || !state.schemaIntrospector) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }

    // Already introspected for THIS instance - reuse cached data
    if (state.instanceInfo && state.schemaInfo && state.introspectedInstanceUrl === instanceUrl) {
      return;
    }

    // REST-only mode: token lacks GraphQL access, skip introspection entirely
    // (doInitialize set instanceInfo via REST, no point hitting GraphQL)
    if (state.tokenScopeInfo && !state.tokenScopeInfo.hasGraphQLAccess) {
      return;
    }

    // Deduplication: if another request is already introspecting this instance, await it
    const existingPromise = this.introspectionPromises.get(instanceUrl);
    if (existingPromise) {
      logDebug('Awaiting existing introspection for instance', { url: instanceUrl });
      await existingPromise;
      return;
    }

    // Start introspection and register the promise for deduplication
    const promise = this.doIntrospection(instanceUrl);
    this.introspectionPromises.set(instanceUrl, promise);

    try {
      await promise;
    } finally {
      if (this.introspectionPromises.get(instanceUrl) === promise) {
        this.introspectionPromises.delete(instanceUrl);
      }
    }
  }

  /**
   * Perform actual introspection logic for an instance.
   * Extracted from ensureIntrospected() for deduplication support.
   */
  private async doIntrospection(instanceUrl: string): Promise<void> {
    const state = this.instances.get(instanceUrl);
    if (!state?.client || !state.versionDetector || !state.schemaIntrospector) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }

    const { client, versionDetector, schemaIntrospector } = state;
    const endpoint = client.endpoint;
    const registry = InstanceRegistry.getInstance();

    // Check InstanceRegistry cache first (for multi-instance support)
    if (registry.isInitialized()) {
      const cachedIntrospection = registry.getIntrospection(instanceUrl);
      if (cachedIntrospection) {
        logInfo('Using cached introspection from InstanceRegistry', { url: instanceUrl });
        state.instanceInfo = {
          version: cachedIntrospection.version,
          tier: cachedIntrospection.tier as 'free' | 'premium' | 'ultimate',
          features: cachedIntrospection.features as unknown as GitLabInstanceInfo['features'],
          detectedAt: cachedIntrospection.cachedAt,
        };
        state.schemaInfo = cachedIntrospection.schemaInfo as SchemaInfo;
        state.introspectedInstanceUrl = instanceUrl;
        return;
      }
    }

    // Check legacy cache: prefer instanceUrl for multi-instance consistency,
    // but fall back to endpoint-keyed entries from older cache format
    const primaryCacheKey = instanceUrl;
    const legacyCacheKey = endpoint;
    let cached = ConnectionManager.introspectionCache.get(primaryCacheKey);
    if (!cached && primaryCacheKey !== legacyCacheKey) {
      cached = ConnectionManager.introspectionCache.get(legacyCacheKey);
    }
    const now = Date.now();

    if (cached && now - cached.timestamp < ConnectionManager.CACHE_TTL) {
      logInfo('Using cached GraphQL introspection data');
      state.instanceInfo = cached.instanceInfo;
      state.schemaInfo = cached.schemaInfo;
      state.introspectedInstanceUrl = instanceUrl;
      return;
    }

    logDebug('Introspecting GitLab GraphQL schema (deferred OAuth mode)...');

    // Detect instance info and introspect schema in parallel
    // Per-URL state already has the correct client for this instance
    const [instanceInfo, schemaInfo] = await Promise.all([
      versionDetector.detectInstance(),
      schemaIntrospector.introspectSchema(),
    ]);

    // Verify this state entry is still ours (reinitialize may have replaced it)
    if (this.instances.get(instanceUrl) !== state) return;

    state.instanceInfo = instanceInfo;
    state.schemaInfo = schemaInfo;
    state.introspectedInstanceUrl = instanceUrl;

    // Cache the results
    ConnectionManager.introspectionCache.set(primaryCacheKey, {
      instanceInfo,
      schemaInfo,
      timestamp: now,
    });

    // Also cache in InstanceRegistry for multi-instance support
    if (registry.isInitialized()) {
      const cachedIntrospection: CachedIntrospection = {
        version: instanceInfo.version,
        tier: instanceInfo.tier,
        features: instanceInfo.features as unknown as Record<string, boolean>,
        schemaInfo,
        cachedAt: new Date(),
      };
      registry.setIntrospection(instanceUrl, cachedIntrospection);
    }

    logInfo('GraphQL schema introspection completed (deferred)', {
      version: state.instanceInfo?.version,
      tier: state.instanceInfo?.tier,
      widgetTypes: state.schemaInfo?.workItemWidgetTypes.length || 0,
    });
  }

  /**
   * Helper to resolve URL and look up per-URL state.
   * Returns [state, resolvedUrl] or throws if not initialized.
   */
  // TODO: no-arg callers (ToolAvailability, WidgetAvailability) resolve against
  // currentInstanceUrl which may not match the OAuth request context in concurrent
  // traffic. Those callers should pass an explicit URL (#379).
  private resolveState(instanceUrl?: string): [InstanceState, string] {
    // Empty string is falsy → falls to currentInstanceUrl (same as undefined/null).
    // This is intentional: callers pass either a real URL or nothing.
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    const state = this.instances.get(url);
    if (!state) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    // Note: state.isInitialized may be false during doInitialize() — the client
    // is valid at this point (constructed before map insertion). Failed inits
    // delete the entry entirely (see doInitialize catch block), so a present
    // entry always has a usable client. Individual getters (getInstanceInfo,
    // getSchemaInfo) null-check their respective fields independently.
    return [state, url];
  }

  public getClient(instanceUrl?: string): GraphQLClient {
    const [state] = this.resolveState(instanceUrl);
    return state.client;
  }

  /**
   * Get a thread-safe GraphQL client for the current or specified instance.
   *
   * In OAuth mode with multi-instance support, this returns a per-instance
   * client from the connection pool, avoiding singleton endpoint mutation.
   * In static mode, returns the per-URL client from InstanceState.
   *
   * @param instanceUrl - Optional instance URL (defaults to current context)
   * @param authHeaders - Optional auth headers for OAuth per-request tokens
   */
  public getInstanceClient(
    instanceUrl?: string,
    authHeaders?: Record<string, string>,
  ): GraphQLClient {
    const registry = InstanceRegistry.getInstance();

    // Determine which instance to use — normalize all sources for consistent Map keys
    const rawTargetUrl = instanceUrl ?? getGitLabApiUrlFromContext() ?? this.currentInstanceUrl;
    const targetUrl = rawTargetUrl ? normalizeInstanceUrl(rawTargetUrl) : null;

    // If registry is initialized and instance is registered, use per-instance client
    if (targetUrl && registry.isInitialized() && registry.has(targetUrl)) {
      const client = registry.getGraphQLClient(targetUrl, authHeaders);
      if (client) {
        return client;
      }
    }

    // Fallback to per-URL state client
    if (targetUrl) {
      const state = this.instances.get(targetUrl);
      if (state) return state.client;
      // targetUrl resolved (explicit or from context) but not found anywhere —
      // fail fast rather than silently routing to a different instance's client.
      throw new Error(`Connection not initialized for ${targetUrl}. Call initialize() first.`);
    }
    return this.getClient();
  }

  public getVersionDetector(instanceUrl?: string): GitLabVersionDetector {
    const [state] = this.resolveState(instanceUrl);
    return state.versionDetector;
  }

  public getSchemaIntrospector(instanceUrl?: string): SchemaIntrospector {
    const [state] = this.resolveState(instanceUrl);
    return state.schemaIntrospector;
  }

  public getInstanceInfo(instanceUrl?: string): GitLabInstanceInfo {
    const [state] = this.resolveState(instanceUrl);
    if (!state.instanceInfo) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return state.instanceInfo;
  }

  public getSchemaInfo(instanceUrl?: string): SchemaInfo {
    const [state] = this.resolveState(instanceUrl);
    if (!state.schemaInfo) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return state.schemaInfo;
  }

  /**
   * Get the current instance URL (for tracking instance switches)
   */
  public getCurrentInstanceUrl(): string | null {
    return this.currentInstanceUrl;
  }

  /**
   * Check if initialize() has completed for the given (or current) URL.
   * This is an initialization flag, NOT a live connectivity check — use
   * HealthMonitor.isInstanceReachable() for runtime reachability.
   * True for partial states (OAuth REST-only). HealthMonitor's performConnect
   * derives degraded state from getInstanceInfo().version after this check.
   */
  public isConnected(instanceUrl?: string): boolean {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return false;
    const state = this.instances.get(url);
    return state?.isInitialized ?? false;
  }

  public isFeatureAvailable(
    feature: keyof GitLabInstanceInfo['features'],
    instanceUrl?: string,
  ): boolean {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return false;
    const state = this.instances.get(url);
    if (!state?.instanceInfo) return false;
    return state.instanceInfo.features[feature];
  }

  public getTier(instanceUrl?: string): string {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return 'unknown';
    const state = this.instances.get(url);
    if (!state?.instanceInfo) return 'unknown';
    return state.instanceInfo.tier;
  }

  public getVersion(instanceUrl?: string): string {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return 'unknown';
    const state = this.instances.get(url);
    if (!state?.instanceInfo) return 'unknown';
    return state.instanceInfo.version;
  }

  public isWidgetAvailable(widgetType: string, instanceUrl?: string): boolean {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return false;
    const state = this.instances.get(url);
    // Read from schemaInfo directly — schemaIntrospector's internal cache may
    // not be populated after a cache-hit restore (only schemaInfo is copied).
    return state?.schemaInfo?.workItemWidgetTypes.includes(widgetType) ?? false;
  }

  /**
   * Get detected token scope info (null if detection was skipped or failed)
   */
  public getTokenScopeInfo(instanceUrl?: string): TokenScopeInfo | null {
    const url = instanceUrl ? normalizeInstanceUrl(instanceUrl) : this.currentInstanceUrl;
    if (!url) return null;
    const state = this.instances.get(url);
    return state?.tokenScopeInfo ?? null;
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

    const url = this.currentInstanceUrl;
    if (!url) return false;
    const state = this.instances.get(url);
    if (!state) return false;

    const previousScopes = state.tokenScopeInfo?.scopes ?? [];
    const previousHasGraphQL = state.tokenScopeInfo?.hasGraphQLAccess ?? false;
    const previousHasWrite = state.tokenScopeInfo?.hasWriteAccess ?? false;

    // Re-detect token scopes against the current instance URL
    const newScopeInfo = await detectTokenScopes(url);

    if (!newScopeInfo) {
      // Detection failed - keep existing state
      return false;
    }

    // Check if scopes changed
    const newScopes = newScopeInfo.scopes;
    const scopesChanged =
      previousScopes.length !== newScopes.length ||
      !previousScopes.every((s) => newScopes.includes(s)) ||
      previousHasGraphQL !== newScopeInfo.hasGraphQLAccess ||
      previousHasWrite !== newScopeInfo.hasWriteAccess;

    // Re-check that the state entry is still the live one: a concurrent
    // reinitialize() or reset() may have replaced / deleted it while we were
    // awaiting detectTokenScopes() above.  Writing into a stale object would
    // silently lose the refreshed scopes or corrupt a connection that is no
    // longer active.
    const currentState = this.instances.get(url);
    if (currentState !== state) {
      return false;
    }

    // Always persist refreshed scope info (even when scopes haven't changed)
    // so non-scope metadata in TokenScopeInfo stays fresh
    state.tokenScopeInfo = newScopeInfo;
    if (scopesChanged) {
      logInfo('Token scopes changed - tool registry will be refreshed', {
        previousScopes,
        newScopes,
        hasGraphQLAccess: newScopeInfo.hasGraphQLAccess,
        hasWriteAccess: newScopeInfo.hasWriteAccess,
      });
    }

    return scopesChanged;
  }

  /**
   * Detect GitLab version via REST API (fallback when GraphQL is not available).
   * Uses GET /api/v4/version; authentication requirements depend on instance
   * configuration. This helper always sends the configured token as a fallback.
   */
  private async detectVersionViaREST(baseUrl?: string): Promise<GitLabInstanceInfo> {
    try {
      const url = baseUrl ?? this.currentInstanceUrl ?? GITLAB_BASE_URL;
      const response = await enhancedFetch(`${url}/api/v4/version`, {
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN ?? '',
          Accept: 'application/json',
        },
        retry: false, // Don't retry version detection at startup
      });

      if (response.ok) {
        const data = (await response.json()) as {
          version: string;
          revision: string;
          enterprise?: boolean;
        };

        logInfo('Detected GitLab version via REST (GraphQL unavailable)', {
          version: data.version,
          enterprise: data.enterprise,
        });

        return {
          version: data.version,
          tier: data.enterprise ? 'premium' : 'free',
          features: this.getDefaultFeatures(data.enterprise ?? false),
          detectedAt: new Date(),
        };
      }

      // Version endpoint also failed - return minimal info
      logInfo('REST version detection failed, using defaults', { status: response.status });
    } catch (error) {
      logInfo('REST version detection failed, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback: return unknown version with default features
    return {
      version: 'unknown',
      tier: 'free',
      features: this.getDefaultFeatures(false),
      detectedAt: new Date(),
    };
  }

  /**
   * Get default features based on whether GitLab is enterprise edition.
   * In OAuth mode without full introspection, we default to enabling most features
   * to allow tools to be available - they will fail gracefully if not actually available.
   */
  private getDefaultFeatures(isEnterprise: boolean): GitLabInstanceInfo['features'] {
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

  /**
   * Re-initialize connection with a different GitLab instance.
   * Used when switching instances in static token mode.
   *
   * @param newInstanceUrl - The new GitLab instance URL to connect to
   */
  public async reinitialize(rawInstanceUrl: string): Promise<void> {
    const newInstanceUrl = normalizeInstanceUrl(rawInstanceUrl);
    logInfo('Re-initializing ConnectionManager for new instance', {
      newInstanceUrl,
    });

    // Clear state for the NEW URL before re-init. When switching instances,
    // keep previous state alive as fallback. When refreshing the same URL,
    // save the live state and restore it if re-init fails.
    const previousUrl = this.currentInstanceUrl;
    const savedState = this.instances.get(newInstanceUrl);
    // Only restore states that were successfully initialized; a placeholder
    // entry written by doInitialize() before any network step completed is not
    // a valid fallback — reinstate it would point currentInstanceUrl at an
    // uninitialised connection.
    const restorableState = savedState?.isInitialized ? savedState : undefined;
    this.initializePromises.delete(newInstanceUrl);
    this.introspectionPromises.delete(newInstanceUrl);
    this.instances.delete(newInstanceUrl);

    // Clear all caches for the new URL (guard: registry may not be initialized yet)
    try {
      const registry = InstanceRegistry.getInstance();
      registry.clearIntrospectionCache(newInstanceUrl);
    } catch {
      // InstanceRegistry not initialized — no cache to clear
    }
    ConnectionManager.introspectionCache.delete(newInstanceUrl);
    ConnectionManager.introspectionCache.delete(`${newInstanceUrl}/api/graphql`);

    // Re-initialize the connection with the new instance URL
    try {
      await this.initialize(newInstanceUrl);
    } catch (error) {
      // On failure: restore the best available state.
      // - Same-URL refresh: restore saved state for this URL
      // - URL switch: keep previousUrl as the active healthy instance
      if (restorableState) {
        this.instances.set(newInstanceUrl, restorableState);
      }
      if (previousUrl && this.instances.has(previousUrl)) {
        this.currentInstanceUrl = previousUrl;
      } else if (restorableState) {
        this.currentInstanceUrl = newInstanceUrl;
      }
      throw error;
    }

    // Only after successful init: clean up the previous instance state
    if (previousUrl && previousUrl !== newInstanceUrl) {
      this.initializePromises.delete(previousUrl);
      this.introspectionPromises.delete(previousUrl);
      this.instances.delete(previousUrl);
    }

    const state = this.instances.get(newInstanceUrl);
    logInfo('ConnectionManager re-initialized', {
      version: state?.instanceInfo?.version,
      tier: state?.instanceInfo?.tier,
      instanceUrl: this.currentInstanceUrl,
    });
  }

  /**
   * Clear the inflight initialize promise for a URL.
   * Called by HealthMonitor after init timeout — prevents reconnect attempts
   * from re-awaiting a hung doInitialize() promise.
   */
  public clearInflight(rawUrl: string): void {
    const url = normalizeInstanceUrl(rawUrl);
    this.initializePromises.delete(url);
    this.introspectionPromises.delete(url);
  }

  public reset(): void {
    this.instances.clear();
    this.currentInstanceUrl = null;
    this.latestRequestedUrl = null;
    this.introspectionPromises.clear();
    this.initializePromises.clear();
    ConnectionManager.introspectionCache.clear();
    // Clear InstanceRegistry introspection cache to prevent doIntrospection()
    // from resurrecting stale data after a full reset
    try {
      InstanceRegistry.getInstance().clearIntrospectionCache();
    } catch {
      // InstanceRegistry not initialized — nothing to clear
    }
  }
}
