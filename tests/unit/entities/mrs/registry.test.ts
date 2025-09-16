import { mrsToolRegistry, getMrsReadOnlyToolNames, getMrsToolDefinitions, getFilteredMrsTools } from '../../../../src/entities/mrs/registry';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue([
      { id: 1, iid: 1, title: 'Feature: Add new functionality', state: 'opened' },
      { id: 2, iid: 2, title: 'Fix: Resolve bug in component', state: 'merged' }
    ])
  })
}));

describe('MRS Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(mrsToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected merge request tools', () => {
      const toolNames = Array.from(mrsToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('get_branch_diffs');
      expect(toolNames).toContain('get_merge_request');
      expect(toolNames).toContain('list_merge_requests');
      expect(toolNames).toContain('get_merge_request_diffs');
      expect(toolNames).toContain('list_merge_request_diffs');
      expect(toolNames).toContain('mr_discussions');
      expect(toolNames).toContain('get_draft_note');
      expect(toolNames).toContain('list_draft_notes');

      // Check for write tools
      expect(toolNames).toContain('create_merge_request');
      expect(toolNames).toContain('merge_merge_request');
      expect(toolNames).toContain('create_note');
      expect(toolNames).toContain('create_draft_note');
      expect(toolNames).toContain('publish_draft_note');
      expect(toolNames).toContain('bulk_publish_draft_notes');
      expect(toolNames).toContain('update_merge_request');
      expect(toolNames).toContain('create_merge_request_thread');
      expect(toolNames).toContain('update_merge_request_note');
      expect(toolNames).toContain('create_merge_request_note');
      expect(toolNames).toContain('update_draft_note');
      expect(toolNames).toContain('delete_draft_note');
    });

    it('should have tools with valid structure', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

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
      const toolNames = Array.from(mrsToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 20 merge request tools', () => {
      expect(mrsToolRegistry.size).toBe(20);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper get_branch_diffs tool', () => {
      const tool = mrsToolRegistry.get('get_branch_diffs');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_branch_diffs');
      expect(tool!.description).toContain('Get the changes/diffs between two branches');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_merge_request tool', () => {
      const tool = mrsToolRegistry.get('get_merge_request');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_merge_request');
      expect(tool!.description).toContain('Get details of a merge request');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper list_merge_requests tool', () => {
      const tool = mrsToolRegistry.get('list_merge_requests');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_merge_requests');
      expect(tool!.description).toContain('List merge requests');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper create_merge_request tool', () => {
      const tool = mrsToolRegistry.get('create_merge_request');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('create_merge_request');
      expect(tool!.description).toContain('Create a new merge request');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper merge_merge_request tool', () => {
      const tool = mrsToolRegistry.get('merge_merge_request');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('merge_merge_request');
      expect(tool!.description).toContain('Merge a merge request');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper draft note tools', () => {
      const createTool = mrsToolRegistry.get('create_draft_note');
      const getTool = mrsToolRegistry.get('get_draft_note');
      const listTool = mrsToolRegistry.get('list_draft_notes');
      const publishTool = mrsToolRegistry.get('publish_draft_note');
      const bulkPublishTool = mrsToolRegistry.get('bulk_publish_draft_notes');
      const updateTool = mrsToolRegistry.get('update_draft_note');
      const deleteTool = mrsToolRegistry.get('delete_draft_note');

      expect(createTool).toBeDefined();
      expect(getTool).toBeDefined();
      expect(listTool).toBeDefined();
      expect(publishTool).toBeDefined();
      expect(bulkPublishTool).toBeDefined();
      expect(updateTool).toBeDefined();
      expect(deleteTool).toBeDefined();

      expect(createTool!.description).toContain('Create a draft note');
      expect(getTool!.description).toContain('Get a single draft note');
      expect(listTool!.description).toContain('List draft notes');
      expect(publishTool!.description).toContain('Publish a single draft note');
      expect(bulkPublishTool!.description).toContain('Publish all draft notes');
      expect(updateTool!.description).toContain('Update an existing draft note');
      expect(deleteTool!.description).toContain('Delete a draft note');
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools).toContain('get_branch_diffs');
      expect(readOnlyTools).toContain('get_merge_request');
      expect(readOnlyTools).toContain('get_merge_request_diffs');
      expect(readOnlyTools).toContain('list_merge_request_diffs');
      expect(readOnlyTools).toContain('mr_discussions');
      expect(readOnlyTools).toContain('get_draft_note');
      expect(readOnlyTools).toContain('list_draft_notes');
      expect(readOnlyTools).toContain('list_merge_requests');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools).not.toContain('create_merge_request');
      expect(readOnlyTools).not.toContain('merge_merge_request');
      expect(readOnlyTools).not.toContain('create_note');
      expect(readOnlyTools).not.toContain('create_draft_note');
      expect(readOnlyTools).not.toContain('update_merge_request');
    });

    it('should return exactly 8 read-only tools', () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(8);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getMrsReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(mrsToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe('MRS Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const toolDefinitions = getMrsToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(20);
    });

    it('should return all tools from registry', () => {
      const toolDefinitions = getMrsToolDefinitions();
      const registrySize = mrsToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const toolDefinitions = getMrsToolDefinitions();

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

  describe('Filtered MRS Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const filteredTools = getFilteredMrsTools(false);
      expect(filteredTools.length).toBe(20);
    });

    it('should return only read-only tools in read-only mode', () => {
      const filteredTools = getFilteredMrsTools(true);
      const readOnlyTools = getMrsReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const filteredTools = getFilteredMrsTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain('get_branch_diffs');
      expect(toolNames).toContain('get_merge_request');
      expect(toolNames).toContain('list_merge_requests');
      expect(toolNames).toContain('get_merge_request_diffs');
      expect(toolNames).toContain('list_merge_request_diffs');
      expect(toolNames).toContain('mr_discussions');
      expect(toolNames).toContain('get_draft_note');
      expect(toolNames).toContain('list_draft_notes');

      expect(toolNames).not.toContain('create_merge_request');
      expect(toolNames).not.toContain('merge_merge_request');
      expect(toolNames).not.toContain('create_note');
      expect(toolNames).not.toContain('create_draft_note');
    });

    it('should not include write tools in read-only mode', () => {
      const filteredTools = getFilteredMrsTools(true);
      const toolNames = filteredTools.map(tool => tool.name);
      const writeTools = [
        'create_merge_request', 'merge_merge_request', 'create_note', 'create_draft_note',
        'publish_draft_note', 'bulk_publish_draft_notes', 'update_merge_request',
        'create_merge_request_thread', 'update_merge_request_note', 'create_merge_request_note',
        'update_draft_note', 'delete_draft_note'
      ];

      writeTools.forEach(toolName => {
        expect(toolNames).not.toContain(toolName);
      });
    });

    it('should return exactly 8 tools in read-only mode', () => {
      const filteredTools = getFilteredMrsTools(true);
      expect(filteredTools.length).toBe(8);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('should have handlers that accept arguments', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected merge request tools', () => {
      const expectedTools = [
        'get_branch_diffs', 'get_merge_request', 'list_merge_requests', 'get_merge_request_diffs',
        'list_merge_request_diffs', 'mr_discussions', 'get_draft_note', 'list_draft_notes',
        'create_merge_request', 'merge_merge_request', 'create_note', 'create_draft_note',
        'publish_draft_note', 'bulk_publish_draft_notes', 'update_merge_request',
        'create_merge_request_thread', 'update_merge_request_note', 'create_merge_request_note',
        'update_draft_note', 'delete_draft_note'
      ];

      expectedTools.forEach(toolName => {
        expect(mrsToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have consistent tool count between functions', () => {
      const registrySize = mrsToolRegistry.size;
      const toolDefinitions = getMrsToolDefinitions();
      const filteredTools = getFilteredMrsTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = mrsToolRegistry.size;
      const readOnlyTools = getMrsReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have consistent schema format', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('MRS Tool Specifics', () => {
    it('should support merge request operations', () => {
      const getMRTool = mrsToolRegistry.get('get_merge_request');
      expect(getMRTool).toBeDefined();
      expect(getMRTool!.inputSchema).toBeDefined();

      // The tool should handle merge request identification
      expect(getMRTool!.description).toContain('merge request');
    });

    it('should mention merge request context in descriptions', () => {
      const toolEntries = Array.from(mrsToolRegistry.values());

      toolEntries.forEach(tool => {
        const description = tool.description.toLowerCase();
        // Each tool should mention merge request, branch, diff, or draft
        expect(description).toMatch(/merge request|branch|diff|draft|note/);
      });
    });

    it('should have comprehensive draft note management', () => {
      const draftNoteTools = [
        'create_draft_note', 'get_draft_note', 'list_draft_notes',
        'publish_draft_note', 'bulk_publish_draft_notes', 'update_draft_note', 'delete_draft_note'
      ];

      draftNoteTools.forEach(toolName => {
        expect(mrsToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have diff and comparison tools', () => {
      expect(mrsToolRegistry.has('get_branch_diffs')).toBe(true);
      expect(mrsToolRegistry.has('get_merge_request_diffs')).toBe(true);
      expect(mrsToolRegistry.has('list_merge_request_diffs')).toBe(true);
    });

    it('should have discussion and note tools', () => {
      expect(mrsToolRegistry.has('mr_discussions')).toBe(true);
      expect(mrsToolRegistry.has('create_note')).toBe(true);
      expect(mrsToolRegistry.has('create_merge_request_note')).toBe(true);
      expect(mrsToolRegistry.has('update_merge_request_note')).toBe(true);
      expect(mrsToolRegistry.has('create_merge_request_thread')).toBe(true);
    });
  });
});