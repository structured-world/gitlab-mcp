/**
 * Unit tests for handlers.ts
 * Tests MCP request handlers and tool execution
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { setupHandlers, resetHandlersState } from '../../src/handlers';
import * as scopeIds from '../../src/configuration/scope-ids';
import * as runtimeConfig from '../../src/config';
import { StructuredToolError, parseGitLabApiError } from '../../src/utils/error-handler';
import { GitLabTimeoutError } from '../../src/utils/fetch';
import { ConfigurationService } from '../../src/configuration/service';
import { resolveCaller } from '../../src/configuration/caller';
import { runWithTokenAccount } from '../../src/accounts/token-account';
import * as chatAccounts from '../../src/accounts/chat-accounts';

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
  getTool: jest.fn(),
  getToolRegistryKey: jest.fn().mockReturnValue(undefined),
  isReadOnlyTool: jest.fn().mockReturnValue(true),
  /** Argument names a tool declares; undefined when unknown, so every argument is checked. */
  getDeclaredArguments: jest.fn().mockReturnValue(undefined),
  // Built from the two mocks above, as the real registry builds it from its tables.
  getToolFacts: (name: string) => ({
    name,
    group: jest
      .requireActual('../../src/configuration/groups')
      .groupOfRegistry(mockRegistryManager.getToolRegistryKey(name)),
    readOnly: mockRegistryManager.isReadOnlyTool(name) as boolean,
  }),
};

// A real configuration service over an in-memory store, so the caller's settings are
// applied exactly as in production; the home directory is never touched.
const mockSettings = new Map<
  string,
  { accountKey: string; settings: Record<string, unknown>; version: number; updatedAt: number }
>();
const mockSettingsRead = jest.fn();
/** Presets the configuration service loads by name; empty preset when absent. */
const mockPresets: Record<string, Record<string, unknown>> = {};
let mockConfigurationService: unknown;
jest.mock('../../src/configuration', () => ({
  ...jest.requireActual('../../src/configuration/caller'),
  getConfigurationService: () => mockConfigurationService,
}));

jest.mock('../../src/registry-manager', () => ({
  RegistryManager: {
    getInstance: jest.fn(() => mockRegistryManager),
  },
}));

