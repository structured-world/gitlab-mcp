import { coreToolRegistry, getCoreReadOnlyToolNames, getCoreToolDefinitions, getFilteredCoreTools } from '../../../../src/entities/core/registry';

// Mock the fetch function to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

describe('Core Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(coreToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected core tools', () => {
      const toolNames = Array.from(coreToolRegistry.keys());

      // Check for essential read-only tools
      expect(toolNames).toContain('search_repositories');
      expect(toolNames).toContain('list_projects');
      expect(toolNames).toContain('get_project');
      expect(toolNames).toContain('list_namespaces');
      expect(toolNames).toContain('get_users');

      // Check for write tools
      expect(toolNames).toContain('create_repository');
      expect(toolNames).toContain('fork_repository');
      expect(toolNames).toContain('create_branch');
    });

    it('should have tools with valid structure', () => {
      for (const [toolName, tool] of coreToolRegistry) {
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
      const toolNames = Array.from(coreToolRegistry.keys());
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have substantial number of tools', () => {
      expect(coreToolRegistry.size).toBeGreaterThan(10);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper search_repositories tool', () => {
      const tool = coreToolRegistry.get('search_repositories');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('search_repositories');
      expect(tool?.description).toContain('Search for GitLab projects');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper list_projects tool', () => {
      const tool = coreToolRegistry.get('list_projects');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_projects');
      expect(tool?.description).toContain('List projects accessible');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_project tool', () => {
      const tool = coreToolRegistry.get('get_project');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_project');
      expect(tool?.description).toContain('Get details of a specific project');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper create_repository tool', () => {
      const tool = coreToolRegistry.get('create_repository');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_repository');
      expect(tool?.description).toContain('Create a new GitLab project');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper fork_repository tool', () => {
      const tool = coreToolRegistry.get('fork_repository');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('fork_repository');
      expect(tool?.description).toContain('Fork a GitLab project');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper verify_namespace tool', () => {
      const tool = coreToolRegistry.get('verify_namespace');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('verify_namespace');
      expect(tool?.description).toContain('Verify if a namespace path exists');
      expect(tool?.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getCoreReadOnlyToolNames();

      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getCoreReadOnlyToolNames();

      expect(readOnlyTools).toContain('search_repositories');
      expect(readOnlyTools).toContain('list_projects');
      expect(readOnlyTools).toContain('get_project');
      expect(readOnlyTools).toContain('list_namespaces');
      expect(readOnlyTools).toContain('get_users');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getCoreReadOnlyToolNames();

      expect(readOnlyTools).not.toContain('create_repository');
      expect(readOnlyTools).not.toContain('fork_repository');
      expect(readOnlyTools).not.toContain('create_branch');
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getCoreReadOnlyToolNames();
      const registryKeys = Array.from(coreToolRegistry.keys());

      for (const toolName of readOnlyTools) {
        expect(registryKeys).toContain(toolName);
      }
    });
  });

  describe('Core Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const definitions = getCoreToolDefinitions();

      expect(Array.isArray(definitions)).toBe(true);
      expect(definitions.length).toBe(coreToolRegistry.size);
    });

    it('should return all tools from registry', () => {
      const definitions = getCoreToolDefinitions();
      const registrySize = coreToolRegistry.size;

      expect(definitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const definitions = getCoreToolDefinitions();

      for (const definition of definitions) {
        expect(definition).toHaveProperty('name');
        expect(definition).toHaveProperty('description');
        expect(definition).toHaveProperty('inputSchema');
        expect(definition).toHaveProperty('handler');
      }
    });
  });

  describe('Filtered Core Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const allTools = getFilteredCoreTools(false);
      const allDefinitions = getCoreToolDefinitions();

      expect(allTools.length).toBe(allDefinitions.length);
    });

    it('should return only read-only tools in read-only mode', () => {
      const readOnlyTools = getFilteredCoreTools(true);
      const readOnlyNames = getCoreReadOnlyToolNames();

      expect(readOnlyTools.length).toBe(readOnlyNames.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const readOnlyTools = getFilteredCoreTools(true);
      const readOnlyNames = getCoreReadOnlyToolNames();

      for (const tool of readOnlyTools) {
        expect(readOnlyNames).toContain(tool.name);
      }
    });

    it('should not include write tools in read-only mode', () => {
      const readOnlyTools = getFilteredCoreTools(true);
      const writeTools = ['create_repository', 'fork_repository', 'create_branch'];

      for (const tool of readOnlyTools) {
        expect(writeTools).not.toContain(tool.name);
      }
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      for (const [, tool] of coreToolRegistry) {
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      }
    });

    it('should have handlers that accept arguments', () => {
      for (const [, tool] of coreToolRegistry) {
        expect(tool.handler.length).toBe(1); // Should accept one argument
      }
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected essential tools', () => {
      const essentialTools = [
        'search_repositories',
        'list_projects',
        'get_project',
        'list_namespaces',
        'get_users',
        'create_repository',
        'fork_repository',
      ];

      for (const toolName of essentialTools) {
        expect(coreToolRegistry.has(toolName)).toBe(true);
      }
    });

    it('should have consistent tool count between functions', () => {
      const allDefinitions = getCoreToolDefinitions();
      const readOnlyNames = getCoreReadOnlyToolNames();
      const readOnlyTools = getFilteredCoreTools(true);

      expect(readOnlyTools.length).toBe(readOnlyNames.length);
      expect(allDefinitions.length).toBe(coreToolRegistry.size);
      expect(allDefinitions.length).toBeGreaterThan(readOnlyNames.length);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = coreToolRegistry.size;
      const readOnlyCount = getCoreReadOnlyToolNames().length;

      expect(totalTools).toBeGreaterThan(readOnlyCount);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      for (const [, tool] of coreToolRegistry) {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
        expect(tool.inputSchema).toHaveProperty('type');
      }
    });

    it('should have consistent schema format', () => {
      for (const [toolName, tool] of coreToolRegistry) {
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
});