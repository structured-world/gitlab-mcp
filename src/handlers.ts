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
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    try {
      if (!request.params.arguments) {
        throw new Error('Arguments are required');
      }

      console.log(`Tool called: ${request.params.name}`);

      // TODO: Implement actual tool handlers
      // For now, return a placeholder
      return {
        content: [
          {
            type: 'text',
            text: `Tool ${request.params.name} called with arguments: ${JSON.stringify(request.params.arguments, null, 2)}`,
          },
        ],
      };
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