// Mock config — use short HANDLER_TIMEOUT_MS for timeout tests
jest.mock('../../src/config', () => ({
  GITLAB_ALLOWED_PROJECT_IDS: [],
  LOG_FORMAT: 'condensed',
  HANDLER_TIMEOUT_MS: 100,
  GITLAB_BASE_URL: 'https://gitlab.example.com',
  GITLAB_SCHEMA_MODE: 'flat',
  // No action is denied by the operator here; scoped calls check the requested action.
  isActionDenied: () => false,
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
  forceReconnect: jest.fn(),
  getMonitoredInstances: jest.fn().mockReturnValue(['https://gitlab.example.com']),
  shutdown: jest.fn(),
};

jest.mock('../../src/services/HealthMonitor', () => ({
  HealthMonitor: {
    getInstance: jest.fn(() => mockHealthMonitor),
    resetInstance: jest.fn(),
  },
  InitializationTimeoutError: jest.requireActual('../../src/services/HealthMonitor')
    .InitializationTimeoutError,
}));

// Mock OAuth module for authentication checks
jest.mock('../../src/oauth/index', () => ({
  isOAuthEnabled: jest.fn().mockReturnValue(false),
  isAuthenticationConfigured: jest.fn().mockReturnValue(true),
  getTokenContext: jest.fn().mockReturnValue(null),
  getGitLabApiUrlFromContext: jest.fn().mockReturnValue(undefined),
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

// Mock SessionManager — needed by the ListToolsRequestSchema and CallToolRequestSchema handlers
// for per-session instance URL tracking (#398).
const mockSessionManager = {
  getSessionInstanceUrl: jest.fn().mockReturnValue('https://gitlab.example.com'),
  setSessionInstanceUrl: jest.fn(),
  broadcastToolsListChanged: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/session-manager', () => ({
  getSessionManager: jest.fn(() => mockSessionManager),
  resetSessionManager: jest.fn(),
  STDIO_SESSION_ID: 'stdio',
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
  schema:
    | typeof ListToolsRequestSchema
    | typeof CallToolRequestSchema
    | typeof ListResourcesRequestSchema
    | typeof ReadResourceRequestSchema,
): McpHandler {
  // Use findLast to get the latest registered handler (not a stale pre-retry one)
  const calls = (mockServer.setRequestHandler as jest.Mock).mock.calls;
  const call = [...calls].reverse().find(([s]: [unknown]) => s === schema);
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

    mockSettings.clear();
    for (const name of Object.keys(mockPresets)) delete mockPresets[name];
    mockSettingsRead.mockImplementation(async (key: string) => mockSettings.get(key));
    mockRegistryManager.getToolRegistryKey.mockReturnValue(undefined);
    mockRegistryManager.isReadOnlyTool.mockReturnValue(true);
    mockConfigurationService = new ConfigurationService(
      async () => ({
        get: mockSettingsRead,
        put: async (key: string, settings: Record<string, unknown>, expected: number) => {
          const version = mockSettings.get(key)?.version ?? 0;
          if (version !== expected) return undefined;
          const record = { accountKey: key, settings, version: version + 1, updatedAt: 1 };
          mockSettings.set(key, record);
          return record;
        },
      }),
      { load: async (name: string) => mockPresets[name] ?? {} },
      async () => undefined,
    );

    // Create mock server
    mockServer = {
      setRequestHandler: jest.fn(),
      getClientVersion: jest.fn().mockReturnValue({ name: 'claude-code', version: 'test' }),
      sendToolListChanged: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Server>;

    // Mock ConnectionManager methods — re-seed defaults that tests may flip
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.initialize.mockResolvedValue(undefined);
    mockConnectionManager.ensureIntrospected.mockResolvedValue(undefined);
    mockConnectionManager.getClient.mockReturnValue({});
    mockConnectionManager.getInstanceInfo.mockReturnValue({
      version: '16.0.0',
      tier: 'ultimate',
    });
    // Tier detection methods used by error-handler.ts
    mockConnectionManager.getTier.mockReturnValue('ultimate');
    mockConnectionManager.isFeatureAvailable.mockReturnValue(true);

    // Mock HealthMonitor defaults — re-seed after tests that flip these
    mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
    mockHealthMonitor.getState.mockReturnValue('healthy');
    mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(true);

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
    mockRegistryManager.getTool.mockReturnValue(null);

    // SessionManager mock defaults for per-session instance URL tracking (#398)
    mockSessionManager.getSessionInstanceUrl.mockReturnValue('https://gitlab.example.com');
    mockSessionManager.setSessionInstanceUrl.mockReturnValue(undefined);
  });

  describe('setupHandlers', () => {
    it('should initialize health monitor and set up request handlers', async () => {
      await setupHandlers(mockServer);

      // Should initialize health monitor (which internally calls connectionManager.initialize)
      expect(mockHealthMonitor.initialize).toHaveBeenCalledTimes(1);
      expect(mockHealthMonitor.onStateChange).toHaveBeenCalledTimes(1);

      // Tools, plus the resources serving the settings panel
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(4);
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListResourcesRequestSchema,
        expect.any(Function),
      );
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ReadResourceRequestSchema,
        expect.any(Function),
      );
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

    it('should deduplicate concurrent setupHandlers calls', async () => {
      // Call setupHandlers concurrently — the ??= guard must ensure
      // health monitor init and state-change registration happen exactly once
      await Promise.all([
        setupHandlers(mockServer),
        setupHandlers(mockServer),
        setupHandlers(mockServer),
      ]);

      expect(mockHealthMonitor.initialize).toHaveBeenCalledTimes(1);
      expect(mockHealthMonitor.onStateChange).toHaveBeenCalledTimes(1);
    });

    it('should continue setup even if health monitor starts disconnected', async () => {
      // Simulate HealthMonitor starting in disconnected state (GitLab unreachable)
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(false);
      mockHealthMonitor.getMonitoredInstances.mockReturnValue(['https://gitlab.example.com']);

      await setupHandlers(mockServer);

      // Should still set up handlers — tools/list returns context-only tools
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(4);
      // refreshCache IS called even when disconnected (applies disconnected-mode filter)
      // setupHandlers calls refreshCache() without URL — the per-URL variant is
      // used only in the state-change callback, not during initial setup.
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

      // The handler calls getAllToolDefinitions() which returns the result of
      // RegistryManager's internal filtering (tested in RegistryManager.test.ts).
      // Here we verify the wiring: setupHandlers calls refreshCache() during setup
      // (applying the disconnected filter), and the ListTools handler passes through
      // whatever getAllToolDefinitions() returns.
      mockRegistryManager.getAllToolDefinitions.mockReturnValue([
        {
          name: 'manage_context',
          description: 'Context management tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ]);

      await setupHandlers(mockServer);

      // refreshCache was called during setup (applies disconnected-mode filter)
      expect(mockRegistryManager.refreshCache).toHaveBeenCalled();

      const handler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
      const result = await handler({ method: 'tools/list' }, {});

      // Handler returns the filtered result from RegistryManager
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0].name).toBe('manage_context');
      // getAllToolDefinitions was called by the ListTools handler
      expect(mockRegistryManager.getAllToolDefinitions).toHaveBeenCalled();

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

    describe('per-session instance URL resolution (#398)', () => {
      it('should pass session instanceUrl to getAllToolDefinitions when sessionId is provided', async () => {
        // Session targeting a non-default instance
        mockSessionManager.getSessionInstanceUrl.mockReturnValue('https://custom.gitlab.com');

        await listToolsHandler({ method: 'tools/list' }, { sessionId: 'sess-abc' });

        expect(mockSessionManager.getSessionInstanceUrl).toHaveBeenCalledWith('sess-abc');
        expect(mockRegistryManager.getAllToolDefinitions).toHaveBeenCalledWith(
          'https://custom.gitlab.com',
          'flat',
        );
      });

      it('should pass undefined to getAllToolDefinitions when sessionId is absent (registry resolves via OAuth context chain)', async () => {
        // No extra.sessionId (e.g. stdio transport) — pass undefined so registry resolves
        // via OAuth context URL → current URL → GITLAB_BASE_URL chain (#398).
        await listToolsHandler({ method: 'tools/list' });

        expect(mockSessionManager.getSessionInstanceUrl).not.toHaveBeenCalled();
        expect(mockRegistryManager.getAllToolDefinitions).toHaveBeenCalledWith(undefined, 'flat');
      });

      it('should pass undefined to getAllToolDefinitions for unknown/expired sessionId (registry resolves via OAuth context chain)', async () => {
        // SessionManager always sets instanceUrl on createSession(); undefined from
        // getSessionInstanceUrl means the sessionId is unknown or expired. Pass it
        // through so the registry's resolution chain is not short-circuited (#398).
        mockSessionManager.getSessionInstanceUrl.mockReturnValue(undefined);

        await listToolsHandler({ method: 'tools/list' }, { sessionId: 'new-sess' });

        expect(mockRegistryManager.getAllToolDefinitions).toHaveBeenCalledWith(undefined, 'flat');
      });
    });
  });

  describe('call tool handler', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    it('preserves explicitly declared MCP result envelopes', async () => {
      // Auth/UI metadata and structured data must reach the host outside text content.
      const envelope = {
        content: [{ type: 'text', text: 'Ready' }],
        structuredContent: { ready: true },
        _meta: { 'ui/resourceUri': 'ui://gitlab/settings' },
      };
      mockRegistryManager.getTool.mockReturnValue({ resultFormat: 'mcp' });
      mockRegistryManager.executeTool.mockResolvedValue(envelope);
      const result = await callToolHandler({
        params: { name: 'settings', arguments: {} },
      });
      expect(result).toEqual(envelope);
    });

    it('rejects structured output that violates the declared schema', async () => {
      // A malformed native output must be a tool error, never a misleading success.
      mockRegistryManager.getTool.mockReturnValue({
        resultFormat: 'mcp',
        outputSchema: {
          type: 'object',
          properties: { ready: { type: 'boolean' } },
          required: ['ready'],
        },
      });
      mockRegistryManager.executeTool.mockResolvedValue({
        content: [],
        structuredContent: { ready: 'yes' },
      });
      const result = await callToolHandler({ params: { name: 'settings', arguments: {} } });
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('output');
    });

    it('should update session instanceUrl on each tool call (#398)', async () => {
      // Verifies that the CallTool handler keeps per-session instance URL in sync
      // so subsequent ListTools calls resolve the correct tool catalog for that session.
      const request = {
        params: { name: 'get_project', arguments: { id: 'proj-1' } },
      };

      await callToolHandler(request, { sessionId: 'sess-xyz' });

      expect(mockSessionManager.setSessionInstanceUrl).toHaveBeenCalledWith(
        'sess-xyz',
        'https://gitlab.example.com',
      );
    });

    // Account actions run as the connection's own account, not the one the chat switched
    // to: pinning the session to that account's instance would list the wrong instance's
    // tools until the next ordinary call.
    it('keeps the session instance when a call manages accounts', async () => {
      mockRegistryManager.executeTool.mockResolvedValue({ accounts: [] });

      await callToolHandler(
        { params: { name: 'manage_context', arguments: { action: 'list_accounts' } } },
        { sessionId: 'sess-xyz' },
      );

      expect(mockSessionManager.setSessionInstanceUrl).not.toHaveBeenCalled();
    });

    it('should not update session instanceUrl when sessionId is absent (#398)', async () => {
      // No extra.sessionId — no crash, no spurious session update
      const request = {
        params: { name: 'get_project', arguments: { id: 'proj-1' } },
      };

      await callToolHandler(request);

      expect(mockSessionManager.setSessionInstanceUrl).not.toHaveBeenCalled();
    });

    it('should persist the OAuth context URL when sessionId is present (#398)', async () => {
      // Verifies OAuth path: when isOAuthEnabled=true and getGitLabApiUrlFromContext returns
      // an instance URL, setSessionInstanceUrl is called with the OAuth URL (not GITLAB_BASE_URL).
      // Regression guard: a fallback to GITLAB_BASE_URL in OAuth mode would silently break
      // multi-tenant tool catalog filtering.
      const oauth = await import('../../src/oauth/index');
      const oauthUrl = 'https://oauth-instance.example.com';
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(oauthUrl);

      await callToolHandler(
        { params: { name: 'get_project', arguments: { id: 'proj-1' } } },
        { sessionId: 'sess-oauth' },
      );

      expect(mockSessionManager.setSessionInstanceUrl).toHaveBeenCalledWith('sess-oauth', oauthUrl);

      // Restore defaults so subsequent tests are unaffected
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    });

    it('should NOT update session instanceUrl when OAuth context URL is absent (#398)', async () => {
      // Regression guard: contextless OAuth calls (health checks, non-OAuth transport)
      // fall back to GITLAB_BASE_URL for routing — that fallback must NOT be written into
      // SessionManager, which would silently overwrite a session already pinned to another
      // instance and break multi-tenant tool catalog filtering on the next ListTools call.
      const oauth = await import('../../src/oauth/index');
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(true);
      // getGitLabApiUrlFromContext returns undefined — contextless / startup health check
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);

      await callToolHandler(
        { params: { name: 'get_project', arguments: { id: 'proj-1' } } },
        { sessionId: 'sess-pinned' },
      );

      // Session URL must NOT be updated (fallback GITLAB_BASE_URL must not overwrite pinned URL)
      expect(mockSessionManager.setSessionInstanceUrl).not.toHaveBeenCalled();

      // Restore defaults
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    });

    // In OAuth mode every call goes to the token's instance. The session's tool list must
    // describe that instance after a context change too, also while GitLab is unreachable,
    // or the client would list tools of an instance none of its calls reach.
    it.each([
      ['connected', true],
      ['unreachable', false],
    ])(
      'keeps the session on the token instance after a context change (%s)',
      async (_, reachable) => {
        const oauth = await import('../../src/oauth/index');
        (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(true);
        (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(
          'https://account.example.com',
        );
        mockHealthMonitor.isInstanceReachable.mockReturnValue(reachable);
        mockSessionManager.getSessionInstanceUrl.mockReturnValue('https://account.example.com');

        await callToolHandler(
          {
            params: {
              name: 'manage_context',
              arguments: { action: 'switch_preset', preset: 'readonly' },
            },
          },
          { sessionId: 'sess-switch' },
        );

        const pins = mockSessionManager.setSessionInstanceUrl.mock.calls.filter(
          (c) => c[0] === 'sess-switch',
        );
        expect(pins).toEqual([['sess-switch', 'https://account.example.com']]);

        mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
        (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
        (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
      },
    );

    // A session pinned to another instance (from an earlier connection of the chat) is moved
    // to the OAuth token's instance by the next call, a reset as well, so an immediate tool
    // list is built for the instance the calls reach.
    it('pins the session to the account instance on reset', async () => {
      const oauth = await import('../../src/oauth/index');
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(
        'https://account.example.com',
      );
      mockSessionManager.getSessionInstanceUrl.mockReturnValue('https://previous.example.com');

      await callToolHandler(
        { params: { name: 'manage_context', arguments: { action: 'reset' } } },
        { sessionId: 'sess-reset' },
      );

      const pins = mockSessionManager.setSessionInstanceUrl.mock.calls.filter(
        (c) => c[0] === 'sess-reset',
      );
      expect(pins.at(-1)).toEqual(['sess-reset', 'https://account.example.com']);

      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
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

      expect(mockRegistryManager.hasToolHandler).toHaveBeenCalledWith(
        'get_project',
        'https://gitlab.example.com',
      );
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'get_project',
        { id: 'test-project' },
        'https://gitlab.example.com',
      );
    });

    it('normalizes omitted arguments to an empty object for no-input tools', async () => {
      // MCP permits omitted arguments; native settings/profile reads use no inputs.
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
            text: JSON.stringify({ result: 'success' }, null, 2),
          },
        ],
      });
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'get_project',
        {},
        'https://gitlab.example.com',
      );
    });

    it('should verify connection and continue if already initialized', async () => {
      // isConnected returns true (default) → should skip initialize()
      mockConnectionManager.initialize.mockClear();

      const mockRequest = {
        params: {
          name: 'test_tool',
          arguments: {},
        },
      };

      await callToolHandler(mockRequest);

      expect(mockConnectionManager.getClient).toHaveBeenCalled();
      // Connected fast-path skips initialize()
      expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
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

    // A tool list sent before an instance was first initialized could not be filtered by its
    // version, tier and token scopes; once a call initialized it, clients are told to list
    // again. An instance already initialized changes nothing, so nobody is told.
    it('announces the tool list again after a call first initializes an instance', async () => {
      mockConnectionManager.isConnected.mockReturnValue(false);

      await callToolHandler({ params: { name: 'test_tool', arguments: {} } }, { sessionId: 's1' });
      // The announcement is not awaited by the call: wait for it before asserting, so it
      // cannot land after the mocks are cleared below.
      for (
        let tick = 0;
        tick < 50 && mockSessionManager.broadcastToolsListChanged.mock.calls.length === 0;
        tick++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(mockConnectionManager.initialize).toHaveBeenCalledTimes(1);
      expect(mockSessionManager.broadcastToolsListChanged).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );
      expect(mockServer.sendToolListChanged).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      mockConnectionManager.isConnected.mockReturnValue(true);
      await callToolHandler({ params: { name: 'test_tool', arguments: {} } }, { sessionId: 's1' });
      for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSessionManager.broadcastToolsListChanged).not.toHaveBeenCalled();
      expect(mockServer.sendToolListChanged).not.toHaveBeenCalled();
    });

    // The announcement is best effort: a client that cannot be told keeps the call's result.
    it('answers the call when the tool list cannot be announced', async () => {
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockSessionManager.broadcastToolsListChanged.mockRejectedValueOnce(new Error('closed'));
      mockServer.sendToolListChanged.mockRejectedValueOnce(new Error('not connected'));
      mockRegistryManager.executeTool.mockResolvedValueOnce({ result: 'ok' });

      const result = await callToolHandler(
        { params: { name: 'test_tool', arguments: {} } },
        { sessionId: 's1' },
      );
      for (
        let tick = 0;
        tick < 50 && mockServer.sendToolListChanged.mock.calls.length === 0;
        tick++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.isError).toBeUndefined();
      expect(mockSessionManager.broadcastToolsListChanged).toHaveBeenCalled();
      expect(mockServer.sendToolListChanged).toHaveBeenCalled();
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
      // "Connection failed" is classified as permanent (no transient keyword match)
      // → derivedState='failed' → not retriable
      expect(parsed.reconnecting).toBe(false);
      expect(parsed.auto_retry_enabled).toBe(false);

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
      // Pin health state to 'failed' — auth errors derive failed state
      mockHealthMonitor.getState.mockReturnValue('failed');

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
      expect(parsed.auto_retry_enabled).toBe(false);
      expect(parsed.message).toContain('authentication');
      expect(parsed.message).toContain('Automatic reconnection is disabled');

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    });

    it('should return CONNECTION_FAILED on connected fast-path when getClient throws before bootstrap completes', async () => {
      // isConnected() returns true, so initialize() is intentionally skipped here.
      // getClient() then throws while bootstrapComplete is still false, which should
      // produce a structured CONNECTION_FAILED response rather than a generic error string.
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.getClient.mockImplementationOnce(() => {
        throw new Error('Connection not initialized. Call initialize() first.');
      });

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.tool).toBe('test_tool');
      expect(parsed.action).toBe('list');
      expect(parsed.instance_url).toBe('https://gitlab.example.com');
      // Error is reported to HealthMonitor
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.any(Error),
      );

      // Restore
      mockConnectionManager.getClient.mockReturnValue({});
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
        structuredContent: {
          error: {
            error:
              "Failed to execute tool 'unknown_tool': Tool 'unknown_tool' is not available or has been filtered out",
          },
        },
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
        structuredContent: {
          error: { error: "Failed to execute tool 'test_tool': Tool execution failed" },
        },
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
        structuredContent: { error: { error: "Failed to execute tool 'test_tool': String error" } },
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
      mockHealthMonitor.isInstanceReachable.mockClear();
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      // Clear bootstrap mocks to verify the health gate short-circuits
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockClear();
      mockConnectionManager.getClient.mockClear();
      mockConnectionManager.ensureIntrospected.mockClear();
      mockRegistryManager.executeTool.mockClear();

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.instance_url).toBe('https://gitlab.example.com');
      expect(parsed.tool).toBe('browse_projects');
      expect(parsed.action).toBe('list');
      // disconnected = not actively reconnecting, but auto-retry is enabled
      expect(parsed.reconnecting).toBe(false);
      expect(parsed.auto_retry_enabled).toBe(true);
      // Verify the health gate was consulted with the correct URL
      expect(mockHealthMonitor.isInstanceReachable).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );
      // Health gate must prevent bootstrap and tool execution
      expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
      expect(mockConnectionManager.getClient).not.toHaveBeenCalled();
      expect(mockConnectionManager.ensureIntrospected).not.toHaveBeenCalled();
      expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it('should block connecting state when isInstanceReachable returns false', async () => {
      mockHealthMonitor.getState.mockReturnValue('connecting');
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);

      const result = await callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      // connecting + unreachable → CONNECTION_FAILED with preserved connecting state
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
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
      mockConnectionManager.isConnected.mockReturnValue(false);

      // manage_context should NOT be blocked by health gate
      mockRegistryManager.executeTool.mockResolvedValue({ context: 'info' });
      mockHealthMonitor.reportSuccess.mockClear();
      mockHealthMonitor.reportError.mockClear();
      mockConnectionManager.initialize.mockClear();
      mockConnectionManager.getClient.mockClear();
      mockConnectionManager.ensureIntrospected.mockClear();

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
      // Fast-path skips bootstrap entirely — no GitLab I/O, no health reporting
      expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
      expect(mockConnectionManager.getClient).not.toHaveBeenCalled();
      expect(mockConnectionManager.ensureIntrospected).not.toHaveBeenCalled();
      expect(mockHealthMonitor.reportSuccess).not.toHaveBeenCalled();
      expect(mockHealthMonitor.reportError).not.toHaveBeenCalled();
      // Per-URL cache resolution: instanceUrl threaded through registry calls
      expect(mockRegistryManager.hasToolHandler).toHaveBeenCalledWith(
        'manage_context',
        'https://gitlab.example.com',
      );
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'manage_context',
        { action: 'whoami' },
        'https://gitlab.example.com',
        undefined,
      );

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    it.each([
      {
        label: 'handler not yet cached (hasToolHandler=false)',
        hasToolHandler: false,
        // executeTool not called — no undefined to guard against here
        stubExecuteUndefined: false,
      },
      {
        label: 'TOCTOU: executeTool returns undefined after hasToolHandler=true',
        hasToolHandler: true,
        // Regression guard: fast-path must return null, not {text:"undefined"}
        stubExecuteUndefined: true,
      },
    ])(
      'should fall through to bootstrap when tryManageContextFastPath returns null — $label',
      async ({ hasToolHandler, stubExecuteUndefined }) => {
        // Instance unreachable → tryManageContextFastPath is entered for manage_context
        mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
        mockHealthMonitor.getState.mockReturnValue('disconnected');
        mockConnectionManager.isConnected.mockReturnValue(false);
        mockConnectionManager.initialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        mockRegistryManager.hasToolHandler.mockReturnValue(hasToolHandler);
        if (stubExecuteUndefined) {
          mockRegistryManager.executeTool.mockResolvedValueOnce(undefined);
        }

        const result = await callToolHandler({
          params: { name: 'manage_context', arguments: { action: 'whoami' } },
        });

        // Fast-path returns null → falls through to ensureBootstrapped → CONNECTION_FAILED
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content![0].text);
        expect(parsed.error_code).toBe('CONNECTION_FAILED');
      },
    );

    it('should return error and NOT call reportSuccess when post-bootstrap executeTool returns undefined (TOCTOU)', async () => {
      // Regression guard: hasToolHandler passes but executeTool returns undefined due to
      // concurrent refreshCache swapping the cache. Must throw (converting to McpError)
      // rather than serializing JSON.stringify(undefined) as a valid response.
      // reportSuccess must NOT be called for a cache miss.
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValueOnce(undefined);

      const result = await callToolHandler({
        params: { name: 'test_tool', arguments: {} },
      });

      // Should return an error response (McpError), not reportSuccess
      expect(result.isError).toBe(true);
      expect(mockHealthMonitor.reportSuccess).not.toHaveBeenCalled();
    });

    it('should log warning and continue when refreshCache throws after bootstrap (cache isolated try/catch)', async () => {
      // refreshCache is wrapped in its own try/catch — a failure must NOT abort the tool call.
      // The comment in ensureBootstrapped says "If it fails, the tool call should still proceed".
      const { logWarn } = await import('../../src/logger');
      mockRegistryManager.refreshCache.mockImplementationOnce(() => {
        throw new Error('Cache rebuild failed');
      });
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'ok' });

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      // Tool call succeeds despite refreshCache throwing
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.result).toBe('ok');
      // Cache failure is logged as a warning, not surfaced to the user
      expect(logWarn).toHaveBeenCalledWith(
        'Failed to refresh registry cache after bootstrap',
        expect.objectContaining({
          instanceUrl: 'https://gitlab.example.com',
          err: expect.any(Error),
        }),
      );
    });

    it('should route reachable manage_context through normal bootstrap and report health', async () => {
      // When instance IS reachable, manage_context goes through full bootstrap
      // (unlike the disconnected fast-path above)
      mockRegistryManager.executeTool.mockResolvedValue({ context: 'info' });

      const result = await callToolHandler({
        params: {
          name: 'manage_context',
          arguments: { action: 'whoami' },
        },
      });

      expect(result.isError).toBeUndefined();
      // Reachable path goes through bootstrap → reports health
      expect(mockHealthMonitor.reportSuccess).toHaveBeenCalled();
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

    it('should handle non-Error thrown from initialize (coverage: catch block non-Error branches)', async () => {
      // Simulates a non-standard rejection: string/object rather than Error instance.
      // Exercises the ternary fallback paths in the catch block of ensureBootstrapped.
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockRejectedValue('string rejection');

      const result = await callToolHandler({
        params: { name: 'test_tool', arguments: {} },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      // Non-Error: initError instanceof Error is false → reportError NOT called
      expect(mockHealthMonitor.reportError).not.toHaveBeenCalled();

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

      // refreshCache should have been called exactly once with the instance URL
      expect(mockRegistryManager.refreshCache).toHaveBeenCalledTimes(1);
      expect(mockRegistryManager.refreshCache).toHaveBeenCalledWith('https://gitlab.example.com');
    });

    it('should log warning when broadcastToolsListChanged rejects in state change callback (line 424)', async () => {
      // Line 424: .catch() on broadcastToolsListChangedForStateChange when broadcast fails.
      // The catch handler logs a warning but does not rethrow (fire-and-forget pattern).
      const { logWarn } = await import('../../src/logger');
      const stateChangeCallback = mockHealthMonitor.onStateChange.mock.calls[0]?.[0];
      expect(stateChangeCallback).toBeDefined();

      mockSessionManager.broadcastToolsListChanged.mockRejectedValueOnce(
        new Error('Broadcast failed'),
      );
      mockRegistryManager.refreshCache.mockClear();

      if (stateChangeCallback) {
        stateChangeCallback('https://gitlab.example.com', 'disconnected', 'healthy');
        // Flush microtasks through the fire-and-forget catch path
        await new Promise((resolve) => process.nextTick(resolve));
        await new Promise((resolve) => process.nextTick(resolve));
        await new Promise((resolve) => process.nextTick(resolve));
      }

      // Despite broadcast failure, refreshCache should still have been called
      expect(mockRegistryManager.refreshCache).toHaveBeenCalledWith('https://gitlab.example.com');
      // Broadcast must be scoped to the affected instance — not a global broadcast
      expect(mockSessionManager.broadcastToolsListChanged).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );
      // Warning must be logged so the failure is observable without crashing
      expect(logWarn).toHaveBeenCalledWith(
        'Failed to broadcast tools/list_changed after state change',
        expect.objectContaining({
          instanceUrl: 'https://gitlab.example.com',
          err: expect.any(Error),
        }),
      );
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

      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'test_tool',
        {},
        'https://gitlab.example.com',
      );
    });

    it('should fall back to GITLAB_BASE_URL when getCurrentInstanceUrl returns null (non-OAuth mode)', async () => {
      // Exercises the `?? GITLAB_BASE_URL` fallback in the non-OAuth URL resolution path.
      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      mockConnectionManager.getCurrentInstanceUrl.mockReturnValueOnce(null);

      await callToolHandler({ params: { name: 'test_tool', arguments: {} } });

      // Tool should be invoked with the GITLAB_BASE_URL fallback
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'test_tool',
        {},
        'https://gitlab.example.com',
      );
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

  describe('ensureBootstrapped — LOG_FORMAT=verbose paths', () => {
    // These tests temporarily switch LOG_FORMAT to 'verbose' to exercise the
    // diagnostic logging branches inside ensureBootstrapped (lines 294, 322-326).
    // The config module mock object is mutated per-describe and restored in afterAll.
    let configMock: { LOG_FORMAT: string; HANDLER_TIMEOUT_MS: number; GITLAB_BASE_URL: string };

    beforeAll(() => {
      configMock = jest.requireMock('../../src/config');
      configMock.LOG_FORMAT = 'verbose';
    });

    afterAll(() => {
      configMock.LOG_FORMAT = 'condensed';
    });

    beforeEach(async () => {
      jest.clearAllMocks();
      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      // Default mocks needed by bootstrap + tool execution
      mockConnectionManager.isConnected.mockReturnValue(false); // triggers line 294 log
      mockConnectionManager.initialize.mockResolvedValue(undefined);
      mockConnectionManager.getClient.mockReturnValue({});
      mockConnectionManager.getInstanceInfo.mockReturnValue({
        version: '16.0.0',
        tier: 'ultimate',
      });
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'ok' });
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.isAnyInstanceHealthy.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
    });

    afterEach(() => {
      mockConnectionManager.isConnected.mockReturnValue(true);
    });

    it('should log init message and connection-verified info when getInstanceInfo succeeds (lines 294, 323-324)', async () => {
      // isConnected=false triggers the "Connection not initialized" verbose log (line 294).
      // After bootstrap, getInstanceInfo succeeds → "Connection verified: ..." log (lines 323-324).
      const result = await callToolHandler({ params: { name: 'test_tool', arguments: {} } });
      expect(result.isError).toBeFalsy();
    });

    it('should log "instance info not yet available" when getInstanceInfo throws (lines 294, 326)', async () => {
      // getInstanceInfo throws → catches inside the verbose block → logDebug at line 326.
      mockConnectionManager.getInstanceInfo.mockImplementationOnce(() => {
        throw new Error('Not yet available');
      });
      const result = await callToolHandler({ params: { name: 'test_tool', arguments: {} } });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('timeout error handling', () => {
    beforeEach(async () => {
      await setupHandlers(mockServer);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
    });

    it('honors an explicit non-idempotent declaration on a browse tool', async () => {
      // A public hint may tighten retry safety; the name must not override it.
      mockRegistryManager.getTool.mockReturnValue({ idempotent: false });
      mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('headers', 10000));
      const result = await callToolHandler({
        params: { name: 'browse_projects', arguments: { action: 'list' } },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content![0].text).retryable).toBe(false);
    });
    it('should convert timeout error to structured TIMEOUT response for idempotent tools', async () => {
      // Test timeout handling for browse_* (idempotent) tools
      mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('headers', 10000));

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
      mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('headers', 10000));

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
      expect(parsed.timeout_ms).toBe(10000);
    });

    it('should mark browse_* tools as idempotent for timeout errors', async () => {
      mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('connect', 5000));

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
      mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('connect', 5000));

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
        mockRegistryManager.executeTool.mockRejectedValue(new GitLabTimeoutError('connect', 5000));

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
      // Never-settling promise — avoids delayed resolve leaking into later tests
      mockRegistryManager.executeTool.mockImplementation(() => new Promise<never>(() => {}));

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
      mockRegistryManager.executeTool.mockImplementation(() => new Promise<never>(() => {}));

      const result = await callToolHandler({
        params: {
          name: 'manage_merge_request',
          arguments: { project_id: '123' },
        },
      });

      // Should timeout — bootstrap needs bounding even for non-idempotent ops
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');
      expect(parsed.tool).toBe('manage_merge_request');
      expect(parsed.retryable).toBe(false);
      expect(parsed.timeout_ms).toBe(100);
    }, 5000);

    it('should suppress late health reports after tool-timeout via timedOut guard', async () => {
      // When executeTool resolves AFTER the timeout fires, the timedOut guard
      // must prevent the late success from being reported to HealthMonitor.
      // This verifies the timedOut flag suppresses reportSuccess/reportError.
      let resolveDelayed!: (value: unknown) => void;
      mockRegistryManager.executeTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDelayed = resolve;
          }),
      );

      const resultPromise = callToolHandler({
        params: {
          name: 'browse_projects',
          arguments: { action: 'list' },
        },
      });

      // Wait for timeout to fire
      const result = await resultPromise;
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('TIMEOUT');

      // Clear any calls from the bootstrap phase
      mockHealthMonitor.reportSuccess.mockClear();
      mockHealthMonitor.reportError.mockClear();

      // Now resolve the delayed tool — this should NOT trigger late health reports
      resolveDelayed({ result: 'late' });
      // Flush microtasks deterministically (no scheduler-dependent setTimeout)
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      expect(mockHealthMonitor.reportSuccess).not.toHaveBeenCalled();
      expect(mockHealthMonitor.reportError).not.toHaveBeenCalled();
    }, 5000);

    // Resolving the chat's account (a token refresh, a wait for another replica's refresh
    // lease) is part of the call: the timeout bounds it too.
    it('times out a call whose account resolution does not finish', async () => {
      const resolve = jest
        .spyOn(chatAccounts, 'withChatAccount')
        .mockImplementation(() => new Promise<never>(() => {}));
      try {
        const result = await callToolHandler(
          { params: { name: 'browse_projects', arguments: { action: 'list' } } },
          { sessionId: 'sess-1' },
        );

        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content![0].text).error_code).toBe('TIMEOUT');
      } finally {
        resolve.mockRestore();
      }
    }, 5000);

    // The client was already told the call timed out: an account resolved late must not
    // run the tool behind that answer.
    it('does not run the tool once the call timed out during account resolution', async () => {
      let resumeResolution!: () => void;
      const resolve = jest
        .spyOn(chatAccounts, 'withChatAccount')
        .mockImplementation(async (_sessionId, fn) => {
          await new Promise<void>((done) => {
            resumeResolution = done;
          });
          return fn();
        });
      mockRegistryManager.executeTool.mockResolvedValue({ result: 'late' });
      try {
        const result = await callToolHandler(
          { params: { name: 'browse_projects', arguments: { action: 'list' } } },
          { sessionId: 'sess-1' },
        );
        expect(JSON.parse(result.content![0].text).error_code).toBe('TIMEOUT');

        resumeResolution();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
      } finally {
        resolve.mockRestore();
      }
    }, 5000);

    // An account resolution that fails after the client got its timeout has nobody to tell:
    // the failure is logged, never left as an unhandled rejection.
    it('settles an account resolution that fails after the call timed out', async () => {
      let failResolution!: () => void;
      const resolve = jest.spyOn(chatAccounts, 'withChatAccount').mockImplementation(
        () =>
          new Promise<never>((_ok, fail) => {
            failResolution = () => fail(new chatAccounts.AccountUnavailableError('gone'));
          }),
      );
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const result = await callToolHandler(
          { params: { name: 'browse_projects', arguments: { action: 'list' } } },
          { sessionId: 'sess-1' },
        );
        expect(JSON.parse(result.content![0].text).error_code).toBe('TIMEOUT');

        failResolution();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
        resolve.mockRestore();
      }
    }, 5000);

    // Only an unusable account becomes a tool error; any other failure of the resolution
    // surfaces as the request's error.
    it('surfaces a failure of the account resolution that is not an unusable account', async () => {
      const resolve = jest
        .spyOn(chatAccounts, 'withChatAccount')
        .mockRejectedValueOnce(new Error('settings store down'));
      try {
        await expect(
          callToolHandler(
            { params: { name: 'browse_projects', arguments: { action: 'list' } } },
            { sessionId: 'sess-1' },
          ),
        ).rejects.toThrow('settings store down');
      } finally {
        resolve.mockRestore();
      }
    });

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
    it('should log warning and continue when refreshCache throws during initial setup (line 448)', async () => {
      // Cover line 448: logWarn in catch block when initial refreshCache() call throws.
      // setupHandlers must still succeed (handlers registered) despite cache failure.
      const { logWarn } = await import('../../src/logger');
      resetHandlersState();
      mockRegistryManager.refreshCache.mockImplementationOnce(() => {
        throw new Error('Registry cache init failed');
      });

      await setupHandlers(mockServer);
      // All handlers should still be registered despite cache failure
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(4);
      // Cache failure is logged as a warning
      expect(logWarn).toHaveBeenCalledWith(
        'Failed to refresh registry cache during handler setup',
        expect.objectContaining({ err: expect.any(Error) }),
      );

      // Restore
      mockRegistryManager.refreshCache.mockReturnValue(undefined);
    });

    it('should reset healthMonitorStartup promise on health monitor init failure', async () => {
      // Cover lines 222-223: healthMonitorStartup = null; throw error
      mockHealthMonitor.initialize.mockRejectedValueOnce(new Error('Health monitor init failed'));

      // First call should throw (propagating the health monitor error)
      await expect(setupHandlers(mockServer)).rejects.toThrow('Health monitor init failed');

      // After failure, healthMonitorStartup is reset to null so next call retries
      // A second call should attempt initialization again
      mockHealthMonitor.initialize.mockResolvedValue(undefined);
      await setupHandlers(mockServer);
      expect(mockHealthMonitor.initialize).toHaveBeenCalledTimes(2);
      // State-change listener must not be double-registered after retry
      expect(mockHealthMonitor.onStateChange).toHaveBeenCalledTimes(1);
      // Verify the retry registered handlers (server is usable after recovery)
      expect(mockServer.setRequestHandler).toHaveBeenCalled();

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
      (oauth.getTokenContext as jest.Mock).mockReturnValue(null);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
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
        undefined,
      );
    });

    it('uses request grants when reading the dispatch idempotency definition', async () => {
      // A denied account must not inherit a shared host's descriptor/retry hint.
      const oauth = require('../../src/oauth/index');
      oauth.getTokenContext.mockReturnValue({
        gitlabToken: 'fixture-only',
        gitlabScopes: ['read_api'],
      });
      await callToolHandler({ params: { name: 'browse_projects', arguments: { action: 'list' } } });
      expect(mockRegistryManager.getTool).toHaveBeenCalledWith(
        'browse_projects',
        'https://gitlab.example.com',
        ['read_api'],
      );
      expect(mockConnectionManager.ensureIntrospected).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        ['read_api'],
      );
    });

    it('checks request grants on the disconnected configuration fast path', async () => {
      // A token without api/read_api must not reach find_scope_targets just because
      // GitLab is marked unreachable: the fast path passes the grants like normal dispatch.
      const oauth = require('../../src/oauth/index');
      oauth.getTokenContext.mockReturnValue({
        gitlabToken: 'fixture-only',
        gitlabScopes: ['read_user'],
      });
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockRegistryManager.executeTool.mockResolvedValue({ targets: [] });
      try {
        await callToolHandler({
          params: { name: 'find_scope_targets', arguments: { query: 'grp' } },
        });
        expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
          'find_scope_targets',
          { query: 'grp' },
          'https://gitlab.example.com',
          ['read_user'],
        );
        expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
      } finally {
        mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
        mockHealthMonitor.getState.mockReturnValue('healthy');
      }
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

      // Tool should execute successfully; OAuth context path was exercised
      expect(result.isError).toBeUndefined();
      expect(getTokenContext).toHaveBeenCalled();
    });

    it('should route per-request OAuth URL through initialize and health reporting', async () => {
      const oauth = require('../../src/oauth/index');
      const oauthUrl = 'https://oauth-instance.example.com';
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(oauthUrl);
      // Force bootstrap path — isConnected=false triggers initialize(oauthUrl)
      mockConnectionManager.isConnected.mockReturnValue(false);

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(result.isError).toBeUndefined();
      // Verify the OAuth URL was passed through all per-URL code paths
      expect(mockConnectionManager.isConnected).toHaveBeenCalledWith(oauthUrl);
      expect(mockConnectionManager.initialize).toHaveBeenCalledWith(oauthUrl);
      expect(mockConnectionManager.ensureIntrospected).toHaveBeenCalledWith(oauthUrl, undefined);
      expect(mockHealthMonitor.isInstanceReachable).toHaveBeenCalledWith(oauthUrl);
      expect(mockHealthMonitor.reportSuccess).toHaveBeenCalledWith(oauthUrl);
      // Per-URL cache resolution: instanceUrl threaded through registry calls
      expect(mockRegistryManager.hasToolHandler).toHaveBeenCalledWith('test_tool', oauthUrl);
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith('test_tool', {}, oauthUrl);

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    });

    it('should return CONNECTION_FAILED when introspection fails before bootstrap completes', async () => {
      // isConnected returns true (already connected), but ensureIntrospected throws
      // Since bootstrapComplete is still false, this goes to CONNECTION_FAILED path
      mockConnectionManager.ensureIntrospected.mockRejectedValueOnce(
        new Error('Introspection failed'),
      );

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      // Introspection failure should be reported to HealthMonitor
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.any(Error),
      );
    });

    it('should route per-request OAuth URL through failing bootstrap and report to HealthMonitor', async () => {
      const oauth = require('../../src/oauth/index');
      const oauthUrl = 'https://oauth-failing.example.com';
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(oauthUrl);

      // ensureIntrospected fails — bootstrapComplete stays false
      mockConnectionManager.ensureIntrospected.mockRejectedValueOnce(
        new Error('Introspection failed'),
      );

      const result = await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.instance_url).toBe(oauthUrl);
      // Verify the OAuth URL was used for health reporting
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(oauthUrl, expect.any(Error));

      // Restore
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    });

    it('should short-circuit with CONNECTION_FAILED for OAuth URL when unreachable', async () => {
      const oauth = require('../../src/oauth/index');
      const oauthUrl = 'https://oauth-unreachable.example.com';
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(oauthUrl);
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.isInstanceReachable.mockClear();
      mockHealthMonitor.getState.mockReturnValue('disconnected');

      const result = await callToolHandler({
        params: { name: 'browse_projects', arguments: { action: 'list' } },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error_code).toBe('CONNECTION_FAILED');
      expect(parsed.instance_url).toBe(oauthUrl);
      // Verify reachability gate used the OAuth URL, not GITLAB_BASE_URL
      expect(mockHealthMonitor.isInstanceReachable).toHaveBeenCalledWith(oauthUrl);

      // Restore
      mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
      mockHealthMonitor.getState.mockReturnValue('healthy');
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    });

    // A configuration tool answered while GitLab is marked unreachable is how a caller checks
    // or recovers the connection: the monitor probes GitLab again itself, so other tools
    // recover as soon as GitLab answers instead of waiting for the next scheduled attempt.
    it('has the monitor probe GitLab again after a configuration tool answers', async () => {
      mockHealthMonitor.isInstanceReachable.mockReturnValue(false);
      mockHealthMonitor.getState.mockReturnValue('disconnected');
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValueOnce({ success: true });

      try {
        const result = await callToolHandler({
          params: { name: 'check_connection', arguments: {} },
        });

        expect(result.isError).toBeFalsy();
        expect(mockHealthMonitor.forceReconnect).toHaveBeenCalledWith('https://gitlab.example.com');
        expect(mockHealthMonitor.reportSuccess).not.toHaveBeenCalled();
      } finally {
        mockHealthMonitor.isInstanceReachable.mockReturnValue(true);
        mockHealthMonitor.getState.mockReturnValue('healthy');
      }
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
      // Verify requestId was forwarded to getStack
      expect(mockRequestTracker.getStack).toHaveBeenCalledWith('req-123');
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

      expect(mockRequestTracker.getStack).toHaveBeenCalledWith('req-789');
      // recordError should NOT have been called (no sessionId)
      expect(mockConnectionTracker.recordError).not.toHaveBeenCalled();
    });

    // The access log records the caller's working scope.
    it('records the working scope of the caller in the access log', async () => {
      await (mockConfigurationService as ConfigurationService).updateAccount(
        resolveCaller(undefined, 'https://gitlab.example.com'),
        { scope: { type: 'group', path: 'groups/my-group', includeSubgroups: true } },
      );

      await callToolHandler({
        params: {
          name: 'test_tool',
          arguments: {},
        },
      });

      expect(mockRequestTracker.setContextForCurrentRequest).toHaveBeenCalledWith(
        'groups/my-group',
      );
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
      // Never-settling promise — avoids delayed resolve leaking into later tests
      mockConnectionManager.initialize.mockImplementation(() => new Promise<never>(() => {}));

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
        expect.objectContaining({ message: expect.stringContaining('timed out') }),
      );
      expect(mockConnectionManager.clearInflight).toHaveBeenCalledWith(
        'https://gitlab.example.com',
      );

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    }, 5000);

    it('should report error and clearInflight against OAuth URL when bootstrap times out', async () => {
      const oauth = require('../../src/oauth/index');
      const oauthUrl = 'https://oauth-timeout.example.com';
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(true);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(oauthUrl);
      mockConnectionManager.initialize.mockImplementation(() => new Promise<never>(() => {}));

      const { isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      const handler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      const result = await handler({
        params: { name: 'browse_projects', arguments: { action: 'list' } },
      });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content![0].text).error_code).toBe('TIMEOUT');
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        oauthUrl,
        expect.objectContaining({ message: expect.stringContaining('timed out') }),
      );
      expect(mockConnectionManager.clearInflight).toHaveBeenCalledWith(oauthUrl);

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
      (oauth.isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (oauth.getGitLabApiUrlFromContext as jest.Mock).mockReturnValue(undefined);
    }, 5000);

    it('should not report success/error after deferred init resolves post-timeout', async () => {
      // Bootstrap hangs, then resolves AFTER timeout fires
      let resolveInit!: () => void;
      let resolveExecuteReached!: () => void;
      const executeReached = new Promise<void>((resolve) => {
        resolveExecuteReached = resolve;
      });
      mockConnectionManager.initialize.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r;
          }),
      );
      // Track when executeTool is reached after late bootstrap settles
      mockRegistryManager.executeTool.mockImplementationOnce(async () => {
        resolveExecuteReached();
        return { result: 'late' };
      });

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      const handler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      const result = await handler({
        params: { name: 'browse_projects', arguments: { action: 'list' } },
      });

      expect(result.isError).toBe(true);
      const successCallsAfterTimeout = mockHealthMonitor.reportSuccess.mock.calls.length;
      const errorCallsAfterTimeout = mockHealthMonitor.reportError.mock.calls.length;

      // Now resolve the deferred init — wait through the full chain
      // (initialize → ensureIntrospected → executeTool) before asserting
      resolveInit();
      await executeReached;
      await new Promise((r) => process.nextTick(r));

      // Neither reportSuccess nor reportError should have been called after timeout
      expect(mockHealthMonitor.reportSuccess.mock.calls.length).toBe(successCallsAfterTimeout);
      expect(mockHealthMonitor.reportError.mock.calls.length).toBe(errorCallsAfterTimeout);

      // Restore
      mockConnectionManager.isConnected.mockReturnValue(true);
      mockConnectionManager.initialize.mockResolvedValue(undefined);
    }, 5000);

    it('should forward late bootstrap rejection (auth error) to HealthMonitor after timeout', async () => {
      // Bootstrap hangs past timeout, then REJECTS with an auth error.
      // The timedOut guard must still forward auth/permanent errors to reportError
      // so the instance converges to `failed` instead of staying in `reconnecting`.
      let rejectInit!: (err: Error) => void;
      mockConnectionManager.initialize.mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectInit = reject;
          }),
      );

      const { isOAuthEnabled, isAuthenticationConfigured } = await import('../../src/oauth/index');
      (isOAuthEnabled as jest.Mock).mockReturnValue(false);
      (isAuthenticationConfigured as jest.Mock).mockReturnValue(true);

      await setupHandlers(mockServer);
      const handler = getRegisteredHandler(mockServer, CallToolRequestSchema);

      const result = await handler({
        params: { name: 'browse_projects', arguments: { action: 'list' } },
      });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content![0].text).error_code).toBe('TIMEOUT');

      // Now reject with a real auth error — should be forwarded despite timedOut
      mockHealthMonitor.reportError.mockClear();
      rejectInit(new Error('401 Unauthorized'));
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      // Auth error classified as 'auth' → forwarded through timedOut guard
      // Pin to the actual 401 rejection (not the timeout sentinel)
      expect(mockHealthMonitor.reportError).toHaveBeenCalledWith(
        'https://gitlab.example.com',
        expect.objectContaining({ message: expect.stringContaining('401') }),
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

      expect(mockRequestTracker.getStack).toHaveBeenCalledWith('req-early-001');
      // recordError should have been called via recordEarlyReturnError (lines 79-81)
      expect(mockConnectionTracker.recordError).toHaveBeenCalledWith(
        'sess-early-001',
        expect.any(String),
      );
    });
  });

  // The settings panel is served as an MCP App resource with a CSP that allows no origin.
  describe('settings panel resource', () => {
    const PANEL_URI = 'ui://gitlab-mcp/settings-panel-v1.html';

    beforeEach(async () => {
      await setupHandlers(mockServer);
    });

    it('lists the panel as an MCP App document', async () => {
      const list = getRegisteredHandler(mockServer, ListResourcesRequestSchema);

      const result = (await list({ method: 'resources/list', params: {} })) as {
        resources: Array<Record<string, unknown>>;
      };

      expect(result.resources).toEqual([
        {
          uri: PANEL_URI,
          name: 'GitLab connection panel',
          mimeType: 'text/html;profile=mcp-app',
          _meta: {
            ui: {
              csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
              prefersBorder: true,
            },
          },
        },
      ]);
    });

    it('reads the panel document with its CSP metadata', async () => {
      const read = getRegisteredHandler(mockServer, ReadResourceRequestSchema);

      const result = (await read({ method: 'resources/read', params: { uri: PANEL_URI } })) as {
        contents: Array<{ uri: string; mimeType: string; text: string; _meta: unknown }>;
      };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe(PANEL_URI);
      expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
      expect(result.contents[0].text.startsWith('<!doctype html>')).toBe(true);
      // Self-contained: nothing is loaded from anywhere, which the empty CSP would block.
      expect(result.contents[0].text).not.toMatch(/<(script|link|img)[^>]+(src|href)=/);
      expect(result.contents[0]._meta).toEqual({
        ui: {
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
          prefersBorder: true,
        },
      });
    });

    it('rejects an unknown resource', async () => {
      const read = getRegisteredHandler(mockServer, ReadResourceRequestSchema);

      // The SDK invokes handlers inside a promise chain, so a thrown error answers the request.
      await expect(
        Promise.resolve().then(() =>
          read({ method: 'resources/read', params: { uri: 'ui://gitlab-mcp/other.html' } }),
        ),
      ).rejects.toThrow('Unknown resource: ui://gitlab-mcp/other.html');
    });
  });

  // The caller's settings take effect in execution, also for direct calls a UI never
  // offered: a restricted tool is neither listed nor run, and nothing reaches GitLab.
  describe('caller settings', () => {
    const staticCaller = () => resolveCaller('sess-1', 'https://gitlab.example.com');
    const service = () => mockConfigurationService as ConfigurationService;

    beforeEach(async () => {
      await setupHandlers(mockServer);
      listToolsHandler = getRegisteredHandler(mockServer, ListToolsRequestSchema);
      callToolHandler = getRegisteredHandler(mockServer, CallToolRequestSchema);
      mockRegistryManager.getAllToolDefinitions.mockReturnValue([
        { name: 'browse_merge_requests', description: '', inputSchema: { type: 'object' } },
        { name: 'manage_merge_request', description: '', inputSchema: { type: 'object' } },
        { name: 'manage_context', description: '', inputSchema: { type: 'object' } },
      ]);
      mockRegistryManager.isReadOnlyTool.mockImplementation(
        (name: string) => !name.startsWith('manage_'),
      );
      mockRegistryManager.getToolRegistryKey.mockImplementation((name: string) =>
        name.includes('merge_request') ? 'mrs' : 'context',
      );
    });

    // An operator allowlist must constrain every project tool, independently of account settings.
    it('refuses another project before executing a pipeline tool', async () => {
      runtimeConfig.GITLAB_ALLOWED_PROJECT_IDS.push('1');
      try {
        const result = await callToolHandler(
          {
            params: {
              name: 'browse_pipelines',
              arguments: { action: 'job', project_id: '2', job_id: '3' },
            },
          },
          { sessionId: 'sess-1' },
        );
        expect(result.isError).toBe(true);
        expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
      } finally {
        runtimeConfig.GITLAB_ALLOWED_PROJECT_IDS.splice(0);
      }
    });

    // Clearing a personal working scope must never remove the operator's project restriction.
    it('keeps the operator allowlist when the caller selects everywhere', async () => {
      runtimeConfig.GITLAB_ALLOWED_PROJECT_IDS.push('1');
      try {
        await service().updateSession(staticCaller(), { scope: 'everywhere' });
        const result = await callToolHandler(
          { params: { name: 'browse_projects', arguments: { action: 'get', project_id: '2' } } },
          { sessionId: 'sess-1' },
        );
        expect(result.isError).toBe(true);
        expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
      } finally {
        runtimeConfig.GITLAB_ALLOWED_PROJECT_IDS.splice(0);
      }
    });

    it('lists every tool for a caller without settings', async () => {
      const result = await listToolsHandler({}, { sessionId: 'sess-1' });

      expect(result.tools?.map((t) => t.name)).toEqual([
        'browse_merge_requests',
        'manage_merge_request',
        'manage_context',
      ]);
    });

    it('hides write tools from a read-only account and keeps manage_context', async () => {
      await service().updateAccount(staticCaller(), { readOnly: true });

      const result = await listToolsHandler({}, { sessionId: 'sess-1' });

      expect(result.tools?.map((t) => t.name)).toEqual(['browse_merge_requests', 'manage_context']);
    });

    it('hides the tools of a group the account switched off', async () => {
      await service().updateAccount(staticCaller(), { disabledToolGroups: ['mrs'] });

      const result = await listToolsHandler({}, { sessionId: 'sess-1' });

      expect(result.tools?.map((t) => t.name)).toEqual(['manage_context']);
    });

    // An action the preset denies is refused on every call, so the list does not offer it:
    // its branch leaves a discriminated schema and its value the enum of a flat one, and a
    // tool whose every action is denied is not listed.
    it('leaves the actions a preset denies out of the listed schemas', async () => {
      const branch = (action: string) => ({
        type: 'object',
        properties: { action: { const: action } },
        required: ['action'],
      });
      mockRegistryManager.getAllToolDefinitions.mockReturnValue([
        {
          name: 'manage_merge_request',
          description: '',
          inputSchema: { oneOf: [branch('merge'), branch('update')] },
        },
        {
          name: 'browse_merge_requests',
          description: '',
          inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['list', 'get'] } },
          },
        },
        {
          name: 'manage_todos',
          description: '',
          inputSchema: { oneOf: [branch('mark_done')] },
        },
      ]);
      mockPresets.guarded = {
        denied_actions: [
          'manage_merge_request:merge',
          'browse_merge_requests:get',
          'manage_todos:mark_done',
        ],
      };
      await service().updateSession(staticCaller(), { preset: 'guarded' });

      const result = await listToolsHandler({}, { sessionId: 'sess-1' });

      expect(result.tools?.map((t) => t.name)).toEqual([
        'manage_merge_request',
        'browse_merge_requests',
      ]);
      const [manage, browse] = result.tools as Array<{ inputSchema: Record<string, unknown> }>;
      expect(manage.inputSchema.oneOf).toEqual([branch('update')]);
      expect(browse.inputSchema).toMatchObject({
        properties: { action: { enum: ['list'] } },
      });
    });

    // A sessionless static-token chat (stdio) that switched to another configured instance:
    // the list is filtered with that instance's settings, not the startup one's.
    it('lists a sessionless caller with the settings of the instance it switched to', async () => {
      const switched = 'https://other.example.com';
      await service().updateAccount(resolveCaller(undefined, switched), { readOnly: true });

      const result = await runWithTokenAccount({ instanceUrl: switched, token: 'other' }, () =>
        listToolsHandler({}, {}),
      );

      expect(result.tools?.map((t) => t.name)).toEqual(['browse_merge_requests', 'manage_context']);
    });

    // Another chat initializing a configured instance moves the connection manager's latest
    // instance; a chat that did not switch keeps its own instance and settings.
    it('keeps a chat that did not switch on the server instance', async () => {
      mockConnectionManager.getCurrentInstanceUrl.mockReturnValue('https://other.example.com');
      try {
        await service().updateAccount(resolveCaller(undefined, 'https://other.example.com'), {
          readOnly: true,
        });

        const result = await listToolsHandler({}, {});

        expect(result.tools?.map((t) => t.name)).toContain('manage_merge_request');
      } finally {
        mockConnectionManager.getCurrentInstanceUrl.mockReturnValue('https://gitlab.example.com');
      }
    });

    // A chat whose chosen account cannot be used lists the connection's own tools, so it
    // still sees manage_context to switch away; other failures of the list surface.
    it('lists the connection tools while the chosen account cannot be used', async () => {
      const resolve = jest
        .spyOn(chatAccounts, 'withChatAccount')
        .mockRejectedValueOnce(new chatAccounts.AccountUnavailableError('account gone'))
        .mockRejectedValueOnce(new Error('settings store down'));

      try {
        const result = await listToolsHandler({}, { sessionId: 'sess-1' });
        expect(result.tools?.map((t) => t.name)).toContain('manage_context');
        await expect(listToolsHandler({}, { sessionId: 'sess-1' })).rejects.toThrow(
          'settings store down',
        );
      } finally {
        resolve.mockRestore();
      }
    });

    // A chat whose chosen account became unusable (unlinked, token removed, grant revoked)
    // can still list, switch, link and unlink accounts; every other call is refused.
    it('runs the account actions of a chat whose chosen account cannot be used', async () => {
      const resolve = jest
        .spyOn(chatAccounts, 'withChatAccount')
        .mockRejectedValue(new chatAccounts.AccountUnavailableError('account gone'));
      mockRegistryManager.executeTool.mockResolvedValue({ success: true });

      try {
        const recovery = await callToolHandler(
          {
            params: {
              name: 'manage_context',
              arguments: { action: 'switch_account', account: 'gitlab:1' },
            },
          },
          { sessionId: 'sess-1' },
        );
        expect(recovery.isError).toBeUndefined();
        // It runs on the connection's own instance, never the unusable account's.
        expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
          'manage_context',
          expect.objectContaining({ action: 'switch_account' }),
          'https://gitlab.example.com',
          undefined,
        );

        mockRegistryManager.executeTool.mockClear();
        const refused = await callToolHandler(
          { params: { name: 'browse_merge_requests', arguments: { action: 'list' } } },
          { sessionId: 'sess-1' },
        );
        expect(refused.isError).toBe(true);
        expect(refused.content?.[0].text).toContain('account gone');
        expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
      } finally {
        resolve.mockRestore();
      }
    });

    // The connection's instance fails to start while the health monitor still reports it
    // reachable: listing and switching accounts need no GitLab connection, so the chat can
    // still move to an account that works.
    it('runs the account actions when the instance cannot be initialized', async () => {
      mockConnectionManager.isConnected.mockReturnValue(false);
      mockConnectionManager.initialize.mockRejectedValue(new Error('Connection failed'));
      mockRegistryManager.hasToolHandler.mockReturnValue(true);
      mockRegistryManager.executeTool.mockResolvedValue([{ id: 'gitlab:1' }]);

      const result = await callToolHandler(
        { params: { name: 'manage_context', arguments: { action: 'list_accounts' } } },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBeUndefined();
      expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'manage_context',
        expect.objectContaining({ action: 'list_accounts' }),
        'https://gitlab.example.com',
        undefined,
      );
    });

    // Listing is visibility only: an unreadable settings store does not empty the list.
    it('keeps the registry list when the settings cannot be read', async () => {
      mockSettingsRead.mockRejectedValue(new Error('database down'));

      const result = await listToolsHandler({}, { sessionId: 'sess-1' });

      expect(result.tools).toHaveLength(3);
    });

    it('refuses a direct call to a write tool in read-only mode without running it', async () => {
      await service().updateSession(staticCaller(), { readOnly: true });

      const result = await callToolHandler(
        { params: { name: 'manage_merge_request', arguments: { action: 'merge' } } },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0].text).toContain(
        "'manage_merge_request merge' is not allowed by the current settings: read-only mode is on",
      );
      expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
      expect(mockConnectionManager.initialize).not.toHaveBeenCalled();
    });

    // Limits that need no lookup refuse the call before a numeric target is resolved through
    // GitLab, so a refused call reaches nothing.
    it('refuses a read-only call with a numeric target without looking the target up', async () => {
      await service().updateAccount(staticCaller(), {
        readOnly: true,
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      const lookup = jest.spyOn(scopeIds, 'withTargetPaths');

      try {
        const result = await callToolHandler(
          {
            params: {
              name: 'manage_merge_request',
              arguments: { action: 'merge', project_id: 7, merge_request_iid: 1 },
            },
          },
          { sessionId: 'sess-1' },
        );

        expect(result.content?.[0].text).toContain('read-only mode is on');
        expect(lookup).not.toHaveBeenCalled();
      } finally {
        lookup.mockRestore();
      }
    });

    it('names only the tool when a refused call has no action', async () => {
      await service().updateSession(staticCaller(), { readOnly: true });

      const result = await callToolHandler(
        { params: { name: 'manage_merge_request', arguments: {} } },
        { sessionId: 'sess-1' },
      );

      expect(result.content?.[0].text).toContain(
        "'manage_merge_request' is not allowed by the current settings: read-only mode is on",
      );
    });

    it('refuses a project outside the working scope and runs one inside it', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });

      const outside = await callToolHandler(
        {
          params: {
            name: 'browse_merge_requests',
            arguments: { action: 'list', project_id: 'other/app' },
          },
        },
        { sessionId: 'sess-1' },
      );
      const inside = await callToolHandler(
        {
          params: {
            name: 'browse_merge_requests',
            arguments: { action: 'list', project_id: 'team/app' },
          },
        },
        { sessionId: 'sess-1' },
      );

      expect(outside.content?.[0].text).toMatch(/outside the allowed scope/);
      expect(inside.isError).toBeFalsy();
      expect(mockRegistryManager.executeTool).toHaveBeenCalledTimes(1);
    });

    // An argument the tool does not take is dropped by its handler, so it is not checked
    // against the scope: the call runs as it would without one.
    it('ignores an argument the tool does not declare when checking the scope', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      mockRegistryManager.getDeclaredArguments.mockReturnValueOnce(new Set(['action', 'user_id']));

      const result = await callToolHandler(
        {
          params: {
            name: 'browse_users',
            arguments: { action: 'get', user_id: 1, project_id: 'outside/project' },
          },
        },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBeFalsy();
      expect(mockRegistryManager.executeTool).toHaveBeenCalledTimes(1);
      // Only the selected action's arguments are declared for the scope check.
      expect(mockRegistryManager.getDeclaredArguments).toHaveBeenCalledWith('browse_users', 'get');
    });

    it('strips targets from unselected action branches before resolving scope IDs', async () => {
      // group_id belongs to the group search variant; project search must not resolve or reject it.
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      mockRegistryManager.getDeclaredArguments.mockReturnValueOnce(
        new Set(['action', 'project_id', 'group_id', 'scope', 'search']),
      );
      const ids = jest.spyOn(require('../../src/configuration/scope-ids'), 'withTargetPaths');
      const result = await callToolHandler(
        {
          params: {
            name: 'browse_search',
            arguments: {
              action: 'project',
              project_id: 'team/app',
              group_id: 'outside',
              scope: 'issues',
              search: 'bug',
            },
          },
        },
        { sessionId: 'sess-1' },
      );
      expect(result.isError).toBeFalsy();
      expect(ids.mock.calls[0][0]).toEqual(
        expect.not.objectContaining({ group_id: expect.anything() }),
      );
      ids.mockRestore();
    });

    // Validate the complete entrypoint: multi-project preflight must reach sorted search emulation.
    it('executes a global project search for a multi-project preset scope', async () => {
      const resolved = await service().resolve(staticCaller());
      const scope = { projects: ['team/a', 'team/b'] };
      const { ScopeEnforcer } = require('../../src/profiles/scope-enforcer');
      jest.spyOn(service(), 'resolve').mockResolvedValueOnce({
        ...resolved,
        policy: { ...resolved.policy, scope, scopeEnforcer: new ScopeEnforcer(scope) },
      });
      mockRegistryManager.executeTool.mockImplementation(async (_tool, args) => ({
        id: args.project_id === 'team/a' ? 1 : 2,
        name: 'app',
        name_with_namespace: 'team / app',
        archived: false,
        path_with_namespace: args.project_id,
        created_at: args.project_id === 'team/a' ? '2024-01-01' : '2025-01-01',
      }));
      const result = await callToolHandler(
        {
          params: {
            name: 'browse_search',
            arguments: {
              action: 'global',
              scope: 'projects',
              search: 'app',
              sort: 'desc',
              order_by: 'created_at',
              per_page: 1,
            },
          },
        },
        { sessionId: 'sess-1' },
      );
      expect(result.isError).toBeFalsy();
      expect(mockRegistryManager.executeTool).toHaveBeenCalledTimes(2);
      expect(JSON.parse(result.content![0].text)).toMatchObject({ results: [{ id: 2 }] });
    });

    // A preset naming its group by numeric id: the listing returns paths, so the scope is read
    // as the group's path before its rows are kept, instead of keeping none of them.
    it("lists the projects of a preset's numeric group scope", async () => {
      const resolved = await service().resolve(staticCaller());
      const scope = { group: '4' };
      const { ScopeEnforcer } = require('../../src/profiles/scope-enforcer');
      jest.spyOn(service(), 'resolve').mockResolvedValueOnce({
        ...resolved,
        policy: { ...resolved.policy, scope, scopeEnforcer: new ScopeEnforcer(scope) },
      });
      const { gitlab } = require('../../src/utils/gitlab-api');
      const read = jest
        .spyOn(gitlab, 'get')
        .mockImplementation(async (path: unknown) =>
          path === 'namespaces/4' ? { id: 4, full_path: 'team' } : undefined,
        );
      mockRegistryManager.executeTool.mockResolvedValue([
        { id: 1, path_with_namespace: 'team/app' },
        { id: 2, path_with_namespace: 'elsewhere/shared' },
      ]);

      try {
        const result = await callToolHandler(
          { params: { name: 'browse_projects', arguments: { action: 'list' } } },
          { sessionId: 'sess-1' },
        );

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(result.content![0].text)).toEqual([
          { id: 1, path_with_namespace: 'team/app' },
        ]);
      } finally {
        read.mockRestore();
      }
    });

    // Another chat of the same account keeps its own session settings.
    it('applies a session override to its own session only', async () => {
      await service().updateSession(staticCaller(), { readOnly: true });

      const other = await callToolHandler(
        { params: { name: 'manage_merge_request', arguments: { action: 'merge' } } },
        { sessionId: 'sess-2' },
      );

      expect(other.isError).toBeFalsy();
      expect(mockRegistryManager.executeTool).toHaveBeenCalledTimes(1);
    });

    // Running a call without knowing the caller's restrictions could bypass them.
    it('refuses a call when the settings cannot be read', async () => {
      mockSettingsRead.mockRejectedValue(new Error('database down'));

      const result = await callToolHandler(
        { params: { name: 'browse_merge_requests', arguments: { action: 'list' } } },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0].text).toContain('database down');
      expect(mockRegistryManager.executeTool).not.toHaveBeenCalled();
    });

    it('runs the tool with its caller available to it', async () => {
      const { currentCaller } = jest.requireActual('../../src/configuration/caller');
      let seen: unknown;
      mockRegistryManager.executeTool.mockImplementation(async () => {
        seen = currentCaller();
        return { ok: true };
      });

      await callToolHandler(
        { params: { name: 'manage_context', arguments: { action: 'show' } } },
        { sessionId: 'sess-1' },
      );

      expect(seen).toMatchObject({ sessionKey: 'sess-1', oauth: false });
    });

    // A listing that names no target reads everything the account sees; in a scoped
    // chat it reads the scope instead, and what it cannot filter by is left out.
    it('narrows a targetless listing to the working scope', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      mockRegistryManager.executeTool.mockResolvedValue([
        { path_with_namespace: 'team/app' },
        { path_with_namespace: 'other/api' },
      ]);

      await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list' } } },
        { sessionId: 'sess-1' },
      );
      const search = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'search', q: 'app' } } },
        { sessionId: 'sess-1' },
      );

      // Read in GitLab's largest pages: the scope filters the rows after GitLab paged them.
      // Active projects only, as a plain listing lists them; the tool's default simple view.
      expect(mockRegistryManager.executeTool.mock.calls[0][1]).toEqual({
        action: 'list',
        group_id: 'team',
        include_subgroups: true,
        active: true,
        simple: true,
        page: 1,
        per_page: 100,
      });
      expect(JSON.parse(search.content?.[0].text ?? '')).toEqual([
        { path_with_namespace: 'team/app' },
      ]);
    });

    // A project listing filtered after GitLab paginated it can miss the scope project
    // entirely; a scope made of projects lists those projects themselves.
    it('lists the projects of a project scope instead of filtering one page of all', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'project', path: 'team/app', includeSubgroups: false },
      });
      mockRegistryManager.executeTool.mockImplementation(
        async (tool: string, args: Record<string, unknown>) =>
          tool === 'browse_projects' && args.action === 'get'
            ? { id: 7, path_with_namespace: args.project_id, name: 'App' }
            : [{ path_with_namespace: 'other/api' }],
      );

      const listed = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list' } } },
        { sessionId: 'sess-1' },
      );
      const filtered = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list', search: 'zzz' } } },
        { sessionId: 'sess-1' },
      );

      expect(mockRegistryManager.executeTool.mock.calls[0].slice(0, 2)).toEqual([
        'browse_projects',
        { action: 'get', project_id: 'team/app' },
      ]);
      expect(JSON.parse(listed.content?.[0].text ?? '')).toEqual([
        { id: 7, path_with_namespace: 'team/app', name: 'App' },
      ]);
      expect(JSON.parse(filtered.content?.[0].text ?? '')).toEqual([]);
    });

    // GitLab paginates before the scope filters: a page of mostly outside rows must not hide
    // the matching ones on later pages.
    it('reads further pages until the scoped page is filled', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      const outside = Array.from({ length: 100 }, (_, i) => ({
        path_with_namespace: `other/p${i}`,
      }));
      mockRegistryManager.executeTool.mockImplementation(
        async (_tool: string, args: Record<string, unknown>) =>
          args.page === 1 ? outside : [{ path_with_namespace: 'team/app' }],
      );

      const result = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'search', q: 'app' } } },
        { sessionId: 'sess-1' },
      );

      expect(mockRegistryManager.executeTool.mock.calls.map(([, args]) => args)).toEqual([
        { action: 'search', q: 'app', page: 1, per_page: 100 },
        { action: 'search', q: 'app', page: 2, per_page: 100 },
      ]);
      expect(JSON.parse(result.content?.[0].text ?? '')).toEqual([
        { path_with_namespace: 'team/app' },
      ]);
    });

    it('returns the requested scoped page', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      const rows = Array.from({ length: 5 }, (_, i) => ({ path_with_namespace: `team/p${i}` }));
      mockRegistryManager.executeTool.mockResolvedValue(rows);

      const result = await callToolHandler(
        {
          params: {
            name: 'browse_projects',
            arguments: { action: 'search', q: 'p', page: 2, per_page: 2 },
          },
        },
        { sessionId: 'sess-1' },
      );

      expect(JSON.parse(result.content?.[0].text ?? '')).toEqual([
        { path_with_namespace: 'team/p2' },
        { path_with_namespace: 'team/p3' },
      ]);
    });

    // List filters the scope's own projects cannot apply keep GitLab's listing semantics.
    it('keeps list filters for a project scope by filtering GitLab listing pages', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'project', path: 'team/app', includeSubgroups: false },
      });
      mockRegistryManager.executeTool.mockResolvedValue([
        { path_with_namespace: 'other/api' },
        { path_with_namespace: 'team/app' },
      ]);

      const result = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list', archived: true } } },
        { sessionId: 'sess-1' },
      );

      expect(mockRegistryManager.executeTool.mock.calls[0].slice(0, 2)).toEqual([
        'browse_projects',
        { action: 'list', archived: true, simple: true, page: 1, per_page: 100 },
      ]);
      expect(JSON.parse(result.content?.[0].text ?? '')).toEqual([
        { path_with_namespace: 'team/app' },
      ]);
    });

    // A scope project that is gone is left out; any other failure is reported, not hidden
    // behind a shorter list.
    it('reports a scope project GitLab failed to return', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'project', path: 'team/app', includeSubgroups: false },
      });
      mockRegistryManager.executeTool.mockRejectedValueOnce(
        new Error('GitLab API error: 503 Service Unavailable'),
      );
      const failed = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list' } } },
        { sessionId: 'sess-1' },
      );
      mockRegistryManager.executeTool.mockRejectedValueOnce(
        new Error('GitLab API error: 404 Not Found'),
      );
      const gone = await callToolHandler(
        { params: { name: 'browse_projects', arguments: { action: 'list' } } },
        { sessionId: 'sess-1' },
      );

      expect(failed.isError).toBe(true);
      expect(failed.content?.[0].text).toContain('503');
      expect(gone.isError).toBeFalsy();
      expect(JSON.parse(gone.content?.[0].text ?? '')).toEqual([]);
    });

    // Marking every todo done would also clear todos outside the scope: in a scoped chat
    // only the scope's pending todos are marked, one by one, over every page of the scope
    // group's own todo feed.
    it('marks only the pending todos of the working scope done', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      const pages: Record<number, Array<Record<string, unknown>>> = {
        1: [
          ...Array.from({ length: 99 }, (_, i) => ({
            id: 100 + i,
            project: { path_with_namespace: 'other/api' },
          })),
          { id: 1, project: { path_with_namespace: 'team/app' } },
        ],
        2: [
          { id: 2, group: { full_path: 'team/sub' } },
          { id: 3, project: { path_with_namespace: 'other/api' } },
        ],
      };
      mockRegistryManager.executeTool.mockImplementation(
        async (tool: string, args: Record<string, unknown>) => {
          if (tool === 'browse_namespaces') return { id: 9, full_path: 'team' };
          if (tool === 'browse_todos') return pages[args.page as number] ?? [];
          return { id: args.id, state: 'done' };
        },
      );

      const result = await callToolHandler(
        { params: { name: 'manage_todos', arguments: { action: 'mark_all_done' } } },
        { sessionId: 'sess-1' },
      );

      const calls = mockRegistryManager.executeTool.mock.calls.map(([tool, args]) => [tool, args]);
      expect(calls).toEqual([
        ['browse_namespaces', { action: 'get', namespace_id: 'team' }],
        ['browse_todos', { action: 'list', state: 'pending', per_page: 100, page: 1, group_id: 9 }],
        ['browse_todos', { action: 'list', state: 'pending', per_page: 100, page: 2, group_id: 9 }],
        ['manage_todos', { action: 'mark_done', id: 1 }],
        ['manage_todos', { action: 'mark_done', id: 2 }],
      ]);
      expect(JSON.parse(result.content?.[0].text ?? '')).toEqual({
        success: true,
        marked: 2,
        failed: [],
        message:
          'Marked 2 of 2 todos of the working scope as done; todos outside it were left pending',
      });
    });

    // A failed todo must not hide the ones already marked, and a large scope must not
    // flood GitLab with every request at once.
    it('reports the todos it could not mark and keeps the requests bounded', async () => {
      await service().updateAccount(staticCaller(), {
        scope: { type: 'group', path: 'team', includeSubgroups: true },
      });
      const todos = Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        project: { path_with_namespace: 'team/app' },
      }));
      let inFlight = 0;
      let peak = 0;
      mockRegistryManager.executeTool.mockImplementation(
        async (tool: string, args: Record<string, unknown>) => {
          if (tool === 'browse_namespaces') return { id: 9, full_path: 'team' };
          if (tool === 'browse_todos') return args.page === 1 ? todos : [];
          inFlight++;
          peak = Math.max(peak, inFlight);
          // Yield without a timer: concurrent requests still overlap here, and the call
          // stays far inside this file's 100 ms handler timeout on a loaded machine.
          await Promise.resolve();
          inFlight--;
          if (args.id === 3) throw new Error('GitLab API error: 429 Too Many Requests');
          return { id: args.id, state: 'done' };
        },
      );

      const result = await callToolHandler(
        { params: { name: 'manage_todos', arguments: { action: 'mark_all_done' } } },
        { sessionId: 'sess-1' },
      );

      // Requests overlap, a few at a time: the bound is reached and never exceeded.
      expect(peak).toBe(5);
      expect(JSON.parse(result.content?.[0].text ?? '')).toEqual({
        success: false,
        marked: 11,
        failed: [{ id: 3, error: 'GitLab API error: 429 Too Many Requests' }],
        message:
          'Marked 11 of 12 todos of the working scope as done; 1 could not be marked; todos outside it were left pending',
      });
    });

    // A project search has no projects scope: a mixed scope's groups search their projects,
    // and its own projects answer when they match.
    it('composes a global search of projects across a mixed scope', async () => {
      await service().updateSession(staticCaller(), { preset: 'mixed' });
      mockPresets.mixed = { scope: { project: 'team/app', groups: ['other'] } };
      const project = {
        id: 1,
        name: 'x-app',
        name_with_namespace: 'team / x-app',
        path_with_namespace: 'team/app',
        created_at: '2026-01-01',
      };
      mockRegistryManager.executeTool.mockImplementation(async (tool: string) =>
        tool === 'browse_projects' ? project : { scope: 'projects', results: [] },
      );

      const result = await callToolHandler(
        {
          params: {
            name: 'browse_search',
            arguments: { action: 'global', scope: 'projects', search: 'x' },
          },
        },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content?.[0].text ?? '').results).toEqual([project]);
      expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
        'browse_search',
        expect.objectContaining({ action: 'group', group_id: 'other', scope: 'projects' }),
        'https://gitlab.example.com',
      );
    });

    // Each project of the scope answers an issue search itself, so the global search is
    // composed from their searches instead of refused.
    it('composes a global issue search across a scope of several projects', async () => {
      await service().updateSession(staticCaller(), { preset: 'several' });
      mockPresets.several = { scope: { projects: ['team/app', 'other/api'] } };
      mockRegistryManager.executeTool.mockResolvedValue({ scope: 'issues', results: [] });

      const result = await callToolHandler(
        {
          params: {
            name: 'browse_search',
            arguments: { action: 'global', scope: 'issues', search: 'x' },
          },
        },
        { sessionId: 'sess-1' },
      );

      expect(result.isError).toBeFalsy();
      for (const project_id of ['team/app', 'other/api']) {
        expect(mockRegistryManager.executeTool).toHaveBeenCalledWith(
          'browse_search',
          expect.objectContaining({ action: 'project', project_id, scope: 'issues' }),
          'https://gitlab.example.com',
        );
      }
    });
  });
});
