import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getFilteredTools } from './tools';
import { ConnectionManager } from './services/ConnectionManager';
// Import all handler functions that will be implemented
// TODO: Import actual handler functions once we extract them

export async function setupHandlers(server: Server): Promise<void> {
  // Initialize connection and detect GitLab instance on startup
  const connectionManager = ConnectionManager.getInstance();
  try {
    await connectionManager.initialize();
    // Logger is handled inside ConnectionManager
  } catch {
    // Logger is handled inside ConnectionManager
    // Continue without version detection - tools will handle gracefully
  }
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = getFilteredTools();

    // Remove $schema for Gemini compatibility and ensure proper JSON schema format
    const modifiedTools = tools.map((tool) => {
      let inputSchema = tool.inputSchema;

      // Force all input schemas to be type: "object" for MCP compatibility
      if (inputSchema && typeof inputSchema === 'object') {
        inputSchema = { ...inputSchema, type: 'object' };
      }

      // Remove $schema for Gemini compatibility
      if (inputSchema && typeof inputSchema === 'object' && '$schema' in inputSchema) {
        const cleanedSchema = { ...inputSchema } as Record<string, unknown>;
        delete cleanedSchema.$schema;
        inputSchema = cleanedSchema;
      }

      return { ...tool, inputSchema };
    });

    return {
      tools: modifiedTools,
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (!request.params.arguments) {
        throw new Error('Arguments are required');
      }

      console.log(`Tool called: ${request.params.name}`);

      // Check if connection is initialized - try to initialize if needed
      const connectionManager = ConnectionManager.getInstance();
      try {
        // Try to get client first
        connectionManager.getClient();
        const instanceInfo = connectionManager.getInstanceInfo();
        console.log(`Connection verified: ${instanceInfo.version} ${instanceInfo.tier}`);
      } catch {
        console.log('Connection not initialized, attempting to initialize...');
        try {
          await connectionManager.initialize();
          connectionManager.getClient();
          const instanceInfo = connectionManager.getInstanceInfo();
          console.log(`Connection initialized: ${instanceInfo.version} ${instanceInfo.tier}`);
        } catch (initError) {
          console.error('Connection initialization failed:', initError);
          throw new Error('Bad Request: Server not initialized');
        }
      }

      // Dynamic tool dispatch using naming convention
      const toolName = request.params.name;
      const handlerName = `handle${toolName
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')}`;

      try {
        // Import the dynamic handlers function
        const { getDynamicHandlers } = await import('./entities');
        const dynamicHandlers = await getDynamicHandlers();
        const handler = dynamicHandlers[handlerName];

        console.log(`Looking for handler: ${handlerName}`);
        console.log(`Available dynamic handlers:`, Object.keys(dynamicHandlers));

        if (!handler || typeof handler !== 'function') {
          throw new Error(
            `Handler function '${handlerName}' not found in dynamic handlers. Available handlers: ${Object.keys(dynamicHandlers).join(', ')}`,
          );
        }

        // Execute the handler
        // eslint-disable-next-line no-unused-vars
        const handlerFn = handler as (args: unknown) => Promise<unknown>;
        const result = await handlerFn(request.params.arguments);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (importError) {
        const errorMessage =
          importError instanceof Error ? importError.message : String(importError);
        throw new Error(`Failed to import handler ${handlerName}: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error in tool handler:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });
}
