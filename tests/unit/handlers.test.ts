/**
 * Unit tests for handlers.ts
 * Tests MCP request handlers and tool execution
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupHandlers, resetHandlersState } from '../../src/handlers';
import { StructuredToolError, parseGitLabApiError } from '../../src/utils/error-handler';

// Mock ConnectionManager
const mockConnectionManager = {
  initialize: jest.fn(),
  getClient: jest.fn(),
  getInstanceInfo: jest.fn(),
  getTier: jest.fn(),
  isFeatureAvailable: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  getCurrentInstanceUrl: jest.fn().mockReturnValue('https://gitlab.example.com'),
};

jest.mock('../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => mockConnectionManager),
  },
}));

// Mock logger
jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

// Mock RegistryManager
const mockRegistryManager = {
  getAllToolDefinitions: jest.fn(),
  hasToolHandler: jest.fn(),
  executeTool: jest.fn(),
  refreshCache: jest.fn(),
};

jest.mock('../../src/registry-manager', () => ({
  RegistryManager: {
    getInstance: jest.fn(() => mockRegistryManager),
  },
}));

// Mock config — use short HANDLER_TIMEOUT_MS for timeout tests
jest.mock('../../src/config', () => ({
  LOG_FORMAT: 'condensed',
  HANDLER_TIMEOUT_MS: 100,
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

// Mock HealthMonitor
const mockHealthMonitor = {
  initialize: jest.fn().mockResolvedValue(undefined),
  onStateChange: jest.fn(),
  getState: jest.fn().mockReturnValue('healthy'),
  isAnyInstanceHealthy: jest.fn().mockReturnValue(true),
  isInstanceReachable: jest.fn().mockReturnValue(true),
  reportSuccess: jest.fn(),
  reportError: jest.fn(),
  getMonitoredInstances: jest.fn().mockReturnValue(['https://gitlab.example.com']),
  shutdown: jest.fn(),
};

jest.mock('../../src/services/HealthMonitor', () => ({
  HealthMonitor: {
    getInstance: jest.fn(() => mockHealthMonitor),
    resetInstance: jest.fn(),
  },
}));

// Mock OAuth module for authentication checks
jest.mock('../../src/oauth/index', () => ({
  isOAuthEnabled: jest.fn().mockReturnValue(false),
  isAuthenticationConfigured: jest.fn().mockReturnValue(true),
  getTokenContext: jest.fn().mockReturnValue(null),
  getGitLabApiUrlFromContext: jest.fn().mockReturnValue(null),
}));

/** Handler result type matching MCP SDK response shape */
interface HandlerResult {
  content?: Array<{ type: string; text: string }>;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  isError?: boolean;
}

/** Handler function type matching MCP SDK setRequestHandler callback shape */
type McpHandler = (
  request: Record<string, unknown>,
  extra?: Record<string, unknown>,
) => Promise<HandlerResult>;

