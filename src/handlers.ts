import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get tools from registry manager (already filtered)
    const { RegistryManager } = await import('./registry-manager');
    const registryManager = RegistryManager.getInstance();
    const tools = registryManager.getAllToolDefinitions();

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

      // Dynamic tool dispatch using the new registry manager
      const toolName = request.params.name;

      try {
        // Import the registry manager
        const { RegistryManager } = await import('./registry-manager');
        const registryManager = RegistryManager.getInstance();

        // Check if tool exists and passes all filtering (applied at registry level)
        if (!registryManager.hasToolHandler(toolName)) {
          throw new Error(`Tool '${toolName}' is not available or has been filtered out`);
        }

        console.log(`Executing tool: ${toolName}`);

        // Execute the tool using the registry manager
        const result = await registryManager.executeTool(toolName, request.params.arguments);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to execute tool '${toolName}': ${errorMessage}`);
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
