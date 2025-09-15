/**
 * Unit tests for main handlers.ts file
 * Tests the core MCP server request handling logic
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupHandlers } from '../../src/handlers';
import { ConnectionManager } from '../../src/services/ConnectionManager';
import { getFilteredTools } from '../../src/tools';
import { resetMocks } from '../utils/testHelpers';
import * as entities from '../../src/entities';

// Mock dependencies
jest.mock('../../src/services/ConnectionManager');
jest.mock('../../src/tools');
jest.mock('../../src/entities', () => ({
  coreTools: [],
  labelsTools: [],
  mrsTools: [],
  filesTools: [],
  variablesTools: [],
  wikiTools: [],
  milestoneTools: [],
  pipelineTools: [],
  workitemsTools: [],
  coreReadOnlyTools: [],
  labelsReadOnlyTools: [],
  mrsReadOnlyTools: [],
  filesReadOnlyTools: [],
  variablesReadOnlyTools: [],
  wikiReadOnlyTools: [],
  milestoneReadOnlyTools: [],
  pipelineReadOnlyTools: [],
  workitemsReadOnlyTools: [],
  getDynamicHandlers: jest.fn()
}));

describe('handlers.ts', () => {
  let mockServer: jest.Mocked<Server>;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockGetFilteredTools: jest.MockedFunction<typeof getFilteredTools>;
  let listToolsHandler: any;
  let callToolHandler: any;

  beforeEach(() => {
    resetMocks();

    // Mock Server
    mockServer = {
      setRequestHandler: jest.fn((schema, handler) => {
        if (schema === ListToolsRequestSchema) {
          listToolsHandler = handler;
        } else if (schema === CallToolRequestSchema) {
          callToolHandler = handler;
        }
      })
    } as any;

    // Mock ConnectionManager
    mockConnectionManager = {
      initialize: jest.fn(),
      getClient: jest.fn(),
      getInstanceInfo: jest.fn().mockReturnValue({
        version: '16.0.0',
        tier: 'free'
      })
    } as any;

    (ConnectionManager.getInstance as jest.Mock).mockReturnValue(mockConnectionManager);

    // Mock getFilteredTools
    mockGetFilteredTools = getFilteredTools as jest.MockedFunction<typeof getFilteredTools>;
    mockGetFilteredTools.mockReturnValue([
      {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string' }
          }
        }
      }
    ]);
  });

  describe('setupHandlers', () => {
    it('should set up request handlers on server', async () => {
      mockConnectionManager.initialize.mockResolvedValue(undefined);

      await setupHandlers(mockServer);

      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema,
        expect.any(Function)
      );
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        CallToolRequestSchema,
        expect.any(Function)
      );
    });

    it('should initialize connection manager', async () => {
      mockConnectionManager.initialize.mockResolvedValue(undefined);

      await setupHandlers(mockServer);

      expect(ConnectionManager.getInstance).toHaveBeenCalled();
      expect(mockConnectionManager.initialize).toHaveBeenCalled();
    });

    it('should handle connection manager initialization failure gracefully', async () => {
      mockConnectionManager.initialize.mockRejectedValue(new Error('Connection failed'));

      // Should not throw
      await expect(setupHandlers(mockServer)).resolves.not.toThrow();

      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('ListTools handler', () => {
    beforeEach(async () => {
      mockConnectionManager.initialize.mockResolvedValue(undefined);
      await setupHandlers(mockServer);
    });

    it('should return filtered tools', () => {
      const result = listToolsHandler();

      expect(result).toEqual({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: expect.objectContaining({
              type: 'object'
            })
          })
        ])
      });
      expect(getFilteredTools).toHaveBeenCalled();
    });

    it('should ensure all input schemas have type: object', () => {
      mockGetFilteredTools.mockReturnValue([
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            properties: { param: { type: 'string' } }
          }
        }
      ]);

      const result = listToolsHandler();

      expect(result.tools[0].inputSchema.type).toBe('object');
    });

    it('should remove $schema property for Gemini compatibility', () => {
      mockGetFilteredTools.mockReturnValue([
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: { param: { type: 'string' } }
          }
        }
      ]);

      const result = listToolsHandler();

      expect(result.tools[0].inputSchema).not.toHaveProperty('$schema');
      expect(result.tools[0].inputSchema.type).toBe('object');
    });

    it('should handle tools with no input schema', () => {
      mockGetFilteredTools.mockReturnValue([
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {}
        }
      ]);

      const result = listToolsHandler();

      expect(result.tools[0]).toEqual({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' }
      });
    });
  });

  describe('CallTool handler', () => {
    let mockGetDynamicHandlers: jest.MockedFunction<typeof entities.getDynamicHandlers>;
    let mockHandler: jest.Mock;

    beforeEach(async () => {
      mockConnectionManager.initialize.mockResolvedValue(undefined);
      mockConnectionManager.getClient.mockReturnValue({
        endpoint: 'test-endpoint',
        request: jest.fn(),
        setHeaders: jest.fn(),
        setAuthToken: jest.fn()
      } as any);

      // Get the mocked function from the already mocked entities module
      mockGetDynamicHandlers = entities.getDynamicHandlers as jest.MockedFunction<typeof entities.getDynamicHandlers>;
      mockHandler = jest.fn().mockResolvedValue({ success: true });

      // Configure the mock to return our test handlers
      mockGetDynamicHandlers.mockResolvedValue({
        handleTestTool: mockHandler
      });

      await setupHandlers(mockServer);
    });

    it('should call tool handler successfully', async () => {
      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true }, null, 2)
          }
        ]
      });
      expect(mockHandler).toHaveBeenCalledWith({ param: 'value' });
    });

    it('should throw error when arguments are missing', async () => {
      const request = {
        params: {
          name: 'test_tool'
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Arguments are required' }, null, 2)
          }
        ],
        isError: true
      });
    });

    it('should initialize connection if not available', async () => {
      mockConnectionManager.getClient
        .mockImplementationOnce(() => {
          throw new Error('Not connected');
        })
        .mockReturnValue({
          endpoint: 'test-endpoint',
          request: jest.fn(),
          setHeaders: jest.fn(),
          setAuthToken: jest.fn()
        } as any);

      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      await callToolHandler(request);

      expect(mockConnectionManager.initialize).toHaveBeenCalledTimes(2); // Once in setup, once in handler
    });

    it('should handle connection initialization failure', async () => {
      mockConnectionManager.getClient.mockImplementation(() => {
        throw new Error('Not connected');
      });
      mockConnectionManager.initialize.mockRejectedValue(new Error('Init failed'));

      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Bad Request: Server not initialized' }, null, 2)
          }
        ],
        isError: true
      });
    });

    it('should convert tool name to handler name correctly', async () => {
      const request = {
        params: {
          name: 'create_merge_request',
          arguments: { param: 'value' }
        }
      };

      mockGetDynamicHandlers.mockResolvedValue({
        handleCreateMergeRequest: mockHandler
      });

      await callToolHandler(request);

      expect(mockGetDynamicHandlers).toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith({ param: 'value' });
    });

    it('should handle missing handler function', async () => {
      mockGetDynamicHandlers.mockResolvedValue({
        handleOtherTool: jest.fn()
      });

      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: expect.stringContaining('Handler function \'handleTestTool\' not found')
          }
        ],
        isError: true
      });
    });

    it('should handle handler execution errors', async () => {
      mockHandler.mockRejectedValue(new Error('Handler failed'));

      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: expect.stringContaining('Handler failed')
          }
        ],
        isError: true
      });
    });

    it('should handle dynamic handler import errors', async () => {
      mockGetDynamicHandlers.mockRejectedValue(new Error('Import failed'));

      const request = {
        params: {
          name: 'test_tool',
          arguments: { param: 'value' }
        }
      };

      const result = await callToolHandler(request);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: expect.stringContaining('Failed to import handler handleTestTool')
          }
        ],
        isError: true
      });
    });
  });
});