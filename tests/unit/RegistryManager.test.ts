import { RegistryManager } from '../../src/registry-manager';
import { EnhancedToolDefinition } from '../../src/types';

// Mock all dependencies
jest.mock('../../src/entities/core/registry', () => ({
  coreToolRegistry: new Map([
    ['core_tool_1', { name: 'core_tool_1', description: 'Core tool 1', inputSchema: { type: 'object' }, handler: jest.fn().mockResolvedValue({ success: true }) }],
    ['core_readonly', { name: 'core_readonly', description: 'Core readonly tool', inputSchema: { type: 'object' }, handler: jest.fn() }],
  ]),
  getCoreReadOnlyToolNames: () => ['core_readonly'],
}));

jest.mock('../../src/entities/labels/registry', () => ({
  labelsToolRegistry: new Map([
    ['labels_tool_1', { name: 'labels_tool_1', description: 'Labels tool 1', inputSchema: { type: 'object' }, handler: jest.fn() }],
    ['labels_readonly', { name: 'labels_readonly', description: 'Labels readonly', inputSchema: { type: 'object' }, handler: jest.fn() }],
  ]),
  getLabelsReadOnlyToolNames: () => ['labels_readonly'],
}));

// Mock empty registries
['mrs', 'files', 'milestones', 'pipelines', 'variables', 'wiki', 'workitems'].forEach(entity => {
  jest.mock(`../../src/entities/${entity}/registry`, () => ({
    [`${entity}ToolRegistry`]: new Map(),
    [`get${entity.charAt(0).toUpperCase() + entity.slice(1)}ReadOnlyToolNames`]: () => [],
  }));
});

jest.mock('../../src/services/ToolAvailability', () => ({
  ToolAvailability: {
    isToolAvailable: jest.fn(),
    getUnavailableReason: jest.fn(),
  },
}));

jest.mock('../../src/logger', () => ({
  logger: { debug: jest.fn() },
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
  getToolDescriptionOverrides: jest.fn(() => new Map()),
}));

