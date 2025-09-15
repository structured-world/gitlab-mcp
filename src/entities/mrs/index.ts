// Always export shared schemas
export * from '../shared';

// Always export read-only schemas and tools (for backward compatibility)
export * from './schema-readonly';
export * from './tools-readonly';

// Export write schemas (for backward compatibility)
export * from './schema';
export * from './tools';

// Export the new unified registry
export * from './registry';

// Import from the new registry
import { getFilteredMrsTools, getMrsReadOnlyToolNames } from './registry';
import type { ToolDefinition } from '../../types';

// Conditional exports based on GITLAB_READONLY environment variable
const isReadOnly = process.env.GITLAB_READONLY === 'true';

// Get tools from the new registry (with backward compatibility)
const mrsToolsFromRegistry = getFilteredMrsTools(isReadOnly);

// Convert enhanced tool definitions to regular tool definitions for backward compatibility
export const mrsTools: ToolDefinition[] = mrsToolsFromRegistry.map(
  (tool): ToolDefinition => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }),
);

// Export read-only tool names for backward compatibility
export const mrsReadOnlyTools = getMrsReadOnlyToolNames();
