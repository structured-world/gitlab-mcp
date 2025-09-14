import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getFilteredTools } from "./tools";
import { logger } from "./http";
// Import all handler functions that will be implemented
// TODO: Import actual handler functions once we extract them

export function setupHandlers(server: Server): void {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = getFilteredTools();

    // Remove $schema for Gemini compatibility
    const modifiedTools = tools.map(tool => {
      if ("$schema" in tool.inputSchema) {
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
  server.setRequestHandler(CallToolRequestSchema, request => {
    try {
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      logger.info({ tool: request.params.name }, "Tool called");

      // TODO: Implement actual tool handlers
      // For now, return a placeholder
      return {
        content: [
          {
            type: "text",
            text: `Tool ${request.params.name} called with arguments: ${JSON.stringify(request.params.arguments, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      logger.error({ err: error as unknown }, "Error in tool handler");
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });
}
