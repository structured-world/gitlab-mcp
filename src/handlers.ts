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

    // Remove $schema for Gemini compatibility
    const modifiedTools = tools.map((tool) => {
      if ('$schema' in tool.inputSchema) {
        const inputSchema = { ...tool.inputSchema } as Record<string, unknown>;
        delete inputSchema.$schema;
        return { ...tool, inputSchema };
      }
      return tool;
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
