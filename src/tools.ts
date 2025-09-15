import {
  coreTools,
  coreReadOnlyTools,
  labelsTools,
  labelsReadOnlyTools,
  mrsTools,
  mrsReadOnlyTools,
  // Legacy imports for entities not yet migrated
  wikiTools,
  wikiReadOnlyTools,
  milestoneTools,
  milestoneReadOnlyTools,
  pipelineTools,
  pipelineReadOnlyTools,
  workitemsTools,
  workitemsReadOnlyTools,
  filesTools,
  filesReadOnlyTools,
  variablesTools,
  variablesReadOnlyTools,
} from './entities';
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
} from './config';
import { ToolDefinition } from './types';
import { ToolAvailability } from './services/ToolAvailability';
import { logger } from './logger';

// Build all available tools by combining entities based on configuration
function buildAllTools(): ToolDefinition[] {
  let tools: ToolDefinition[] = [];

  // Add tools from migrated entities (using new registry system)
  tools.push(...coreTools);

  if (USE_LABELS) {
    tools.push(...labelsTools);
  }

  if (USE_MRS) {
    tools.push(...mrsTools);
  }

  // Legacy entities (not yet migrated to registry system)

  // Add file tools if enabled
  if (USE_FILES) {
    tools.push(...filesTools);
  }

  // Add wiki tools if enabled
  if (USE_GITLAB_WIKI) {
    tools.push(...wikiTools);
  }

  // Add milestone tools if enabled
  if (USE_MILESTONE) {
    tools.push(...milestoneTools);
  }

  // Add pipeline tools if enabled
  if (USE_PIPELINE) {
    tools.push(...pipelineTools);
  }

  // Add workitems tools if enabled
  if (USE_WORKITEMS) {
    tools.push(...workitemsTools);
  }

  // Add variables tools if enabled
  if (USE_VARIABLES) {
    tools.push(...variablesTools);
  }

  return tools;
}

// All available tools (dynamically built based on configuration)
export const allTools: ToolDefinition[] = buildAllTools();

// Build read-only tools list based on enabled entities
function buildReadOnlyTools(): string[] {
  let readOnly: string[] = [];

  // Add read-only tools from migrated entities (using new registry system)
  readOnly.push(...coreReadOnlyTools);

  if (USE_LABELS) {
    readOnly.push(...labelsReadOnlyTools);
  }

  if (USE_MRS) {
    readOnly.push(...mrsReadOnlyTools);
  }

  // Legacy entities (not yet migrated to registry system)

  if (USE_FILES) {
    readOnly.push(...filesReadOnlyTools);
  }

  if (USE_GITLAB_WIKI) {
    readOnly.push(...wikiReadOnlyTools);
  }

  if (USE_MILESTONE) {
    readOnly.push(...milestoneReadOnlyTools);
  }

  if (USE_PIPELINE) {
    readOnly.push(...pipelineReadOnlyTools);
  }

  if (USE_WORKITEMS) {
    readOnly.push(...workitemsReadOnlyTools);
  }

  if (USE_VARIABLES) {
    readOnly.push(...variablesReadOnlyTools);
  }

  return readOnly;
}

// Define which tools are read-only (dynamically built based on configuration)
export const readOnlyTools = buildReadOnlyTools();

/**
 * Get filtered tools based on configuration, version, and tier
 */
export function getFilteredTools(): ToolDefinition[] {
  let tools = [...allTools];

  // Filter out read-only tools if in read-only mode
  if (GITLAB_READ_ONLY_MODE) {
    tools = tools.filter((tool) => readOnlyTools.includes(tool.name));
  }

  // Filter out tools matching the denied regex
  if (GITLAB_DENIED_TOOLS_REGEX) {
    const regex = GITLAB_DENIED_TOOLS_REGEX;
    tools = tools.filter((tool) => !regex.test(tool.name));
  }

  // Filter out tools that are not available for the current GitLab version/tier
  const availableTools: ToolDefinition[] = [];
  for (const tool of tools) {
    if (ToolAvailability.isToolAvailable(tool.name)) {
      availableTools.push(tool);
    } else {
      const reason = ToolAvailability.getUnavailableReason(tool.name);
      logger.debug(`Tool '${tool.name}' filtered out: ${reason}`);
    }
  }

  return availableTools;
}
