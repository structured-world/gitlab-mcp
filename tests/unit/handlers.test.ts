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
  clearInflight: jest.fn(),
  ensureIntrospected: jest.fn().mockResolvedValue(undefined),
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

// Mock logging/index so connection-tracker paths (lines 712-715) can be exercised
const mockRequestTracker = {
  setToolForCurrentRequest: jest.fn(),
  setErrorForCurrentRequest: jest.fn(),
  setContextForCurrentRequest: jest.fn(),
  setReadOnlyForCurrentRequest: jest.fn(),
  getStack: jest.fn().mockReturnValue(null),
};
const mockConnectionTracker = {
  incrementTools: jest.fn(),
  recordError: jest.fn(),
};
// getCurrentRequestId returns undefined by default (no AsyncLocalStorage context in tests)
const mockGetCurrentRequestId = jest.fn().mockReturnValue(undefined);

jest.mock('../../src/logging/index', () => ({
  getRequestTracker: jest.fn(() => mockRequestTracker),
  getConnectionTracker: jest.fn(() => mockConnectionTracker),
  getCurrentRequestId: jest.fn(() => mockGetCurrentRequestId()),
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

/** Resolve a registered MCP handler by its schema rather than by call index.
 *  This decouples tests from the registration order inside setupHandlers(). */
function getRegisteredHandler(
  mockServer: jest.Mocked<Server>,
  schema: typeof ListToolsRequestSchema | typeof CallToolRequestSchema,
): McpHandler {
  const call = (mockServer.setRequestHandler as jest.Mock).mock.calls.find(
    ([s]: [unknown]) => s === schema,
  );
  if (!call) {
    throw new Error(`Handler for schema ${String(schema)} was not registered`);
  }
  return call[1] as McpHandler;
}

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
    } as unknown as jest.Mocked<Server>;

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
      listToolsHandler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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
      const handler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
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
      listToolsHandler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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
      // disconnected = not actively reconnecting, but auto-retry is enabled
      expect(parsed.reconnecting).toBe(false);
      expect(parsed.auto_retry_enabled).toBe(true);

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should treat connecting state as reachable (optimistic during startup)', async () => {
      mockHealthMonitor.getState.mockReturnValue('connecting');
      // isInstanceReachable false — the only reason tool proceeds is the
      // getState('connecting') gate treating connecting as reachable
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      // connecting is reachable — tool proceeds to execution, not CONNECTION_FAILED
      expect(result.isError).toBeUndefined();

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
      expect(parsed.message).toContain(
        'permanent authentication, permission, or configuration error',
      );
      expect(parsed.suggested_fix).toContain('authentication/authorization');

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

      expect(mockHealthMonitor.reportSuccess).toHaveBeenCalledWith('https://gitlab.example.com');
    });

    it('should report error to health monitor after tool execution failure', async () => {
      // Use a transport-level error message that classifyError maps to 'transient'
      // (bare "API timeout" would be classified as 'permanent' after the narrowed heuristic)
      mockRegistryManager.executeTool.mockRejectedValue(new Error('connect timeout: ETIMEDOUT'));

      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.any(Error),
      );
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
      // Health monitor should have been notified of bootstrap failure with the instance URL
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.any(Error),
      );

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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);

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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    it('should extract action from error cause via wrapper', async () => {
      // Test extractActionFromError when wrapped error's cause has action property (line 88)
      // The error gets wrapped on line 320: throw new Error(..., { cause: error })
      // So the wrapper's cause (original error) needs the action property
      const errorWithAction: Error & { action?: string } = new Error(
        'GitLab API error: 403 Forbidden',
      );
      errorWithAction.action = 'custom_action';
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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);

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
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
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

    it('should timeout non-idempotent operations to bound bootstrap phase', async () => {
      // Non-idempotent tools (manage_*) now also race with timeout to prevent
      // hung bootstrap (init/introspection) from blocking indefinitely
      mockRegistryManager.executeTool.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ result: 'mutated' }), 200)),
      );

      const result = await callToolHandler({
        params: {
          name: 'manage_merge_request',
          arguments: { project_id: '123' },
        },
      });

      // Should timeout (200ms > HANDLER_TIMEOUT_MS 100ms) — bootstrap needs bounding
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
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
      listToolsHandler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
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

      return listToolsHandler({ method: 'tools/list' }, {}).then((result) => {
        // The $ref should be resolved
        const schema = result.tools![0].inputSchema as Record<string, Record<string, unknown>>;
        expect(schema.properties.refProp).not.toHaveProperty('$ref');
        expect((schema.properties.refProp as Record<string, unknown>).type).toBe('string');
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

      return listToolsHandler({ method: 'tools/list' }, {}).then((result) => {
        // The $ref should be removed, but description preserved
        const schema = result.tools![0].inputSchema as Record<string, Record<string, unknown>>;
        expect(schema.properties.badRef).not.toHaveProperty('$ref');
        expect((schema.properties.badRef as Record<string, unknown>).description).toBe(
          'Has bad ref',
        );
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

      return listToolsHandler({ method: 'tools/list' }, {}).then((result) => {
        // The array should be preserved
        const schema = result.tools![0].inputSchema as Record<string, Record<string, unknown>>;
        expect((schema.properties.items as Record<string, unknown[]>).oneOf).toHaveLength(2);
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

      return listToolsHandler({ method: 'tools/list' }, {}).then((result) => {
        const schema = result.tools![0].inputSchema as Record<string, Record<string, unknown>>;
        const nested = schema.properties.nested as Record<string, Record<string, string>>;
        expect(nested.additionalProperties.type).toBe('string');
      });
    });
  });

  describe('setupHandlers - health monitor startup failure', () => {
    it('should reset healthMonitorStartup promise on health monitor init failure', async () => {
      // Cover lines 222-223: healthMonitorStartup = null; throw error
      mockHealthMonitor.initialize.mockRejectedValueOnce(new Error('Health monitor init failed'));

      // First call should throw (propagating the health monitor error)
      await expect(setupHandlers(mockServer)).rejects.toThrow('Health monitor init failed');

      // After failure, healthMonitorStartup is reset to null so next call retries
      // A second call should attempt initialization again
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      await expect(setupHandlers(mockServer)).resolves.not.toThrow();

      // Restore
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
    });
  });

  describe('OAuth mode - introspection and token context paths', () => {
    beforeEach(async () => {
      resetHandlersState();
      jest.clearAllMocks();

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      mockConnectionManager.initialize.mockResolvedValue(undefined);
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.getClient.mockReturnValue({});
      mockConnectionManager.getInstanceInfo.mockReturnValue({ version: '17.0.0', tier: 'free' });
      mockConnectionManager.ensureIntrospected.mockResolvedValue(undefined);
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'ok' });
      mockRegistryManager.refreshCache.mockReturnValue(undefined);
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);

      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    afterEach(() => {
      // Restore default mocks
      const oauth = require('../../src/oauth/index');
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (oauth.isAuthenticationConfigured as jest.Mock).mockReturnValue(true);
    });

    it('should call ensureIntrospected in OAuth mode (line 493)', async () => {
      // In OAuth mode, the handler calls connectionManager.ensureIntrospected()
      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(mockConnectionManager.ensureIntrospected).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );
    });

    it('should log OAuth context check before tool execution (lines 612-614)', async () => {
      const { getTokenContext } = await import('../../src/oauth/index');
      (getTokenContext as jest.Mock).mockReturnValue({ gitlabToken: 'test-token' });

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      // Tool should execute successfully; OAuth context is logged (debug)
      expect(result.isError).toBeUndefined();
    });

    it('should rethrow when connected but introspection fails (line 560)', async () => {
      // isConnected returns true (already connected), but ensureIntrospected throws
      mockConnectionManager.ensureIntrospected.mockRejectedValueOnce(
        new Error('Introspection failed'),
      );

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      // The error propagates to the outer catch → structured error or plain error
      expect(result.isError).toBe(true);
      // Should contain the rethrown error message
      expect(result.content![0].text).toContain('Introspection failed');
    });
  });

  describe('connection tracker integration via logging mock', () => {
    beforeEach(async () => {
      resetHandlersState();
      jest.clearAllMocks();

      mockConnectionManager.initialize.mockResolvedValue(undefined);
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.getClient.mockReturnValue({});
      mockConnectionManager.getInstanceInfo.mockReturnValue({ version: '17.0.0', tier: 'free' });
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'ok' });
      mockRegistryManager.refreshCache.mockReturnValue(undefined);
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    afterEach(() => {
      // Reset getCurrentRequestId mock to default (undefined)
      mockGetCurrentRequestId.mockReturnValue(undefined);
      mockRequestTracker.getStack.mockReturnValue(null);
    });

    it('should call getStack when getCurrentRequestId returns a value (lines 712-715)', async () => {
      // Make getCurrentRequestId return a real-looking requestId so the
      // connection tracker path (lines 712-715) is exercised on error
      mockGetCurrentRequestId.mockReturnValue('req-123');
      mockRequestTracker.getStack.mockReturnValue({ sessionId: 'sess-456' });

      mockRegistryManager.executeTool.mockRejectedValueOnce(
        new Error('GitLab API error: 500 Internal Server Error'),
      );

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      // Connection tracker recordError should have been called via the outer catch block
      expect(mockConnectionTracker.recordError).toHaveBeenCalledWith(
        'sess-456',
        expect.any(String),
      );
    });

    it('should skip connection tracker when getStack has no sessionId', async () => {
      mockGetCurrentRequestId.mockReturnValue('req-789');
      // getStack returns a stack without sessionId
      mockRequestTracker.getStack.mockReturnValue({ sessionId: undefined });

      mockRegistryManager.executeTool.mockRejectedValueOnce(new Error('Some error'));

      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      // recordError should NOT have been called (no sessionId)
      expect(mockConnectionTracker.recordError).not.toHaveBeenCalled();
    });
  });

  describe('handler-level timeout with bootstrap in progress', () => {
    // Test the bootstrapStarted && !bootstrapComplete path (lines 680-684)
    // This is triggered when the bootstrap phase (init + introspection) times out,
    // NOT when a normal tool execution times out after bootstrap completed.
    beforeEach(() => {
      resetHandlersState();
      jest.clearAllMocks();

      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.getClient.mockReturnValue({});
      mockConnectionManager.getInstanceInfo.mockReturnValue({ version: '17.0.0', tier: 'free' });
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.refreshCache.mockReturnValue(undefined);
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should report error to HealthMonitor and call clearInflight when bootstrap times out', async () => {
      // Bootstrap (connectionManager.initialize) hangs longer than HANDLER_TIMEOUT_MS (100ms)
      mockConnectionManager.initialize.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      const handler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      const result = await handler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');

      // bootstrapStarted=true and bootstrapComplete=false → HealthMonitor and clearInflight are called
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.any(Error),
      );
      expect(mockConnectionManager.clearInflight).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    }, 5000);
  });

  describe('recordEarlyReturnError - connection tracker path', () => {
    // Tests the getConnectionTracker().recordError() branch inside recordEarlyReturnError
    // (lines 79-81) which runs when currentRequestId is set and stack has sessionId
    beforeEach(async () => {
      resetHandlersState();
      jest.clearAllMocks();

      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.getClient.mockReturnValue({});
      mockConnectionManager.getInstanceInfo.mockReturnValue({ version: '17.0.0', tier: 'free' });
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.refreshCache.mockReturnValue(undefined);

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    afterEach(() => {
      mockGetCurrentRequestId.mockReturnValue(undefined);
      mockRequestTracker.getStack.mockReturnValue(null);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should call recordError on connectionTracker inside recordEarlyReturnError (lines 79-81)', async () => {
      // getCurrentRequestId returns a value and stack has sessionId
      // This triggers recordEarlyReturnError → getConnectionTracker().recordError()
      mockGetCurrentRequestId.mockReturnValue('req-early-001');
      mockRequestTracker.getStack.mockReturnValue({ sessionId: 'sess-early-001' });

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      // The disconnected health check triggers CONNECTION_FAILED → recordEarlyReturnError
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');

      // recordError should have been called via recordEarlyReturnError (lines 79-81)
      expect(mockConnectionTracker.recordError).toHaveBeenCalledWith(
        'sess-early-001',
        expect.any(String),
      );
    });
  });
});
