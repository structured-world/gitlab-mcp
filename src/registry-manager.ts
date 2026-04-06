import { ToolRegistry, EnhancedToolDefinition, ToolDefinition } from './types';
import { coreToolRegistry, getCoreReadOnlyToolNames } from './entities/core/registry';
import { labelsToolRegistry, getLabelsReadOnlyToolNames } from './entities/labels/registry';
import { mrsToolRegistry, getMrsReadOnlyToolNames } from './entities/mrs/registry';
import { filesToolRegistry, getFilesReadOnlyToolNames } from './entities/files/registry';
import {
  milestonesToolRegistry,
  getMilestonesReadOnlyToolNames,
} from './entities/milestones/registry';
import {
  pipelinesToolRegistry,
  getPipelinesReadOnlyToolNames,
} from './entities/pipelines/registry';
import {
  variablesToolRegistry,
  getVariablesReadOnlyToolNames,
} from './entities/variables/registry';
import { wikiToolRegistry, getWikiReadOnlyToolNames } from './entities/wiki/registry';
import {
  workitemsToolRegistry,
  getWorkitemsReadOnlyToolNames,
} from './entities/workitems/registry';
import { webhooksToolRegistry, getWebhooksReadOnlyToolNames } from './entities/webhooks/registry';
import { snippetsToolRegistry, getSnippetsReadOnlyToolNames } from './entities/snippets/registry';
import {
  integrationsToolRegistry,
  getIntegrationsReadOnlyToolNames,
} from './entities/integrations/registry';
import { releasesToolRegistry, getReleasesReadOnlyToolNames } from './entities/releases/registry';
import { refsToolRegistry, getRefsReadOnlyToolNames } from './entities/refs/registry';
import { membersToolRegistry, getMembersReadOnlyToolNames } from './entities/members/registry';
import { searchToolRegistry, getSearchReadOnlyToolNames } from './entities/search/registry';
import { contextToolRegistry, getContextReadOnlyToolNames } from './entities/context/registry';
import {
  iterationsToolRegistry,
  getIterationsReadOnlyToolNames,
} from './entities/iterations/registry';
import {
  GITLAB_BASE_URL,
  GITLAB_READ_ONLY_MODE,
  GITLAB_DENIED_TOOLS_REGEX,
  GITLAB_CROSS_REFS,
  USE_GITLAB_WIKI,
  USE_MILESTONE,
  USE_PIPELINE,
  USE_WORKITEMS,
  USE_LABELS,
  USE_MRS,
  USE_FILES,
  USE_VARIABLES,
  USE_SNIPPETS,
  USE_WEBHOOKS,
  USE_INTEGRATIONS,
  USE_RELEASES,
  USE_REFS,
  USE_MEMBERS,
  USE_SEARCH,
  USE_ITERATIONS,
  getToolDescriptionOverrides,
} from './config';
import { ToolAvailability } from './services/ToolAvailability';
import { ConnectionManager } from './services/ConnectionManager';
import { HealthMonitor } from './services/HealthMonitor';
import { isToolAvailableForScopes } from './services/TokenScopeDetector';
import type { GitLabScope } from './services/TokenScopeDetector';
import type { GitLabTier } from './services/GitLabVersionDetector';
import { logDebug, logError } from './logger';
import {
  transformToolSchema,
  stripTierRestrictedParameters,
  shouldRemoveTool,
  extractActionsFromSchema,
} from './utils/schema-utils';
import { resolveRelatedReferences, stripRelatedSection } from './utils/description-utils';
import { normalizeInstanceUrl } from './utils/url';
import { getGitLabApiUrlFromContext } from './oauth/token-context';

/**
 * Central registry manager that aggregates tools from all entity registries
 * and provides a unified interface for tool discovery and execution
 */
class RegistryManager {
  private static instance: RegistryManager;
  private registries: Map<string, ToolRegistry> = new Map();

  // Per-URL tool caches — each instance URL gets its own filtered tool map
  // so concurrent multi-instance traffic cannot interfere (#379).
  // Growth is bounded by the number of distinct GitLab instances (typically 1-3,
  // never user-input-driven). No eviction needed at this scale.
  private readonly toolLookupCaches = new Map<string, Map<string, EnhancedToolDefinition>>();
  private readonly toolDefinitionsCaches = new Map<string, ToolDefinition[]>();
  private readonly toolNamesCaches = new Map<string, string[]>();

