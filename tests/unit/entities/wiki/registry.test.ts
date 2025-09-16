import { wikiToolRegistry, getWikiReadOnlyToolNames, getWikiToolDefinitions, getFilteredWikiTools } from '../../../../src/entities/wiki/registry';
import { enhancedFetch } from '../../../../src/utils/fetch';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn()
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: 'https://gitlab.example.com',
    GITLAB_TOKEN: 'test-token-12345'
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  mockEnhancedFetch.mockReset();
});

describe('Wiki Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(wikiToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected wiki tools', () => {
      const toolNames = Array.from(wikiToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_wiki_pages');
      expect(toolNames).toContain('get_wiki_page');

      // Check for write tools
      expect(toolNames).toContain('create_wiki_page');
      expect(toolNames).toContain('update_wiki_page');
      expect(toolNames).toContain('delete_wiki_page');
    });

    it('should have tools with valid structure', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

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
      const toolNames = Array.from(wikiToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 5 wiki tools', () => {
      expect(wikiToolRegistry.size).toBe(5);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_wiki_pages tool', () => {
      const tool = wikiToolRegistry.get('list_wiki_pages');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_wiki_pages');
      expect(tool!.description).toContain('List wiki pages');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_wiki_page tool', () => {
      const tool = wikiToolRegistry.get('get_wiki_page');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_wiki_page');
      expect(tool!.description).toContain('Get details of a specific wiki page');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper create_wiki_page tool', () => {
      const tool = wikiToolRegistry.get('create_wiki_page');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('create_wiki_page');
      expect(tool!.description).toContain('Create a new wiki page');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper update_wiki_page tool', () => {
      const tool = wikiToolRegistry.get('update_wiki_page');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('update_wiki_page');
      expect(tool!.description).toContain('Update an existing wiki page');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper delete_wiki_page tool', () => {
      const tool = wikiToolRegistry.get('delete_wiki_page');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('delete_wiki_page');
      expect(tool!.description).toContain('Delete a wiki page');
      expect(tool!.inputSchema).toBeDefined();
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getWikiReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getWikiReadOnlyToolNames();
      expect(readOnlyTools).toContain('list_wiki_pages');
      expect(readOnlyTools).toContain('get_wiki_page');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getWikiReadOnlyToolNames();
      expect(readOnlyTools).not.toContain('create_wiki_page');
      expect(readOnlyTools).not.toContain('update_wiki_page');
      expect(readOnlyTools).not.toContain('delete_wiki_page');
    });

    it('should return exactly 2 read-only tools', () => {
      const readOnlyTools = getWikiReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(2);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getWikiReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(wikiToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe('Wiki Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const toolDefinitions = getWikiToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(5);
    });

    it('should return all tools from registry', () => {
      const toolDefinitions = getWikiToolDefinitions();
      const registrySize = wikiToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const toolDefinitions = getWikiToolDefinitions();

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

  describe('Filtered Wiki Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const filteredTools = getFilteredWikiTools(false);
      expect(filteredTools.length).toBe(5);
    });

    it('should return only read-only tools in read-only mode', () => {
      const filteredTools = getFilteredWikiTools(true);
      const readOnlyTools = getWikiReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const filteredTools = getFilteredWikiTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain('list_wiki_pages');
      expect(toolNames).toContain('get_wiki_page');
      expect(toolNames).not.toContain('create_wiki_page');
      expect(toolNames).not.toContain('update_wiki_page');
      expect(toolNames).not.toContain('delete_wiki_page');
    });

    it('should not include write tools in read-only mode', () => {
      const filteredTools = getFilteredWikiTools(true);
      const toolNames = filteredTools.map(tool => tool.name);
      const writeTools = ['create_wiki_page', 'update_wiki_page', 'delete_wiki_page'];

      writeTools.forEach(toolName => {
        expect(toolNames).not.toContain(toolName);
      });
    });

    it('should return exactly 2 tools in read-only mode', () => {
      const filteredTools = getFilteredWikiTools(true);
      expect(filteredTools.length).toBe(2);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('should have handlers that accept arguments', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected wiki tools', () => {
      const expectedTools = [
        'list_wiki_pages',
        'get_wiki_page',
        'create_wiki_page',
        'update_wiki_page',
        'delete_wiki_page'
      ];

      expectedTools.forEach(toolName => {
        expect(wikiToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have consistent tool count between functions', () => {
      const registrySize = wikiToolRegistry.size;
      const toolDefinitions = getWikiToolDefinitions();
      const filteredTools = getFilteredWikiTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = wikiToolRegistry.size;
      const readOnlyTools = getWikiReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have consistent schema format', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('Wiki Tool Specifics', () => {
    it('should support both project and group wikis', () => {
      const listWikiTool = wikiToolRegistry.get('list_wiki_pages');
      expect(listWikiTool).toBeDefined();
      expect(listWikiTool!.inputSchema).toBeDefined();

      // The tool should handle both project and group contexts
      expect(listWikiTool!.description).toContain('project or group');
    });

    it('should mention wiki management context in descriptions', () => {
      const toolEntries = Array.from(wikiToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.description.toLowerCase()).toMatch(/wiki/);
      });
    });

    it('should have comprehensive wiki CRUD operations', () => {
      expect(wikiToolRegistry.has('list_wiki_pages')).toBe(true);
      expect(wikiToolRegistry.has('get_wiki_page')).toBe(true);
      expect(wikiToolRegistry.has('create_wiki_page')).toBe(true);
      expect(wikiToolRegistry.has('update_wiki_page')).toBe(true);
      expect(wikiToolRegistry.has('delete_wiki_page')).toBe(true);
    });

    it('should provide wiki page management for both projects and groups', () => {
      const tools = Array.from(wikiToolRegistry.values());
      const supportsProjectAndGroup = tools.some(tool =>
        tool.description.includes('project or group')
      );
      expect(supportsProjectAndGroup).toBe(true);
    });
  });

  describe('Handler Function Tests', () => {
    describe('list_wiki_pages handler', () => {
      it('should list project wiki pages successfully', async () => {
        const mockWikiPages = [
          { slug: 'home', title: 'Home', content: 'Welcome' },
          { slug: 'docs', title: 'Documentation', content: 'API docs' }
        ];

        mockEnhancedFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(mockWikiPages)
        } as any);

        const handler = wikiToolRegistry.get('list_wiki_pages')!.handler;
        const result = await handler({ project_id: 'test-project' });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          'https://gitlab.example.com/api/v4/projects/test-project/wikis?per_page=20',
          {
            headers: {
              Authorization: 'Bearer test-token-12345',
            },
          }
        );
        expect(result).toEqual(mockWikiPages);
      });

      it('should list group wiki pages successfully', async () => {
        const mockWikiPages = [{ slug: 'group-home', title: 'Group Home' }];

        mockEnhancedFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(mockWikiPages)
        } as any);

        const handler = wikiToolRegistry.get('list_wiki_pages')!.handler;
        const result = await handler({ group_id: 'test-group' });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          'https://gitlab.example.com/api/v4/groups/test-group/wikis?per_page=20',
          {
            headers: {
              Authorization: 'Bearer test-token-12345',
            },
          }
        );
        expect(result).toEqual(mockWikiPages);
      });

      it('should throw error on failed API call', async () => {
        mockEnhancedFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        } as any);

        const handler = wikiToolRegistry.get('list_wiki_pages')!.handler;

        await expect(handler({ project_id: 'invalid-project' }))
          .rejects.toThrow('GitLab API error: 404 Not Found');
      });
    });

    describe('get_wiki_page handler', () => {
      it('should get project wiki page successfully', async () => {
        const mockWikiPage = { slug: 'home', title: 'Home', content: 'Welcome to wiki' };

        mockEnhancedFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(mockWikiPage)
        } as any);

        const handler = wikiToolRegistry.get('get_wiki_page')!.handler;
        const result = await handler({
          project_id: 'test-project',
          slug: 'home'
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          'https://gitlab.example.com/api/v4/projects/test-project/wikis/home?',
          {
            headers: {
              Authorization: 'Bearer test-token-12345',
            },
          }
        );
        expect(result).toEqual(mockWikiPage);
      });
    });

    describe('create_wiki_page handler', () => {
      it('should create project wiki page successfully', async () => {
        const mockWikiPage = { slug: 'new-page', title: 'New Page', content: 'New content' };

        mockEnhancedFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(mockWikiPage)
        } as any);

        const handler = wikiToolRegistry.get('create_wiki_page')!.handler;
        const result = await handler({
          project_id: 'test-project',
          title: 'New Page',
          content: 'New content'
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          'https://gitlab.example.com/api/v4/projects/test-project/wikis',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-token-12345',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: 'New Page',
              content: 'New content'
            })
          }
        );
        expect(result).toEqual(mockWikiPage);
      });

      it('should create group wiki page successfully', async () => {
        const mockWikiPage = { slug: 'group-page', title: 'Group Page' };

        mockEnhancedFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(mockWikiPage)
        } as any);

        const handler = wikiToolRegistry.get('create_wiki_page')!.handler;
        const result = await handler({
          group_id: 'test-group',
          title: 'Group Page',
          content: 'Group content',
          format: 'markdown'
        });

        expect(mockEnhancedFetch).toHaveBeenCalledWith(
          'https://gitlab.example.com/api/v4/groups/test-group/wikis',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              title: 'Group Page',
              content: 'Group content',
              format: 'markdown'
            })
          })
        );
        expect(result).toEqual(mockWikiPage);
      });
    });

    describe('Error handling', () => {
      it('should handle invalid schema input', async () => {
        const handler = wikiToolRegistry.get('list_wiki_pages')!.handler;

        await expect(handler({})).rejects.toThrow();
        await expect(handler({ invalid_param: 'value' })).rejects.toThrow();
      });

      it('should handle network errors', async () => {
        mockEnhancedFetch.mockRejectedValueOnce(new Error('Network error'));

        const handler = wikiToolRegistry.get('list_wiki_pages')!.handler;

        await expect(handler({ project_id: 'test-project' }))
          .rejects.toThrow('Network error');
      });
    });
  });
});