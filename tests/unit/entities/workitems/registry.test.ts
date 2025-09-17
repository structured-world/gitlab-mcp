import { workitemsToolRegistry, getWorkitemsReadOnlyToolNames, getWorkitemsToolDefinitions, getFilteredWorkitemsTools } from '../../../../src/entities/workitems/registry';

// Create mock client
const mockClient = {
  request: jest.fn(),
};

// Mock GraphQL client to avoid actual API calls
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({
      getClient: jest.fn(() => mockClient),
    })),
  },
}));

describe('Workitems Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(workitemsToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected workitem tools', () => {
      const toolNames = Array.from(workitemsToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_work_items');
      expect(toolNames).toContain('get_work_item');
      expect(toolNames).toContain('get_work_item_types');

      // Check for write tools
      expect(toolNames).toContain('create_work_item');
      expect(toolNames).toContain('update_work_item');
      expect(toolNames).toContain('delete_work_item');
    });

    it('should have tools with valid structure', () => {
      for (const [toolName, tool] of workitemsToolRegistry) {
        expect(tool).toHaveProperty('name', toolName);
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.handler).toBe('function');
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('should have unique tool names', () => {
      const toolNames = Array.from(workitemsToolRegistry.keys());
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 6 workitem tools', () => {
      expect(workitemsToolRegistry.size).toBe(6);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_work_items tool', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_work_items');
      expect(tool?.description).toContain('HIERARCHY-AWARE');
      expect(tool?.description).toContain('EPICS exist ONLY at GROUP level');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_work_item tool', () => {
      const tool = workitemsToolRegistry.get('get_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_work_item');
      expect(tool?.description).toContain('GET BY ID');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_work_item_types tool', () => {
      const tool = workitemsToolRegistry.get('get_work_item_types');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_work_item_types');
      expect(tool?.description).toContain('PREREQUISITE');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper create_work_item tool', () => {
      const tool = workitemsToolRegistry.get('create_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_work_item');
      expect(tool?.description).toContain('CREATE');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper update_work_item tool', () => {
      const tool = workitemsToolRegistry.get('update_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('update_work_item');
      expect(tool?.description).toContain('Modify existing work item');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper delete_work_item tool', () => {
      const tool = workitemsToolRegistry.get('delete_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('delete_work_item');
      expect(tool?.description).toContain('DELETE');
      expect(tool?.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getWorkitemsReadOnlyToolNames();

      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getWorkitemsReadOnlyToolNames();

      expect(readOnlyTools).toContain('list_work_items');
      expect(readOnlyTools).toContain('get_work_item');
      expect(readOnlyTools).toContain('get_work_item_types');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getWorkitemsReadOnlyToolNames();

      expect(readOnlyTools).not.toContain('create_work_item');
      expect(readOnlyTools).not.toContain('update_work_item');
      expect(readOnlyTools).not.toContain('delete_work_item');
    });

    it('should return exactly 3 read-only tools', () => {
      const readOnlyTools = getWorkitemsReadOnlyToolNames();

      expect(readOnlyTools).toEqual(['list_work_items', 'get_work_item', 'get_work_item_types']);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getWorkitemsReadOnlyToolNames();
      const registryKeys = Array.from(workitemsToolRegistry.keys());

      for (const toolName of readOnlyTools) {
        expect(registryKeys).toContain(toolName);
      }
    });
  });

  describe('Workitems Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const definitions = getWorkitemsToolDefinitions();

      expect(Array.isArray(definitions)).toBe(true);
      expect(definitions.length).toBe(workitemsToolRegistry.size);
    });

    it('should return all tools from registry', () => {
      const definitions = getWorkitemsToolDefinitions();

      expect(definitions.length).toBe(6);
    });

    it('should return tool definitions with proper structure', () => {
      const definitions = getWorkitemsToolDefinitions();

      for (const definition of definitions) {
        expect(definition).toHaveProperty('name');
        expect(definition).toHaveProperty('description');
        expect(definition).toHaveProperty('inputSchema');
        expect(definition).toHaveProperty('handler');
      }
    });
  });

  describe('Filtered Workitems Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const allTools = getFilteredWorkitemsTools(false);
      const allDefinitions = getWorkitemsToolDefinitions();

      expect(allTools.length).toBe(allDefinitions.length);
    });

    it('should return only read-only tools in read-only mode', () => {
      const readOnlyTools = getFilteredWorkitemsTools(true);
      const readOnlyNames = getWorkitemsReadOnlyToolNames();

      expect(readOnlyTools.length).toBe(readOnlyNames.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const readOnlyTools = getFilteredWorkitemsTools(true);
      const readOnlyNames = getWorkitemsReadOnlyToolNames();

      for (const tool of readOnlyTools) {
        expect(readOnlyNames).toContain(tool.name);
      }
    });

    it('should not include write tools in read-only mode', () => {
      const readOnlyTools = getFilteredWorkitemsTools(true);
      const writeTools = ['create_work_item', 'update_work_item', 'delete_work_item'];

      for (const tool of readOnlyTools) {
        expect(writeTools).not.toContain(tool.name);
      }
    });

    it('should return exactly 3 tools in read-only mode', () => {
      const readOnlyTools = getFilteredWorkitemsTools(true);

      expect(readOnlyTools.length).toBe(3);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      for (const [, tool] of workitemsToolRegistry) {
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      }
    });

    it('should have handlers that accept arguments', () => {
      for (const [, tool] of workitemsToolRegistry) {
        expect(tool.handler.length).toBe(1); // Should accept one argument
      }
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected workitem tools', () => {
      const expectedTools = [
        'list_work_items',
        'get_work_item',
        'get_work_item_types',
        'create_work_item',
        'update_work_item',
        'delete_work_item',
      ];

      for (const toolName of expectedTools) {
        expect(workitemsToolRegistry.has(toolName)).toBe(true);
      }
    });

    it('should have consistent tool count between functions', () => {
      const allDefinitions = getWorkitemsToolDefinitions();
      const readOnlyNames = getWorkitemsReadOnlyToolNames();
      const readOnlyTools = getFilteredWorkitemsTools(true);

      expect(readOnlyTools.length).toBe(readOnlyNames.length);
      expect(allDefinitions.length).toBe(workitemsToolRegistry.size);
      expect(allDefinitions.length).toBeGreaterThan(readOnlyNames.length);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = workitemsToolRegistry.size;
      const readOnlyCount = getWorkitemsReadOnlyToolNames().length;

      expect(totalTools).toBeGreaterThan(readOnlyCount);
      expect(totalTools).toBe(6);
      expect(readOnlyCount).toBe(3);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      for (const [, tool] of workitemsToolRegistry) {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
        expect(tool.inputSchema).toHaveProperty('type');
      }
    });

    it('should have consistent schema format', () => {
      for (const [toolName, tool] of workitemsToolRegistry) {
        expect(tool.inputSchema).toBeDefined();

        // Schema should be an object with type property
        if (typeof tool.inputSchema === 'object' && tool.inputSchema !== null) {
          expect(tool.inputSchema).toHaveProperty('type');
        } else {
          throw new Error(`Tool ${toolName} has invalid inputSchema type`);
        }
      }
    });
  });

  describe('GitLab Hierarchy Documentation', () => {
    it('should have proper hierarchy documentation in list_work_items', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool?.description).toContain('groupPath for EPICS ONLY');
      expect(tool?.description).toContain('projectPath for ISSUES/TASKS/BUGS ONLY');
      expect(tool?.description).toContain('GROUP level');
    });

    it('should emphasize critical hierarchy rules', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool?.description).toContain('HIERARCHY-AWARE');
      expect(tool?.description).toContain('PROJECT level');
    });
  });

  describe('Handler Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('list_work_items handler', () => {
      it('should execute successfully with valid group path', async () => {
        const mockWorkItems = [
          { id: 'gid://gitlab/WorkItem/1', title: 'Epic 1', workItemType: { name: 'Epic' } },
          { id: 'gid://gitlab/WorkItem/2', title: 'Epic 2', workItemType: { name: 'Epic' } },
        ];

        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockWorkItems } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ groupPath: 'test-group' });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object), // GraphQL query object
          {
            groupPath: 'test-group',
            first: 20,
            after: undefined,
          }
        );
        expect(result).toEqual(mockWorkItems);
      });

      it('should handle custom pagination parameters', async () => {
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          groupPath: 'test-group',
          first: 50,
          after: 'cursor-123',
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          {
            groupPath: 'test-group',
            first: 50,
            after: 'cursor-123',
          }
        );
      });

      it('should return empty array when group has no work items', async () => {
        mockClient.request.mockResolvedValueOnce({ group: null });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ groupPath: 'empty-group' });

        expect(result).toEqual([]);
      });

      it('should throw error on invalid parameters', async () => {
        const tool = workitemsToolRegistry.get('list_work_items');

        await expect(tool?.handler({})).rejects.toThrow();
        await expect(tool?.handler({ namespacePath: '' })).rejects.toThrow();
      });
    });

    describe('get_work_item handler', () => {
      it('should execute successfully with valid work item ID', async () => {
        const mockWorkItem = {
          id: 'gid://gitlab/WorkItem/1',
          title: 'Test Work Item',
          description: 'Test description',
          workItemType: { name: 'Epic' },
        };

        mockClient.request.mockResolvedValueOnce({
          workItem: mockWorkItem,
        });

        const tool = workitemsToolRegistry.get('get_work_item');
        const result = await tool?.handler({ id: 'gid://gitlab/WorkItem/1' });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          { id: 'gid://gitlab/WorkItem/1' }
        );
        expect(result).toEqual(mockWorkItem);
      });

      it('should handle non-existent work item', async () => {
        mockClient.request.mockResolvedValueOnce({ workItem: null });

        const tool = workitemsToolRegistry.get('get_work_item');

        await expect(tool?.handler({ id: 'gid://gitlab/WorkItem/999' }))
          .rejects.toThrow('Work item with ID "gid://gitlab/WorkItem/999" not found');
      });
    });

    describe('get_work_item_types handler', () => {
      it('should execute successfully with valid namespace path', async () => {
        const mockTypes = [
          { id: 'gid://gitlab/WorkItems::Type/1', name: 'Epic' },
          { id: 'gid://gitlab/WorkItems::Type/2', name: 'Issue' },
          { id: 'gid://gitlab/WorkItems::Type/3', name: 'Task' },
        ];

        mockClient.request.mockResolvedValueOnce({
          namespace: { workItemTypes: { nodes: mockTypes } },
        });

        const tool = workitemsToolRegistry.get('get_work_item_types');
        const result = await tool?.handler({ namespacePath: 'test-namespace' });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          { namespacePath: 'test-namespace' }
        );
        expect(result).toEqual(mockTypes);
      });

      it('should return empty array when namespace has no types', async () => {
        mockClient.request.mockResolvedValueOnce({ namespace: null });

        const tool = workitemsToolRegistry.get('get_work_item_types');
        const result = await tool?.handler({ namespacePath: 'empty-namespace' });

        expect(result).toEqual([]);
      });
    });

    describe('create_work_item handler', () => {
      it('should execute successfully with valid parameters', async () => {
        // First mock the work item types query
        mockClient.request.mockResolvedValueOnce({
          namespace: {
            workItemTypes: {
              nodes: [
                { id: 'gid://gitlab/WorkItems::Type/1', name: 'EPIC' }
              ]
            }
          }
        });

        // Then mock the creation mutation
        const createdWorkItem = {
          workItem: {
            id: 'gid://gitlab/WorkItem/123',
            title: 'New Epic',
            workItemType: { name: 'EPIC' },
          },
        };

        mockClient.request.mockResolvedValueOnce({
          workItemCreate: {
            ...createdWorkItem,
            errors: []
          }
        });

        const tool = workitemsToolRegistry.get('create_work_item');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          workItemType: 'EPIC',
          title: 'New Epic',
        });

        expect(mockClient.request).toHaveBeenCalledTimes(2);
        expect(result).toEqual(createdWorkItem.workItem);
      });

      it('should create work item with description', async () => {
        // Mock work item types
        mockClient.request.mockResolvedValueOnce({
          namespace: {
            workItemTypes: {
              nodes: [{ id: 'gid://gitlab/WorkItems::Type/1', name: 'EPIC' }]
            }
          }
        });

        // Mock creation
        mockClient.request.mockResolvedValueOnce({
          workItemCreate: {
            workItem: {
              id: 'gid://gitlab/WorkItem/124',
              title: 'Epic with Description',
              description: 'Detailed description',
            }
          }
        });

        const tool = workitemsToolRegistry.get('create_work_item');
        await tool?.handler({
          namespacePath: 'test-group',
          workItemType: 'EPIC',
          title: 'Epic with Description',
          description: 'Detailed description',
        });

        expect(mockClient.request).toHaveBeenCalledTimes(2);
      });

      it('should handle creation errors', async () => {
        const tool = workitemsToolRegistry.get('create_work_item');

        await expect(tool?.handler({
          groupPath: 'test-group',
          workItemType: 'INVALID_TYPE',
          title: 'Failed Epic',
        })).rejects.toThrow();
      });
    });

    describe('update_work_item handler', () => {
      it('should execute successfully with valid parameters', async () => {
        const updatedWorkItem = {
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated Epic',
        };

        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: updatedWorkItem,
            errors: [],
          },
        });

        const tool = workitemsToolRegistry.get('update_work_item');
        const result = await tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated Epic',
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            input: expect.objectContaining({
              id: 'gid://gitlab/WorkItem/123',
              title: 'Updated Epic',
            }),
          })
        );
        expect(result).toEqual(updatedWorkItem);
      });

      it('should handle update with multiple fields', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: { id: 'gid://gitlab/WorkItem/123' },
            errors: [],
          },
        });

        const tool = workitemsToolRegistry.get('update_work_item');
        await tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated Title',
          description: 'Updated description',
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            input: expect.objectContaining({
              id: 'gid://gitlab/WorkItem/123',
              title: 'Updated Title',
              descriptionWidget: { description: 'Updated description' },
            })
          })
        );
      });
    });

    describe('delete_work_item handler', () => {
      it('should execute successfully with valid work item ID', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemDelete: { errors: [] },
        });

        const tool = workitemsToolRegistry.get('delete_work_item');
        const result = await tool?.handler({ id: 'gid://gitlab/WorkItem/123' });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          { id: 'gid://gitlab/WorkItem/123' }
        );
        expect(result).toEqual({ deleted: true });
      });

      it('should handle deletion errors', async () => {
        mockClient.request.mockRejectedValueOnce(new Error('Deletion failed'));

        const tool = workitemsToolRegistry.get('delete_work_item');

        await expect(tool?.handler({ id: 'gid://gitlab/WorkItem/123' }))
          .rejects.toThrow('Deletion failed');
      });
    });

    describe('Error Handling', () => {
      it('should handle GraphQL client errors gracefully', async () => {
        mockClient.request.mockRejectedValueOnce(new Error('Network error'));

        const tool = workitemsToolRegistry.get('list_work_items');

        await expect(tool?.handler({ groupPath: 'test-group' }))
          .rejects.toThrow('Network error');
      });

      it('should handle schema validation errors', async () => {
        const tool = workitemsToolRegistry.get('list_work_items');

        // Missing required groupPath
        await expect(tool?.handler({})).rejects.toThrow();

        // Invalid parameter types
        await expect(tool?.handler({ groupPath: 123 })).rejects.toThrow();
      });
    });
  });
});