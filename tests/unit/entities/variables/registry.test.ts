import { variablesToolRegistry, getVariablesReadOnlyToolNames } from '../../../../src/entities/variables/registry';

// Mock the fetch function to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

describe('Variables Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(variablesToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected variable tools', () => {
      const toolNames = Array.from(variablesToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_variables');
      expect(toolNames).toContain('get_variable');

      // Check for write tools
      expect(toolNames).toContain('create_variable');
      expect(toolNames).toContain('update_variable');
      expect(toolNames).toContain('delete_variable');
    });

    it('should have tools with valid structure', () => {
      for (const [toolName, tool] of variablesToolRegistry) {
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
      const toolNames = Array.from(variablesToolRegistry.keys());
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_variables tool', () => {
      const tool = variablesToolRegistry.get('list_variables');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_variables');
      expect(tool?.description).toContain('CI/CD variables');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_variable tool', () => {
      const tool = variablesToolRegistry.get('get_variable');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_variable');
      expect(tool?.description).toContain('specific CI/CD variable');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper create_variable tool', () => {
      const tool = variablesToolRegistry.get('create_variable');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_variable');
      expect(tool?.description).toContain('Create');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper update_variable tool', () => {
      const tool = variablesToolRegistry.get('update_variable');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('update_variable');
      expect(tool?.description).toContain('Update');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper delete_variable tool', () => {
      const tool = variablesToolRegistry.get('delete_variable');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('delete_variable');
      expect(tool?.description).toContain('Remove');
      expect(tool?.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getVariablesReadOnlyToolNames();

      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getVariablesReadOnlyToolNames();

      expect(readOnlyTools).toContain('list_variables');
      expect(readOnlyTools).toContain('get_variable');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getVariablesReadOnlyToolNames();

      expect(readOnlyTools).not.toContain('create_variable');
      expect(readOnlyTools).not.toContain('update_variable');
      expect(readOnlyTools).not.toContain('delete_variable');
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getVariablesReadOnlyToolNames();
      const registryKeys = Array.from(variablesToolRegistry.keys());

      for (const toolName of readOnlyTools) {
        expect(registryKeys).toContain(toolName);
      }
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      for (const [, tool] of variablesToolRegistry) {
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      }
    });

    it('should have handlers that accept arguments', () => {
      for (const [, tool] of variablesToolRegistry) {
        expect(tool.handler.length).toBe(1); // Should accept one argument
      }
    });
  });

  describe('Registry Consistency', () => {
    it('should have all tools defined in registry', () => {
      const expectedTools = [
        'list_variables',
        'get_variable',
        'create_variable',
        'update_variable',
        'delete_variable',
      ];

      for (const toolName of expectedTools) {
        expect(variablesToolRegistry.has(toolName)).toBe(true);
      }
    });

    it('should have consistent tool count', () => {
      const toolCount = variablesToolRegistry.size;
      const readOnlyCount = getVariablesReadOnlyToolNames().length;

      // Registry should have more tools than just read-only ones
      expect(toolCount).toBeGreaterThan(readOnlyCount);
      // Should have exactly 5 tools as defined above
      expect(toolCount).toBe(5);
    });
  });

  describe('Variable Tool Specifics', () => {
    it('should support both project and group variables', () => {
      const listTool = variablesToolRegistry.get('list_variables');
      const getTool = variablesToolRegistry.get('get_variable');

      expect(listTool?.description).toContain('project or group');
      expect(getTool?.description).toContain('project or group');
    });

    it('should mention CI/CD context in descriptions', () => {
      const toolNames = Array.from(variablesToolRegistry.keys());

      for (const toolName of toolNames) {
        const tool = variablesToolRegistry.get(toolName);
        expect(tool?.description.toLowerCase()).toMatch(/ci\/cd|variable/);
      }
    });
  });
});