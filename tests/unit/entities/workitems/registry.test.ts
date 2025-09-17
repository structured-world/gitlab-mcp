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
      expect(tool?.description).toContain('COMPREHENSIVE');
      expect(tool?.description).toContain('GROUP query: gets EPICs + recursively fetches ISSUES/TASKS from all subprojects');
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

      expect(tool?.description).toContain('ALWAYS tries both GROUP and PROJECT queries and combines results');
      expect(tool?.description).toContain('GROUP query: gets EPICs + recursively fetches ISSUES/TASKS from all subprojects');
      expect(tool?.description).toContain('PROJECT query: gets ISSUES/TASKS directly from project');
    });

    it('should emphasize critical hierarchy rules', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool?.description).toContain('COMPREHENSIVE');
      expect(tool?.description).toContain('PROJECT query: gets ISSUES/TASKS directly from project');
    });
  });

  describe('Handler Tests', () => {
    beforeEach(() => {
      // Only reset the request mock, not the entire ConnectionManager mock structure
      mockClient.request.mockReset();
    });

    describe('list_work_items handler', () => {
      it('should execute successfully with valid group path', async () => {
        const mockWorkItems = [
          { id: 'gid://gitlab/WorkItem/1', title: 'Epic 1', workItemType: { name: 'Epic' } },
          { id: 'gid://gitlab/WorkItem/2', title: 'Epic 2', workItemType: { name: 'Epic' } },
        ];

        // Mock epic work items query (1st call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockWorkItems } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } }, // No projects to avoid more calls
        });

        // Mock project query (3rd call - unified strategy always tries both)
        mockClient.request.mockResolvedValueOnce({
          project: null, // Group, not project
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group' });

        // Verify epic work items call (unified strategy - no namespace detection)
        expect(mockClient.request).toHaveBeenNthCalledWith(1,
          expect.any(Object),
          {
            groupPath: 'test-group',
            types: ['EPIC'],
            first: 20,
            after: undefined,
          }
        );

        expect(result).toEqual(mockWorkItems);
      });

      it('should handle custom pagination parameters', async () => {
        // Mock epic work items query (1st call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query (3rd call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          project: null, // Group, not project
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          first: 50,
          after: 'cursor-123',
        });

        // Verify epic work items call with custom pagination (unified strategy - no namespace detection)
        expect(mockClient.request).toHaveBeenNthCalledWith(1,
          expect.any(Object),
          {
            groupPath: 'test-group',
            types: ['EPIC'],
            first: 50,
            after: 'cursor-123',
          }
        );
      });

      it('should return empty array when group has no work items', async () => {
        // Mock epic work items query (1st call - unified strategy)
        mockClient.request.mockResolvedValueOnce({ group: null });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query (3rd call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          project: null, // Group, not project
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'empty-group' });

        expect(result).toEqual([]);
      });

      it('should handle group with projects containing work items', async () => {
        const mockProjects = [
          { fullPath: 'test-group/project1', name: 'Project 1' },
          { fullPath: 'test-group/project2', name: 'Project 2' },
        ];
        const mockProjectWorkItems = [
          { id: 'gid://gitlab/WorkItem/100', title: 'Issue 1', workItemType: { name: 'Issue' } },
          { id: 'gid://gitlab/WorkItem/101', title: 'Task 1', workItemType: { name: 'Task' } },
        ];

        // Mock epic work items query (1st call - no epics)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: mockProjects } },
        });

        // Mock project work items queries (3rd and 4th calls)
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: [mockProjectWorkItems[0]] } },
        });
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: [mockProjectWorkItems[1]] } },
        });

        // Mock project query (5th call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          project: null, // Group, not project
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group' });

        expect(result).toEqual(mockProjectWorkItems);
        expect(mockClient.request).toHaveBeenCalledTimes(5);
      });

      it('should handle project-specific query (unified strategy)', async () => {
        const mockProjectWorkItems = [
          { id: 'gid://gitlab/WorkItem/200', title: 'Project Issue', workItemType: { name: 'Issue' } },
        ];

        // Mock group query (1st call - fails for project)
        mockClient.request.mockResolvedValueOnce({
          group: null,
        });

        // Mock group projects query (2nd call - fails for project)
        mockClient.request.mockResolvedValueOnce({
          group: null,
        });

        // Mock project query (3rd call - succeeds)
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: mockProjectWorkItems } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group/test-project' });

        expect(result).toEqual(mockProjectWorkItems);
      });

      it('should handle error in project work items fetch', async () => {
        const mockProjects = [
          { fullPath: 'test-group/failing-project', name: 'Failing Project' },
        ];

        // Mock epic work items query (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: mockProjects } },
        });

        // Mock project work items query (3rd call - throws error)
        mockClient.request.mockRejectedValueOnce(new Error('GraphQL timeout'));

        // Mock project query (4th call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group' });

        expect(result).toEqual([]); // Should return empty array, not throw
      });

      it('should handle type filtering correctly', async () => {
        const mockEpics = [
          { id: 'gid://gitlab/WorkItem/300', title: 'Epic 1', workItemType: { name: 'Epic' } },
        ];

        // Mock epic work items query with type filter (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockEpics } },
        });

        // Mock group projects query (2nd call - should be skipped for EPIC-only filter)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query (3rd call - unified strategy)
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          types: ['EPIC']
        });

        expect(result).toEqual(mockEpics);
        // Should call epic query with correct types filter
        expect(mockClient.request).toHaveBeenNthCalledWith(1,
          expect.any(Object),
          expect.objectContaining({
            types: ['EPIC']
          })
        );
      });

      it('should handle pagination parameters correctly in distributed queries', async () => {
        const mockProjects = [
          { fullPath: 'test-group/project1', name: 'Project 1' },
          { fullPath: 'test-group/project2', name: 'Project 2' },
        ];

        // Mock epic work items query (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: mockProjects } },
        });

        // Mock project work items queries with distributed pagination
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: [] } },
        });
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: [] } },
        });

        // Mock project query (5th call)
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          first: 100,
          after: 'cursor-abc'
        });

        // Check pagination parameters passed to main project query (last call)
        expect(mockClient.request).toHaveBeenNthCalledWith(5,
          expect.any(Object),
          expect.objectContaining({
            first: 100,
            after: 'cursor-abc'
          })
        );
      });

      it('should handle both GROUP and PROJECT queries failing', async () => {
        // Mock group query failure (1st call)
        mockClient.request.mockRejectedValueOnce(new Error('Group not found'));

        // Mock group projects query failure (2nd call)
        mockClient.request.mockRejectedValueOnce(new Error('Group projects not found'));

        // Mock project query failure (3rd call)
        mockClient.request.mockRejectedValueOnce(new Error('Project not found'));

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'non-existent' });

        expect(result).toEqual([]); // Should return empty array, not throw
        expect(mockClient.request).toHaveBeenCalledTimes(2); // Only epic query and project query attempted
      });

      it('should handle mixed success/failure in unified strategy', async () => {
        const mockEpics = [
          { id: 'gid://gitlab/WorkItem/400', title: 'Epic from group', workItemType: { name: 'Epic' } },
        ];
        const mockProjectWorkItems = [
          { id: 'gid://gitlab/WorkItem/401', title: 'Issue from project', workItemType: { name: 'Issue' } },
        ];

        // Mock group epic query success (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockEpics } },
        });

        // Mock group projects query success (2nd call) - but with empty projects
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query success (3rd call)
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: mockProjectWorkItems } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'mixed-namespace' });

        // Should combine successful results from both strategies
        expect(result).toEqual([...mockEpics, ...mockProjectWorkItems]);
      });

      it('should skip group projects query when no project-level types requested', async () => {
        const mockEpics = [
          { id: 'gid://gitlab/WorkItem/500', title: 'Epic only', workItemType: { name: 'Epic' } },
        ];

        // Mock epic work items query (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockEpics } },
        });

        // Group projects query should be skipped

        // Mock project query (2nd call - unified strategy still tries)
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          types: ['EPIC']
        });

        expect(result).toEqual(mockEpics);
        expect(mockClient.request).toHaveBeenCalledTimes(2); // Epic query + project query only
      });

      it('should handle includeSubgroups parameter correctly', async () => {
        // Mock epic work items query (1st call)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query (2nd call)
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query (3rd call)
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          includeSubgroups: false
        });

        // Check that includeSubgroups parameter is passed correctly
        expect(mockClient.request).toHaveBeenNthCalledWith(2,
          expect.any(Object),
          expect.objectContaining({
            includeSubgroups: false
          })
        );
      });

      it('should validate required parameters', async () => {
        const tool = workitemsToolRegistry.get('list_work_items');

        // Empty object should throw validation error (missing namespacePath)
        await expect(tool?.handler({})).rejects.toThrow('Required');

        // Empty namespacePath is valid and returns empty array
        const result = await tool?.handler({ namespacePath: '' });
        expect(result).toEqual([]);
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
          namespacePath: 'test-group',
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

        // The handler is designed to be resilient and return empty array on errors
        const result = await tool?.handler({ namespacePath: 'test-group' });
        expect(result).toEqual([]);
      });

      it('should handle work item type not found error in create_work_item', async () => {
        // Mock work item types query with empty result
        mockClient.request.mockResolvedValueOnce({
          namespace: {
            workItemTypes: {
              nodes: []
            }
          }
        });

        const tool = workitemsToolRegistry.get('create_work_item');

        await expect(tool?.handler({
          namespacePath: 'test-group',
          workItemType: 'EPIC',
          title: 'Test Epic',
        })).rejects.toThrow('Work item type "EPIC" not found in namespace "test-group"');
      });

      it('should handle GraphQL errors in create_work_item mutation', async () => {
        // Mock work item types query
        mockClient.request.mockResolvedValueOnce({
          namespace: {
            workItemTypes: {
              nodes: [{ id: 'gid://gitlab/WorkItems::Type/1', name: 'EPIC' }]
            }
          }
        });

        // Mock creation mutation with errors
        mockClient.request.mockResolvedValueOnce({
          workItemCreate: {
            workItem: null,
            errors: ['Validation failed', 'Title is required']
          }
        });

        const tool = workitemsToolRegistry.get('create_work_item');

        await expect(tool?.handler({
          namespacePath: 'test-group',
          workItemType: 'EPIC',
          title: '',
        })).rejects.toThrow('GitLab GraphQL errors: Validation failed, Title is required');
      });

      it('should handle empty work item creation response', async () => {
        // Mock work item types query
        mockClient.request.mockResolvedValueOnce({
          namespace: {
            workItemTypes: {
              nodes: [{ id: 'gid://gitlab/WorkItems::Type/1', name: 'EPIC' }]
            }
          }
        });

        // Mock creation mutation with no work item returned
        mockClient.request.mockResolvedValueOnce({
          workItemCreate: {
            workItem: null,
            errors: []
          }
        });

        const tool = workitemsToolRegistry.get('create_work_item');

        await expect(tool?.handler({
          namespacePath: 'test-group',
          workItemType: 'EPIC',
          title: 'Test Epic',
        })).rejects.toThrow('Work item creation failed - no work item returned');
      });

      it('should handle GraphQL errors in update_work_item', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: null,
            errors: ['Permission denied', 'Work item not found']
          }
        });

        const tool = workitemsToolRegistry.get('update_work_item');

        await expect(tool?.handler({
          id: 'gid://gitlab/WorkItem/999',
          title: 'Updated Title',
        })).rejects.toThrow('GitLab GraphQL errors: Permission denied, Work item not found');
      });

      it('should handle empty update response', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: null,
            errors: []
          }
        });

        const tool = workitemsToolRegistry.get('update_work_item');

        await expect(tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated Title',
        })).rejects.toThrow('Work item update failed - no work item returned');
      });

      it('should handle GraphQL errors in delete_work_item', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemDelete: {
            errors: ['Permission denied', 'Work item cannot be deleted']
          }
        });

        const tool = workitemsToolRegistry.get('delete_work_item');

        await expect(tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
        })).rejects.toThrow('GitLab GraphQL errors: Permission denied, Work item cannot be deleted');
      });

      it('should handle schema validation errors', async () => {
        const tool = workitemsToolRegistry.get('list_work_items');

        // Missing required namespacePath
        await expect(tool?.handler({})).rejects.toThrow();

        // Invalid types format
        await expect(tool?.handler({
          namespacePath: 'test-group',
          types: 'INVALID_FORMAT' // Should be array
        })).rejects.toThrow();

        // Invalid parameter types
        await expect(tool?.handler({ namespacePath: 123 })).rejects.toThrow();
      });
    });

    describe('Edge Cases and Advanced Scenarios', () => {
      it('should handle pagination parameters correctly', async () => {
        const mockEpics = [
          { id: 'gid://gitlab/WorkItem/600', title: 'Paginated Epic', workItemType: { name: 'Epic' } },
        ];

        // Mock epic work items query with pagination
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockEpics } },
        });

        // Mock group projects query
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query
        mockClient.request.mockResolvedValueOnce({ project: null });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          first: 50,
          after: 'cursor123'
        });

        // Verify pagination parameters are passed correctly
        expect(mockClient.request).toHaveBeenNthCalledWith(1,
          expect.any(Object),
          expect.objectContaining({
            first: 50,
            after: 'cursor123'
          })
        );

        expect(mockClient.request).toHaveBeenNthCalledWith(3,
          expect.any(Object),
          expect.objectContaining({
            first: 50,
            after: 'cursor123'
          })
        );
      });

      it('should distribute pagination across multiple projects', async () => {
        const projects = [
          { fullPath: 'test-group/project1' },
          { fullPath: 'test-group/project2' },
          { fullPath: 'test-group/project3' },
        ];

        // Mock epic work items query (empty)
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: [] } },
        });

        // Mock group projects query
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: projects } },
        });

        // Mock project work items queries for each project
        mockClient.request.mockResolvedValueOnce({ project: { workItems: { nodes: [] } } });
        mockClient.request.mockResolvedValueOnce({ project: { workItems: { nodes: [] } } });
        mockClient.request.mockResolvedValueOnce({ project: { workItems: { nodes: [] } } });

        // Mock main project query
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: [] } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          first: 30 // Should be divided among 3 projects: 10 each
        });

        // Check that pagination is properly distributed
        expect(mockClient.request).toHaveBeenCalledTimes(6);
        expect(result).toEqual([]); // 1 epic + 1 projects + 3 project items + 1 main project

        // Verify each project gets a fair share of the pagination limit
        for (let i = 3; i <= 5; i++) {
          expect(mockClient.request).toHaveBeenNthCalledWith(i,
            expect.any(Object),
            expect.objectContaining({
              first: 10 // 30 / 3 projects = 10 each
            })
          );
        }
      });

      it('should handle malformed GraphQL responses', async () => {
        // Mock malformed response without expected structure
        mockClient.request.mockResolvedValueOnce({ unexpected: 'structure' });
        mockClient.request.mockResolvedValueOnce({ group: null });
        mockClient.request.mockResolvedValueOnce({ project: { workItems: null } });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group' });

        // Should handle gracefully and return empty array
        expect(result).toEqual([]);
      });

      it('should handle complex type filtering scenarios', async () => {
        const mockEpics = [
          { id: 'gid://gitlab/WorkItem/700', title: 'Complex Epic', workItemType: { name: 'Epic' } },
        ];
        const mockIssues = [
          { id: 'gid://gitlab/WorkItem/701', title: 'Complex Issue', workItemType: { name: 'Issue' } },
        ];

        // Mock epic query for mixed types
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockEpics } },
        });

        // Mock group projects query
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [{ fullPath: 'test-group/project' }] } },
        });

        // Mock project work items query
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: mockIssues } },
        });

        // Mock main project query
        mockClient.request.mockResolvedValueOnce({
          project: { workItems: { nodes: mockIssues } },
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          types: ['EPIC', 'ISSUE', 'TASK']
        });

        // Should combine both epics and issues
        expect(result).toHaveLength(3); // 1 epic + 2 issues (from two different queries)
        expect(result).toEqual(expect.arrayContaining([...mockEpics, ...mockIssues, ...mockIssues]));
      });

      it('should handle widget-specific updates correctly', async () => {
        const updatedWorkItem = {
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated with Widgets',
        };

        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: updatedWorkItem,
            errors: [],
          },
        });

        const tool = workitemsToolRegistry.get('update_work_item');
        await tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
          assigneeIds: ['gid://gitlab/User/1', 'gid://gitlab/User/2'],
          labelIds: ['gid://gitlab/ProjectLabel/1'],
          milestoneId: 'gid://gitlab/Milestone/1',
          state: 'CLOSE'
        });

        // Verify widget-specific input structure
        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            input: expect.objectContaining({
              id: 'gid://gitlab/WorkItem/123',
              assigneesWidget: { assigneeIds: ['gid://gitlab/User/1', 'gid://gitlab/User/2'] },
              labelsWidget: { addLabelIds: ['gid://gitlab/ProjectLabel/1'] },
              milestoneWidget: { milestoneId: 'gid://gitlab/Milestone/1' },
              stateEvent: 'CLOSE'
            }),
          })
        );
      });

      it('should handle empty widget arrays correctly', async () => {
        mockClient.request.mockResolvedValueOnce({
          workItemUpdate: {
            workItem: { id: 'gid://gitlab/WorkItem/123' },
            errors: [],
          },
        });

        const tool = workitemsToolRegistry.get('update_work_item');
        await tool?.handler({
          id: 'gid://gitlab/WorkItem/123',
          title: 'Updated Title Only',
          assigneeIds: [], // Empty array should not include widget
          labelIds: []     // Empty array should not include widget
        });

        // Verify empty arrays don't create widgets
        expect(mockClient.request).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            input: expect.objectContaining({
              id: 'gid://gitlab/WorkItem/123',
              title: 'Updated Title Only'
            }),
          })
        );

        // Verify no widget properties are included for empty arrays
        const callArgs = mockClient.request.mock.calls[0][1];
        expect(callArgs.input).not.toHaveProperty('assigneesWidget');
        expect(callArgs.input).not.toHaveProperty('labelsWidget');
      });
    });
  });
});