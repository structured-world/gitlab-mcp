/**
 * Unit tests for server.ts
 * Tests server initialization, transport mode detection, and server setup
 */

// Mock all external dependencies at the top
const mockServer = {
  connect: jest.fn(),
  notification: jest.fn().mockResolvedValue(undefined),
};

const mockSessionManager = {
  start: jest.fn(),
  createSession: jest.fn().mockResolvedValue(mockServer),
  touchSession: jest.fn(),
  removeSession: jest.fn().mockResolvedValue(undefined),
  broadcastToolsListChanged: jest.fn().mockResolvedValue(undefined),
  shutdown: jest.fn().mockResolvedValue(undefined),
  activeSessionCount: 0,
};

const mockHttpServer = {
  listen: jest.fn(),
  on: jest.fn(),
  keepAliveTimeout: 0,
  headersTimeout: 0,
  timeout: 0,
};

const mockApp = {
  use: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  all: jest.fn(),
  listen: jest.fn(),
  set: jest.fn(),
};

const mockTransport = {
  sessionId: "test-session-123",
  handleRequest: jest.fn(),
  handlePostMessage: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockLogDebug = jest.fn();

// Mock Express
const mockExpress = jest.fn(() => mockApp);
(mockExpress as any).json = jest.fn();
jest.mock("express", () => mockExpress);

// Mock http module to prevent actual server creation
jest.mock("http", () => ({
  createServer: jest.fn(() => mockHttpServer),
}));

// Mock SDK components
jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn(() => mockServer),
}));

jest.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: jest.fn(() => mockTransport),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn(() => mockTransport),
}));

// Store StreamableHTTP constructor options for testing callbacks
let lastStreamableOpts: {
  sessionIdGenerator?: () => string;
  onsessioninitialized?: (id: string) => void;
  onsessionclosed?: (id: string) => void;
} | null = null;

jest.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: jest.fn((opts?: Record<string, unknown>) => {
    lastStreamableOpts = opts as typeof lastStreamableOpts;
    return mockTransport;
  }),
}));

// Mock config
jest.mock("../../src/config", () => ({
  SSE: false,
  STREAMABLE_HTTP: false,
  HOST: "localhost",
  PORT: "3000",
  SSE_HEARTBEAT_MS: 30000,
  HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
  packageName: "test-package",
  packageVersion: "1.0.0",
  LOG_FORMAT: "condensed",
  LOG_FILTER: [],
  shouldSkipAccessLogRequest: jest.fn(() => false),
}));

// Mock types
jest.mock("../../src/types", () => ({}));

// Mock handlers
jest.mock("../../src/handlers", () => ({
  setupHandlers: jest.fn(),
}));

// Mock logger
jest.mock("../../src/logger", () => ({
  logger: mockLogger,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
  logError: mockLogError,
  logDebug: mockLogDebug,
  // Real implementation - pure function with no side effects
  truncateId: (id: string) => (id.length <= 10 ? id : id.substring(0, 4) + ".." + id.slice(-4)),
}));

// Mock OAuth config module
jest.mock("../../src/oauth/index", () => ({
  loadOAuthConfig: jest.fn(() => null),
  validateStaticConfig: jest.fn(),
  isOAuthEnabled: jest.fn(() => false),
  getAuthModeDescription: jest.fn(() => "Static token mode"),
  sessionStore: {
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    associateMcpSession: jest.fn(),
    removeMcpSessionAssociation: jest.fn(),
  },
  runWithTokenContext: jest.fn(),
}));

// Mock session manager
jest.mock("../../src/session-manager", () => ({
  getSessionManager: jest.fn(() => mockSessionManager),
}));

import type { Server as _Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startServer, sendToolsListChangedNotification } from "../../src/server";
import { sessionStore as mockSessionStore } from "../../src/oauth/index";

