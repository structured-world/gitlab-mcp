import { labelsToolRegistry, getLabelsReadOnlyToolNames, getLabelsToolDefinitions, getFilteredLabelsTools } from '../../../../src/entities/labels/registry';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue([
      { id: 1, name: 'bug', color: '#ff0000' },
      { id: 2, name: 'feature', color: '#00ff00' }
    ])
  })
}));

describe('Labels Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(labelsToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected label tools', () => {
      const toolNames = Array.from(labelsToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_labels');
      expect(toolNames).toContain('get_label');

      // Check for write tools
      expect(toolNames).toContain('create_label');
      expect(toolNames).toContain('update_label');
      expect(toolNames).toContain('delete_label');
    });

    it('should have tools with valid structure', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

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
      const toolNames = Array.from(labelsToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 5 label tools', () => {
      expect(labelsToolRegistry.size).toBe(5);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_labels tool', () => {
      const tool = labelsToolRegistry.get('list_labels');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_labels');
      expect(tool!.description).toContain('List labels');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_label tool', () => {
      const tool = labelsToolRegistry.get('get_label');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_label');
      expect(tool!.description).toContain('Get a single label');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper create_label tool', () => {
      const tool = labelsToolRegistry.get('create_label');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('create_label');
      expect(tool!.description).toContain('Create a new label');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper update_label tool', () => {
      const tool = labelsToolRegistry.get('update_label');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('update_label');
      expect(tool!.description).toContain('Update an existing label');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper delete_label tool', () => {
      const tool = labelsToolRegistry.get('delete_label');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('delete_label');
      expect(tool!.description).toContain('Delete a label');
      expect(tool!.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getLabelsReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getLabelsReadOnlyToolNames();
      expect(readOnlyTools).toContain('list_labels');
      expect(readOnlyTools).toContain('get_label');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getLabelsReadOnlyToolNames();
      expect(readOnlyTools).not.toContain('create_label');
      expect(readOnlyTools).not.toContain('update_label');
      expect(readOnlyTools).not.toContain('delete_label');
    });

    it('should return exactly 2 read-only tools', () => {
      const readOnlyTools = getLabelsReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(2);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getLabelsReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(labelsToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe('Labels Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const toolDefinitions = getLabelsToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(5);
    });

    it('should return all tools from registry', () => {
      const toolDefinitions = getLabelsToolDefinitions();
      const registrySize = labelsToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const toolDefinitions = getLabelsToolDefinitions();

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

  describe('Filtered Labels Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const filteredTools = getFilteredLabelsTools(false);
      expect(filteredTools.length).toBe(5);
    });

    it('should return only read-only tools in read-only mode', () => {
      const filteredTools = getFilteredLabelsTools(true);
      const readOnlyTools = getLabelsReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const filteredTools = getFilteredLabelsTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain('list_labels');
      expect(toolNames).toContain('get_label');
      expect(toolNames).not.toContain('create_label');
      expect(toolNames).not.toContain('update_label');
      expect(toolNames).not.toContain('delete_label');
    });

    it('should not include write tools in read-only mode', () => {
      const filteredTools = getFilteredLabelsTools(true);
      const toolNames = filteredTools.map(tool => tool.name);
      const writeTools = ['create_label', 'update_label', 'delete_label'];

      writeTools.forEach(toolName => {
        expect(toolNames).not.toContain(toolName);
      });
    });

    it('should return exactly 2 tools in read-only mode', () => {
      const filteredTools = getFilteredLabelsTools(true);
      expect(filteredTools.length).toBe(2);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('should have handlers that accept arguments', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected label tools', () => {
      const expectedTools = [
        'list_labels',
        'get_label',
        'create_label',
        'update_label',
        'delete_label'
      ];

      expectedTools.forEach(toolName => {
        expect(labelsToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have consistent tool count between functions', () => {
      const registrySize = labelsToolRegistry.size;
      const toolDefinitions = getLabelsToolDefinitions();
      const filteredTools = getFilteredLabelsTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = labelsToolRegistry.size;
      const readOnlyTools = getLabelsReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have consistent schema format', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('Label Tool Specifics', () => {
    it('should support both project and group labels', () => {
      const listLabelsTool = labelsToolRegistry.get('list_labels');
      expect(listLabelsTool).toBeDefined();
      expect(listLabelsTool!.inputSchema).toBeDefined();

      // The tool should handle both project and group contexts
      expect(listLabelsTool!.description).toContain('project or group');
    });

    it('should mention label management context in descriptions', () => {
      const toolEntries = Array.from(labelsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.description.toLowerCase()).toMatch(/label/);
      });
    });
  });
});