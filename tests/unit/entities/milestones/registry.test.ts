import { milestonesToolRegistry, getMilestonesReadOnlyToolNames, getMilestonesToolDefinitions, getFilteredMilestonesTools } from '../../../../src/entities/milestones/registry';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue([
      { id: 1, title: 'Sprint 1', state: 'active' },
      { id: 2, title: 'Sprint 2', state: 'closed' }
    ])
  })
}));

describe('Milestones Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(milestonesToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected milestone tools', () => {
      const toolNames = Array.from(milestonesToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_milestones');
      expect(toolNames).toContain('get_milestone');
      expect(toolNames).toContain('get_milestone_issue');
      expect(toolNames).toContain('get_milestone_merge_requests');
      expect(toolNames).toContain('get_milestone_burndown_events');

      // Check for write tools
      expect(toolNames).toContain('create_milestone');
      expect(toolNames).toContain('edit_milestone');
      expect(toolNames).toContain('delete_milestone');
      expect(toolNames).toContain('promote_milestone');
    });

    it('should have tools with valid structure', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
        expect(typeof tool.handler).toBe('function');
      });
    });

    it('should have unique tool names', () => {
      const toolNames = Array.from(milestonesToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 9 milestone tools', () => {
      expect(milestonesToolRegistry.size).toBe(9);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_milestones tool', () => {
      const tool = milestonesToolRegistry.get('list_milestones');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_milestones');
      expect(tool!.description).toContain('List milestones');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_milestone tool', () => {
      const tool = milestonesToolRegistry.get('get_milestone');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_milestone');
      expect(tool!.description).toContain('Get details of a specific');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_milestone_issue tool', () => {
      const tool = milestonesToolRegistry.get('get_milestone_issue');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_milestone_issue');
      expect(tool!.description).toContain('Get issues associated');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_milestone_merge_requests tool', () => {
      const tool = milestonesToolRegistry.get('get_milestone_merge_requests');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_milestone_merge_requests');
      expect(tool!.description).toContain('Get merge requests associated');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_milestone_burndown_events tool', () => {
      const tool = milestonesToolRegistry.get('get_milestone_burndown_events');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_milestone_burndown_events');
      expect(tool!.description).toContain('Get burndown events');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper create_milestone tool', () => {
      const tool = milestonesToolRegistry.get('create_milestone');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('create_milestone');
      expect(tool!.description).toContain('Create a new milestone');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper edit_milestone tool', () => {
      const tool = milestonesToolRegistry.get('edit_milestone');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('edit_milestone');
      expect(tool!.description).toContain('Edit an existing milestone');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper delete_milestone tool', () => {
      const tool = milestonesToolRegistry.get('delete_milestone');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('delete_milestone');
      expect(tool!.description).toContain('Delete a milestone');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper promote_milestone tool', () => {
      const tool = milestonesToolRegistry.get('promote_milestone');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('promote_milestone');
      expect(tool!.description).toContain('Promote a project milestone');
      expect(tool!.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      expect(readOnlyTools).toContain('list_milestones');
      expect(readOnlyTools).toContain('get_milestone');
      expect(readOnlyTools).toContain('get_milestone_issue');
      expect(readOnlyTools).toContain('get_milestone_merge_requests');
      expect(readOnlyTools).toContain('get_milestone_burndown_events');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      expect(readOnlyTools).not.toContain('create_milestone');
      expect(readOnlyTools).not.toContain('edit_milestone');
      expect(readOnlyTools).not.toContain('delete_milestone');
      expect(readOnlyTools).not.toContain('promote_milestone');
    });

    it('should return exactly 5 read-only tools', () => {
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(5);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(milestonesToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe('Milestones Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const toolDefinitions = getMilestonesToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(9);
    });

    it('should return all tools from registry', () => {
      const toolDefinitions = getMilestonesToolDefinitions();
      const registrySize = milestonesToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const toolDefinitions = getMilestonesToolDefinitions();

      toolDefinitions.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('Filtered Milestones Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const filteredTools = getFilteredMilestonesTools(false);
      expect(filteredTools.length).toBe(9);
    });

    it('should return only read-only tools in read-only mode', () => {
      const filteredTools = getFilteredMilestonesTools(true);
      const readOnlyTools = getMilestonesReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const filteredTools = getFilteredMilestonesTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain('list_milestones');
      expect(toolNames).toContain('get_milestone');
      expect(toolNames).toContain('get_milestone_issue');
      expect(toolNames).toContain('get_milestone_merge_requests');
      expect(toolNames).toContain('get_milestone_burndown_events');
      expect(toolNames).not.toContain('create_milestone');
      expect(toolNames).not.toContain('edit_milestone');
      expect(toolNames).not.toContain('delete_milestone');
      expect(toolNames).not.toContain('promote_milestone');
    });

    it('should not include write tools in read-only mode', () => {
      const filteredTools = getFilteredMilestonesTools(true);
      const toolNames = filteredTools.map(tool => tool.name);
      const writeTools = ['create_milestone', 'edit_milestone', 'delete_milestone', 'promote_milestone'];

      writeTools.forEach(toolName => {
        expect(toolNames).not.toContain(toolName);
      });
    });

    it('should return exactly 5 tools in read-only mode', () => {
      const filteredTools = getFilteredMilestonesTools(true);
      expect(filteredTools.length).toBe(5);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('should have handlers that accept arguments', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected milestone tools', () => {
      const expectedTools = [
        'list_milestones',
        'get_milestone',
        'get_milestone_issue',
        'get_milestone_merge_requests',
        'get_milestone_burndown_events',
        'create_milestone',
        'edit_milestone',
        'delete_milestone',
        'promote_milestone'
      ];

      expectedTools.forEach(toolName => {
        expect(milestonesToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have consistent tool count between functions', () => {
      const registrySize = milestonesToolRegistry.size;
      const toolDefinitions = getMilestonesToolDefinitions();
      const filteredTools = getFilteredMilestonesTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = milestonesToolRegistry.size;
      const readOnlyTools = getMilestonesReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have consistent schema format', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('Milestone Tool Specifics', () => {
    it('should support both project and group milestones', () => {
      const listMilestonesTool = milestonesToolRegistry.get('list_milestones');
      expect(listMilestonesTool).toBeDefined();
      expect(listMilestonesTool!.inputSchema).toBeDefined();

      // The tool should handle both project and group contexts
      expect(listMilestonesTool!.description).toContain('project or group');
    });

    it('should mention milestone management context in descriptions', () => {
      const toolEntries = Array.from(milestonesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.description.toLowerCase()).toMatch(/milestone/);
      });
    });

    it('should have milestone-specific tools for issues and merge requests', () => {
      expect(milestonesToolRegistry.has('get_milestone_issue')).toBe(true);
      expect(milestonesToolRegistry.has('get_milestone_merge_requests')).toBe(true);
      expect(milestonesToolRegistry.has('get_milestone_burndown_events')).toBe(true);
    });

    it('should have promote milestone tool for project-to-group promotion', () => {
      const promoteTool = milestonesToolRegistry.get('promote_milestone');
      expect(promoteTool).toBeDefined();
      expect(promoteTool!.description).toContain('Promote a project milestone to a group milestone');
    });
  });
});