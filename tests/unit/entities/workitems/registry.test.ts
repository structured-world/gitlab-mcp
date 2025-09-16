import { workitemsToolRegistry, getWorkitemsReadOnlyToolNames, getWorkitemsToolDefinitions, getFilteredWorkitemsTools } from '../../../../src/entities/workitems/registry';

// Mock GraphQL client to avoid actual API calls
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({
      getClient: jest.fn(() => ({
        request: jest.fn().mockResolvedValue({ group: { workItems: { nodes: [] } } }),
      })),
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
      expect(tool?.description).toContain('List work items from a GitLab GROUP');
      expect(tool?.description).toContain('EPICS exist ONLY at GROUP level');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_work_item tool', () => {
      const tool = workitemsToolRegistry.get('get_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_work_item');
      expect(tool?.description).toContain('Get details of a specific work item');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_work_item_types tool', () => {
      const tool = workitemsToolRegistry.get('get_work_item_types');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_work_item_types');
      expect(tool?.description).toContain('Get available work item types');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper create_work_item tool', () => {
      const tool = workitemsToolRegistry.get('create_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_work_item');
      expect(tool?.description).toContain('Create a new work item');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper update_work_item tool', () => {
      const tool = workitemsToolRegistry.get('update_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('update_work_item');
      expect(tool?.description).toContain('Update an existing work item');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper delete_work_item tool', () => {
      const tool = workitemsToolRegistry.get('delete_work_item');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('delete_work_item');
      expect(tool?.description).toContain('Delete a work item');
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

      expect(tool?.description).toContain('EPICS exist ONLY at GROUP level');
      expect(tool?.description).toContain('ISSUES/TASKS/BUGS exist ONLY at PROJECT level');
      expect(tool?.description).toContain('GROUP-level work items (Epics)');
    });

    it('should emphasize critical hierarchy rules', () => {
      const tool = workitemsToolRegistry.get('list_work_items');

      expect(tool?.description).toContain('CRITICAL GitLab Hierarchy');
      expect(tool?.description).toContain('For Issues/Tasks, query the project they belong to, not the group');
    });
  });
});