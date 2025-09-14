// Conditional exports based on GITLAB_READONLY environment variable
const isReadOnly = process.env.GITLAB_READONLY === "true";

// Always export shared schemas
export * from "../shared";

// Always export read-only schemas and tools
export * from "./schema-readonly";
export * from "./tools-readonly";

// Import write modules conditionally but export them always
// The schemas are just type definitions, so exporting them doesn't hurt
// The actual control is in the tools array
export * from "./schema";
export * from "./tools";

// Import tool arrays
import { workitemsReadOnlyToolsArray } from "./tools-readonly";
import { workitemsWriteTools } from "./tools";
import type { ToolDefinition } from "../../types";

// Create combined or read-only tools array based on environment
export const workitemsTools: ToolDefinition[] = isReadOnly
  ? workitemsReadOnlyToolsArray
  : [...workitemsReadOnlyToolsArray, ...workitemsWriteTools];

// Export read-only tool names for backward compatibility
export const workitemsReadOnlyTools = workitemsReadOnlyToolsArray.map(tool => tool.name);
