import { pipelinesToolRegistry, getPipelinesReadOnlyToolNames, getPipelinesToolDefinitions, getFilteredPipelinesTools } from '../../../../src/entities/pipelines/registry';

// Mock enhancedFetch to avoid actual API calls
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue([
      { id: 1, status: 'success', ref: 'main', sha: 'abc123' },
      { id: 2, status: 'running', ref: 'feature-branch', sha: 'def456' }
    ])
  })
}));

describe('Pipelines Registry', () => {
  describe('Registry Structure', () => {
    it('should be a Map instance', () => {
      expect(pipelinesToolRegistry instanceof Map).toBe(true);
    });

    it('should contain expected pipeline tools', () => {
      const toolNames = Array.from(pipelinesToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain('list_pipelines');
      expect(toolNames).toContain('get_pipeline');
      expect(toolNames).toContain('list_pipeline_jobs');
      expect(toolNames).toContain('list_pipeline_trigger_jobs');
      expect(toolNames).toContain('get_pipeline_job');
      expect(toolNames).toContain('get_pipeline_job_output');

      // Check for write tools
      expect(toolNames).toContain('create_pipeline');
      expect(toolNames).toContain('retry_pipeline');
      expect(toolNames).toContain('cancel_pipeline');
      expect(toolNames).toContain('play_pipeline_job');
      expect(toolNames).toContain('retry_pipeline_job');
      expect(toolNames).toContain('cancel_pipeline_job');
    });

    it('should have tools with valid structure', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

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
      const toolNames = Array.from(pipelinesToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 12 pipeline tools', () => {
      expect(pipelinesToolRegistry.size).toBe(12);
    });
  });

  describe('Tool Definitions', () => {
    it('should have proper list_pipelines tool', () => {
      const tool = pipelinesToolRegistry.get('list_pipelines');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_pipelines');
      expect(tool!.description).toContain('List pipelines');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper get_pipeline tool', () => {
      const tool = pipelinesToolRegistry.get('get_pipeline');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_pipeline');
      expect(tool!.description).toContain('Get details of a specific pipeline');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper list_pipeline_jobs tool', () => {
      const tool = pipelinesToolRegistry.get('list_pipeline_jobs');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_pipeline_jobs');
      expect(tool!.description).toContain('List all jobs in a specific pipeline');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper create_pipeline tool', () => {
      const tool = pipelinesToolRegistry.get('create_pipeline');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('create_pipeline');
      expect(tool!.description).toContain('Create a new pipeline');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper retry_pipeline tool', () => {
      const tool = pipelinesToolRegistry.get('retry_pipeline');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('retry_pipeline');
      expect(tool!.description).toContain('Retry a failed or canceled pipeline');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper cancel_pipeline tool', () => {
      const tool = pipelinesToolRegistry.get('cancel_pipeline');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('cancel_pipeline');
      expect(tool!.description).toContain('Cancel a running pipeline');
      expect(tool!.inputSchema).toBeDefined();
    });

    it('should have proper job management tools', () => {
      const playTool = pipelinesToolRegistry.get('play_pipeline_job');
      const retryTool = pipelinesToolRegistry.get('retry_pipeline_job');
      const cancelTool = pipelinesToolRegistry.get('cancel_pipeline_job');
      const getTool = pipelinesToolRegistry.get('get_pipeline_job');
      const outputTool = pipelinesToolRegistry.get('get_pipeline_job_output');

      expect(playTool).toBeDefined();
      expect(retryTool).toBeDefined();
      expect(cancelTool).toBeDefined();
      expect(getTool).toBeDefined();
      expect(outputTool).toBeDefined();

      expect(playTool!.description).toContain('Run a manual pipeline job');
      expect(retryTool!.description).toContain('Retry a failed or canceled pipeline job');
      expect(cancelTool!.description).toContain('Cancel a running pipeline job');
      expect(getTool!.description).toContain('Get details of a GitLab pipeline job number');
      expect(outputTool!.description).toContain('Get the output');
    });
  });

  describe('Read-Only Tools Function', () => {
    it('should return an array of read-only tool names', () => {
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it('should include expected read-only tools', () => {
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      expect(readOnlyTools).toContain('list_pipelines');
      expect(readOnlyTools).toContain('get_pipeline');
      expect(readOnlyTools).toContain('list_pipeline_jobs');
      expect(readOnlyTools).toContain('list_pipeline_trigger_jobs');
      expect(readOnlyTools).toContain('get_pipeline_job');
      expect(readOnlyTools).toContain('get_pipeline_job_output');
    });

    it('should not include write tools', () => {
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      expect(readOnlyTools).not.toContain('create_pipeline');
      expect(readOnlyTools).not.toContain('retry_pipeline');
      expect(readOnlyTools).not.toContain('cancel_pipeline');
      expect(readOnlyTools).not.toContain('play_pipeline_job');
      expect(readOnlyTools).not.toContain('retry_pipeline_job');
      expect(readOnlyTools).not.toContain('cancel_pipeline_job');
    });

    it('should return exactly 6 read-only tools', () => {
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(6);
    });

    it('should return tools that exist in the registry', () => {
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(pipelinesToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe('Pipelines Tool Definitions Function', () => {
    it('should return an array of tool definitions', () => {
      const toolDefinitions = getPipelinesToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(12);
    });

    it('should return all tools from registry', () => {
      const toolDefinitions = getPipelinesToolDefinitions();
      const registrySize = pipelinesToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it('should return tool definitions with proper structure', () => {
      const toolDefinitions = getPipelinesToolDefinitions();

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

  describe('Filtered Pipelines Tools Function', () => {
    it('should return all tools in normal mode', () => {
      const filteredTools = getFilteredPipelinesTools(false);
      expect(filteredTools.length).toBe(12);
    });

    it('should return only read-only tools in read-only mode', () => {
      const filteredTools = getFilteredPipelinesTools(true);
      const readOnlyTools = getPipelinesReadOnlyToolNames();
      expect(filteredTools.length).toBe(readOnlyTools.length);
    });

    it('should filter tools correctly in read-only mode', () => {
      const filteredTools = getFilteredPipelinesTools(true);
      const toolNames = filteredTools.map(tool => tool.name);

      expect(toolNames).toContain('list_pipelines');
      expect(toolNames).toContain('get_pipeline');
      expect(toolNames).toContain('list_pipeline_jobs');
      expect(toolNames).toContain('list_pipeline_trigger_jobs');
      expect(toolNames).toContain('get_pipeline_job');
      expect(toolNames).toContain('get_pipeline_job_output');

      expect(toolNames).not.toContain('create_pipeline');
      expect(toolNames).not.toContain('retry_pipeline');
      expect(toolNames).not.toContain('cancel_pipeline');
      expect(toolNames).not.toContain('play_pipeline_job');
      expect(toolNames).not.toContain('retry_pipeline_job');
      expect(toolNames).not.toContain('cancel_pipeline_job');
    });

    it('should not include write tools in read-only mode', () => {
      const filteredTools = getFilteredPipelinesTools(true);
      const toolNames = filteredTools.map(tool => tool.name);
      const writeTools = [
        'create_pipeline', 'retry_pipeline', 'cancel_pipeline',
        'play_pipeline_job', 'retry_pipeline_job', 'cancel_pipeline_job'
      ];

      writeTools.forEach(toolName => {
        expect(toolNames).not.toContain(toolName);
      });
    });

    it('should return exactly 6 tools in read-only mode', () => {
      const filteredTools = getFilteredPipelinesTools(true);
      expect(filteredTools.length).toBe(6);
    });
  });

  describe('Tool Handlers', () => {
    it('should have handlers that are async functions', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('should have handlers that accept arguments', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.handler.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Registry Consistency', () => {
    it('should have all expected pipeline tools', () => {
      const expectedTools = [
        'list_pipelines', 'get_pipeline', 'list_pipeline_jobs', 'list_pipeline_trigger_jobs',
        'get_pipeline_job', 'get_pipeline_job_output', 'create_pipeline', 'retry_pipeline',
        'cancel_pipeline', 'play_pipeline_job', 'retry_pipeline_job', 'cancel_pipeline_job'
      ];

      expectedTools.forEach(toolName => {
        expect(pipelinesToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have consistent tool count between functions', () => {
      const registrySize = pipelinesToolRegistry.size;
      const toolDefinitions = getPipelinesToolDefinitions();
      const filteredTools = getFilteredPipelinesTools(false);

      expect(toolDefinitions.length).toBe(registrySize);
      expect(filteredTools.length).toBe(registrySize);
    });

    it('should have more tools than just read-only ones', () => {
      const totalTools = pipelinesToolRegistry.size;
      const readOnlyTools = getPipelinesReadOnlyToolNames();

      expect(totalTools).toBeGreaterThan(readOnlyTools.length);
    });
  });

  describe('Tool Input Schemas', () => {
    it('should have valid JSON schema structure for all tools', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have consistent schema format', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

      toolEntries.forEach(tool => {
        // Each schema should be a valid JSON Schema object
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('Pipeline Tool Specifics', () => {
    it('should support pipeline operations', () => {
      const listTool = pipelinesToolRegistry.get('list_pipelines');
      expect(listTool).toBeDefined();
      expect(listTool!.inputSchema).toBeDefined();

      // The tool should handle pipeline listing
      expect(listTool!.description).toContain('List pipelines');
    });

    it('should mention pipeline context in descriptions', () => {
      const toolEntries = Array.from(pipelinesToolRegistry.values());

      toolEntries.forEach(tool => {
        const description = tool.description.toLowerCase();
        // Each tool should mention pipeline or job
        expect(description).toMatch(/pipeline|job/);
      });
    });

    it('should have comprehensive job management', () => {
      const jobTools = [
        'list_pipeline_jobs', 'get_pipeline_job', 'get_pipeline_job_output',
        'play_pipeline_job', 'retry_pipeline_job', 'cancel_pipeline_job'
      ];

      jobTools.forEach(toolName => {
        expect(pipelinesToolRegistry.has(toolName)).toBe(true);
      });
    });

    it('should have pipeline lifecycle management', () => {
      expect(pipelinesToolRegistry.has('create_pipeline')).toBe(true);
      expect(pipelinesToolRegistry.has('retry_pipeline')).toBe(true);
      expect(pipelinesToolRegistry.has('cancel_pipeline')).toBe(true);
    });

    it('should have trigger job support', () => {
      expect(pipelinesToolRegistry.has('list_pipeline_trigger_jobs')).toBe(true);

      const triggerTool = pipelinesToolRegistry.get('list_pipeline_trigger_jobs');
      expect(triggerTool!.description).toContain('List all trigger jobs');
    });
  });
});