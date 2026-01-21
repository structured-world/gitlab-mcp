// Always export shared schemas
export * from "../shared";

// Export types
export * from "./types";

// Export schema
export * from "./schema";

// Export context manager
export * from "./context-manager";

// Export handlers
export * from "./handlers";

// Export registry
export * from "./registry";

// Import from registry for convenience exports
import {
  getFilteredContextTools,
  getContextReadOnlyToolNames,
  contextToolRegistry,
} from "./registry";
import type { ToolDefinition } from "../../types";

// Conditional exports based on GITLAB_READ_ONLY_MODE environment variable
const isReadOnly = process.env.GITLAB_READ_ONLY_MODE === "true";

// Get tools from registry (with backward compatibility)
const contextToolsFromRegistry = getFilteredContextTools(isReadOnly);

// Convert enhanced tool definitions to regular tool definitions for backward compatibility
export const contextTools: ToolDefinition[] = contextToolsFromRegistry.map(
  (tool): ToolDefinition => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })
);

// Export read-only tool names for backward compatibility
export const contextReadOnlyTools = getContextReadOnlyToolNames();

// Export registry for direct access
export { contextToolRegistry };