  // Tool description overrides from environment variables
  private descriptionOverrides: Map<string, string> = new Map();

  // Cached read-only tools list built from registries
  private readOnlyToolsCache: string[] | null = null;

  private constructor() {
    this.initializeRegistries();
    this.loadDescriptionOverrides();
    this.buildToolLookupCache();
  }

  public static getInstance(): RegistryManager {
    if (!RegistryManager.instance) {
      RegistryManager.instance = new RegistryManager();
    }
    return RegistryManager.instance;
  }

  /**
   * Initialize all entity registries based on configuration
   */
  private initializeRegistries(): void {
    // Always add core tools
    this.registries.set('core', coreToolRegistry);

    // Always add context tools (runtime context management)
    this.registries.set('context', contextToolRegistry);

    // Add tools based on feature flags
    if (USE_LABELS) {
      this.registries.set('labels', labelsToolRegistry);
    }

    if (USE_MRS) {
      this.registries.set('mrs', mrsToolRegistry);
    }

    if (USE_FILES) {
      this.registries.set('files', filesToolRegistry);
    }

    if (USE_MILESTONE) {
      this.registries.set('milestones', milestonesToolRegistry);
    }

    if (USE_PIPELINE) {
      this.registries.set('pipelines', pipelinesToolRegistry);
    }

    if (USE_VARIABLES) {
      this.registries.set('variables', variablesToolRegistry);
    }

    if (USE_GITLAB_WIKI) {
      this.registries.set('wiki', wikiToolRegistry);
    }

    if (USE_WORKITEMS) {
      this.registries.set('workitems', workitemsToolRegistry);
    }

    if (USE_SNIPPETS) {
      this.registries.set('snippets', snippetsToolRegistry);
    }

    if (USE_WEBHOOKS) {
      this.registries.set('webhooks', webhooksToolRegistry);
    }

    if (USE_INTEGRATIONS) {
      this.registries.set('integrations', integrationsToolRegistry);
    }

    if (USE_RELEASES) {
      this.registries.set('releases', releasesToolRegistry);
    }

    if (USE_REFS) {
      this.registries.set('refs', refsToolRegistry);
    }

    if (USE_MEMBERS) {
      this.registries.set('members', membersToolRegistry);
    }

    if (USE_SEARCH) {
      this.registries.set('search', searchToolRegistry);
    }

    if (USE_ITERATIONS) {
      this.registries.set('iterations', iterationsToolRegistry);
    }

    // All entity registries have been migrated to the new pattern!
  }

  /**
   * Load tool description overrides from environment variables
   */
  private loadDescriptionOverrides(): void {
    this.descriptionOverrides = getToolDescriptionOverrides();

    if (this.descriptionOverrides.size > 0) {
      logDebug('Loaded tool description overrides', { count: this.descriptionOverrides.size });
      for (const [toolName, description] of this.descriptionOverrides) {
        logDebug('Tool description override', { toolName, description });
      }
    }
  }

  /**
   * Build read-only tools list from registries based on configuration
   */
  private buildReadOnlyToolsList(): string[] {
    const readOnlyTools: string[] = [];

    // Always add core read-only tools
    readOnlyTools.push(...getCoreReadOnlyToolNames());

    // Always add context read-only tools
    readOnlyTools.push(...getContextReadOnlyToolNames());

    // Add read-only tools from enabled entities
    if (USE_LABELS) {
      readOnlyTools.push(...getLabelsReadOnlyToolNames());
    }

    if (USE_MRS) {
      readOnlyTools.push(...getMrsReadOnlyToolNames());
    }

    if (USE_FILES) {
      readOnlyTools.push(...getFilesReadOnlyToolNames());
    }

    if (USE_GITLAB_WIKI) {
      readOnlyTools.push(...getWikiReadOnlyToolNames());
    }

    if (USE_MILESTONE) {
      readOnlyTools.push(...getMilestonesReadOnlyToolNames());
    }

    if (USE_PIPELINE) {
      readOnlyTools.push(...getPipelinesReadOnlyToolNames());
    }

    if (USE_WORKITEMS) {
      readOnlyTools.push(...getWorkitemsReadOnlyToolNames());
    }

    if (USE_VARIABLES) {
      readOnlyTools.push(...getVariablesReadOnlyToolNames());
    }

    if (USE_SNIPPETS) {
      readOnlyTools.push(...getSnippetsReadOnlyToolNames());
    }

    if (USE_WEBHOOKS) {
      readOnlyTools.push(...getWebhooksReadOnlyToolNames());
    }

    if (USE_INTEGRATIONS) {
      readOnlyTools.push(...getIntegrationsReadOnlyToolNames());
    }

    if (USE_RELEASES) {
      readOnlyTools.push(...getReleasesReadOnlyToolNames());
    }

    if (USE_REFS) {
      readOnlyTools.push(...getRefsReadOnlyToolNames());
    }

    if (USE_MEMBERS) {
      readOnlyTools.push(...getMembersReadOnlyToolNames());
    }

    if (USE_SEARCH) {
      readOnlyTools.push(...getSearchReadOnlyToolNames());
    }

    if (USE_ITERATIONS) {
      readOnlyTools.push(...getIterationsReadOnlyToolNames());
    }

    return readOnlyTools;
  }

