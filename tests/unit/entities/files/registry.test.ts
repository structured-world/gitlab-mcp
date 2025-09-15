import { filesToolRegistry, getFilesReadOnlyToolNames } from '../../../../src/entities/files/registry';

// Mock the fetch function to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

describe('Files Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(filesToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected file tools', () => {
      const toolNames = Array.from(filesToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('get_repository_tree');
      expect(toolNames).toContain('get_file_contents');

      // Check for write tools
      expect(toolNames).toContain('create_or_update_file');
      expect(toolNames).toContain('push_files');
      expect(toolNames).toContain('upload_markdown');
    });

    it('should have tools with valid structure', () => {
      for (const [toolName, tool] of filesToolRegistry) {
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
      const toolNames = Array.from(filesToolRegistry.keys());
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper get_repository_tree tool', () => {
      const tool = filesToolRegistry.get('get_repository_tree');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_repository_tree');
      expect(tool?.description).toContain('repository tree');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper get_file_contents tool', () => {
      const tool = filesToolRegistry.get('get_file_contents');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_file_contents');
      expect(tool?.description).toContain('contents of a file');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper create_or_update_file tool', () => {
      const tool = filesToolRegistry.get('create_or_update_file');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_or_update_file');
      expect(tool?.description).toContain('Create or update');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper push_files tool', () => {
      const tool = filesToolRegistry.get('push_files');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('push_files');
      expect(tool?.description).toContain('Push multiple files');
      expect(tool?.inputSchema).toBeDefined();
    });

    it('should have proper upload_markdown tool', () => {
      const tool = filesToolRegistry.get('upload_markdown');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('upload_markdown');
      expect(tool?.description).toContain('Upload a file');
      expect(tool?.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(readOnlyTools).toContain('get_repository_tree');
      expect(readOnlyTools).toContain('get_file_contents');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(readOnlyTools).not.toContain('create_or_update_file');
      expect(readOnlyTools).not.toContain('push_files');
      expect(readOnlyTools).not.toContain('upload_markdown');
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getFilesReadOnlyToolNames();
      const registryKeys = Array.from(filesToolRegistry.keys());

      for (const toolName of readOnlyTools) {
        expect(registryKeys).toContain(toolName);
      }
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      for (const [, tool] of filesToolRegistry) {
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      }
    });

    it('should have handlers that accept arguments', () => {
      for (const [, tool] of filesToolRegistry) {
        expect(tool.handler.length).toBe(1); // Should accept one argument
      }
    });
  });

  describe('Registry Consistency', () => {
    it('should have all tools defined in registry', () => {
      const expectedTools = [
        'get_repository_tree',
        'get_file_contents',
        'create_or_update_file',
        'push_files',
        'upload_markdown',
      ];

      for (const toolName of expectedTools) {
        expect(filesToolRegistry.has(toolName)).toBe(true);
      }
    });

    it('should have consistent tool count', () => {
      const toolCount = filesToolRegistry.size;
      const readOnlyCount = getFilesReadOnlyToolNames().length;

      // Registry should have more tools than just read-only ones
      expect(toolCount).toBeGreaterThan(readOnlyCount);
      // Should have exactly 5 tools as defined above
      expect(toolCount).toBe(5);
    });
  });
});