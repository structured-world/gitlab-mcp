/**
 * Unit tests for server.ts
 * Tests server initialization, transport mode detection, and server setup
 */

// Mock all external dependencies at the top
const mockServer = {
  connect: jest.fn()
};

const mockApp = {
  use: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  listen: jest.fn()
};

const mockTransport = {
  sessionId: 'test-session-123'
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Mock Express
const mockExpress = jest.fn(() => mockApp);
(mockExpress as any).json = jest.fn();
jest.mock('express', () => mockExpress);

// Mock SDK components
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => mockServer)
}));

jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn(() => mockTransport)
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(() => mockTransport)
}));

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn(() => mockTransport)
}));

// Mock config
jest.mock('../../src/config', () => ({
  SSE: false,
  STREAMABLE_HTTP: false,
  HOST: 'localhost',
  PORT: '3000',
  packageName: 'test-package',
  packageVersion: '1.0.0'
}));

// Mock types
jest.mock('../../src/types', () => ({}));

// Mock handlers
jest.mock('../../src/handlers', () => ({
  setupHandlers: jest.fn()
}));

// Mock logger
jest.mock('../../src/logger', () => ({
  logger: mockLogger
}));

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { startServer } from '../../src/server';

describe('server', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    // Store original values
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };

    // Reset to default state
    process.argv = ['node', 'server.js'];
    delete process.env.SSE;
    delete process.env.STREAMABLE_HTTP;

    // Mock app.listen to call callback immediately
    mockApp.listen.mockImplementation((port: number, host: string, callback: () => void) => {
      if (callback) callback();
    });

    // Mock server.connect to resolve
    mockServer.connect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Restore original values
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe('transport mode detection', () => {
    it('should select SSE mode when sse argument is provided', async () => {
      process.argv = ['node', 'server.js', 'sse'];

      await startServer();

      expect(mockLogger.info).toHaveBeenCalledWith('Selected SSE mode');
      expect(mockApp.get).toHaveBeenCalledWith('/sse', expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith('/messages', expect.any(Function));
      expect(mockApp.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
    });

    it('should select SSE mode when SSE environment variable is set', async () => {
      process.env.SSE = 'true';

      // Re-import to pick up new env vars
      jest.resetModules();
      jest.doMock('../../src/config', () => ({
        SSE: true,
        STREAMABLE_HTTP: false,
        HOST: 'localhost',
        PORT: '3000',
        packageName: 'test-package',
        packageVersion: '1.0.0'
      }));

      const { startServer: newStartServer } = await import('../../src/server');
      await newStartServer();

      expect(mockLogger.info).toHaveBeenCalledWith('Selected SSE mode');
    });

    it('should select streamable-http mode when streamable-http argument is provided', async () => {
      process.argv = ['node', 'server.js', 'streamable-http'];

      await startServer();

      expect(mockLogger.info).toHaveBeenCalledWith('Selected streamable-http mode');
      expect(mockApp.post).toHaveBeenCalledWith('/mcp', expect.any(Function));
      expect(mockApp.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
    });

    it('should select streamable-http mode when STREAMABLE_HTTP environment variable is set', async () => {
      process.env.STREAMABLE_HTTP = 'true';

      // Re-import to pick up new env vars
      jest.resetModules();
      jest.doMock('../../src/config', () => ({
        SSE: false,
        STREAMABLE_HTTP: true,
        HOST: 'localhost',
        PORT: '3000',
        packageName: 'test-package',
        packageVersion: '1.0.0'
      }));

      const { startServer: newStartServer } = await import('../../src/server');
      await newStartServer();

      expect(mockLogger.info).toHaveBeenCalledWith('Selected streamable-http mode');
    });

    it('should default to stdio mode when no arguments or env vars are provided', async () => {
      await startServer();

      expect(mockLogger.info).toHaveBeenCalledWith('Defaulting to stdio mode');
      expect(mockServer.connect).toHaveBeenCalled();
    });

    it('should log transport mode detection information', async () => {
      await startServer();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Transport mode detection: args=[], SSE=false, STREAMABLE_HTTP=false'
      );
    });
  });

  describe('SSE mode', () => {
    beforeEach(() => {
      process.argv = ['node', 'server.js', 'sse'];
    });

    it('should set up Express app with JSON middleware', async () => {
      const express = require('express');

      await startServer();

      expect(express).toHaveBeenCalled();
      expect(mockApp.use).toHaveBeenCalledWith(express.json());
    });

    it('should set up SSE endpoint that creates transport and connects server', async () => {
      await startServer();

      // Get the SSE endpoint handler
      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === '/sse')[1];

      // Mock response object
      const mockRes = {};
      const mockReq = {};

      // Call the handler
      await sseHandler(mockReq, mockRes);

      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
    });

    it('should set up messages endpoint for handling JSON-RPC messages', async () => {
      await startServer();

      expect(mockApp.post).toHaveBeenCalledWith('/messages', expect.any(Function));
    });

    it('should start HTTP server on configured host and port', async () => {
      await startServer();

      expect(mockApp.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
      expect(mockLogger.info).toHaveBeenCalledWith('GitLab MCP Server SSE running on http://localhost:3000');
      expect(mockLogger.info).toHaveBeenCalledWith('SSE server started successfully');
    });
  });

  describe('streamable-http mode', () => {
    beforeEach(() => {
      process.argv = ['node', 'server.js', 'streamable-http'];
    });

    it('should set up Express app for streamable HTTP', async () => {
      const express = require('express');

      await startServer();

      expect(express).toHaveBeenCalled();
      expect(mockApp.use).toHaveBeenCalledWith(express.json());
    });

    it('should set up message endpoint for streamable HTTP transport', async () => {
      await startServer();

      expect(mockApp.post).toHaveBeenCalledWith('/mcp', expect.any(Function));
    });

    it('should start HTTP server for streamable HTTP mode', async () => {
      await startServer();

      expect(mockApp.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
      expect(mockLogger.info).toHaveBeenCalledWith('GitLab MCP Server HTTP running on http://localhost:3000');
    });
  });

  describe('stdio mode', () => {
    it('should connect server with StdioServerTransport', async () => {
      await startServer();

      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
    });

    it('should not set up any HTTP endpoints in stdio mode', async () => {
      await startServer();

      expect(mockApp.get).not.toHaveBeenCalled();
      expect(mockApp.post).not.toHaveBeenCalled();
      expect(mockApp.listen).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle server connection errors in stdio mode', async () => {
      mockServer.connect.mockRejectedValue(new Error('Connection failed'));

      // stdio mode should propagate connection errors
      await expect(startServer()).rejects.toThrow('Connection failed');
    });

    it('should handle server.connect rejections gracefully', async () => {
      const originalConnect = mockServer.connect;
      mockServer.connect.mockRejectedValue(new Error('Connection failed'));

      try {
        await startServer();
      } catch (error) {
        expect(error.message).toBe('Connection failed');
      }

      // Restore original mock
      mockServer.connect = originalConnect;
    });
  });

  describe('request handlers', () => {
    describe('SSE messages endpoint', () => {
      beforeEach(() => {
        process.argv = ['node', 'server.js', 'sse'];
      });

      it('should handle valid session ID in messages endpoint', async () => {
        await startServer();

        // Get the messages handler
        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === '/messages')[1];

        // Mock request with session ID
        const mockReq = {
          query: { sessionId: 'test-session-123' },
          body: { method: 'test', params: {} }
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes)
        };

        // First create a transport through SSE endpoint
        const sseHandler = mockApp.get.mock.calls.find(call => call[0] === '/sse')[1];
        await sseHandler({}, {});

        // Now call messages handler
        await messagesHandler(mockReq, mockRes);

        expect(mockLogger.debug).toHaveBeenCalledWith('Messages endpoint hit!');
      });

      it('should return 404 for invalid session ID', async () => {
        await startServer();

        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === '/messages')[1];

        const mockReq = {
          query: { sessionId: 'invalid-session' },
          body: { method: 'test', params: {} }
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes)
        };

        await messagesHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' });
      });

      it('should return 404 when no session ID provided', async () => {
        await startServer();

        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === '/messages')[1];

        const mockReq = {
          query: {},
          body: { method: 'test', params: {} }
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes)
        };

        await messagesHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' });
      });
    });
  });

  // Note: setupHandlers integration is tested separately in handlers.test.ts
});