  /**
   * Get read-only tools list (cached for performance)
   */
  private getReadOnlyTools(): string[] {
    this.readOnlyToolsCache ??= this.buildReadOnlyToolsList();
    return this.readOnlyToolsCache;
  }

  /**
   * Build unified tool lookup cache for O(1) tool access with filtering applied.
   * @param instanceUrl — when provided, fetches tier/version/scopes for this
   *   specific instance URL instead of the default (currentInstanceUrl). Prevents
   *   cross-instance leakage when called from per-URL init/state-change events.
   */
  /** Load instance context (tier/version/scopes) for cache build and stats.
   *  Returns undefined fields when connection is not initialized. */
  private loadInstanceContext(instanceUrl?: string): {
    instanceInfo?: { tier: GitLabTier; version: string };
    tokenScopes?: GitLabScope[];
  } {
    let instanceInfo: { tier: GitLabTier; version: string } | undefined;
    try {
      const info = ConnectionManager.getInstance().getInstanceInfo(instanceUrl);
      instanceInfo = { tier: info.tier, version: info.version };
    } catch (err) {
      if (!isExpectedInitError(err)) throw err;
    }

    let tokenScopes: GitLabScope[] | undefined;
    try {
      const scopeInfo = ConnectionManager.getInstance().getTokenScopeInfo(instanceUrl);
      if (scopeInfo) {
        tokenScopes = scopeInfo.scopes;
      }
    } catch (err) {
      if (!isExpectedInitError(err)) throw err;
    }

    return { instanceInfo, tokenScopes };
  }

  /** Check if a tool should be included in the cache (passes all filters). */
  /** Why a tool was excluded from the cache. Returns null if tool should be included.
   *  Used by both buildToolLookupCache and getFilterStats to ensure consistent logic. */
  private getToolExclusionReason(
    toolName: string,
    tool: EnhancedToolDefinition,
    ctx: { instanceInfo?: { tier: GitLabTier; version: string }; tokenScopes?: GitLabScope[] },
  ): 'readOnly' | 'deniedRegex' | 'scopes' | 'tier' | 'actionDenial' | null {
    if (GITLAB_READ_ONLY_MODE && !this.getReadOnlyTools().includes(toolName)) return 'readOnly';
    if (GITLAB_DENIED_TOOLS_REGEX?.test(toolName)) return 'deniedRegex';
    if (ctx.tokenScopes && !isToolAvailableForScopes(toolName, ctx.tokenScopes)) return 'scopes';
    // Context tools (manage_context etc.) are always available regardless of
    // GitLab version/tier — they are local/session tools, not GitLab API tools.
    // Skip tier filtering for tools in the context registry.
    const isContextTool = this.registries.get('context')?.has(toolName) ?? false;
    if (
      !isContextTool &&
      ctx.instanceInfo &&
      ctx.instanceInfo.version !== 'unknown' &&
      !ToolAvailability.isToolAvailableForInstance(toolName, ctx.instanceInfo)
    )
      return 'tier';
    const allActions = extractActionsFromSchema(tool.inputSchema);
    if (allActions.length > 0 && shouldRemoveTool(toolName, allActions)) return 'actionDenial';
    return null;
  }