describe('handlers', () => {
  let mockServer: jest.Mocked<Server>;
  let listToolsHandler: McpHandler;
  let callToolHandler: McpHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    resetHandlersState();

    // Create mock server
    mockServer = {
      setRequestHandler: jest.fn(),
    } as any;

    // Mock ConnectionManager methods
    mockConnectionManager.initialize.mockResolvedValue(undefined);
    mockConnectionManager.getClient.mockReturnValue({});
    mockConnectionManager.getInstanceInfo.mockReturnValue({
      version: '16.0.0',
      tier: 'ultimate',
    });
    // Tier detection methods used by error-handler.ts
    mockConnectionManager.getTier.mockReturnValue('ultimate');
    mockConnectionManager.isFeatureAvailable.mockReturnValue(true);

    // Mock RegistryManager methods
    mockRegistryManager.getAllToolDefinitions.mockReturnValue([
      {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    mockRegistryManager.hasToolHandler.mockReturnValue(true);
    mockRegistryManager.executeTool.mockResolvedValue({ result: 'success' });
  });

  describe('setupHandlers', () => {
    it('should initialize health monitor and set up request handlers', async () => {
      await setupHandlers(mockServer);

      // Should initialize health monitor (which internally calls connectionManager.initialize)
      expect(mockHealthMonitor.initialize).toHaveBeenCalledTimes(1);
      expect(mockHealthMonitor.onStateChange).toHaveBeenCalledTimes(1);

      // Should set up both handlers
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema,
        expect.any(Function),
      );
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        CallToolRequestSchema,
        expect.any(Function),
      );

      // Capture the handlers for further testing
      listToolsHandler = mockServer.setRequestHandler.mock.calls[0][1] as McpHandler;
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should continue setup even if health monitor starts disconnected', async () => {
      // Simulate HealthMonitor starting in disconnected state (GitLab unreachable)
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(false);
      mockHealthMonitor.getMonitoredInstances.mockReturnValue(['https://gitlab.example.com']);

      await setupHandlers(mockServer);

      // Should still set up handlers — tools/list returns context-only tools
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
      // refreshCache IS called even when disconnected (applies disconnected-mode filter)
      expect(mockRegistryManager.refreshCache).toHaveBeenCalled();

      // Restore
      mockHealthMonitor.getState.mockReturnValue('healthy');
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(true);
      mockHealthMonitor.getMonitoredInstances.mockReturnValue(['https://gitlab.example.com']);
    });

    it('should return context-only tools when disconnected', async () => {
      // Simulate disconnected state
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(false);
      mockHealthMonitor.getMonitoredInstances.mockReturnValue(['https://gitlab.example.com']);

      // getAllToolDefinitions in disconnected mode returns only context tools
      mockRegistryManager.getAllToolDefinitions.mockReturnValue([
        {
          name: 'manage_context',
          description: 'Context management tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ]);

      await setupHandlers(mockServer);
      const handler = mockServer.setRequestHandler.mock.calls[0][1] as McpHandler;
      const result = await handler({ method: 'tools/list' }, {});

      // Only context tools should be returned when disconnected
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0].name).toBe('manage_context');

      // Restore
      mockHealthMonitor.getState.mockReturnValue('healthy');
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(true);
      mockHealthMonitor.getMonitoredInstances.mockReturnValue(['https://gitlab.example.com']);
    });
  });

  describe('list tools handler', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      listToolsHandler = mockServer.setRequestHandler.mock.calls[0][1] as McpHandler;
    });

    it('should return list of tools from registry manager', async () => {
      const mockTools = [
        {
          name: 'get_project',
          description: 'Get project details',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
        {
          name: 'list_projects',
          description: 'List all projects',
          inputSchema: { type: 'object', properties: {} },
        },
      ];

      mockRegistryManager.getAllToolDefinitions.mockReturnValue(mockTools);

      const result = await listToolsHandler({ method: 'tools/list' }, {});

      expect(result).toEqual({
        tools: [
          {
            name: 'get_project',
            description: 'Get project details',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          },
          {
            name: 'list_projects',
            description: 'List all projects',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      expect(mockRegistryManager.getAllToolDefinitions).toHaveBeenCalledTimes(1);
    });

    it('should remove $schema from input schemas for Gemini compatibility', async () => {
      const toolWithSchema = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {},
          $schema: 'http://json-schema.org/draft-07/schema#',
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithSchema]);

      const result = await listToolsHandler({ method: 'tools/list' }, {});

      expect(result.tools![0].inputSchema).not.toHaveProperty('$schema');
      expect(result.tools![0].inputSchema.type).toBe('object');
    });

    it('should force input schemas to be type object for MCP compatibility', async () => {
      const toolWithoutType = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          properties: {},
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithoutType]);

      const result = await listToolsHandler({ method: 'tools/list' }, {});

      expect(result.tools![0].inputSchema.type).toBe('object');
    });
  });

  describe('call tool handler', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should execute tool and return result', async () => {
      const mockRequest = {
        params: {
          name: 'get_project',
          arguments: { id: 'test-project' },
        },
      };

      const mockResult = { id: 123, name: 'Test Project' };
      mockRegistryManager.executeTool.mockResolvedValue(mockResult);

      const result = await callToolHandler(mockRequest);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult, null, 2),
          },
        ],
      });

      expect(mockRegistryManager.hasToolHandler).toHaveBeenCalledWith('get_project');
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith('get_project', {
        id: 'test-project',
      });
    });

    it('should throw error if arguments are missing', async () => {
      const mockRequest = {
        params: {
          name: 'get_project',
          // arguments missing
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Arguments are required' }, null, 2),
          },
        ],
        isError: true,
      });
    });

    it('should verify connection and continue if already initialized', async () => {
      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      await callToolHandler(mockRequest);

      expect(mockConnectionManager.getClient).toHaveBeenCalled();
      expect(mockConnectionManager.getInstanceInfo).toHaveBeenCalled();
    });

    it('should initialize connection if not already initialized', async () => {
      // Clear mock call count from setupHandlers to isolate handler behavior
      mockConnectionManager.initialize.mockClear();

      // Simulate uninitialized state: isConnected returns false, then initialize succeeds
      mockConnectionManager.isConnected.mockReturnValueOnce(false);
      mockConnectionManager.isConnected.mockReturnValue(true);

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      await callToolHandler(mockRequest);

      // Connection manager initialize called from the handler when not connected
      expect(mockConnectionManager.initialize).toHaveBeenCalledTimes(1);
    });

    it('should return error if connection initialization fails', async () => {
      // Simulate uninitialized + init failure
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockRejectedValue(new Error('Connection failed'));

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      // Bootstrap failure now returns structured CONNECTION_FAILED (not "Bad Request")
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.tool).toBe('test_tool');

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    });

    it('should return CONNECTION_FAILED with reconnecting=false on auth error', async () => {
      // Simulate uninitialized + auth failure (401)
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockRejectedValue(
        new Error('GitLab API error: 401 Unauthorized'),
      );

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: { action: 'list' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.tool).toBe('test_tool');
      // Auth errors → failed state → no auto-reconnect
      expect(parsed.reconnecting).toBe(false);

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    });

    it('should return error if tool is not available', async () => {
      mockRegistryManager.hasToolHandler.mockReturnValue(false);

      const mockRequest = {
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error:
                  "Failed to execute tool 'unknown_tool': Tool 'unknown_tool' is not available or has been filtered out",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });
    });

    it('should return error if tool execution fails', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(new Error('Tool execution failed'));

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: "Failed to execute tool 'test_tool': Tool execution failed",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockRegistryManager.executeTool.mockRejectedValue('String error');

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: "Failed to execute tool 'test_tool': String error",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });
    });
  });

  describe('connection health integration', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should return CONNECTION_FAILED error when instance is unreachable', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.tool).toBe('browse_projects');
      expect(parsed.action).toBe('list');
      // disconnected = transient, auto-reconnect in progress
      expect(parsed.reconnecting).toBe(true);

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should indicate reconnecting when state is connecting', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('connecting');

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.reconnecting).toBe(true);

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should return CONNECTION_FAILED with auth hint when state is failed', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('failed');

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.reconnecting).toBe(false);
      expect(parsed.message).toContain('authentication or configuration error');
      expect(parsed.suggested_fix).toContain('authentication credentials');

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should report success to health monitor after successful tool execution', async () => {
      mockRegistryManager.executeTool.mockResolvedValue({ ok: true });

      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(mockHealthMonitor.reportSuccess).toHaveBeenCalled();
    });

    it('should report error to health monitor after tool execution failure', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(new Error('API timeout'));

      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(mockHealthMonitor.reportError).toHaveBeenCalled();
    });

    it('should register state change callback during setup', async () => {
      // onStateChange was called during setupHandlers
      expect(mockHealthMonitor.onStateChange).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should allow manage_context through when disconnected', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');

      // manage_context should NOT be blocked by health gate
      mockRegistryManager.executeTool.mockResolvedValue({ context: 'info' });

      const result = await callToolHandler({
        params: {
          name: 'manage_context',
          arguments: { action: 'whoami' },
        },
      });

      // Should get through to tool execution, not CONNECTION_FAILED
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.context).toBe('info');

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should report bootstrap init error to health monitor', async () => {
      // Simulate: isConnected false, then initialize also fails
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(result.isError).toBe(true);
      // Health monitor should have been notified of bootstrap failure
      expect(mockHealthMonitor.reportError).toHaveBeenCalled();

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    });

    it('should invoke state change callback for tool list updates', async () => {
      // Capture the callback registered via onStateChange
      const stateChangeCallback = mockHealthMonitor.onStateChange.mock.calls[0]?.[0];
      expect(stateChangeCallback).toBeDefined();

      // Clear refreshCache call count from setup
      mockRegistryManager.refreshCache.mockClear();

      // Simulate disconnected → healthy transition (should trigger broadcast)
      if (stateChangeCallback) {
        stateChangeCallback('https://gitlab.example.com', 'disconnected', 'healthy');
        // Flush microtasks + dynamic import resolution for fire-and-forget callback
        await new Promise((resolve) => process.nextTick(resolve));
        await new Promise((resolve) => process.nextTick(resolve));
      }

      // refreshCache should have been called with the instance URL by the state change callback
      expect(mockRegistryManager.refreshCache).toHaveBeenCalledWith('https://gitlab.example.com');
    });

    it('should handle CONNECTION_FAILED with missing action field', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { project_id: '123' },
        },
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.action).toBe('unknown');

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });
  });

  describe('edge cases', () => {
    it('should handle empty arguments in tool call', async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      await callToolHandler(mockRequest);

      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith('test_tool', {});
    });
  });

  describe('structured error handling', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should parse GitLab API error and return structured error response', async () => {
      // Simulate a 403 Forbidden error from GitLab API
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API error: 403 Forbidden - You need to be a project member'),
      );

      const mockRequest = {
        params: {
          name: 'browse_protected_branches',
          arguments: { action: 'list', project_id: '123' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      // Should be a structured error (either TIER_RESTRICTED or PERMISSION_DENIED)
      expect(parsed.error_code).toBeDefined();
      expect(parsed.tool).toBe('browse_protected_branches');
      expect(parsed.http_status).toBe(403);
    });

    it('should parse wrapped GitLab API error correctly', async () => {
      // Error is wrapped with "Failed to execute tool" prefix
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error(
          "Failed to execute tool 'test': GitLab API error: 404 Not Found - Project not found",
        ),
      );

      const mockRequest = {
        params: {
          name: 'browse_projects',
          arguments: { action: 'get', project_id: '999' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('NOT_FOUND');
      expect(parsed.http_status).toBe(404);
    });

    it('should extract action from tool arguments', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API error: 500 Internal Server Error'),
      );

      const mockRequest = {
        params: {
          name: 'manage_merge_request',
          arguments: { action: 'approve', project_id: '123', iid: '1' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.action).toBe('approve');
    });

    it('should handle GitLab API error without status text', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(new Error('GitLab API error: 429'));

      const mockRequest = {
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('RATE_LIMITED');
      expect(parsed.http_status).toBe(429);
    });

    it('should handle 5xx server errors', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API error: 502 Bad Gateway'),
      );

      const mockRequest = {
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('SERVER_ERROR');
      expect(parsed.http_status).toBe(502);
    });

    it('should fallback to plain error for non-GitLab API errors', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(new Error('Some other error'));

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      // Should be plain error format, not structured
      expect(parsed.error).toContain('Some other error');
      expect(parsed.error_code).toBeUndefined();
    });
  });

  describe('parseGitLabApiError', () => {
    // Tests for the parseGitLabApiError helper function
    // Validates that GitLab API error strings are correctly parsed into status and message

    it('should parse standard GitLab API error format', () => {
      const result = parseGitLabApiError('GitLab API error: 403 Forbidden');
      expect(result).toEqual({
        status: 403,
        message: '403 Forbidden',
      });
    });

    it('should parse error with status text and details', () => {
      const result = parseGitLabApiError(
        'GitLab API error: 404 Not Found - Project does not exist',
      );
      expect(result).toEqual({
        status: 404,
        message: '404 Not Found - Project does not exist',
      });
    });

    it('should parse error with only status code', () => {
      const result = parseGitLabApiError('GitLab API error: 429');
      expect(result).toEqual({
        status: 429,
        message: '429',
      });
    });

    it('should parse error with details but no status text', () => {
      const result = parseGitLabApiError('GitLab API error: 500 - Server error message');
      expect(result).toEqual({
        status: 500,
        message: '500 - Server error message',
      });
    });

    it('should parse wrapped error (from tool execution)', () => {
      const result = parseGitLabApiError(
        "Failed to execute tool 'test': GitLab API error: 403 Forbidden - Access denied",
      );
      expect(result).toEqual({
        status: 403,
        message: '403 Forbidden - Access denied',
      });
    });

    it('should handle multi-word status text', () => {
      const result = parseGitLabApiError('GitLab API error: 502 Bad Gateway');
      expect(result).toEqual({
        status: 502,
        message: '502 Bad Gateway',
      });
    });

    it('should return null for non-GitLab API errors', () => {
      expect(parseGitLabApiError('Some random error')).toBeNull();
      expect(parseGitLabApiError('Connection refused')).toBeNull();
      expect(parseGitLabApiError('Timeout')).toBeNull();
    });

    it('should return null for malformed GitLab API errors', () => {
      // Missing status code
      expect(parseGitLabApiError('GitLab API error: Forbidden')).toBeNull();
      // Just the prefix
      expect(parseGitLabApiError('GitLab API error:')).toBeNull();
    });

    it('should handle 5xx server errors', () => {
      const result = parseGitLabApiError('GitLab API error: 503 Service Unavailable');
      expect(result).toEqual({
        status: 503,
        message: '503 Service Unavailable',
      });
    });

    it('should parse status text with punctuation (hyphens, apostrophes)', () => {
      // Test that regex handles punctuation in status text (not just \w\s)
      const result1 = parseGitLabApiError('GitLab API error: 203 Non-Authoritative Information');
      expect(result1).toEqual({
        status: 203,
        message: '203 Non-Authoritative Information',
      });

      const result2 = parseGitLabApiError("GitLab API error: 418 I'm a teapot");
      expect(result2).toEqual({
        status: 418,
        message: "418 I'm a teapot",
      });
    });
  });

  describe('structured error handling - additional paths', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should extract action from error cause via wrapper', async () => {
      // Test extractActionFromError when wrapped error's cause has action property (line 88)
      // The error gets wrapped on line 320: throw new Error(..., { cause: error })
      // So the wrapper's cause (original error) needs the action property
      const errorWithAction = new Error('GitLab API error: 403 Forbidden');
      (errorWithAction as any).action = 'custom_action';
      mockRegistryManager.executeTool.mockRejectedValue(errorWithAction);

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: { action: 'ignored_action' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      // Action is extracted from the cause chain (line 88)
      expect(parsed.action).toBe('custom_action');
    });

    it('should pass through StructuredToolError via cause chain', async () => {
      // Test toStructuredError when error.cause is StructuredToolError (lines 109-111)
      // The error gets wrapped, so we check the cause for StructuredToolError
      const structuredError = new StructuredToolError({
        error_code: 'API_ERROR',
        tool: 'original_tool',
        action: 'original_action',
        message: 'Pre-structured error',
        http_status: 418,
      });
      mockRegistryManager.executeTool.mockRejectedValue(structuredError);

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      // Should preserve the original structured error
      expect(parsed.error_code).toBe('API_ERROR');
      expect(parsed.tool).toBe('original_tool');
      expect(parsed.action).toBe('original_action');
      expect(parsed.http_status).toBe(418);
    });
  });

  describe('timeout error handling', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should convert timeout error to structured TIMEOUT response for idempotent tools', async () => {
      // Test timeout handling for browse_* (idempotent) tools
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API timeout after 10000ms'),
      );

      const mockRequest = {
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
      expect(parsed.tool).toBe('browse_projects');
      expect(parsed.action).toBe('list');
      expect(parsed.retryable).toBe(true); // browse_* is idempotent
      expect(parsed.timeout_ms).toBe(10000);
    });

    it('should convert timeout error to structured TIMEOUT response for non-idempotent tools', async () => {
      // Test timeout handling for manage_* (non-idempotent) tools
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API timeout after 10000ms'),
      );

      const mockRequest = {
        params: {
          name: 'manage_merge_request',
          arguments: { action: 'merge' },
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
      expect(parsed.tool).toBe('manage_merge_request');
      expect(parsed.action).toBe('merge');
      expect(parsed.retryable).toBe(false); // manage_* is NOT idempotent
    });

    it('should mark browse_* tools as idempotent for timeout errors', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API timeout after 5000ms'),
      );

      const mockRequest = {
        params: {
          name: 'browse_members',
          arguments: { action: 'list_project' },
        },
      };

      const result = await callToolHandler(mockRequest);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.retryable).toBe(true); // browse_* is idempotent
    });

    it('should mark browse_* tools as idempotent for timeout errors (CQRS pattern)', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(
        new Error('GitLab API timeout after 5000ms'),
      );

      const mockRequest = {
        params: {
          name: 'browse_merge_requests',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.retryable).toBe(true); // browse_* is idempotent
    });

    it('should mark legacy list_*/get_* patterns as idempotent (backwards compat)', async () => {
      // isIdempotentOperation still recognizes legacy prefixes as a safety net
      for (const legacyName of ['list_merge_requests', 'get_pipeline']) {
        mockRegistryManager.executeTool.mockRejectedValue(
          new Error('GitLab API timeout after 5000ms'),
        );

        const mockRequest = {
          params: {
            name: legacyName,
            arguments: {},
          },
        };

        const result = await callToolHandler(mockRequest);
        const parsed = JSON.parse(result.content![0].text);
        expect(parsed.retryable).toBe(true);
      }
    });

    it('should handle direct StructuredToolError without wrapping', async () => {
      // Test the direct isStructuredToolError check (line 120-121)
      const structuredError = new StructuredToolError({
        error_code: 'TIMEOUT',
        tool: 'direct_tool',
        action: 'direct_action',
        message: 'Direct timeout error',
        retryable: true,
        timeout_ms: 15000,
      });
      mockRegistryManager.executeTool.mockRejectedValue(structuredError);

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
      expect(parsed.tool).toBe('direct_tool');
      expect(parsed.timeout_ms).toBe(15000);
    });
  });

  describe('authentication check', () => {
    it('should return error when no authentication configured', async () => {
      // Mock no auth configured
      const { isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(false);

      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      const result = await callToolHandler(mockRequest);

      expect(result.isError).toBe(true);
      expect(result.content![0].text).toContain('GITLAB_TOKEN');
      expect(result.content![0].text).toContain('environment variable is required');

      // Restore mock
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);
    });
  });

  describe('handler-level timeout (Promise.race)', () => {
    // Tests the Promise.race timeout path: when tool execution exceeds HANDLER_TIMEOUT_MS (100ms),
    // the handler returns a structured TIMEOUT error immediately without waiting for the tool.

    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = mockServer.setRequestHandler.mock.calls[1][1] as McpHandler;
    });

    it('should return structured timeout error when tool execution exceeds HANDLER_TIMEOUT_MS', async () => {
      // Make executeTool hang longer than HANDLER_TIMEOUT_MS (100ms)
      mockRegistryManager.executeTool.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
      expect(parsed.tool).toBe('browse_projects');
      expect(parsed.action).toBe('list');
      expect(parsed.retryable).toBe(true); // browse_* is idempotent
      expect(parsed.timeout_ms).toBe(100);
    }, 5000);

    it('should skip timeout race for non-idempotent operations to prevent duplicate mutations', async () => {
      // Non-idempotent tool (manage_*) runs to completion even if slow
      mockRegistryManager.executeTool.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ result: 'mutated' }), 200)),
      );

      const result = await callToolHandler({
        params: {
          name: 'manage_merge_request',
          arguments: { project_id: '123' },
        },
      });

      // Should complete successfully (no timeout) even though it took 200ms > HANDLER_TIMEOUT_MS (100ms)
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.result).toBe('mutated');
    }, 5000);

    it('should not trigger timeout when tool completes within HANDLER_TIMEOUT_MS', async () => {
      // Tool resolves immediately (well within 100ms timeout)
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'fast' });

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      // Should get normal result, not timeout
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.result).toBe('fast');
    });
  });

  describe('list tools handler - resolveRefs edge cases', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      listToolsHandler = mockServer.setRequestHandler.mock.calls[0][1] as McpHandler;
    });

    it('should resolve $ref references in input schemas', () => {
      // Test resolveRefs with $ref (lines 164-173)
      const toolWithRef = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            sharedProp: { type: 'string', description: 'Shared property' },
            refProp: { $ref: '#/properties/sharedProp' },
          },
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithRef]);

      return listToolsHandler({ method: 'tools/list' }, {}).then((result: any) => {
        // The $ref should be resolved
        expect(result.tools![0].inputSchema.properties.refProp).not.toHaveProperty('$ref');
        expect(result.tools![0].inputSchema.properties.refProp.type).toBe('string');
      });
    });

    it('should handle unresolvable $ref by removing it', () => {
      // Test resolveRefs with unresolvable $ref (lines 175-178)
      const toolWithBadRef = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            badRef: { $ref: '#/properties/nonExistent', description: 'Has bad ref' },
          },
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithBadRef]);

      return listToolsHandler({ method: 'tools/list' }, {}).then((result: any) => {
        // The $ref should be removed, but description preserved
        expect(result.tools![0].inputSchema.properties.badRef).not.toHaveProperty('$ref');
        expect(result.tools![0].inputSchema.properties.badRef.description).toBe('Has bad ref');
      });
    });

    it('should handle array schemas in resolveRefs', () => {
      // Test resolveRefs with array (line 159)
      const toolWithArray = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithArray]);

      return listToolsHandler({ method: 'tools/list' }, {}).then((result: any) => {
        // The array should be preserved
        expect(result.tools![0].inputSchema.properties.items.oneOf).toHaveLength(2);
      });
    });

    it('should handle nested objects in resolveRefs', () => {
      // Test resolveRefs with nested object (line 194)
      const toolWithNested = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
        },
      };

      mockRegistryManager.getAllToolDefinitions.mockReturnValue([toolWithNested]);

      return listToolsHandler({ method: 'tools/list' }, {}).then((result: any) => {
        expect(result.tools![0].inputSchema.properties.nested.additionalProperties.type).toBe(
          'string',
        );
      });
    });
  });
});
