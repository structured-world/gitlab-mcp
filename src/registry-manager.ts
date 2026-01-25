import { ToolRegistry, EnhancedToolDefinition, ToolDefinition } from "./types";
import { coreToolRegistry, getCoreReadOnlyToolNames } from "./entities/core/registry";
import { labelsToolRegistry, getLabelsReadOnlyToolNames } from "./entities/labels/registry";
import { mrsToolRegistry, getMrsReadOnlyToolNames } from "./entities/mrs/registry";
import { filesToolRegistry, getFilesReadOnlyToolNames } from "./entities/files/registry";
import {
  milestonesToolRegistry,
  getMilestonesReadOnlyToolNames,
} from "./entities/milestones/registry";
import {
  pipelinesToolRegistry,
  getPipelinesReadOnlyToolNames,
} from "./entities/pipelines/registry";
import {
  variablesToolRegistry,
  getVariablesReadOnlyToolNames,
} from "./entities/variables/registry";
import { wikiToolRegistry, getWikiReadOnlyToolNames } from "./entities/wiki/registry";
import {
  workitemsToolRegistry,
  getWorkitemsReadOnlyToolNames,
} from "./entities/workitems/registry";
import { webhooksToolRegistry, getWebhooksReadOnlyToolNames } from "./entities/webhooks/registry";
import { snippetsToolRegistry, getSnippetsReadOnlyToolNames } from "./entities/snippets/registry";
import {
  integrationsToolRegistry,
  getIntegrationsReadOnlyToolNames,
} from "./entities/integrations/registry";
import { releasesToolRegistry, getReleasesReadOnlyToolNames } from "./entities/releases/registry";
import { refsToolRegistry, getRefsReadOnlyToolNames } from "./entities/refs/registry";
import { membersToolRegistry, getMembersReadOnlyToolNames } from "./entities/members/registry";
import { searchToolRegistry, getSearchReadOnlyToolNames } from "./entities/search/registry";
import { contextToolRegistry, getContextReadOnlyToolNames } from "./entities/context/registry";
import {
  iterationsToolRegistry,
  getIterationsReadOnlyToolNames,
} from "./entities/iterations/registry";
import {
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
} from "./config";
import { ToolAvailability } from "./services/ToolAvailability";
import { ConnectionManager } from "./services/ConnectionManager";
import { isToolAvailableForScopes } from "./services/TokenScopeDetector";
import type { GitLabScope } from "./services/TokenScopeDetector";
import type { GitLabTier } from "./services/GitLabVersionDetector";
import { logDebug } from "./logger";
import {
  transformToolSchema,
  stripTierRestrictedParameters,
  shouldRemoveTool,
  extractActionsFromSchema,
} from "./utils/schema-utils";
import { resolveRelatedReferences, stripRelatedSection } from "./utils/description-utils";

/**
 * Central registry manager that aggregates tools from all entity registries
 * and provides a unified interface for tool discovery and execution
 */
class RegistryManager {
  private static instance: RegistryManager;
  private registries: Map<string, ToolRegistry> = new Map();

  // Performance optimization caches
  private toolLookupCache: Map<string, EnhancedToolDefinition> = new Map();
  private toolDefinitionsCache: ToolDefinition[] | null = null;
  private toolNamesCache: string[] | null = null;

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
    this.registries.set("core", coreToolRegistry);

    // Always add context tools (runtime context management)
    this.registries.set("context", contextToolRegistry);

    // Add tools based on feature flags
    if (USE_LABELS) {
      this.registries.set("labels", labelsToolRegistry);
    }

    if (USE_MRS) {
      this.registries.set("mrs", mrsToolRegistry);
    }

    if (USE_FILES) {
      this.registries.set("files", filesToolRegistry);
    }

    if (USE_MILESTONE) {
      this.registries.set("milestones", milestonesToolRegistry);
    }

    if (USE_PIPELINE) {
      this.registries.set("pipelines", pipelinesToolRegistry);
    }

    if (USE_VARIABLES) {
      this.registries.set("variables", variablesToolRegistry);
    }

    if (USE_GITLAB_WIKI) {
      this.registries.set("wiki", wikiToolRegistry);
    }

    if (USE_WORKITEMS) {
      this.registries.set("workitems", workitemsToolRegistry);
    }

    if (USE_SNIPPETS) {
      this.registries.set("snippets", snippetsToolRegistry);
    }

