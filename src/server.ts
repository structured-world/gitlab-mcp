import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as express from "express";
import { SSE, STREAMABLE_HTTP, HOST, PORT } from "./config";
import { TransportMode } from "./types";
import { packageName, packageVersion } from "./config";
import { setupHandlers } from "./handlers";
import { logger } from "./http";

// Create server instance
export const server = new Server(
  {
    name: packageName,
    version: packageVersion,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Terminal colors for logging
const colorGreen = "\x1b[32m";
const colorReset = "\x1b[0m";

function determineTransportMode(): TransportMode {
  const args = process.argv.slice(2);

  if (args.includes("sse") || SSE) {
    return "sse" as TransportMode;
  }

  if (args.includes("streamable-http") || STREAMABLE_HTTP) {
    return "streamable-http" as TransportMode;
  }

  return "stdio" as TransportMode;
}

export async function startServer(): Promise<void> {
  // Setup request handlers
  setupHandlers(server);

  const transportMode = determineTransportMode();

  switch (transportMode) {
    case "stdio": {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info("GitLab MCP Server running on stdio");
      break;
    }

    case "sse": {
      const app = express();

      app.get("/sse", async (req, res) => {
        const transport = new SSEServerTransport("/messages", res);
        await server.connect(transport);
      });

      app.listen(Number(PORT), HOST, () => {
        const url = `http://${HOST}:${PORT}`;
        logger.info(`GitLab MCP Server SSE running on ${url}`);
        console.error(`${colorGreen}GitLab MCP Server SSE running on ${url}${colorReset}`);
      });
      break;
    }

    case "streamable-http": {
      const app = express();
      app.use(express.json());

      const streamableTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

      app.post("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string;
        try {
          let transport: StreamableHTTPServerTransport;
          if (sessionId in streamableTransports) {
            transport = streamableTransports[sessionId];
            await transport.handleRequest(req, res, req.body);
          } else {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => Math.random().toString(36).substring(7),
              onsessioninitialized: (newSessionId: string) => {
                streamableTransports[newSessionId] = transport;
                logger.info(`HTTP session initialized: ${newSessionId}`);
              },
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
          }
        } catch (error: unknown) {
          logger.error({ err: error }, "Error in HTTP transport");
          res.status(500).json({ error: "Internal server error" });
        }
      });

      app.listen(Number(PORT), HOST, () => {
        const url = `http://${HOST}:${PORT}`;
        logger.info(`GitLab MCP Server HTTP running on ${url}`);
        console.error(`${colorGreen}GitLab MCP Server HTTP running on ${url}${colorReset}`);
      });
      break;
    }
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("Shutting down GitLab MCP Server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Shutting down GitLab MCP Server...");
  process.exit(0);
});