  /** Filter registries and build transformed tool map (schema + description overrides). */
  private buildFilteredTools(ctx: {
    instanceInfo?: { tier: GitLabTier; version: string };
    tokenScopes?: GitLabScope[];
  }): Map<string, EnhancedToolDefinition> {
    const result = new Map<string, EnhancedToolDefinition>();

    for (const [, registry] of this.registries) {
      for (const [toolName, tool] of registry) {
        const exclusion = this.getToolExclusionReason(toolName, tool, ctx);
        if (exclusion) {
          logDebug('Tool filtered out', { toolName, reason: exclusion });
          continue;
        }

        let transformedSchema = transformToolSchema(toolName, tool.inputSchema);

        // Strip tier-restricted parameters (skip when version unknown or not initialized)
        if (ctx.instanceInfo && ctx.instanceInfo.version !== 'unknown') {
          const restrictedParams = ToolAvailability.getRestrictedParameters(
            toolName,
            ctx.instanceInfo,
          );
          if (restrictedParams.length > 0) {
            transformedSchema = stripTierRestrictedParameters(transformedSchema, restrictedParams);
          }
        }

        const customDescription = this.descriptionOverrides.get(toolName);
        const finalTool = {
          ...tool,
          inputSchema: transformedSchema,
          ...(customDescription && { description: customDescription }),
        };

        if (customDescription) {
          logDebug('Applied description override', { toolName, customDescription });
        }

        result.set(toolName, finalTool);
      }
    }

    return result;
  }

  /** Resolve or strip Related: references in tool descriptions. */
  private postProcessRelatedReferences(cache: Map<string, EnhancedToolDefinition>): void {
    const availableToolNames = GITLAB_CROSS_REFS ? new Set(cache.keys()) : undefined;

    for (const [toolName, tool] of cache) {
      if (this.descriptionOverrides.has(toolName)) continue;
      const nextDescription = availableToolNames
        ? resolveRelatedReferences(tool.description, availableToolNames)
        : stripRelatedSection(tool.description);
      if (nextDescription !== tool.description) {
        cache.set(toolName, { ...tool, description: nextDescription });
      }
    }
  }

  /**
   * Resolve the cache key for a given (or default) instance URL.
   * Fallback chain: explicit URL → OAuth context → getCurrentInstanceUrl() → GITLAB_BASE_URL.
   * @param instanceUrl - Optional explicit instance URL
   * @returns Normalized instance URL for use as cache key
   */
  private resolveCacheUrl(instanceUrl?: string): string {
    if (instanceUrl) return normalizeInstanceUrl(instanceUrl);
    // Prefer OAuth request context URL (per-request, thread-safe) over the
    // mutable getCurrentInstanceUrl() singleton which may belong to a different
    // concurrent request.
    const contextUrl = getGitLabApiUrlFromContext();
    if (contextUrl) return normalizeInstanceUrl(contextUrl);
    try {
      const current = ConnectionManager.getInstance().getCurrentInstanceUrl();
      if (current) return normalizeInstanceUrl(current);
    } catch {
      // ConnectionManager not initialized yet — fall through to GITLAB_BASE_URL
    }
    return normalizeInstanceUrl(GITLAB_BASE_URL);
  }

  /**
   * Resolve the per-URL cache for the given (or default) instance.
   * Builds the cache on demand when it does not exist yet.
   * @param instanceUrl - Optional instance URL to resolve the correct per-URL cache
   * @returns The tool lookup cache for the resolved URL
   */
  private resolveCache(instanceUrl?: string): Map<string, EnhancedToolDefinition> {
    const url = this.resolveCacheUrl(instanceUrl);
    let cache = this.toolLookupCaches.get(url);
    if (!cache) {
      this.buildToolLookupCache(url);
      cache = this.toolLookupCaches.get(url);
    }
    return cache ?? new Map<string, EnhancedToolDefinition>();
  }

  private buildToolLookupCache(instanceUrl?: string): void {
    const url = this.resolveCacheUrl(instanceUrl);

    let ctx: ReturnType<RegistryManager['loadInstanceContext']>;
    try {
      ctx = this.loadInstanceContext(url);
    } catch (err) {
      // Fail-close: preserve previous cache instead of rebuilding with
      // empty context (which would surface tools the instance cannot use).
      logError('Unexpected error loading instance context; preserving previous cache', {
        error: err instanceof Error ? err.message : String(err),
        instanceUrl: url,
      });
      return;
    }

    // Build into a new map and swap atomically — prevents a concurrent
    // refreshCache from clearing the live cache between hasToolHandler()
    // and executeTool() in an in-flight request.
    const newCache = this.buildFilteredTools(ctx);
    this.postProcessRelatedReferences(newCache);

    // Atomic per-URL swap — in-flight requests that captured a reference
    // to the old map via getTool() keep working; new requests see the
    // updated cache for this URL
    this.toolLookupCaches.set(url, newCache);

    logDebug('Registry manager built cache after filtering', {
      toolCount: newCache.size,
      instanceUrl: url,
    });
  }