    if (USE_WEBHOOKS) {
      this.registries.set("webhooks", webhooksToolRegistry);
    }

    if (USE_INTEGRATIONS) {
      this.registries.set("integrations", integrationsToolRegistry);
    }

    if (USE_RELEASES) {
      this.registries.set("releases", releasesToolRegistry);
    }

    if (USE_REFS) {
      this.registries.set("refs", refsToolRegistry);
    }

    if (USE_MEMBERS) {
      this.registries.set("members", membersToolRegistry);
    }

    if (USE_SEARCH) {
      this.registries.set("search", searchToolRegistry);
    }

    if (USE_ITERATIONS) {
      this.registries.set("iterations", iterationsToolRegistry);
    }

    // All entity registries have been migrated to the new pattern!
  }

  /**
   * Load tool description overrides from environment variables
   */
  private loadDescriptionOverrides(): void {
    this.descriptionOverrides = getToolDescriptionOverrides();

    if (this.descriptionOverrides.size > 0) {
      logDebug("Loaded tool description overrides", { count: this.descriptionOverrides.size });
      for (const [toolName, description] of this.descriptionOverrides) {
        logDebug("Tool description override", { toolName, description });
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
   * Build unified tool lookup cache for O(1) tool access with filtering applied
   */
  private buildToolLookupCache(): void {
    this.toolLookupCache.clear();

    // Pre-fetch instance info once per cache build to avoid redundant calls
    let instanceInfo: { tier: GitLabTier; version: string } | undefined;
    try {
      const info = ConnectionManager.getInstance().getInstanceInfo();
      instanceInfo = { tier: info.tier, version: info.version };
    } catch {
      // Connection not initialized - parameter restrictions won't apply
    }

    // Pre-fetch token scope info for scope-based filtering
    let tokenScopes: GitLabScope[] | undefined;
    try {
      const scopeInfo = ConnectionManager.getInstance().getTokenScopeInfo();
      if (scopeInfo) {
        tokenScopes = scopeInfo.scopes;
      }
    } catch {
      // Connection not initialized - scope filtering won't apply
    }

    for (const registry of this.registries.values()) {
      for (const [toolName, tool] of registry) {
        // Apply GITLAB_READ_ONLY_MODE filtering at registry level
        if (GITLAB_READ_ONLY_MODE && !this.getReadOnlyTools().includes(toolName)) {
          logDebug("Tool filtered out: read-only mode", { toolName });
          continue;
        }

        // Apply GITLAB_DENIED_TOOLS_REGEX filtering at registry level
        if (GITLAB_DENIED_TOOLS_REGEX?.test(toolName)) {
          logDebug("Tool filtered out: matches denied regex", { toolName });
          continue;
        }

        // Apply token scope filtering - skip tools the token can't access
        if (tokenScopes && !isToolAvailableForScopes(toolName, tokenScopes)) {
          logDebug("Tool filtered out: insufficient token scopes", { toolName });
          continue;
        }

        // Apply GitLab version/tier filtering at registry level
        if (!ToolAvailability.isToolAvailable(toolName)) {
          const reason = ToolAvailability.getUnavailableReason(toolName);
          logDebug("Tool filtered out", { toolName, reason });
          continue;
        }

        // Check if all actions are denied for this CQRS tool
        const allActions = extractActionsFromSchema(tool.inputSchema);
        if (allActions.length > 0 && shouldRemoveTool(toolName, allActions)) {
          logDebug("Tool filtered out: all actions denied", { toolName });
          continue;
        }

        // Tool passes all filters - apply schema transformation and description override
        let finalTool = tool;

        // Transform schema to remove denied actions and apply description overrides
        let transformedSchema = transformToolSchema(toolName, tool.inputSchema);

        // Strip tier-restricted parameters from schema (skip if connection not initialized)
        if (instanceInfo) {
          const restrictedParams = ToolAvailability.getRestrictedParameters(toolName, instanceInfo);
          if (restrictedParams.length > 0) {
            transformedSchema = stripTierRestrictedParameters(transformedSchema, restrictedParams);
          }
        }

        // Apply tool-level description override if available
        const customDescription = this.descriptionOverrides.get(toolName);

        finalTool = {
          ...tool,
          inputSchema: transformedSchema,
          ...(customDescription && { description: customDescription }),
        };

        if (customDescription) {
          logDebug("Applied description override", { toolName, customDescription });
        }

        // Add to cache
        this.toolLookupCache.set(toolName, finalTool);
      }
    }

    // Second pass: handle Related references based on GITLAB_CROSS_REFS setting
    if (GITLAB_CROSS_REFS) {
      // Resolve Related references against available tools
      const availableToolNames = new Set(this.toolLookupCache.keys());
      for (const [toolName, tool] of this.toolLookupCache) {
        // Skip tools with custom description overrides (user controls entire description)
        if (this.descriptionOverrides.has(toolName)) continue;

        const resolved = resolveRelatedReferences(tool.description, availableToolNames);
        if (resolved !== tool.description) {
          this.toolLookupCache.set(toolName, { ...tool, description: resolved });
        }
      }
    } else {
      // Cross-refs disabled: strip all "Related:" sections entirely
      for (const [toolName, tool] of this.toolLookupCache) {
        if (this.descriptionOverrides.has(toolName)) continue;

        const stripped = stripRelatedSection(tool.description);
        if (stripped !== tool.description) {
          this.toolLookupCache.set(toolName, { ...tool, description: stripped });
        }
      }
    }

    logDebug("Registry manager built cache after filtering", {
      toolCount: this.toolLookupCache.size,
    });
  }

  /**
   * Invalidate all caches - call when registries change
   */
  private invalidateCaches(): void {
    this.toolDefinitionsCache = null;
    this.toolNamesCache = null;
    this.readOnlyToolsCache = null;
    this.buildToolLookupCache();
  }

  /**
   * Get a tool by name from any registry - O(1) lookup using cache
   */
  public getTool(toolName: string): EnhancedToolDefinition | null {
    return this.toolLookupCache.get(toolName) ?? null;
  }

  /**
   * Execute a tool by name
   */
  public async executeTool(toolName: string, args: unknown): Promise<unknown> {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in any registry`);
    }

    return await tool.handler(args);
  }

  /**
   * Clear all caches and rebuild (e.g., after ConnectionManager init provides tier/version)
   */
  public refreshCache(): void {
    this.invalidateCaches();
  }

  /**
   * Get all tool definitions (for backward compatibility with tools.ts) - cached for performance
   */
  public getAllToolDefinitions(): ToolDefinition[] {
    if (this.toolDefinitionsCache === null) {
      // Build cache
      this.toolDefinitionsCache = [];

      for (const tool of this.toolLookupCache.values()) {
        this.toolDefinitionsCache.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return this.toolDefinitionsCache;
  }

  /**
   * Get tool definitions without GitLab tier/version filtering (for CLI tools, documentation, etc.)
   * Dynamically checks environment filters at runtime to respect CLI-time environment variables
   * but bypasses ToolAvailability tier/version checks since no GitLab connection exists
   */
  public getAllToolDefinitionsTierless(): EnhancedToolDefinition[] {
    const allTools: EnhancedToolDefinition[] = [];

    // Dynamically check environment variables at runtime
    const isReadOnly = process.env.GITLAB_READ_ONLY_MODE === "true";
    const deniedRegex = process.env.GITLAB_DENIED_TOOLS_REGEX
      ? new RegExp(process.env.GITLAB_DENIED_TOOLS_REGEX)
      : undefined;

    // Dynamically check USE_* flags at runtime
    const useLabels = process.env.USE_LABELS !== "false";
    const useMrs = process.env.USE_MRS !== "false";
    const useFiles = process.env.USE_FILES !== "false";
    const useMilestone = process.env.USE_MILESTONE !== "false";
    const usePipeline = process.env.USE_PIPELINE !== "false";
    const useVariables = process.env.USE_VARIABLES !== "false";
    const useWiki = process.env.USE_GITLAB_WIKI !== "false";
    const useWorkitems = process.env.USE_WORKITEMS !== "false";
    const useSnippets = process.env.USE_SNIPPETS !== "false";
    const useWebhooks = process.env.USE_WEBHOOKS !== "false";
    const useIntegrations = process.env.USE_INTEGRATIONS !== "false";
    const useReleases = process.env.USE_RELEASES !== "false";
    const useRefs = process.env.USE_REFS !== "false";
    const useMembers = process.env.USE_MEMBERS !== "false";
    const useSearch = process.env.USE_SEARCH !== "false";
    const useIterations = process.env.USE_ITERATIONS !== "false";

    // Build registries map based on dynamic feature flags
    const registriesToUse = new Map<string, ToolRegistry>();

    // Always add core tools
    registriesToUse.set("core", coreToolRegistry);

    // Always add context tools
    registriesToUse.set("context", contextToolRegistry);

    // Add tools based on dynamically checked feature flags
    if (useLabels) registriesToUse.set("labels", labelsToolRegistry);
    if (useMrs) registriesToUse.set("mrs", mrsToolRegistry);
    if (useFiles) registriesToUse.set("files", filesToolRegistry);
    if (useMilestone) registriesToUse.set("milestones", milestonesToolRegistry);
    if (usePipeline) registriesToUse.set("pipelines", pipelinesToolRegistry);
    if (useVariables) registriesToUse.set("variables", variablesToolRegistry);
    if (useWiki) registriesToUse.set("wiki", wikiToolRegistry);
    if (useWorkitems) registriesToUse.set("workitems", workitemsToolRegistry);
    if (useSnippets) registriesToUse.set("snippets", snippetsToolRegistry);
    if (useWebhooks) registriesToUse.set("webhooks", webhooksToolRegistry);
    if (useIntegrations) registriesToUse.set("integrations", integrationsToolRegistry);
    if (useReleases) registriesToUse.set("releases", releasesToolRegistry);
    if (useRefs) registriesToUse.set("refs", refsToolRegistry);
    if (useMembers) registriesToUse.set("members", membersToolRegistry);
    if (useSearch) registriesToUse.set("search", searchToolRegistry);
    if (useIterations) registriesToUse.set("iterations", iterationsToolRegistry);

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
    const crossRefsEnabled = process.env.GITLAB_CROSS_REFS !== "false";
    if (crossRefsEnabled) {
      // Resolve Related references against available tools
      const availableToolNames = new Set(allTools.map(t => t.name));
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
   * Check if a tool exists in any registry - O(1) lookup using cache
   */
  public hasToolHandler(toolName: string): boolean {
    return this.toolLookupCache.has(toolName);
  }

  /**
   * Get all available tool names - cached for performance
   */
  public getAvailableToolNames(): string[] {
    this.toolNamesCache ??= Array.from(this.toolLookupCache.keys());

    return this.toolNamesCache;
  }

  /**
   * Get filter statistics showing how tools were filtered
   * Used by whoami action to explain tool availability
   */
  public getFilterStats(): FilterStats {
    // Count total tools across all registries
    let totalTools = 0;
    for (const registry of this.registries.values()) {
      totalTools += registry.size;
    }

    const availableTools = this.toolLookupCache.size;

    // Calculate filtered counts by re-running filter logic
    let filteredByReadOnly = 0;
    let filteredByDeniedRegex = 0;
    let filteredByScopes = 0;
    let filteredByTier = 0;
    let filteredByActionDenial = 0;

    // Get token scopes for scope filtering check
    let tokenScopes: GitLabScope[] | undefined;
    try {
      const scopeInfo = ConnectionManager.getInstance().getTokenScopeInfo();
      if (scopeInfo) {
        tokenScopes = scopeInfo.scopes;
      }
    } catch {
      // Connection not initialized
    }

    for (const registry of this.registries.values()) {
      for (const [toolName, tool] of registry) {
        // Check if already in cache (passed all filters)
        if (this.toolLookupCache.has(toolName)) {
          continue;
        }

        // Tool was filtered - determine why (in same order as buildToolLookupCache)
        if (GITLAB_READ_ONLY_MODE && !this.getReadOnlyTools().includes(toolName)) {
          filteredByReadOnly++;
          continue;
        }

        if (GITLAB_DENIED_TOOLS_REGEX?.test(toolName)) {
          filteredByDeniedRegex++;
          continue;
        }

        if (tokenScopes && !isToolAvailableForScopes(toolName, tokenScopes)) {
          filteredByScopes++;
          continue;
        }

        if (!ToolAvailability.isToolAvailable(toolName)) {
          filteredByTier++;
          continue;
        }

        // Check if all actions are denied for this CQRS tool
        const allActions = extractActionsFromSchema(tool.inputSchema);
        if (allActions.length > 0 && shouldRemoveTool(toolName, allActions)) {
          filteredByActionDenial++;
          continue;
        }

        // Unknown filtering reason - count as tier
        filteredByTier++;
      }
    }

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
