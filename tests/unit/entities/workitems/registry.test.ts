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
      expect(tool?.description).toContain('List all work items');
      expect(tool?.description).toContain('epics, issues, tasks');
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

      expect(tool?.description).toContain('List all work items');
      expect(tool?.description).toContain('group path to get all work items across the entire group hierarchy');
      expect(tool?.description).toContain('project path to get project-specific items');
    });

    it('should emphasize comprehensive coverage', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool?.description).toContain('comprehensive overview');
      expect(tool?.description).toContain('all work across teams and projects');
    });
  });

  describe('Handler Tests', () => {
    beforeEach(() => {
      // Only reset the request mock, not the entire ConnectionManager mock structure
      mockClient.request.mockReset();
    });

    // Helper function to create complete mock work items
    const createMockWorkItem = (overrides: any = {}) => ({
      id: 'gid://gitlab/WorkItem/1',
      iid: '1',
      title: 'Test Work Item',
      state: 'OPEN',
      workItemType: { id: 'gid://gitlab/WorkItems::Type/8', name: 'Epic' },
      webUrl: 'https://gitlab.example.com/groups/test/-/epics/1',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      description: null,
      widgets: [],
      ...overrides
    });

    // Helper function to create mock project
    const createMockProject = (overrides: any = {}) => ({
      id: 'gid://gitlab/Project/1',
      fullPath: 'test-group/test-project',
      archived: false,
      ...overrides
    });

    describe('list_work_items handler', () => {
      it('should execute successfully with valid group path', async () => {
        const mockWorkItems = [
          {
            id: 'gid://gitlab/WorkItem/1',
            iid: '1',
            title: 'Epic 1',
            state: 'OPEN',
            workItemType: { id: 'gid://gitlab/WorkItems::Type/8', name: 'Epic' },
            webUrl: 'https://gitlab.example.com/groups/test/-/epics/1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            widgets: []
          },
          {
            id: 'gid://gitlab/WorkItem/2',
            iid: '2',
            title: 'Epic 2',
            state: 'OPEN',
            workItemType: { id: 'gid://gitlab/WorkItems::Type/8', name: 'Epic' },
            webUrl: 'https://gitlab.example.com/groups/test/-/epics/2',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            widgets: []
          },
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

        // With simple=true (default), expect simplified structure
        const expectedSimplified = mockWorkItems.map(item => ({
          id: item.id,
          iid: item.iid,
          title: item.title,
          state: item.state,
          workItemType: item.workItemType,
          webUrl: item.webUrl,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          // No widgets because empty array is filtered out
        }));

        expect(result).toEqual(expectedSimplified);
      });

      it('should return full structure when simple=false', async () => {
        const mockWorkItems = [
          {
            id: 'gid://gitlab/WorkItem/1',
            iid: '1',
            title: 'Epic 1',
            state: 'OPEN',
            workItemType: { id: 'gid://gitlab/WorkItems::Type/8', name: 'Epic' },
            webUrl: 'https://gitlab.example.com/groups/test/-/epics/1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            description: 'Test epic description',
            widgets: [
              {
                type: 'ASSIGNEES',
                assignees: { nodes: [{ id: 'user1', username: 'test', name: 'Test User' }] }
              }
            ]
          }
        ];

        // Mock epic work items query
        mockClient.request.mockResolvedValueOnce({
          group: { workItems: { nodes: mockWorkItems } },
        });

        // Mock group projects query
        mockClient.request.mockResolvedValueOnce({
          group: { projects: { nodes: [] } },
        });

        // Mock project query
        mockClient.request.mockResolvedValueOnce({
          project: null,
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group', simple: false });

        // With simple=false, expect full original structure
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
        const mockWorkItems = [
          {
            id: 'gid://gitlab/WorkItem/100',
            iid: '1',
            title: 'Issue 1',
            state: 'OPEN',
            workItemType: { name: 'Issue' },
            webUrl: 'https://gitlab.example.com/work-items/100',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            description: 'Test description',
            widgets: []
          },
          {
            id: 'gid://gitlab/WorkItem/101',
            iid: '2',
            title: 'Task 1',
            state: 'OPEN',
            workItemType: { name: 'Task' },
            webUrl: 'https://gitlab.example.com/work-items/101',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            description: 'Test description',
            widgets: []
          }
        ];

        const mockProjects = [
          { fullPath: 'test-group/project1', archived: false },
          { fullPath: 'test-group/project2', archived: false }
        ];

        // Smart mock based on query variables instead of call order
        mockClient.request.mockImplementation((query: any, variables: any) => {
          // Epic query (groupPath + types: ['EPIC'])
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [] } } });
          }

          // Group projects query (groupPath + includeSubgroups)
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: mockProjects } } });
          }

          // Project work items queries (projectPath)
          if (variables?.projectPath === 'test-group/project1') {
            return Promise.resolve({ project: { workItems: { nodes: [mockWorkItems[0]] } } });
          }
          if (variables?.projectPath === 'test-group/project2') {
            return Promise.resolve({ project: { workItems: { nodes: [mockWorkItems[1]] } } });
          }

          // Direct project query for group (will fail)
          if (variables?.projectPath === 'test-group') {
            return Promise.resolve({ project: null });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group' });

        // Expect simplified results (default simple=true)
        const expectedSimplified = mockWorkItems.map(item => ({
          id: item.id,
          iid: item.iid,
          title: item.title,
          state: item.state,
          workItemType: item.workItemType,
          webUrl: item.webUrl,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          description: item.description
        }));

        expect(result).toEqual(expectedSimplified);
      });

      it('should handle project-specific query (unified strategy)', async () => {
        const mockWorkItem = {
          id: 'gid://gitlab/WorkItem/200',
          iid: '1',
          title: 'Project Issue',
          state: 'OPEN',
          workItemType: { name: 'Issue' },
          webUrl: 'https://gitlab.example.com/work-items/200',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Test description',
          widgets: []
        };

        // Smart mock based on query variables
        mockClient.request.mockImplementation((query: any, variables: any) => {
          // Group queries fail for project paths
          if (variables?.groupPath === 'test-group/test-project') {
            return Promise.resolve({ group: null });
          }

          // Direct project query succeeds
          if (variables?.projectPath === 'test-group/test-project') {
            return Promise.resolve({ project: { workItems: { nodes: [mockWorkItem] } } });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'test-group/test-project' });

        // Expected simplified result
        const expectedSimplified = [{
          id: mockWorkItem.id,
          iid: mockWorkItem.iid,
          title: mockWorkItem.title,
          state: mockWorkItem.state,
          workItemType: mockWorkItem.workItemType,
          webUrl: mockWorkItem.webUrl,
          createdAt: mockWorkItem.createdAt,
          updatedAt: mockWorkItem.updatedAt,
          description: mockWorkItem.description
        }];

        expect(result).toEqual(expectedSimplified);
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

      it('should handle pagination parameters correctly - each project gets full first value', async () => {
        const mockProjects = [
          { fullPath: 'test-group/project1', archived: false },
          { fullPath: 'test-group/project2', archived: false },
        ];

        // Track calls to verify pagination parameters
        const calls: any[] = [];

        // Smart mock based on query variables for parallel execution
        mockClient.request.mockImplementation((query: any, variables: any) => {
          calls.push({ query, variables });

          // Epic query
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [] } } });
          }

          // Group projects query
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: mockProjects } } });
          }

          // Individual project queries
          if (variables?.projectPath === 'test-group/project1' ||
              variables?.projectPath === 'test-group/project2') {
            return Promise.resolve({ project: { workItems: { nodes: [] } } });
          }

          // Direct project query (fails for group)
          if (variables?.projectPath === 'test-group') {
            return Promise.resolve({ project: null });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          first: 100,
          after: 'cursor-abc'
        });

        // Verify that each project got the full pagination parameters
        const project1Call = calls.find(call => call.variables?.projectPath === 'test-group/project1');
        const project2Call = calls.find(call => call.variables?.projectPath === 'test-group/project2');

        expect(project1Call).toBeDefined();
        expect(project1Call.variables).toMatchObject({
          first: 100,
          after: 'cursor-abc'
        });

        expect(project2Call).toBeDefined();
        expect(project2Call.variables).toMatchObject({
          first: 100,
          after: 'cursor-abc'
        });
      });

      it('should handle both GROUP and PROJECT queries failing', async () => {
        // Mock all queries to fail based on variables
        mockClient.request.mockImplementation((query: any, variables: any) => {
          if (variables?.groupPath === 'non-existent') {
            return Promise.reject(new Error('Group not found'));
          }
          if (variables?.projectPath === 'non-existent') {
            return Promise.reject(new Error('Project not found'));
          }
          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'non-existent' });

        expect(result).toEqual([]); // Should return empty array, not throw
        // With parallel execution: groupQuery attempts epic + projects, projectQuery attempts direct
        // Total: 3 attempts (all fail gracefully)
        expect(mockClient.request).toHaveBeenCalledTimes(3);
      });

      it('should handle mixed success/failure in unified strategy', async () => {
        const mockEpic = {
          id: 'gid://gitlab/WorkItem/400',
          iid: '1',
          title: 'Epic from group',
          state: 'OPEN',
          workItemType: { name: 'Epic' },
          webUrl: 'https://gitlab.example.com/epics/400',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Epic description',
          widgets: []
        };

        const mockProjectWorkItem = {
          id: 'gid://gitlab/WorkItem/401',
          iid: '1',
          title: 'Issue from project',
          state: 'OPEN',
          workItemType: { name: 'Issue' },
          webUrl: 'https://gitlab.example.com/issues/401',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Issue description',
          widgets: []
        };

        // Smart mock for mixed success scenario
        mockClient.request.mockImplementation((query: any, variables: any) => {
          // Epic query succeeds
          if (variables?.groupPath === 'mixed-namespace' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [mockEpic] } } });
          }

          // Group projects query succeeds but returns no projects
          if (variables?.groupPath === 'mixed-namespace' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: [] } } });
          }

          // Direct project query succeeds
          if (variables?.projectPath === 'mixed-namespace') {
            return Promise.resolve({ project: { workItems: { nodes: [mockProjectWorkItem] } } });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({ namespacePath: 'mixed-namespace' });

        // Should combine successful results from both strategies (simplified)
        const expectedResult = [
          {
            id: mockEpic.id,
            iid: mockEpic.iid,
            title: mockEpic.title,
            state: mockEpic.state,
            workItemType: mockEpic.workItemType,
            webUrl: mockEpic.webUrl,
            createdAt: mockEpic.createdAt,
            updatedAt: mockEpic.updatedAt,
            description: mockEpic.description
          },
          {
            id: mockProjectWorkItem.id,
            iid: mockProjectWorkItem.iid,
            title: mockProjectWorkItem.title,
            state: mockProjectWorkItem.state,
            workItemType: mockProjectWorkItem.workItemType,
            webUrl: mockProjectWorkItem.webUrl,
            createdAt: mockProjectWorkItem.createdAt,
            updatedAt: mockProjectWorkItem.updatedAt,
            description: mockProjectWorkItem.description
          }
        ];

        expect(result).toEqual(expectedResult);
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
        // Track calls to verify includeSubgroups parameter
        const calls: any[] = [];

        // Smart mock for parallel execution
        mockClient.request.mockImplementation((query: any, variables: any) => {
          calls.push({ query, variables });

          // Epic query
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [] } } });
          }

          // Group projects query - this should receive includeSubgroups: false
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: [] } } });
          }

          // Direct project query
          if (variables?.projectPath === 'test-group') {
            return Promise.resolve({ project: null });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          includeSubgroups: false
        });

        // Verify that includeSubgroups parameter was passed correctly
        const projectsCall = calls.find(call => call.variables?.includeSubgroups !== undefined);
        expect(projectsCall).toBeDefined();
        expect(projectsCall.variables.includeSubgroups).toBe(false);
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
      it('should handle pagination parameters correctly in parallel strategy', async () => {
        const mockEpic = {
          id: 'gid://gitlab/WorkItem/600',
          iid: '1',
          title: 'Paginated Epic',
          state: 'OPEN',
          workItemType: { name: 'Epic' },
          webUrl: 'https://gitlab.example.com/epics/600',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Epic description',
          widgets: []
        };

        // Track calls to verify pagination parameters
        const calls: any[] = [];

        // Smart mock for parallel execution
        mockClient.request.mockImplementation((query: any, variables: any) => {
          calls.push({ query, variables });

          // Epic query with pagination
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [mockEpic] } } });
          }

          // Group projects query
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: [] } } });
          }

          // Direct project query with pagination
          if (variables?.projectPath === 'test-group') {
            return Promise.resolve({ project: null });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        await tool?.handler({
          namespacePath: 'test-group',
          first: 50,
          after: 'cursor123'
        });

        // Verify pagination parameters are passed correctly to epic query
        const epicCall = calls.find(call =>
          call.variables?.groupPath === 'test-group' && call.variables?.types?.includes('EPIC')
        );
        expect(epicCall).toBeDefined();
        expect(epicCall.variables).toMatchObject({
          first: 50,
          after: 'cursor123'
        });

        // Verify pagination parameters are passed correctly to direct project query
        const projectCall = calls.find(call =>
          call.variables?.projectPath === 'test-group'
        );
        expect(projectCall).toBeDefined();
        expect(projectCall.variables).toMatchObject({
          first: 50,
          after: 'cursor123'
        });
      });

      it('should apply first parameter to each project individually', async () => {
        const projects = [
          { fullPath: 'test-group/project1', archived: false },
          { fullPath: 'test-group/project2', archived: false },
          { fullPath: 'test-group/project3', archived: false },
        ];

        // Track calls to verify each project gets the full first value
        const calls: any[] = [];

        // Smart mock for parallel execution
        mockClient.request.mockImplementation((query: any, variables: any) => {
          calls.push({ query, variables });

          // Epic query
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [] } } });
          }

          // Group projects query
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({ group: { projects: { nodes: projects } } });
          }

          // Individual project queries
          if (variables?.projectPath?.startsWith('test-group/project')) {
            return Promise.resolve({ project: { workItems: { nodes: [] } } });
          }

          // Direct project query (fails for group)
          if (variables?.projectPath === 'test-group') {
            return Promise.resolve({ project: null });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          first: 30 // Each project gets full 30, not divided
        });

        expect(result).toEqual([]);

        // Verify each project gets the full first value, not distributed
        const project1Call = calls.find(call => call.variables?.projectPath === 'test-group/project1');
        const project2Call = calls.find(call => call.variables?.projectPath === 'test-group/project2');
        const project3Call = calls.find(call => call.variables?.projectPath === 'test-group/project3');

        expect(project1Call?.variables?.first).toBe(30);
        expect(project2Call?.variables?.first).toBe(30);
        expect(project3Call?.variables?.first).toBe(30);
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
        const mockEpic = {
          id: 'gid://gitlab/WorkItem/700',
          iid: '1',
          title: 'Complex Epic',
          state: 'OPEN',
          workItemType: { name: 'Epic' },
          webUrl: 'https://gitlab.example.com/epics/700',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Epic description',
          widgets: []
        };

        const mockProjectIssue = {
          id: 'gid://gitlab/WorkItem/701',
          iid: '1',
          title: 'Project Issue',
          state: 'OPEN',
          workItemType: { name: 'Issue' },
          webUrl: 'https://gitlab.example.com/issues/701',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Issue description',
          widgets: []
        };

        const mockDirectIssue = {
          id: 'gid://gitlab/WorkItem/702',
          iid: '2',
          title: 'Direct Issue',
          state: 'OPEN',
          workItemType: { name: 'Issue' },
          webUrl: 'https://gitlab.example.com/issues/702',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          description: 'Direct issue description',
          widgets: []
        };

        // Smart mock for complex type filtering
        mockClient.request.mockImplementation((query: any, variables: any) => {
          // Epic query with type filtering
          if (variables?.groupPath === 'test-group' && variables?.types?.includes('EPIC')) {
            return Promise.resolve({ group: { workItems: { nodes: [mockEpic] } } });
          }

          // Group projects query
          if (variables?.groupPath === 'test-group' && variables?.includeSubgroups !== undefined) {
            return Promise.resolve({
              group: { projects: { nodes: [{ fullPath: 'test-group/project', archived: false }] } }
            });
          }

          // Project within group query
          if (variables?.projectPath === 'test-group/project') {
            return Promise.resolve({ project: { workItems: { nodes: [mockProjectIssue] } } });
          }

          // Direct project query (for when namespacePath might be a project)
          if (variables?.projectPath === 'test-group' &&
              variables?.types?.some(t => ['ISSUE', 'TASK'].includes(t))) {
            return Promise.resolve({ project: { workItems: { nodes: [mockDirectIssue] } } });
          }

          return Promise.resolve({});
        });

        const tool = workitemsToolRegistry.get('list_work_items');
        const result = await tool?.handler({
          namespacePath: 'test-group',
          types: ['EPIC', 'ISSUE', 'TASK']
        });

        // Should combine epic from group + issue from project + issue from direct query
        expect(result).toHaveLength(3);

        // Check that we get simplified versions of all three work items
        const expectedResults = [
          {
            id: mockEpic.id,
            iid: mockEpic.iid,
            title: mockEpic.title,
            state: mockEpic.state,
            workItemType: mockEpic.workItemType,
            webUrl: mockEpic.webUrl,
            createdAt: mockEpic.createdAt,
            updatedAt: mockEpic.updatedAt,
            description: mockEpic.description
          },
          {
            id: mockProjectIssue.id,
            iid: mockProjectIssue.iid,
            title: mockProjectIssue.title,
            state: mockProjectIssue.state,
            workItemType: mockProjectIssue.workItemType,
            webUrl: mockProjectIssue.webUrl,
            createdAt: mockProjectIssue.createdAt,
            updatedAt: mockProjectIssue.updatedAt,
            description: mockProjectIssue.description
          },
          {
            id: mockDirectIssue.id,
            iid: mockDirectIssue.iid,
            title: mockDirectIssue.title,
            state: mockDirectIssue.state,
            workItemType: mockDirectIssue.workItemType,
            webUrl: mockDirectIssue.webUrl,
            createdAt: mockDirectIssue.createdAt,
            updatedAt: mockDirectIssue.updatedAt,
            description: mockDirectIssue.description
          }
        ];

        expect(result).toEqual(expect.arrayContaining(expectedResults));
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