describe('RegistryManager', () => {
  let registryManager: RegistryManager;
  let mockConfig: any;
  const { ToolAvailability } = require('../../src/services/ToolAvailability');

  beforeEach(() => {
    jest.clearAllMocks();
    (RegistryManager as any).instance = null;

    // Get the mocked config
    mockConfig = require('../../src/config');

    // Reset default mocks
    mockConfig.GITLAB_READ_ONLY_MODE = false;
    mockConfig.GITLAB_DENIED_TOOLS_REGEX = null;
    mockConfig.getToolDescriptionOverrides = jest.fn(() => new Map());
    ToolAvailability.isToolAvailable.mockReturnValue(true);
    ToolAvailability.getUnavailableReason.mockReturnValue('');

    registryManager = RegistryManager.getInstance();
  });

  afterEach(() => {
    (RegistryManager as any).instance = null;
  });

  describe('Singleton Pattern', () => {
    it('should implement singleton correctly', () => {
      const instance1 = RegistryManager.getInstance();
      const instance2 = RegistryManager.getInstance();
      expect(instance1).toBe(instance2);
      expect(instance1).toBe(registryManager);
    });
  });

  describe('Core Functionality', () => {
    it('should handle basic tool operations', () => {
      expect(registryManager.getTool('core_tool_1')).toBeDefined();
      expect(registryManager.getTool('nonexistent')).toBeNull();
      expect(registryManager.hasToolHandler('core_tool_1')).toBe(true);
      expect(registryManager.hasToolHandler('nonexistent')).toBe(false);
    });

    it('should execute tools successfully', async () => {
      const result = await registryManager.executeTool('core_tool_1', { test: 'data' });
      expect(result).toEqual({ success: true });
    });

    it('should throw error for nonexistent tool execution', async () => {
      await expect(registryManager.executeTool('nonexistent', {}))
        .rejects.toThrow("Tool 'nonexistent' not found in any registry");
    });

    it('should return all tool definitions and names', () => {
      const definitions = registryManager.getAllToolDefinitions();
      const names = registryManager.getAvailableToolNames();

      expect(Array.isArray(definitions)).toBe(true);
      expect(Array.isArray(names)).toBe(true);
      expect(definitions.length).toBe(names.length);
      expect(definitions.length).toBeGreaterThan(0);

      // Verify definition structure
      const tool = definitions.find(d => d.name === 'core_tool_1');
      expect(tool).toEqual({
        name: 'core_tool_1',
        description: 'Core tool 1',
        inputSchema: { type: 'object' }
      });
      expect((tool as any).handler).toBeUndefined();
    });

    it('should cache definitions and names for performance', () => {
      const defs1 = registryManager.getAllToolDefinitions();
      const defs2 = registryManager.getAllToolDefinitions();
      const names1 = registryManager.getAvailableToolNames();
      const names2 = registryManager.getAvailableToolNames();

      expect(defs1).toBe(defs2);
      expect(names1).toBe(names2);
    });
  });

  describe('Read-Only Mode Filtering', () => {
    beforeEach(() => {
      mockConfig.GITLAB_READ_ONLY_MODE = true;
      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();
    });

    it('should filter tools in read-only mode', () => {
      const names = registryManager.getAvailableToolNames();
      expect(names).toContain('core_readonly');
      expect(names).toContain('labels_readonly');
      expect(names).not.toContain('core_tool_1');
      expect(names).not.toContain('labels_tool_1');
    });

    it('should only return read-only tools', () => {
      expect(registryManager.getTool('core_readonly')).toBeDefined();
      expect(registryManager.getTool('core_tool_1')).toBeNull();
    });
  });

  describe('Regex Filtering', () => {
    beforeEach(() => {
      mockConfig.GITLAB_DENIED_TOOLS_REGEX = /^core_/;
      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();
    });

    it('should filter tools matching denied regex', () => {
      const names = registryManager.getAvailableToolNames();
      expect(names).not.toContain('core_tool_1');
      expect(names).not.toContain('core_readonly');
      expect(names).toContain('labels_tool_1');
    });

    it('should not return filtered tools', () => {
      expect(registryManager.getTool('core_tool_1')).toBeNull();
      expect(registryManager.getTool('labels_tool_1')).toBeDefined();
    });
  });

  describe('Tool Availability Filtering', () => {
    beforeEach(() => {
      ToolAvailability.isToolAvailable.mockImplementation((name: string) => !name.includes('unavailable'));
      ToolAvailability.getUnavailableReason.mockImplementation((name: string) =>
        name.includes('unavailable') ? 'Not available in this GitLab version' : ''
      );
    });

    it('should filter unavailable tools', () => {
      // Add an unavailable tool to the registry for testing
      const coreRegistry = require('../../src/entities/core/registry').coreToolRegistry;
      coreRegistry.set('unavailable_tool', {
        name: 'unavailable_tool',
        description: 'Unavailable tool',
        inputSchema: { type: 'object' },
        handler: jest.fn()
      });

      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();

      const names = registryManager.getAvailableToolNames();
      expect(names).toContain('core_tool_1');
      expect(names).not.toContain('unavailable_tool');
    });
  });

  describe('Description Overrides', () => {
    const mockOverrides = new Map([
      ['core_tool_1', 'Custom description for core tool'],
      ['labels_tool_1', 'Custom labels description'],
    ]);

    beforeEach(() => {
      mockConfig.getToolDescriptionOverrides = jest.fn(() => mockOverrides);
      (RegistryManager as any).instance = null;
      registryManager = RegistryManager.getInstance();
    });

    it('should apply description overrides', () => {
      const tool1 = registryManager.getTool('core_tool_1');
      const tool2 = registryManager.getTool('labels_tool_1');
      const tool3 = registryManager.getTool('core_readonly');

      expect(tool1?.description).toBe('Custom description for core tool');
      expect(tool2?.description).toBe('Custom labels description');
      expect(tool3?.description).toBe('Core readonly tool'); // No override
    });

    it('should include overrides in definitions', () => {
      const definitions = registryManager.getAllToolDefinitions();
      const tool = definitions.find(d => d.name === 'core_tool_1');

      expect(tool?.description).toBe('Custom description for core tool');
    });
  });

  describe('Registry Management', () => {
    it('should load different entity registries based on config', () => {
      // Test with different configurations
      mockConfig.USE_LABELS = false;
      mockConfig.USE_MRS = true;

      // Mock MRS registry for this test
      const mrsRegistry = new Map([
        ['mrs_tool', { name: 'mrs_tool', description: 'MRS tool', inputSchema: {}, handler: jest.fn() }]
      ]);
      require('../../src/entities/mrs/registry').mrsToolRegistry = mrsRegistry;

      (RegistryManager as any).instance = null;
      const newManager = RegistryManager.getInstance();

      const names = newManager.getAvailableToolNames();
      expect(names).toContain('core_tool_1'); // Always includes core
      expect(names).not.toContain('labels_tool_1'); // Labels disabled
    });

    it('should provide cache refresh functionality', () => {
      const originalNames = registryManager.getAvailableToolNames();

      // Test that refresh method exists and doesn't throw
      expect(() => registryManager.refreshCache()).not.toThrow();

      // Names should still be available after refresh
      const refreshedNames = registryManager.getAvailableToolNames();
      expect(refreshedNames.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle tool execution errors', async () => {
      const errorTool = {
        name: 'error_tool',
        description: 'Error tool',
        inputSchema: { type: 'object' },
        handler: jest.fn().mockRejectedValue(new Error('Tool error'))
      };

      const coreRegistry = require('../../src/entities/core/registry').coreToolRegistry;
      coreRegistry.set('error_tool', errorTool);

      (RegistryManager as any).instance = null;
      const errorManager = RegistryManager.getInstance();

      await expect(errorManager.executeTool('error_tool', {}))
        .rejects.toThrow('Tool error');
    });
  });

  describe('Complex Filtering Scenarios', () => {
    it('should handle multiple filters combined', () => {
      mockConfig.GITLAB_READ_ONLY_MODE = true;
      mockConfig.GITLAB_DENIED_TOOLS_REGEX = /readonly/;

      (RegistryManager as any).instance = null;
      const filteredManager = RegistryManager.getInstance();

      // Should filter out tools that match denied regex even if they're read-only
      const names = filteredManager.getAvailableToolNames();
      expect(names).not.toContain('core_readonly');
      expect(names).not.toContain('labels_readonly');
      // May contain other read-only tools from MRS registry if enabled
    });

    it('should maintain consistency across multiple calls after filtering', () => {
      mockConfig.GITLAB_READ_ONLY_MODE = true;
      (RegistryManager as any).instance = null;
      const readOnlyManager = RegistryManager.getInstance();

      for (let i = 0; i < 3; i++) {
        const names = readOnlyManager.getAvailableToolNames();
        const definitions = readOnlyManager.getAllToolDefinitions();
        expect(names.length).toBe(definitions.length);
        expect(names.every(name => definitions.some(def => def.name === name))).toBe(true);
      }
    });
  });
});