  /**
   * Invalidate derived caches for a specific URL and rebuild lookup cache.
   */
  private invalidateCaches(instanceUrl?: string): void {
    const url = this.resolveCacheUrl(instanceUrl);
    this.toolDefinitionsCaches.delete(url);
    this.toolNamesCaches.delete(url);
    // readOnlyToolsCache is derived from registries + config flags (USE_*),
    // not from instance URL — no need to clear on per-URL refresh.
    this.buildToolLookupCache(url);
  }

  /**
   * Get a tool by name - O(1) lookup using per-URL cache.
   * @param toolName - Tool name to look up
   * @param instanceUrl - Optional instance URL to resolve the correct per-URL cache
   */
  public getTool(toolName: string, instanceUrl?: string): EnhancedToolDefinition | null {
    return this.resolveCache(instanceUrl).get(toolName) ?? null;
  }

  /**
   * Execute a tool by name.
   * @param toolName - Tool name to execute
   * @param args - Tool arguments
   * @param instanceUrl - Optional instance URL to resolve the correct per-URL cache
   */
  public async executeTool(
    toolName: string,
    args: unknown,
    instanceUrl?: string,
  ): Promise<unknown> {
    const tool = this.getTool(toolName, instanceUrl);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in any registry`);
    }

    return await tool.handler(args);
  }

  /**
   * Clear all caches and rebuild (e.g., after ConnectionManager init provides tier/version).
   * @param instanceUrl — optional URL to fetch tier/version/scopes from. Prevents
   *   the cache from resolving zero-arg defaults to a stale currentInstanceUrl.
   */
  public refreshCache(instanceUrl?: string): void {
    this.invalidateCaches(instanceUrl);
  }

  /**
   * Get all tool definitions for a specific instance URL - cached per URL.
   * @param instanceUrl - Optional instance URL. When omitted, resolves via
   *   OAuth request context → getCurrentInstanceUrl() → GITLAB_BASE_URL
   */
  public getAllToolDefinitions(instanceUrl?: string): ToolDefinition[] {
    // url (resolved) is used as cache key — always non-undefined.
    // instanceUrl (raw) is passed to isUnreachableFor — preserves undefined
    // so that no-arg callers hit the global "all instances down" branch,
    // while explicit-URL callers get per-instance reachability.
    const url = this.resolveCacheUrl(instanceUrl);
    const cache = this.resolveCache(instanceUrl);
    const unreachableMode = this.isUnreachableFor(instanceUrl);
    // In unreachable mode, rebuild every call (transient state — don't cache
    // a context-only list that would persist after recovery)
    const cachedDefs = this.toolDefinitionsCaches.get(url);
    if (cachedDefs === undefined || unreachableMode) {
      const contextTools = unreachableMode ? this.registries.get('context') : null;

      const defs: ToolDefinition[] = [];
      for (const tool of cache.values()) {
        if (contextTools && !contextTools.has(tool.name)) continue;
        defs.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
      // Don't persist cache in unreachable mode — next call after recovery
      // should see full tool list
      if (unreachableMode) {
        return defs;
      }
      this.toolDefinitionsCaches.set(url, defs);
      return defs;
    }

    return cachedDefs;
  }

  /**
   * Get tool definitions without GitLab tier/version filtering (for CLI tools, documentation, etc.)
   * Dynamically checks environment filters at runtime to respect CLI-time environment variables
   * but bypasses ToolAvailability tier/version checks since no GitLab connection exists
   */
  public getAllToolDefinitionsTierless(): EnhancedToolDefinition[] {
    const allTools: EnhancedToolDefinition[] = [];

    // Dynamically check environment variables at runtime
    const isReadOnly = process.env.GITLAB_READ_ONLY_MODE === 'true';
    const deniedRegex = process.env.GITLAB_DENIED_TOOLS_REGEX
      ? new RegExp(process.env.GITLAB_DENIED_TOOLS_REGEX)
      : undefined;

    // Dynamically check USE_* flags at runtime
    const useLabels = process.env.USE_LABELS !== 'false';
    const useMrs = process.env.USE_MRS !== 'false';
    const useFiles = process.env.USE_FILES !== 'false';
    const useMilestone = process.env.USE_MILESTONE !== 'false';
    const usePipeline = process.env.USE_PIPELINE !== 'false';
    const useVariables = process.env.USE_VARIABLES !== 'false';
    const useWiki = process.env.USE_GITLAB_WIKI !== 'false';
    const useWorkitems = process.env.USE_WORKITEMS !== 'false';
    const useSnippets = process.env.USE_SNIPPETS !== 'false';
    const useWebhooks = process.env.USE_WEBHOOKS !== 'false';
    const useIntegrations = process.env.USE_INTEGRATIONS !== 'false';
    const useReleases = process.env.USE_RELEASES !== 'false';
    const useRefs = process.env.USE_REFS !== 'false';
    const useMembers = process.env.USE_MEMBERS !== 'false';
    const useSearch = process.env.USE_SEARCH !== 'false';
    const useIterations = process.env.USE_ITERATIONS !== 'false';

    // Build registries map based on dynamic feature flags
    const registriesToUse = new Map<string, ToolRegistry>();

    // Always add core tools
    registriesToUse.set('core', coreToolRegistry);

    // Always add context tools
    registriesToUse.set('context', contextToolRegistry);

    // Add tools based on dynamically checked feature flags
    if (useLabels) registriesToUse.set('labels', labelsToolRegistry);
    if (useMrs) registriesToUse.set('mrs', mrsToolRegistry);
    if (useFiles) registriesToUse.set('files', filesToolRegistry);
    if (useMilestone) registriesToUse.set('milestones', milestonesToolRegistry);
    if (usePipeline) registriesToUse.set('pipelines', pipelinesToolRegistry);
    if (useVariables) registriesToUse.set('variables', variablesToolRegistry);
    if (useWiki) registriesToUse.set('wiki', wikiToolRegistry);
    if (useWorkitems) registriesToUse.set('workitems', workitemsToolRegistry);
    if (useSnippets) registriesToUse.set('snippets', snippetsToolRegistry);
    if (useWebhooks) registriesToUse.set('webhooks', webhooksToolRegistry);
    if (useIntegrations) registriesToUse.set('integrations', integrationsToolRegistry);
    if (useReleases) registriesToUse.set('releases', releasesToolRegistry);
    if (useRefs) registriesToUse.set('refs', refsToolRegistry);
    if (useMembers) registriesToUse.set('members', membersToolRegistry);
    if (useSearch) registriesToUse.set('search', searchToolRegistry);
    if (useIterations) registriesToUse.set('iterations', iterationsToolRegistry);

    // Dynamically load description overrides
    const descOverrides = getToolDescriptionOverrides();

    for (const registry of registriesToUse.values()) {
      for (const [toolName, tool] of registry) {
        // Apply dynamically checked GITLAB_READ_ONLY_MODE filtering
        if (isReadOnly && !this.getReadOnlyTools().includes(toolName)) {
          continue;
        }

        // Apply dynamically checked GITLAB_DENIED_TOOLS_REGEX filtering
        if (deniedRegex?.test(toolName)) {
          continue;
        }

        // Check if all actions are denied for this CQRS tool
        const allActions = extractActionsFromSchema(tool.inputSchema);
        if (allActions.length > 0 && shouldRemoveTool(toolName, allActions)) {
          continue;
        }

        // Transform schema to remove denied actions and apply description overrides
        const transformedSchema = transformToolSchema(toolName, tool.inputSchema);

        // Apply dynamically loaded description override if available
        const customDescription = descOverrides.get(toolName);

        const finalTool: EnhancedToolDefinition = {
          ...tool,
          inputSchema: transformedSchema,
          ...(customDescription && { description: customDescription }),
        };

        allTools.push(finalTool);
      }
    }

    // Second pass: handle Related references based on GITLAB_CROSS_REFS setting
    const crossRefsEnabled = process.env.GITLAB_CROSS_REFS !== 'false';
    if (crossRefsEnabled) {
      // Resolve Related references against available tools
      const availableToolNames = new Set(allTools.map((t) => t.name));
      for (let i = 0; i < allTools.length; i++) {
        const tool = allTools[i];
        // Skip tools with custom description overrides
        if (descOverrides.has(tool.name)) continue;

        const resolved = resolveRelatedReferences(tool.description, availableToolNames);
        if (resolved !== tool.description) {
          allTools[i] = { ...tool, description: resolved };
        }
      }
    } else {
      // Cross-refs disabled: strip all "Related:" sections entirely
      for (let i = 0; i < allTools.length; i++) {
        const tool = allTools[i];
        if (descOverrides.has(tool.name)) continue;

        const stripped = stripRelatedSection(tool.description);
        if (stripped !== tool.description) {
          allTools[i] = { ...tool, description: stripped };
        }
      }
    }

    return allTools;
  }

  /**
   * Returns ALL tool definitions without any filtering or transformation.
   * Used for documentation generation (--export) where we need:
   * - Complete tool catalog regardless of environment configuration
   * - Original discriminated union schemas for rich action descriptions
   */
  public getAllToolDefinitionsUnfiltered(): EnhancedToolDefinition[] {
    const allTools: EnhancedToolDefinition[] = [];

    // All registries without any filtering
    const allRegistries: ToolRegistry[] = [
      coreToolRegistry,
      contextToolRegistry,
      labelsToolRegistry,
      mrsToolRegistry,
      filesToolRegistry,
      milestonesToolRegistry,
      pipelinesToolRegistry,
      variablesToolRegistry,
      wikiToolRegistry,
      workitemsToolRegistry,
      snippetsToolRegistry,
      webhooksToolRegistry,
      integrationsToolRegistry,
      releasesToolRegistry,
      refsToolRegistry,
      membersToolRegistry,
      searchToolRegistry,
      iterationsToolRegistry,
    ];

    for (const registry of allRegistries) {
      for (const [, tool] of registry) {
        // Return original schema without transformation
        // This preserves discriminated union structure for documentation
        allTools.push(tool);
      }
    }

    return allTools;
  }

  /**
   * Check if a tool exists in the per-URL cache - O(1) lookup.
   * @param toolName - Tool name to check
   * @param instanceUrl - Optional instance URL to resolve the correct per-URL cache
   */
  public hasToolHandler(toolName: string, instanceUrl?: string): boolean {
    return this.resolveCache(instanceUrl).has(toolName);
  }

  /**
   * Get all available tool names for a specific instance URL - cached per URL.
   * @param instanceUrl - Optional instance URL. When omitted, resolves via
   *   OAuth request context → getCurrentInstanceUrl() → GITLAB_BASE_URL
   */
  public getAvailableToolNames(instanceUrl?: string): string[] {
    // See getAllToolDefinitions for url vs instanceUrl rationale
    const url = this.resolveCacheUrl(instanceUrl);
    const cache = this.resolveCache(instanceUrl);
    const unreachableMode = this.isUnreachableFor(instanceUrl);
    const cachedNames = this.toolNamesCaches.get(url);
    if (cachedNames === undefined || unreachableMode) {
      const contextTools = unreachableMode ? this.registries.get('context') : null;
      const names = Array.from(cache.keys()).filter(
        (name) => !contextTools || contextTools.has(name),
      );
      if (unreachableMode) {
        return names;
      }
      this.toolNamesCaches.set(url, names);
      return names;
    }
    return cachedNames;
  }

  /**
   * Check if the given (or all) instances are unreachable.
   * When instanceUrl is provided, checks per-URL reachability.
   * When omitted, falls back to the global "all instances down" check.
   * @param instanceUrl - Optional instance URL for per-URL check
   * @returns True when the instance (or all instances) are unreachable
   */
  private isUnreachableFor(instanceUrl?: string): boolean {
    const healthMonitor = HealthMonitor.getInstance();
    if (instanceUrl) {
      try {
        // isInstanceReachable returns false for 'connecting', but we treat
        // connecting as reachable (optimistic during startup/reconnect)
        return (
          !healthMonitor.isInstanceReachable(instanceUrl) &&
          healthMonitor.getState(instanceUrl) !== 'connecting'
        );
      } catch {
        // HealthMonitor not initialized or URL not tracked — assume reachable
        return false;
      }
    }
    // Global fallback: all instances down
    return (
      healthMonitor.getMonitoredInstances().length > 0 && !healthMonitor.isAnyInstanceHealthy()
    );
  }

  /**
   * Aggregate per-tool exclusion counts across all registries.
   * Extracted from getFilterStats to keep cognitive complexity within limits.
   */
  private aggregateFilterCounters(
    ctx: ReturnType<RegistryManager['loadInstanceContext']>,
    contextTools: Map<string, EnhancedToolDefinition> | null | undefined,
  ): {
    available: number;
    byReadOnly: number;
    byDeniedRegex: number;
    byScopes: number;
    byTier: number;
    byActionDenial: number;
  } {
    const counts = {
      available: 0,
      byReadOnly: 0,
      byDeniedRegex: 0,
      byScopes: 0,
      byTier: 0,
      byActionDenial: 0,
    };

    const counterByReason: Record<string, keyof typeof counts> = {
      readOnly: 'byReadOnly',
      deniedRegex: 'byDeniedRegex',
      scopes: 'byScopes',
      tier: 'byTier',
      actionDenial: 'byActionDenial',
    };

    for (const registry of this.registries.values()) {
      for (const [toolName, tool] of registry) {
        if (contextTools && !contextTools.has(toolName)) continue;
        const reason = this.getToolExclusionReason(toolName, tool, ctx);
        if (!reason) {
          counts.available++;
        } else {
          const key = counterByReason[reason];
          if (key) counts[key]++;
        }
      }
    }

    return counts;
  }

  /**
   * Get filter statistics showing how tools were filtered
   * Used by whoami action to explain tool availability
   */
  public getFilterStats(instanceUrl?: string): FilterStats {
    // See getAllToolDefinitions for url vs instanceUrl rationale:
    // raw instanceUrl for reachability (preserves undefined → global fallback),
    // resolved url for instance context loading (avoids currentInstanceUrl leakage).
    const url = this.resolveCacheUrl(instanceUrl);
    const unreachableMode = this.isUnreachableFor(instanceUrl);
    const contextTools = unreachableMode ? this.registries.get('context') : null;

    // Count total tools — in unreachable mode, only context tools are in scope
    let totalTools = 0;
    for (const registry of this.registries.values()) {
      for (const [toolName] of registry) {
        if (contextTools && !contextTools.has(toolName)) continue;
        totalTools++;
      }
    }

    // Re-run filter logic with per-URL context — uses the resolved URL
    // so instance info/scopes match the same URL that caches are keyed by.
    let ctx: ReturnType<RegistryManager['loadInstanceContext']>;
    try {
      ctx = this.loadInstanceContext(url);
    } catch (err) {
      // Fail-close: derive stats from whatever is in the current lookup cache
      // rather than computing against empty context (which inflates 'available').
      logError('Unexpected error loading instance context for filter stats; using cached counts', {
        error: err instanceof Error ? err.message : String(err),
        instanceUrl: url,
      });
      const cached = this.toolLookupCaches.get(url);
      return {
        available: cached?.size ?? 0,
        total: totalTools,
        filteredByScopes: 0,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      };
    }

    const {
      available: availableTools,
      byReadOnly: filteredByReadOnly,
      byDeniedRegex: filteredByDeniedRegex,
      byScopes: filteredByScopes,
      byTier: filteredByTier,
      byActionDenial: filteredByActionDenial,
    } = this.aggregateFilterCounters(ctx, contextTools);

    return {
      available: availableTools,
      total: totalTools,
      filteredByScopes,
      filteredByReadOnly,
      filteredByTier,
      filteredByDeniedRegex,
      filteredByActionDenial,
    };
  }
}

/** Return true for errors that indicate the ConnectionManager is not yet
 *  initialised (expected during startup / before first connection). */
function isExpectedInitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('not initialized') ||
    msg.includes('not available') ||
    msg.includes('No connection')
  );
}

/**
 * Filter statistics interface
 */
export interface FilterStats {
  /** Number of tools available after filtering */
  available: number;
  /** Total number of registered tools */
  total: number;
  /** Tools filtered due to insufficient token scopes */
  filteredByScopes: number;
  /** Tools filtered due to read-only mode */
  filteredByReadOnly: number;
  /** Tools filtered due to GitLab tier/version restrictions */
  filteredByTier: number;
  /** Tools filtered due to denied tools regex */
  filteredByDeniedRegex: number;
  /** Tools filtered due to all actions being denied */
  filteredByActionDenial: number;
}

export { RegistryManager };
