import { RegistryManager } from '../../src/registry-manager';
import { EnhancedToolDefinition } from '../../src/types';

// Mock all the dependencies
jest.mock('../../src/entities/core/registry', () => ({
  coreToolRegistry: new Map([
    ['test_core_tool', {
      name: 'test_core_tool',
      description: 'Test core tool',
      inputSchema: { type: 'object' },
      handler: jest.fn().mockResolvedValue({ success: true }),
    }],
  ]),
  getCoreReadOnlyToolNames: () => ['test_core_tool'],
}));

jest.mock('../../src/entities/labels/registry', () => ({
  labelsToolRegistry: new Map([
    ['test_labels_tool', {
      name: 'test_labels_tool',
      description: 'Test labels tool',
      inputSchema: { type: 'object' },
      handler: jest.fn().mockResolvedValue({ success: true }),
    }],
  ]),
  getLabelsReadOnlyToolNames: () => ['test_labels_tool'],
}));

jest.mock('../../src/entities/mrs/registry', () => ({
  mrsToolRegistry: new Map(),
  getMrsReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/files/registry', () => ({
  filesToolRegistry: new Map(),
  getFilesReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/milestones/registry', () => ({
  milestonesToolRegistry: new Map(),
  getMilestonesReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/pipelines/registry', () => ({
  pipelinesToolRegistry: new Map(),
  getPipelinesReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/variables/registry', () => ({
  variablesToolRegistry: new Map(),
  getVariablesReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/wiki/registry', () => ({
  wikiToolRegistry: new Map(),
  getWikiReadOnlyToolNames: () => [],
}));

jest.mock('../../src/entities/workitems/registry', () => ({
  workitemsToolRegistry: new Map(),
  getWorkitemsReadOnlyToolNames: () => [],
}));

jest.mock('../../src/config', () => ({
  GITLAB_READ_ONLY_MODE: false,
  GITLAB_DENIED_TOOLS_REGEX: null,
  USE_GITLAB_WIKI: false,
  USE_MILESTONE: false,
  USE_PIPELINE: false,
  USE_WORKITEMS: false,
  USE_LABELS: true,
  USE_MRS: false,
  USE_FILES: false,
  USE_VARIABLES: false,
  getToolDescriptionOverrides: () => new Map([
    ['test_core_tool', 'Custom description for core tool'],
  ]),
}));

jest.mock('../../src/services/ToolAvailability', () => ({
  ToolAvailability: {
    isToolAvailable: () => true,
    getUnavailableReason: () => '',
  },
}));

jest.mock('../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
  },
}));

describe('RegistryManager', () => {
  let registryManager: RegistryManager;

  beforeEach(() => {
    // Clear any existing instance to ensure fresh state
    (RegistryManager as any).instance = null;
    registryManager = RegistryManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clear instance after each test
    (RegistryManager as any).instance = null;
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = RegistryManager.getInstance();
      const instance2 = RegistryManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should return the same instance as the one created in beforeEach', () => {
      const instance = RegistryManager.getInstance();

      expect(instance).toBe(registryManager);
    });
  });

  describe('getTool', () => {
    it('should return a tool that exists', () => {
      const tool = registryManager.getTool('test_core_tool');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test_core_tool');
      expect(tool?.description).toBe('Custom description for core tool'); // Should have override applied
    });

    it('should return null for a tool that does not exist', () => {
      const tool = registryManager.getTool('non_existent_tool');

      expect(tool).toBeNull();
    });

    it('should return tools from enabled registries', () => {
      const coreTool = registryManager.getTool('test_core_tool');
      const labelsTool = registryManager.getTool('test_labels_tool');

      expect(coreTool).toBeDefined();
      expect(labelsTool).toBeDefined();
    });
  });

  describe('hasToolHandler', () => {
    it('should return true for existing tools', () => {
      expect(registryManager.hasToolHandler('test_core_tool')).toBe(true);
      expect(registryManager.hasToolHandler('test_labels_tool')).toBe(true);
    });

    it('should return false for non-existing tools', () => {
      expect(registryManager.hasToolHandler('non_existent_tool')).toBe(false);
    });
  });

  describe('executeTool', () => {
    it('should execute an existing tool successfully', async () => {
      const result = await registryManager.executeTool('test_core_tool', { test: 'data' });

      expect(result).toEqual({ success: true });
    });

    it('should throw an error for non-existing tools', async () => {
      await expect(registryManager.executeTool('non_existent_tool', {}))
        .rejects
        .toThrow("Tool 'non_existent_tool' not found in any registry");
    });

    it('should pass arguments to the tool handler', async () => {
      const args = { test: 'data', value: 123 };
      await registryManager.executeTool('test_core_tool', args);

      const tool = registryManager.getTool('test_core_tool');
      expect(tool?.handler).toHaveBeenCalledWith(args);
    });
  });

  describe('getAllToolDefinitions', () => {
    it('should return an array of tool definitions', () => {
      const definitions = registryManager.getAllToolDefinitions();

      expect(Array.isArray(definitions)).toBe(true);
      expect(definitions.length).toBeGreaterThan(0);
    });

    it('should return tool definitions without handlers', () => {
      const definitions = registryManager.getAllToolDefinitions();

      const coreToolDef = definitions.find(def => def.name === 'test_core_tool');
      expect(coreToolDef).toBeDefined();
      expect(coreToolDef).toEqual({
        name: 'test_core_tool',
        description: 'Custom description for core tool',
        inputSchema: { type: 'object' },
      });
      expect((coreToolDef as any).handler).toBeUndefined();
    });

    it('should cache tool definitions for performance', () => {
      const definitions1 = registryManager.getAllToolDefinitions();
      const definitions2 = registryManager.getAllToolDefinitions();

      // Should return the same array reference (cached)
      expect(definitions1).toBe(definitions2);
    });
  });

  describe('getAvailableToolNames', () => {
    it('should return an array of tool names', () => {
      const toolNames = registryManager.getAvailableToolNames();

      expect(Array.isArray(toolNames)).toBe(true);
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it('should include tools from enabled registries', () => {
      const toolNames = registryManager.getAvailableToolNames();

      expect(toolNames).toContain('test_core_tool');
      expect(toolNames).toContain('test_labels_tool');
    });

    it('should cache tool names for performance', () => {
      const names1 = registryManager.getAvailableToolNames();
      const names2 = registryManager.getAvailableToolNames();

      // Should return the same array reference (cached)
      expect(names1).toBe(names2);
    });
  });

  describe('Tool Description Overrides', () => {
    it('should apply description overrides from environment variables', () => {
      const tool = registryManager.getTool('test_core_tool');

      expect(tool?.description).toBe('Custom description for core tool');
    });

    it('should not affect tools without overrides', () => {
      const tool = registryManager.getTool('test_labels_tool');

      expect(tool?.description).toBe('Test labels tool');
    });
  });

  describe('Tool Filtering Logic', () => {
    it('should include tools from enabled registries in normal mode', () => {
      const toolNames = registryManager.getAvailableToolNames();

      expect(toolNames).toContain('test_core_tool');
      expect(toolNames).toContain('test_labels_tool');
    });

    it('should maintain consistent tool count across method calls', () => {
      const toolNames = registryManager.getAvailableToolNames();
      const definitions = registryManager.getAllToolDefinitions();

      expect(toolNames.length).toBe(definitions.length);
    });
  });
});