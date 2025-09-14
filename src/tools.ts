import {
  coreTools,
  coreReadOnlyTools,
  wikiTools,
  wikiReadOnlyTools,
  milestoneTools,
  milestoneReadOnlyTools,
  pipelineTools,
  pipelineReadOnlyTools,
  workitemsTools,
  workitemsReadOnlyTools,
} from "./entities";
import {
  GITLAB_READ_ONLY_MODE,
  GITLAB_DENIED_TOOLS_REGEX,
  USE_GITLAB_WIKI,
  USE_MILESTONE,
  USE_PIPELINE,
  USE_WORKITEMS,
} from "./config";
import { ToolDefinition } from "./types";

// Build all available tools by combining entities based on configuration
function buildAllTools(): ToolDefinition[] {
  let tools: ToolDefinition[] = [...coreTools];

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

  return tools;
}

// All available tools (dynamically built based on configuration)
export const allTools: ToolDefinition[] = buildAllTools();

// Build read-only tools list based on enabled entities
function buildReadOnlyTools(): string[] {
  let readOnly: string[] = [...coreReadOnlyTools];

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

  return readOnly;
}

// Define which tools are read-only (dynamically built based on configuration)
export const readOnlyTools = buildReadOnlyTools();

/**
 * Get filtered tools based on configuration
 */
export function getFilteredTools(): ToolDefinition[] {
  let tools = [...allTools];

  // Filter out read-only tools if in read-only mode
  if (GITLAB_READ_ONLY_MODE) {
    tools = tools.filter(tool => readOnlyTools.includes(tool.name));
  }

  // Filter out tools matching the denied regex
  if (GITLAB_DENIED_TOOLS_REGEX) {
    const regex = GITLAB_DENIED_TOOLS_REGEX;
    tools = tools.filter(tool => !regex.test(tool.name));
  }

  return tools;
}
