import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { SSE, STREAMABLE_HTTP, HOST, PORT } from './config';
import { TransportMode } from './types';
import { packageName, packageVersion } from './config';
import { setupHandlers } from './handlers';
import { logger } from './logger';

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
  },
);

// Terminal colors for logging (currently unused)
// const colorGreen = '\x1b[32m';
// const colorReset = '\x1b[0m';

function determineTransportMode(): TransportMode {
  const args = process.argv.slice(2);

  logger.info(
    `Transport mode detection: args=${JSON.stringify(args)}, SSE=${SSE}, STREAMABLE_HTTP=${STREAMABLE_HTTP}`,
  );

  if (args.includes('sse') || SSE) {
    logger.info('Selected SSE mode');
    return 'sse' as TransportMode;
  }

  if (args.includes('streamable-http') || STREAMABLE_HTTP) {
    logger.info('Selected streamable-http mode');
    return 'streamable-http' as TransportMode;
  }

  logger.info('Defaulting to stdio mode');
  return 'stdio' as TransportMode;
}

export async function startServer(): Promise<void> {
  // Setup request handlers
  await setupHandlers(server);

  const transportMode = determineTransportMode();

  switch (transportMode) {
    case 'stdio': {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('GitLab MCP Server running on stdio');
      break;
    }

    case 'sse': {
      logger.info('Setting up SSE mode with MCP SDK...');
      const app = express();
      app.use(express.json());

      const sseTransports: { [sessionId: string]: SSEServerTransport } = {};

      // SSE endpoint for establishing the stream
      app.get('/sse', async (req, res) => {
        logger.debug('SSE endpoint hit!');
        const transport = new SSEServerTransport('/messages', res);

        // Connect the server to this transport (this calls start() automatically)
        await server.connect(transport);

        // Store transport by session ID for message routing
        const sessionId = transport.sessionId;
        sseTransports[sessionId] = transport;
        logger.debug(`SSE transport created with session: ${sessionId}`);
      });

      // Messages endpoint for receiving JSON-RPC messages
      app.post('/messages', async (req, res) => {
        logger.debug('Messages endpoint hit!');
        const sessionId = req.query.sessionId as string;

        if (!sessionId || !sseTransports[sessionId]) {
          return res.status(404).json({ error: 'Session not found' });
        }

        try {
          const transport = sseTransports[sessionId];
          await transport.handlePostMessage(req, res, req.body);
        } catch (error: unknown) {
          logger.error({ err: error }, 'Error handling SSE message');
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      app.listen(Number(PORT), HOST, () => {
        const url = `http://${HOST}:${PORT}`;
        logger.info(`GitLab MCP Server SSE running on ${url}`);
        logger.info('SSE server started successfully');
      });
      break;
    }

    case 'streamable-http': {
      const app = express();
      app.use(express.json());

      const streamableTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

      app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string;
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
          logger.error({ err: error }, 'Error in HTTP transport');
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      app.listen(Number(PORT), HOST, () => {
        const url = `http://${HOST}:${PORT}`;
        logger.info(`GitLab MCP Server HTTP running on ${url}`);
      });
      break;
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down GitLab MCP Server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down GitLab MCP Server...');
  process.exit(0);
});
