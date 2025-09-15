/* eslint-disable no-unused-vars */
import { ConnectionManager } from '../services/ConnectionManager';

/**
 * Dynamic function factory that creates handler functions for all tools
 * and binds them to actual GitLab API implementations
 */

// Generic function that makes actual GitLab API calls
async function makeGitLabApiCall(toolName: string, args: unknown): Promise<unknown> {
  console.log(`Executing ${toolName} with args:`, args);

  // Dynamic import to get actual handlers
  const { getHandlerForTool } = await import('./handler-dispatcher');

  try {
    // Try to get the specific handler for this tool
    const handler = await getHandlerForTool(toolName);
    if (handler) {
      return await handler(args);
    }

    // Fallback to connection manager for basic info
    const connectionManager = ConnectionManager.getInstance();
    const instanceInfo = connectionManager.getInstanceInfo();

    return {
      success: false,
      tool: toolName,
      arguments: args,
      gitlab_instance: {
        version: instanceInfo.version,
        tier: instanceInfo.tier,
        features: Object.keys(instanceInfo.features).slice(0, 5),
      },
      error: `No handler found for tool '${toolName}'`,
      message: `Tool '${toolName}' is not yet implemented`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      tool: toolName,
      arguments: args,
      error: errorMessage,
      message: `Error executing tool '${toolName}': ${errorMessage}`,
    };
  }
}

// Function factory that creates handler functions dynamically
export async function createDynamicHandlers(): Promise<
  Record<string, (args: unknown) => Promise<unknown>>
> {
  // Dynamic import to avoid circular dependency
  const { getFilteredTools } = await import('../tools');
  const tools = getFilteredTools();
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};

  // Create a handler function for each tool
  for (const tool of tools) {
    const toolName = tool.name;
    const handlerName = `handle${toolName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')}`;

    // Create the handler function
    handlers[handlerName] = async (args: unknown) => {
      return await makeGitLabApiCall(toolName, args);
    };

    console.log(`Created handler: ${handlerName} -> ${toolName}`);
  }

  return handlers;
}

// Lazy-loaded handlers to avoid circular dependency issues
let _dynamicHandlers: Record<string, (args: unknown) => Promise<unknown>> | null = null;

export async function getDynamicHandlers(): Promise<
  Record<string, (args: unknown) => Promise<unknown>>
> {
  if (!_dynamicHandlers) {
    _dynamicHandlers = await createDynamicHandlers();
    console.log(`Dynamic handlers created for ${Object.keys(_dynamicHandlers).length} tools`);
  }
  return _dynamicHandlers;
}