describe("server", () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["setTimeout", "setImmediate", "clearTimeout", "Date"] });
    jest.clearAllMocks();
    lastStreamableOpts = null;

    // Store original values
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };

    // Reset to default state
    process.argv = ["node", "server.js"];
    delete process.env.SSE;
    delete process.env.STREAMABLE_HTTP;

    // Mock httpServer.listen to call callback immediately
    mockHttpServer.listen.mockImplementation((port: number, host: string, callback: () => void) => {
      if (callback) callback();
    });

    // Reset HTTP server timeout properties
    mockHttpServer.keepAliveTimeout = 0;
    mockHttpServer.headersTimeout = 0;
    mockHttpServer.timeout = 0;

    // Mock server.connect to resolve
    mockServer.connect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clear all pending timers (SSE heartbeat intervals)
    jest.clearAllTimers();
    jest.useRealTimers();

    // Restore original values
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe("transport mode detection", () => {
    it("should select stdio mode when stdio argument is provided", async () => {
      process.argv = ["node", "server.js", "stdio"];
      delete process.env.PORT;

      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith("Selected stdio mode (explicit argument)");
    });

    it("should select dual transport mode when PORT environment variable is set", async () => {
      process.env.PORT = "3000";

      // Re-import to pick up new env vars
      jest.resetModules();
      jest.doMock("../../src/config", () => ({
        HOST: "localhost",
        PORT: "3000",
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [],
        shouldSkipAccessLogRequest: jest.fn(() => false),
      }));

      const { startServer: newStartServer } = await import("../../src/server");
      await newStartServer();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "Selected dual transport mode (SSE + StreamableHTTP) - PORT environment variable detected"
      );
    });

    it("should select stdio mode when no PORT is set", async () => {
      delete process.env.PORT;
      process.argv = ["node", "server.js"];

      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "Selected stdio mode (no PORT environment variable)"
      );
    });

    it("should log transport mode detection information", async () => {
      delete process.env.PORT;

      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "Transport mode detection",
        expect.objectContaining({ args: [], PORT: "3000" })
      );
    });
  });

  describe("dual transport mode", () => {
    beforeEach(() => {
      process.env.PORT = "3000";
    });

    it("should set up Express app with JSON middleware", async () => {
      const express = require("express");

      await startServer();

      expect(express).toHaveBeenCalled();
      expect(mockApp.use).toHaveBeenCalledWith(express.json());
    });

    it("should set up both SSE and StreamableHTTP endpoints", async () => {
      await startServer();

      expect(mockApp.get).toHaveBeenCalledWith("/sse", expect.any(Function));
      expect(mockApp.post).toHaveBeenCalledWith("/messages", expect.any(Function));
      expect(mockApp.all).toHaveBeenCalledWith(["/", "/mcp"], expect.any(Function));
    });

    it("should register /health endpoint for load balancer health checks", async () => {
      await startServer();

      expect(mockApp.get).toHaveBeenCalledWith("/health", expect.any(Function));
    });

    it("should return JSON status from /health endpoint", async () => {
      await startServer();

      // Get the /health handler
      const healthHandler = mockApp.get.mock.calls.find(
        (call: [string, (...args: unknown[]) => unknown]) => call[0] === "/health"
      )?.[1];
      expect(healthHandler).toBeDefined();

      // Mock response object
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      // Execute the health handler
      healthHandler({}, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ status: "ok" });
    });

    it("should start HTTP server with dual transport endpoints", async () => {
      await startServer();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, "localhost", expect.any(Function));
      expect(mockLogInfo).toHaveBeenCalledWith("GitLab MCP Server running", {
        url: "http://localhost:3000",
      });
      expect(mockLogInfo).toHaveBeenCalledWith("Dual Transport Mode Active");
    });

    it("should log access log filter rules count when LOG_FILTER has rules", async () => {
      // Reset modules to allow re-mock with non-empty LOG_FILTER
      jest.resetModules();
      jest.doMock("../../src/config", () => ({
        SSE: false,
        STREAMABLE_HTTP: false,
        HOST: "localhost",
        PORT: "3000",
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [{ method: "get", path: "/", userAgent: "test" }],
        shouldSkipAccessLogRequest: jest.fn(() => false),
      }));

      const { startServer: newStartServer } = await import("../../src/server");
      await newStartServer();

      expect(mockLogInfo).toHaveBeenCalledWith("Access log filter rules active", { count: 1 });
    });

    it("should skip access logging for requests matching LOG_FILTER", async () => {
      // Reset modules to set up shouldSkipAccessLogRequest to return true
      jest.resetModules();
      const mockSkipFn = jest.fn(() => true);
      jest.doMock("../../src/config", () => ({
        SSE: false,
        STREAMABLE_HTTP: false,
        HOST: "localhost",
        PORT: "3000",
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [{ method: "get", path: "/" }],
        shouldSkipAccessLogRequest: mockSkipFn,
      }));

      const { startServer: newStartServer } = await import("../../src/server");
      await newStartServer();

      // Get the access logging middleware (first app.use call after json middleware)
      const middlewareCalls = mockApp.use.mock.calls;
      // Find the middleware that's a function (not express.json)
      const accessLogMiddleware = middlewareCalls.find(
        (call: [unknown]) =>
          typeof call[0] === "function" && call[0] !== (mockExpress as any).json()
      )?.[0] as ((req: any, res: any, next: () => void) => void) | undefined;

      expect(accessLogMiddleware).toBeDefined();

      // Mock req, res, next
      const mockReq = { method: "GET", path: "/", headers: {} };
      const mockRes = { locals: {}, on: jest.fn() };
      const mockNext = jest.fn();

      // Call middleware - should skip logging because shouldSkipAccessLogRequest returns true
      accessLogMiddleware!(mockReq, mockRes, mockNext);

      // Verify next() was called (request proceeds)
      expect(mockNext).toHaveBeenCalled();
      // Verify shouldSkipAccessLogRequest was called
      expect(mockSkipFn).toHaveBeenCalledWith(mockReq);
    });

    it("should handle SSE endpoint requests", async () => {
      await startServer();

      // Get the SSE handler
      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      // Mock request and response objects
      const mockReq = {};
      const mockRes = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };

      // Execute the SSE handler
      await sseHandler(mockReq, mockRes);

      // Per-session Server created via session manager
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        "test-session-123",
        expect.anything()
      );
      expect(mockLogDebug).toHaveBeenCalledWith("SSE endpoint hit!");
    });

    it("should handle messages endpoint with valid session", async () => {
      await startServer();

      // Get the messages handler
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Mock request and response objects
      const mockReq = {
        query: { sessionId: "test-session-123" },
        body: { id: 1, method: "test", params: {} },
      };
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      // Mock transport exists
      const _transport = { handleRequest: jest.fn().mockResolvedValue({ result: "success" }) };

      // Execute the messages handler
      await messagesHandler(mockReq, mockRes);

      expect(mockLogDebug).toHaveBeenCalledWith("SSE messages endpoint hit!");
    });

    it("should handle messages endpoint with missing session", async () => {
      await startServer();

      // Get the messages handler
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Mock request and response objects with missing sessionId
      const mockReq = {
        query: {},
        body: { id: 1, method: "test", params: {} },
      };
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      // Execute the messages handler
      await messagesHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Session not found" });
    });

    it("should handle messages endpoint errors", async () => {
      await startServer();

      // Get the messages handler
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Mock request and response objects
      const mockReq = {
        query: { sessionId: "test-session-123" },
        body: { id: 1, method: "test", params: {} },
      };
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      // Mock transport error
      const _transport = {
        handleRequest: jest.fn().mockRejectedValue(new Error("Transport error")),
      };

      // Execute the messages handler (this should catch the error)
      await messagesHandler(mockReq, mockRes);

      expect(mockLogDebug).toHaveBeenCalledWith("SSE messages endpoint hit!");
    });

    it("should handle MCP endpoint requests", async () => {
      await startServer();

      // Get the MCP handler
      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Mock request and response objects
      const mockReq = {
        method: "POST",
        path: "/mcp",
        headers: { "content-type": "application/json" },
        body: { id: 1, method: "test", params: {} },
      };
      const mockRes = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        locals: {}, // Required for OAuth session tracking
      };

      // Execute the MCP handler — creates StreamableHTTPServerTransport
      // Session server is created via onsessioninitialized callback (async)
      await mcpHandler(mockReq, mockRes);

      // Transport's handleRequest should have been called
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it("should handle server listen callback", async () => {
      await startServer();

      // Get the listen callback
      const listenCallback = mockHttpServer.listen.mock.calls[0][2];

      // Execute the callback
      listenCallback();

      expect(mockLogInfo).toHaveBeenCalledWith("GitLab MCP Server running", {
        url: "http://localhost:3000",
      });
    });

    it("should handle SSE transport errors", async () => {
      await startServer();

      // Get the messages handler
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Mock request with valid session but transport throws error
      const mockReq = {
        query: { sessionId: "test-session-123" },
        body: { method: "test", params: {} },
      };
      const mockRes = {
        json: jest.fn(),
        status: jest.fn(() => mockRes),
      };

      // Mock transport with error
      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      // Create transport by hitting SSE endpoint first
      await sseHandler({}, { on: jest.fn() });

      // Execute the messages handler (this would normally fail if transport throws error)
      await messagesHandler(mockReq, mockRes);

      expect(mockLogDebug).toHaveBeenCalledWith("SSE messages endpoint hit!");
    });
  });

  describe("transport mode determination", () => {
    it("should select stdio mode with explicit stdio argument", async () => {
      process.env.PORT = "3000"; // Even with PORT, stdio arg should override
      process.argv = ["node", "server.js", "stdio"];

      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith("Selected stdio mode (explicit argument)");
      // In stdio mode, session manager creates a session for the single transport
      expect(mockSessionManager.createSession).toHaveBeenCalledWith("stdio", mockTransport);
    });

    it("should select dual mode when PORT is set without stdio arg", async () => {
      process.env.PORT = "3000";
      process.argv = ["node", "server.js"]; // No stdio arg

      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "Selected dual transport mode (SSE + StreamableHTTP) - PORT environment variable detected"
      );
      expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, "localhost", expect.any(Function));
    });
  });

  describe("individual transport modes", () => {
    it("should handle SSE mode error cases in dual mode", async () => {
      process.env.PORT = "3000";
      await startServer();

      // Get the SSE messages handler from dual mode
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Test error case in messages handler
      const mockReq = {
        query: { sessionId: "test-session-123" },
        body: { test: "data" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: false,
      };

      // Mock transport.handlePostMessage to throw error
      mockTransport.handlePostMessage.mockRejectedValueOnce(new Error("Transport error"));

      // First create SSE transport by hitting SSE endpoint
      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];
      await sseHandler({}, { on: jest.fn() });

      // Now test error handling in messages handler
      await messagesHandler(mockReq, mockRes);

      expect(mockLogDebug).toHaveBeenCalledWith("SSE messages endpoint hit!");
    });

    it("should handle StreamableHTTP mode error cases in dual mode", async () => {
      process.env.PORT = "3000";
      await startServer();

      // Get the MCP handler from dual mode
      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Test error case in MCP handler
      const mockReq = {
        headers: { "mcp-session-id": "existing-session" },
        method: "POST",
        path: "/mcp",
        body: { test: "data" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: false,
        locals: {},
      };

      // Mock transport.handleRequest to throw error
      mockTransport.handleRequest.mockRejectedValueOnce(new Error("Transport error"));

      // Test error handling in MCP handler
      await mcpHandler(mockReq, mockRes);

      expect(mockLogError).toHaveBeenCalledWith("Error in StreamableHTTP transport", {
        err: expect.any(Error),
      });
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });

    it("should handle StreamableHTTP new session creation in dual mode", async () => {
      process.env.PORT = "3000";
      await startServer();

      // Get the MCP handler from dual mode
      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Test new session creation (no existing session ID)
      const mockReq = {
        headers: {}, // No mcp-session-id header
        method: "POST",
        path: "/mcp",
        body: { test: "data" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: false,
        locals: {},
      };

      // Server is connected BEFORE handleRequest via createSession
      await mcpHandler(mockReq, mockRes);

      // createSession is called with a pre-generated session ID and the transport
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything()
      );
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it("should create session before handling request in StreamableHTTP", async () => {
      process.env.PORT = "3000";

      // Track call order to verify createSession happens before handleRequest
      const callOrder: string[] = [];
      mockSessionManager.createSession.mockImplementation(async () => {
        callOrder.push("createSession");
        return mockServer;
      });
      mockTransport.handleRequest.mockImplementation(async () => {
        callOrder.push("handleRequest");
      });

      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      const mockReq = {
        headers: {},
        method: "POST",
        path: "/mcp",
        body: { jsonrpc: "2.0", method: "initialize", id: 1 },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: false,
        locals: {},
      };

      await mcpHandler(mockReq, mockRes);

      // createSession MUST be called before handleRequest
      expect(callOrder).toEqual(["createSession", "handleRequest"]);
    });

    it("should not send 500 when headers already sent in SSE messages handler", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];
      const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

      // Create SSE transport first
      await sseHandler({}, { on: jest.fn() });

      // Mock transport error
      mockTransport.handlePostMessage.mockRejectedValueOnce(new Error("Stream error"));

      const mockReq = {
        query: { sessionId: "test-session-123" },
        body: { method: "test" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: true, // Headers already sent (streaming in progress)
      };

      await messagesHandler(mockReq, mockRes);

      // Should NOT call res.status when headers are already sent
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should not send 500 when headers already sent in StreamableHTTP handler", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Mock createSession to throw after transport is created
      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Server init failed"));

      const mockReq = {
        headers: {},
        method: "POST",
        path: "/mcp",
        body: { method: "initialize" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: true, // Simulate headers already sent
        locals: {},
      };

      await mcpHandler(mockReq, mockRes);

      // Should NOT call res.status when headers are already sent
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should clean up SSE session when client disconnects", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      // Capture the 'close' event handler
      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: () => void) => {
          if (event === "close") closeHandler = handler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      expect(mockRes.on).toHaveBeenCalledWith("close", expect.any(Function));
      expect(closeHandler).not.toBeNull();

      // Simulate client disconnect
      closeHandler!();

      expect(mockSessionManager.removeSession).toHaveBeenCalledWith("test-session-123");
    });

    it("should handle createSession failure in SSE endpoint", async () => {
      process.env.PORT = "3000";

      // Make createSession fail
      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Session init failed"));

      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
        headersSent: false,
      };

      await sseHandler({}, mockRes);

      // Should log the error and return 500
      expect(mockLogError).toHaveBeenCalledWith("Failed to create SSE session", {
        err: expect.any(Error),
        sessionId: "test-session-123",
      });
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.end).toHaveBeenCalled();
      // close handler should NOT be registered since session creation failed
      expect(mockRes.on).not.toHaveBeenCalled();
    });

    it("should not send 500 in SSE if headers already sent when createSession fails", async () => {
      process.env.PORT = "3000";

      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Session init failed"));

      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
        headersSent: true, // SSE headers already sent
      };

      await sseHandler({}, mockRes);

      // Should NOT call res.status when headers are already sent
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should handle createSession failure in StreamableHTTP new session", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // createSession fails
      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Handler setup failed"));

      const mockReq = {
        headers: {},
        method: "POST",
        path: "/mcp",
        body: { method: "initialize" },
      };
      const mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(),
        headersSent: false,
        locals: {},
      };

      await mcpHandler(mockReq, mockRes);

      // Error should be caught and 500 returned
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });

    it("should invoke onsessioninitialized and register transport", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Trigger new session creation
      await mcpHandler(
        { headers: {}, method: "POST", path: "/mcp", body: {} },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false, locals: {} }
      );

      // onsessioninitialized should have been captured
      expect(lastStreamableOpts).not.toBeNull();
      expect(lastStreamableOpts!.onsessioninitialized).toBeDefined();

      // Call onsessioninitialized to simulate SDK behavior
      const sessionId = lastStreamableOpts!.sessionIdGenerator!();
      lastStreamableOpts!.onsessioninitialized!(sessionId);

      expect(mockLogInfo).toHaveBeenCalledWith("MCP session initialized", {
        sessionId,
        method: "POST",
      });
    });

    it("should associate OAuth session in onsessioninitialized when authenticated", async () => {
      process.env.PORT = "3000";
      await startServer();

      // Get the MCP handler registered for dual mode
      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Request with OAuth credentials in res.locals
      const mockReq = {
        headers: {},
        method: "POST",
        path: "/mcp",
        body: {},
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        locals: {
          oauthSessionId: "oauth-session-123",
          gitlabToken: "test-token",
          gitlabUserId: 42,
          gitlabUsername: "testuser",
        },
      };

      await mcpHandler(mockReq, mockRes);

      // onsessioninitialized was captured — verify the callback handles OAuth association
      expect(lastStreamableOpts).not.toBeNull();
      expect(lastStreamableOpts!.onsessioninitialized).toBeDefined();

      // Simulate SDK calling onsessioninitialized
      const sessionId = lastStreamableOpts!.sessionIdGenerator!();
      lastStreamableOpts!.onsessioninitialized!(sessionId);

      // The closure should have captured oauthSessionId from res.locals
      expect(mockSessionStore.associateMcpSession).toHaveBeenCalledWith(
        sessionId,
        "oauth-session-123"
      );
    });

    it("should handle removeSession error in onsessionclosed gracefully", async () => {
      process.env.PORT = "3000";
      mockSessionManager.removeSession.mockRejectedValueOnce(new Error("Remove failed"));

      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      await mcpHandler(
        { headers: {}, method: "POST", path: "/mcp", body: {} },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false, locals: {} }
      );

      // Should not throw when onsessionclosed triggers removeSession error
      expect(() => lastStreamableOpts!.onsessionclosed!("failing-session")).not.toThrow();
    });

    it("should invoke onsessionclosed and cleanup session", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // Trigger new session creation
      await mcpHandler(
        { headers: {}, method: "POST", path: "/mcp", body: {} },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false, locals: {} }
      );

      // Call onsessionclosed to simulate SDK session close
      expect(lastStreamableOpts!.onsessionclosed).toBeDefined();
      lastStreamableOpts!.onsessionclosed!("closed-session-id");

      expect(mockSessionManager.removeSession).toHaveBeenCalledWith("closed-session-id");
      expect(mockLogInfo).toHaveBeenCalledWith("StreamableHTTP session closed", {
        sessionId: "closed-session-id",
        reason: "session_closed",
      });
    });

    it("should touch session and reuse transport for existing StreamableHTTP sessions", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      // First: create a new session and register it via onsessioninitialized
      await mcpHandler(
        { headers: {}, method: "POST", path: "/mcp", body: {} },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false, locals: {} }
      );

      // Simulate SDK firing onsessioninitialized — registers transport in streamableTransports
      const registeredSessionId = lastStreamableOpts!.sessionIdGenerator!();
      lastStreamableOpts!.onsessioninitialized!(registeredSessionId);

      // Second: request with existing session ID — should hit the "reuse" branch
      const mockReq = {
        headers: { "mcp-session-id": registeredSessionId },
        method: "POST",
        path: "/mcp",
        body: { method: "tools/list" },
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        locals: {},
      };

      await mcpHandler(mockReq, mockRes);

      // touchSession called for existing sessions
      expect(mockSessionManager.touchSession).toHaveBeenCalledWith(registeredSessionId);
      // handleRequest called (reusing existing transport)
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it("should start SSE heartbeat on /sse endpoint", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
      };

      await sseHandler({}, mockRes);

      // Heartbeat should be started — debug log confirms
      expect(mockLogDebug).toHaveBeenCalledWith("SSE heartbeat started", {
        sessionId: "test-session-123",
        intervalMs: 30000,
      });
    });

    it("should send SSE ping comments at heartbeat interval", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
      };

      await sseHandler({}, mockRes);

      // Advance time by one heartbeat interval (30s)
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledWith(": ping\n\n");

      // Advance by another interval
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledTimes(2);
    });

    it("should stop SSE heartbeat when /sse connection closes", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: () => void) => {
          if (event === "close") closeHandler = handler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Trigger close event — stops heartbeat
      closeHandler!();

      expect(mockLogDebug).toHaveBeenCalledWith("SSE heartbeat stopped", {
        sessionId: "test-session-123",
      });

      // After close, advancing timer should NOT send more pings
      mockRes.write.mockClear();
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should not write heartbeat if response stream has ended", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
      };

      await sseHandler({}, mockRes);

      // Mark stream as ended before heartbeat fires
      mockRes.writableEnded = true;
      jest.advanceTimersByTime(30000);

      // write should NOT be called since stream has ended
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should start SSE heartbeat for GET requests to StreamableHTTP endpoint", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      const mockReq = {
        headers: {},
        method: "GET",
        path: "/mcp",
        body: {},
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      // Heartbeat should be started for GET requests
      expect(mockLogDebug).toHaveBeenCalledWith(
        "SSE heartbeat started",
        expect.objectContaining({ intervalMs: 30000 })
      );
    });

    it("should send pings on GET SSE stream at heartbeat interval", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      const mockReq = {
        headers: {},
        method: "GET",
        path: "/mcp",
        body: {},
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      // Advance timer and verify pings are sent
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledWith(": ping\n\n");

      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledTimes(2);
    });

    it("should stop heartbeat when GET SSE stream closes", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      const mockReq = {
        headers: {},
        method: "GET",
        path: "/mcp",
        body: {},
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: () => void) => {
          if (event === "close") closeHandler = handler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      // Close the stream
      closeHandler!();

      // Advancing timer should NOT produce writes
      mockRes.write.mockClear();
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should NOT start heartbeat for POST requests to StreamableHTTP endpoint", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        call => Array.isArray(call[0]) && call[0].includes("/mcp")
      )[1];

      const mockReq = {
        headers: {},
        method: "POST",
        path: "/mcp",
        body: { method: "initialize" },
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: true, // POST responses end immediately
        write: jest.fn(),
        on: jest.fn(),
        locals: {},
      };

      await mcpHandler(mockReq, mockRes);

      // No heartbeat for POST requests
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should configure HTTP server timeouts for SSE streaming", async () => {
      process.env.PORT = "3000";
      await startServer();

      // Verify HTTP server timeouts are configured
      expect(mockHttpServer.keepAliveTimeout).toBe(620000);
      expect(mockHttpServer.headersTimeout).toBe(625000); // keepAliveTimeout + 5000
      expect(mockHttpServer.timeout).toBe(0); // No socket timeout for SSE
    });

    it("should register TCP keepalive on incoming sockets", async () => {
      process.env.PORT = "3000";
      await startServer();

      // configureServerTimeouts calls server.on("connection", callback)
      expect(mockHttpServer.on).toHaveBeenCalledWith("connection", expect.any(Function));

      // Get the connection callback and invoke it with a mock socket
      const connectionCall = mockHttpServer.on.mock.calls.find(
        (call: unknown[]) => call[0] === "connection"
      );
      expect(connectionCall).toBeDefined();

      const mockSocket = {
        setKeepAlive: jest.fn(),
        setNoDelay: jest.fn(),
      };
      connectionCall[1](mockSocket);

      expect(mockSocket.setKeepAlive).toHaveBeenCalledWith(true, 30000);
      expect(mockSocket.setNoDelay).toHaveBeenCalledWith(true);
    });

    it("should log SSE keepalive configuration on startup", async () => {
      process.env.PORT = "3000";
      await startServer();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "SSE keepalive configured for proxy chain compatibility",
        { heartbeatMs: 30000, keepAliveTimeoutMs: 620000 }
      );
    });
  });

  describe("heartbeat drain timeout and socket error tracking", () => {
    // These tests need ALL timers faked (including setTimeout/clearTimeout)
    // to test drain timeout behavior without real 10s waits.
    beforeEach(() => {
      jest.useRealTimers();
      jest.useFakeTimers();
      jest.clearAllMocks();
      lastStreamableOpts = null;
      process.argv = ["node", "server.js"];
      delete process.env.SSE;
      delete process.env.STREAMABLE_HTTP;
      mockHttpServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          if (callback) callback();
        }
      );
      mockHttpServer.keepAliveTimeout = 0;
      mockHttpServer.headersTimeout = 0;
      mockHttpServer.timeout = 0;
      mockServer.connect.mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("should destroy socket when heartbeat write returns false and drain times out", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mockDestroy = jest.fn();
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        once: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: mockDestroy,
        locals: {},
      };

      await sseHandler({}, mockRes);

      // First heartbeat tick — write returns false (backpressure)
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);

      expect(mockRes.write).toHaveBeenCalledWith(": ping\n\n");
      // drain listener should be registered
      expect(mockRes.once).toHaveBeenCalledWith("drain", expect.any(Function));

      // Advance past drain timeout (10s) without emitting drain
      jest.advanceTimersByTime(10000);

      // Socket should be destroyed
      expect(mockDestroy).toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "SSE heartbeat drain timeout — destroying dead connection",
        expect.objectContaining({
          sessionId: "test-session-123",
          drainTimeoutMs: 10000,
          reason: "heartbeat_drain_timeout",
        })
      );
    });

    it("should recover when drain event fires before timeout", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        once: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: jest.fn(),
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Write returns false — backpressure
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);

      // Emit drain before timeout
      const drainHandler = mockRes.once.mock.calls.find(
        (call: unknown[]) => call[0] === "drain"
      )?.[1] as (() => void) | undefined;
      expect(drainHandler).toBeDefined();
      drainHandler!();

      expect(mockLogDebug).toHaveBeenCalledWith("SSE heartbeat drain recovered", {
        sessionId: "test-session-123",
      });

      // Socket should NOT be destroyed
      expect(mockRes.destroy).not.toHaveBeenCalled();

      // Next heartbeat should work normally
      mockRes.write.mockReturnValue(true);
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledTimes(2);
    });

    it("should set heartbeat_failed flag on res.locals before destroying socket", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: jest.fn(),
        locals: {},
      };

      await sseHandler({}, mockRes);

      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000); // trigger heartbeat
      jest.advanceTimersByTime(10000); // trigger drain timeout

      expect((mockRes.locals as Record<string, unknown>).heartbeatFailed).toBe(true);
    });

    it("should capture socket error and log as peer_reset disconnect reason", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      let socketErrorHandler: ((err: { message: string; code?: string }) => void) | null = null;
      const mockSocket = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "error") socketErrorHandler = handler as typeof socketErrorHandler;
        }),
      };
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: mockSocket,
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Simulate socket error
      expect(socketErrorHandler).toBeDefined();
      socketErrorHandler!({ message: "read ECONNRESET", code: "ECONNRESET" });

      expect(mockLogWarn).toHaveBeenCalledWith(
        "SSE socket error",
        expect.objectContaining({
          sessionId: "test-session-123",
          error: "read ECONNRESET",
          code: "ECONNRESET",
        })
      );

      // Trigger close
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "peer_reset:ECONNRESET",
      });
    });

    it("should log normal_close when response finishes cleanly", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        writableFinished: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Mark as cleanly finished before close
      mockRes.writableFinished = true;
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "normal_close",
      });
    });

    it("should log client_disconnect when connection closes without error or destroy", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        writableFinished: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Close without error or destroy
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "client_disconnect",
      });
    });

    it("should clean up drain timeout when heartbeat cleanup function is called", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        writableFinished: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: jest.fn(),
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Trigger backpressure
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);

      // drain listener registered
      expect(mockRes.once).toHaveBeenCalledWith("drain", expect.any(Function));

      // Close fires (calls cleanup) before drain timeout
      closeHandler!();

      // removeListener should have been called to clean up drain listener
      expect(mockRes.removeListener).toHaveBeenCalledWith("drain", expect.any(Function));

      // Advancing past drain timeout should NOT destroy (already cleaned up)
      jest.advanceTimersByTime(10000);
      expect(mockRes.destroy).not.toHaveBeenCalled();
    });

    it("should log heartbeat write error when res.write throws", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockImplementation(() => {
          throw new Error("write EPIPE");
        }),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Trigger heartbeat — write will throw
      jest.advanceTimersByTime(30000);

      expect(mockLogWarn).toHaveBeenCalledWith(
        "SSE heartbeat write error — connection likely dead",
        expect.objectContaining({
          sessionId: "test-session-123",
          error: "write EPIPE",
          reason: "heartbeat_write_error",
        })
      );
      // Catch block should clean up drain listener
      expect(mockRes.removeListener).toHaveBeenCalledWith("drain", expect.any(Function));
    });

    it("should clean up drain state in catch when write throws after backpressure", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // First heartbeat: backpressure (registers drain listener + timeout)
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);
      expect(mockRes.once).toHaveBeenCalledWith("drain", expect.any(Function));

      // Simulate drain recovery before timeout
      const drainHandler = mockRes.once.mock.calls.find(
        (c: unknown[]) => c[0] === "drain"
      )![1] as () => void;
      drainHandler();

      // Second heartbeat: write throws
      mockRes.write.mockImplementation(() => {
        throw new Error("write EPIPE");
      });
      jest.advanceTimersByTime(30000);

      // Catch block should clean up drain listener
      expect(mockRes.removeListener).toHaveBeenCalledWith("drain", expect.any(Function));
    });

    it("should clean up drain state when writableEnded detected after backpressure", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(false),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // First heartbeat: backpressure (registers drain listener + timeout)
      jest.advanceTimersByTime(30000);
      expect(mockRes.once).toHaveBeenCalledWith("drain", expect.any(Function));

      // Simulate drain recovery
      const drainHandler = mockRes.once.mock.calls.find(
        (c: unknown[]) => c[0] === "drain"
      )![1] as () => void;
      drainHandler();

      // Second heartbeat: writableEnded is now true
      mockRes.writableEnded = true;
      mockRes.write.mockReturnValue(true); // won't be called but reset mock
      jest.advanceTimersByTime(30000);

      // Should clean up drain listener in the early-exit path
      expect(mockRes.removeListener).toHaveBeenCalledWith("drain", expect.any(Function));
    });

    it("should track socket error on StreamableHTTP GET stream and log peer_reset", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      let socketErrorHandler: ((err: { message: string; code?: string }) => void) | null = null;
      const mockSocket = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "error") socketErrorHandler = handler as typeof socketErrorHandler;
        }),
      };
      const mockReq = {
        headers: {},
        method: "GET",
        path: "/mcp",
        body: {},
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: mockSocket,
      };

      await mcpHandler(mockReq, mockRes);

      // Simulate socket error
      expect(socketErrorHandler).toBeDefined();
      socketErrorHandler!({ message: "read EPIPE", code: "EPIPE" });

      expect(mockLogWarn).toHaveBeenCalledWith(
        "StreamableHTTP GET socket error",
        expect.objectContaining({
          error: "read EPIPE",
          code: "EPIPE",
        })
      );

      // Trigger close
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "peer_reset:EPIPE" })
      );
    });

    it("should skip heartbeat write when already waiting for drain", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: jest.fn(),
        locals: {},
      };

      await sseHandler({}, mockRes);

      // First tick — backpressure
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledTimes(1);

      // Second tick — should skip because still waiting for drain
      jest.advanceTimersByTime(30000);
      expect(mockRes.write).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it("should stop heartbeat when response is destroyed", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Mark as destroyed before heartbeat fires
      mockRes.destroyed = true;
      jest.advanceTimersByTime(30000);

      // write should NOT be called since response is destroyed
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should stop heartbeat when response writableEnded is true", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Mark as writableEnded before heartbeat fires
      mockRes.writableEnded = true;
      jest.advanceTimersByTime(30000);

      // write should NOT be called since response is writableEnded
      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it("should not call res.destroy in drain timeout if already destroyed", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockDestroy = jest.fn();
      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: mockDestroy,
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Trigger backpressure
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);

      // Mark as already destroyed before drain timeout fires
      mockRes.destroyed = true;
      jest.advanceTimersByTime(10000);

      // destroy should NOT be called since already destroyed
      expect(mockDestroy).not.toHaveBeenCalled();
    });

    it("should handle non-Error throw in heartbeat write", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockRes = {
        on: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockImplementation(() => {
          throw "string error"; // non-Error throw
        }),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      jest.advanceTimersByTime(30000);

      expect(mockLogWarn).toHaveBeenCalledWith(
        "SSE heartbeat write error — connection likely dead",
        expect.objectContaining({
          error: "string error",
        })
      );
    });

    it("should use err.message when err.code is undefined in socket error", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      let socketErrorHandler: ((err: { message: string; code?: string }) => void) | null = null;
      const mockSocket = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "error") socketErrorHandler = handler as typeof socketErrorHandler;
        }),
      };
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: mockSocket,
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Socket error without code
      socketErrorHandler!({ message: "connection lost" });
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "peer_reset:connection lost",
      });
    });

    it("should handle null socket gracefully", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: null,
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Close without socket error tracking — should default to client_disconnect
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "client_disconnect",
      });
    });

    it("should log destroyed reason when response is destroyed without heartbeat or error", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      let closeHandler: (() => void) | null = null;
      const mockRes = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        writableFinished: false,
        destroyed: false,
        socket: { on: jest.fn() },
        locals: {},
      };

      await sseHandler({}, mockRes);

      // Destroyed externally (not by heartbeat)
      mockRes.destroyed = true;
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith("SSE session disconnected", {
        sessionId: "test-session-123",
        reason: "destroyed",
      });
    });

    it("should cover StreamableHTTP heartbeat_failed and destroyed disconnect reasons", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      // Test heartbeat_failed path
      let closeHandler: (() => void) | null = null;
      const mockReq = { headers: {}, method: "GET", path: "/mcp", body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: { heartbeatFailed: true },
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "heartbeat_failed" })
      );
    });

    it("should cover StreamableHTTP destroyed disconnect reason", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      const mockReq = { headers: {}, method: "GET", path: "/mcp", body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: true,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "destroyed" })
      );
    });

    it("should cover StreamableHTTP client_disconnect reason", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      const mockReq = { headers: {}, method: "GET", path: "/mcp", body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "client_disconnect" })
      );
    });

    it("should cover StreamableHTTP normal_close disconnect reason", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      const mockReq = { headers: {}, method: "GET", path: "/mcp", body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        writableFinished: true,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: { on: jest.fn() },
      };

      await mcpHandler(mockReq, mockRes);

      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "normal_close" })
      );
    });

    it("should use err.message fallback when err.code is undefined in StreamableHTTP socket error", async () => {
      process.env.PORT = "3000";
      await startServer();

      const mcpHandler = mockApp.all.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes("/mcp")
      )[1];

      let closeHandler: (() => void) | null = null;
      let socketErrorHandler: ((err: { message: string; code?: string }) => void) | null = null;
      const mockSocket = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "error") socketErrorHandler = handler as typeof socketErrorHandler;
        }),
      };
      const mockReq = { headers: {}, method: "GET", path: "/mcp", body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        write: jest.fn().mockReturnValue(true),
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") closeHandler = handler as typeof closeHandler;
        }),
        removeListener: jest.fn(),
        locals: {},
        socket: mockSocket,
      };

      await mcpHandler(mockReq, mockRes);

      // Socket error without code property
      socketErrorHandler!({ message: "connection reset" });
      closeHandler!();

      expect(mockLogInfo).toHaveBeenCalledWith(
        "StreamableHTTP GET stream disconnected",
        expect.objectContaining({ reason: "peer_reset:connection reset" })
      );
    });

    it("should initialize res.locals when undefined during drain timeout", async () => {
      process.env.PORT = "3000";
      await startServer();

      const sseHandler = mockApp.get.mock.calls.find((call: unknown[]) => call[0] === "/sse")[1];

      const mockDestroy = jest.fn();
      const mockRes = {
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        writableEnded: false,
        destroyed: false,
        socket: { on: jest.fn() },
        destroy: mockDestroy,
        locals: undefined as Record<string, unknown> | undefined,
      };

      await sseHandler({}, mockRes);

      // Trigger backpressure
      mockRes.write.mockReturnValue(false);
      jest.advanceTimersByTime(30000);

      // Advance past drain timeout
      jest.advanceTimersByTime(10000);

      // Should have initialized locals and set heartbeatFailed
      expect(mockRes.locals).toBeDefined();
      expect(mockRes.locals!.heartbeatFailed).toBe(true);
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe("stdio mode", () => {
    beforeEach(() => {
      // Ensure stdio mode by removing PORT from environment
      delete process.env.PORT;

      // Re-import config to pick up new env vars
      jest.resetModules();
      jest.doMock("../../src/config", () => ({
        SSE: false,
        STREAMABLE_HTTP: false,
        HOST: "localhost",
        PORT: undefined, // No PORT means stdio mode
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [],
        shouldSkipAccessLogRequest: jest.fn(() => false),
      }));
    });

    it("should create session via session manager with StdioServerTransport", async () => {
      const { startServer: newStartServer } = await import("../../src/server");
      await newStartServer();

      expect(mockSessionManager.createSession).toHaveBeenCalledWith("stdio", mockTransport);
    });

    it("should not set up any HTTP endpoints in stdio mode", async () => {
      const { startServer: newStartServer } = await import("../../src/server");
      await newStartServer();

      expect(mockApp.get).not.toHaveBeenCalled();
      expect(mockApp.post).not.toHaveBeenCalled();
      expect(mockHttpServer.listen).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle session creation errors in stdio mode", async () => {
      // Ensure stdio mode by removing PORT from environment
      delete process.env.PORT;

      // Re-import config to pick up new env vars
      jest.resetModules();
      jest.doMock("../../src/config", () => ({
        SSE: false,
        STREAMABLE_HTTP: false,
        HOST: "localhost",
        PORT: undefined, // No PORT means stdio mode
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [],
        shouldSkipAccessLogRequest: jest.fn(() => false),
      }));

      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Connection failed"));

      // stdio mode should propagate connection errors
      const { startServer: newStartServer } = await import("../../src/server");
      await expect(newStartServer()).rejects.toThrow("Connection failed");
    });

    it("should handle sessionManager.createSession rejections gracefully", async () => {
      // Ensure stdio mode by removing PORT from environment
      delete process.env.PORT;

      // Re-import config to pick up new env vars
      jest.resetModules();
      jest.doMock("../../src/config", () => ({
        SSE: false,
        STREAMABLE_HTTP: false,
        HOST: "localhost",
        PORT: undefined, // No PORT means stdio mode
        SSE_HEARTBEAT_MS: 30000,
        HTTP_KEEPALIVE_TIMEOUT_MS: 620000,
        packageName: "test-package",
        packageVersion: "1.0.0",
        LOG_FORMAT: "condensed",
        LOG_FILTER: [],
        shouldSkipAccessLogRequest: jest.fn(() => false),
      }));

      mockSessionManager.createSession.mockRejectedValueOnce(new Error("Connection failed"));

      try {
        const { startServer: newStartServer } = await import("../../src/server");
        await newStartServer();
      } catch (error: unknown) {
        expect((error as Error).message).toBe("Connection failed");
      }
    });
  });

  describe("request handlers", () => {
    describe("SSE messages endpoint", () => {
      beforeEach(() => {
        process.env.PORT = "3000";
      });

      it("should handle valid session ID in messages endpoint", async () => {
        await startServer();

        // Get the messages handler
        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

        // Mock request with session ID
        const mockReq = {
          query: { sessionId: "test-session-123" },
          body: { method: "test", params: {} },
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes),
          headersSent: false,
        };

        // First create a transport through SSE endpoint
        const sseHandler = mockApp.get.mock.calls.find(call => call[0] === "/sse")[1];
        await sseHandler({}, { on: jest.fn() });

        // Now call messages handler
        await messagesHandler(mockReq, mockRes);

        expect(mockLogDebug).toHaveBeenCalledWith("SSE messages endpoint hit!");
      });

      it("should return 404 for invalid session ID", async () => {
        await startServer();

        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

        const mockReq = {
          query: { sessionId: "invalid-session" },
          body: { method: "test", params: {} },
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes),
        };

        await messagesHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Session not found" });
      });

      it("should return 404 when no session ID provided", async () => {
        await startServer();

        const messagesHandler = mockApp.post.mock.calls.find(call => call[0] === "/messages")[1];

        const mockReq = {
          query: {},
          body: { method: "test", params: {} },
        };
        const mockRes = {
          json: jest.fn(),
          status: jest.fn(() => mockRes),
        };

        await messagesHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Session not found" });
      });
    });
  });

  describe("signal handlers", () => {
    it("should handle SIGINT signal", async () => {
      // Use a mock that returns never (like the real process.exit) instead of throwing
      // Throwing causes Jest worker crashes in Node.js 24
      const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
        // No-op to prevent actual exit
      }) as never);

      // Trigger SIGINT
      process.emit("SIGINT");

      // Wait for async graceful shutdown to complete (flush microtask queue)
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogInfo).toHaveBeenCalledWith("Shutting down GitLab MCP Server...", {
        signal: "SIGINT",
      });
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });

    it("should handle SIGTERM signal", async () => {
      // Use a mock that returns never (like the real process.exit) instead of throwing
      const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
        // No-op to prevent actual exit
      }) as never);

      // Trigger SIGTERM
      process.emit("SIGTERM");

      // Wait for async graceful shutdown to complete (flush microtask queue)
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogInfo).toHaveBeenCalledWith("Shutting down GitLab MCP Server...", {
        signal: "SIGTERM",
      });
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });

    it("should call session manager shutdown and session store close", async () => {
      const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
        // No-op
      }) as never);

      process.emit("SIGINT");
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockSessionManager.shutdown).toHaveBeenCalled();

      const { sessionStore } = require("../../src/oauth/index");
      expect(sessionStore.close).toHaveBeenCalled();

      mockExit.mockRestore();
    });

    it("should handle session manager shutdown errors gracefully", async () => {
      const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
        // No-op
      }) as never);

      mockSessionManager.shutdown.mockRejectedValueOnce(new Error("Shutdown failed"));

      process.emit("SIGINT");
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should still exit despite shutdown error
      expect(mockLogError).toHaveBeenCalledWith("Error shutting down session manager", {
        err: expect.any(Error),
      });
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });
  });

  // Note: setupHandlers integration is tested separately in handlers.test.ts

  describe("sendToolsListChangedNotification", () => {
    beforeEach(() => {
      mockSessionManager.broadcastToolsListChanged.mockClear();
      mockSessionManager.broadcastToolsListChanged.mockResolvedValue(undefined);
    });

    it("should delegate to session manager broadcastToolsListChanged", async () => {
      await sendToolsListChangedNotification();

      expect(mockSessionManager.broadcastToolsListChanged).toHaveBeenCalledTimes(1);
    });

    it("should not throw if broadcast fails", async () => {
      mockSessionManager.broadcastToolsListChanged.mockRejectedValueOnce(
        new Error("Broadcast failed")
      );

      // Should not propagate — error is caught and logged internally
      await expect(sendToolsListChangedNotification()).resolves.toBeUndefined();
    });
  });
});
