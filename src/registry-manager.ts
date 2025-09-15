import { ToolRegistry, EnhancedToolDefinition, ToolDefinition } from './types';
import { coreToolRegistry } from './entities/core/registry';
import { labelsToolRegistry } from './entities/labels/registry';
import { mrsToolRegistry } from './entities/mrs/registry';
import { filesToolRegistry } from './entities/files/registry';
import { milestonesToolRegistry } from './entities/milestones/registry';
import { pipelinesToolRegistry } from './entities/pipelines/registry';
import { variablesToolRegistry } from './entities/variables/registry';
import { wikiToolRegistry } from './entities/wiki/registry';
import { workitemsToolRegistry } from './entities/workitems/registry';
import {
  GITLAB_READ_ONLY_MODE,
  GITLAB_DENIED_TOOLS_REGEX,
  USE_GITLAB_WIKI,
  USE_MILESTONE,
  USE_PIPELINE,
  USE_WORKITEMS,
  USE_LABELS,
  USE_MRS,
  USE_FILES,
  USE_VARIABLES,
  getToolDescriptionOverrides,
} from './config';
import { readOnlyTools } from './tools';
import { ToolAvailability } from './services/ToolAvailability';
import { logger } from './logger';

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

    // All entity registries have been migrated to the new pattern!
  }

  /**
   * Load tool description overrides from environment variables
   */
  private loadDescriptionOverrides(): void {
    this.descriptionOverrides = getToolDescriptionOverrides();

    if (this.descriptionOverrides.size > 0) {
      logger.debug(`Loaded ${this.descriptionOverrides.size} tool description overrides`);
      for (const [toolName, description] of this.descriptionOverrides) {
        logger.debug(`Tool description override: ${toolName} -> "${description}"`);
      }
    }
  }

  /**
   * Build unified tool lookup cache for O(1) tool access with filtering applied
   */
  private buildToolLookupCache(): void {
    this.toolLookupCache.clear();

    for (const registry of this.registries.values()) {
      for (const [toolName, tool] of registry) {
        // Apply GITLAB_READ_ONLY_MODE filtering at registry level
        if (GITLAB_READ_ONLY_MODE && !readOnlyTools.includes(toolName)) {
          logger.debug(`Tool '${toolName}' filtered out: read-only mode`);
          continue;
        }

        // Apply GITLAB_DENIED_TOOLS_REGEX filtering at registry level
        if (GITLAB_DENIED_TOOLS_REGEX?.test(toolName)) {
          logger.debug(`Tool '${toolName}' filtered out: matches denied regex`);
          continue;
        }

        // Apply GitLab version/tier filtering at registry level
        if (!ToolAvailability.isToolAvailable(toolName)) {
          const reason = ToolAvailability.getUnavailableReason(toolName);
          logger.debug(`Tool '${toolName}' filtered out: ${reason}`);
          continue;
        }

        // Tool passes all filters - apply description override if available
        let finalTool = tool;
        const customDescription = this.descriptionOverrides.get(toolName);
        if (customDescription) {
          finalTool = {
            ...tool,
            description: customDescription,
          };
          logger.debug(`Applied description override for '${toolName}': "${customDescription}"`);
        }

        // Add to cache
        this.toolLookupCache.set(toolName, finalTool);
      }
    }

    logger.debug(
      `Registry manager built cache with ${this.toolLookupCache.size} tools after filtering`,
    );
  }

  /**
   * Invalidate all caches - call when registries change
   */
  private invalidateCaches(): void {
    this.toolDefinitionsCache = null;
    this.toolNamesCache = null;
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
}

export { RegistryManager };
