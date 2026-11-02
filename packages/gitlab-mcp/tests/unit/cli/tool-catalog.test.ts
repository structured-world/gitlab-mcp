jest.mock('../../../src/registry-manager', () => ({
  RegistryManager: { getInstance: jest.fn() },
}));

import {
  measureCatalog,
  loadToolCatalog,
  extractActions,
  main,
} from '../../../src/cli/tool-catalog';
import { RegistryManager } from '../../../src/registry-manager';

// Count public actions once per tool, even when several schema variants share an action.
test('metrics distinguish CQRS tools, helpers and registry groups', () => {
  const metrics = measureCatalog({
    tools: [
      {
        name: 'browse_fixture',
        description: '',
        inputSchema: {
          oneOf: [
            { properties: { action: { const: 'list' } } },
            { properties: { action: { const: 'list' } } },
            { properties: { action: { const: 'get' } } },
          ],
        },
      },
      {
        name: 'manage_fixture',
        description: '',
        inputSchema: {
          properties: { action: { enum: ['create', 'delete'] } },
        },
      },
      { name: 'setup_fixture', description: '', inputSchema: {} },
    ],
    toolGroupCount: 2,
    readOnlyToolNames: ['browse_fixture', 'setup_fixture'],
  });
  expect(metrics).toEqual({
    toolCount: 3,
    cqrsToolCount: 2,
    helperToolCount: 1,
    actionCount: 4,
    toolGroupCount: 2,
    readonlyToolCount: 2,
    description: '3 tools, 4 typed actions, 2 registry groups',
  });
});

// Catalogs may be empty or helper-only; neither case invents CQRS actions or groups.
test('empty and helper-only catalogs are measured without substitute values', () => {
  expect(measureCatalog({ tools: [], toolGroupCount: 0, readOnlyToolNames: [] })).toEqual({
    toolCount: 0,
    cqrsToolCount: 0,
    helperToolCount: 0,
    actionCount: 0,
    toolGroupCount: 0,
    readonlyToolCount: 0,
    description: '0 tools, 0 typed actions, 0 registry groups',
  });
  expect(
    measureCatalog({
      tools: [{ name: 'helper', description: '', inputSchema: {} }],
      toolGroupCount: 1,
      readOnlyToolNames: [],
    }),
  ).toMatchObject({ toolCount: 1, helperToolCount: 1, cqrsToolCount: 0, actionCount: 0 });
});

// A literal action is a real action; unrelated schema constants and non-string enums are not.
test('literal actions and malformed action candidates are distinguished', () => {
  expect(
    extractActions({
      properties: { action: { const: 'inspect', description: 'Inspect fixture' } },
    }),
  ).toEqual([{ name: 'inspect', description: 'Inspect fixture' }]);
  expect(extractActions({ oneOf: [{ properties: { action: { const: 7 } } }, {}] })).toEqual([]);
  expect(extractActions({ properties: { action: { enum: [7, 'list'] } } })).toEqual([
    { name: 'list', description: 'List items with filtering and pagination' },
  ]);
  expect(extractActions({ properties: { action: { const: 'inspect' } } })).toEqual([
    { name: 'inspect', description: 'Perform inspect operation' },
  ]);
});

// The release input carries canonical policies and tiers without serializing handlers or schemas.
test('the metadata command emits the shared metrics and complete manifest tool list', () => {
  const tools = [
    {
      name: 'browse_fixture',
      description: 'Read fixture',
      inputSchema: { properties: { action: { const: 'get' } } },
      requirements: { default: { tier: 'premium' as const } },
    },
    { name: 'setup_fixture', description: 'Setup fixture', inputSchema: {} },
  ];
  const catalog = {
    tools,
    toolGroupCount: 2,
    readOnlyToolNames: ['browse_fixture', 'setup_fixture'],
  };
  jest
    .mocked(RegistryManager.getInstance)
    .mockReturnValueOnce({ getUnfilteredCatalog: () => catalog } as unknown as RegistryManager);
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    main();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      metrics: measureCatalog(catalog),
      tools: [
        { name: 'browse_fixture', description: 'Read fixture', tier: 'premium', readOnly: true },
        { name: 'setup_fixture', description: 'Setup fixture', readOnly: true },
      ],
    });
  } finally {
    log.mockRestore();
  }
});

// Publication uses the unfiltered catalog, and a registry failure must propagate to its caller.
test('loading never substitutes an empty or hardcoded catalog after a registry failure', () => {
  const getInstance = jest.mocked(RegistryManager.getInstance);
  getInstance.mockImplementationOnce(() => {
    throw new Error('Fixture registry failure');
  });
  expect(loadToolCatalog).toThrow('Fixture registry failure');
  const catalog = { tools: [], toolGroupCount: 0, readOnlyToolNames: [] };
  getInstance.mockReturnValueOnce({
    getUnfilteredCatalog: () => catalog,
  } as unknown as RegistryManager);
  expect(loadToolCatalog()).toEqual({
    tools: [],
    metrics: measureCatalog(catalog),
    readOnlyToolNames: [],
  });
});
