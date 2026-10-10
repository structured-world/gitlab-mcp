/**
 * The settings tools as registered: each returns its data both as text and as structured
 * content that satisfies the tool's declared output schema, and the panel tool points the
 * host at the panel resource.
 */

import { contextToolRegistry } from '../../../../src/entities/context/registry';
import { formatToolResult } from '../../../../src/utils/tool-result';

jest.mock('../../../../src/entities/context/settings', () => ({
  ...jest.requireActual('../../../../src/entities/context/settings'),
  readSettings: jest.fn(async () => ({
    schema: { type: 'object', properties: { readOnly: { type: 'boolean' } }, required: [] },
    values: { readOnly: false },
    layout: [
      { kind: 'group', title: 'Defaults', items: [{ kind: 'property', property: 'readOnly' }] },
    ],
  })),
  updateSettings: jest.fn(async (set: Record<string, unknown>) => ({ values: set })),
}));

jest.mock('../../../../src/entities/context/connection-check', () => ({
  ...jest.requireActual('../../../../src/entities/context/connection-check'),
  checkConnection: jest.fn(async () => ({
    account: 'alice',
    instance: 'https://gitlab.example.com',
    gitlabVersion: '17.4.0',
    tier: 'premium',
    authenticated: true,
    readOnly: false,
    preset: null,
    scope: null,
    availableTools: 42,
    warnings: [],
    recommendations: [],
  })),
}));

jest.mock('../../../../src/entities/context/scope-search', () => ({
  ...jest.requireActual('../../../../src/entities/context/scope-search'),
  findScopeTargets: jest.fn(async (query: string) => ({
    targets: [{ type: 'group', path: query, name: 'Team' }],
  })),
}));

function tool(name: string) {
  const definition = contextToolRegistry.get(name);
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

async function run(name: string, args: Record<string, unknown> = {}) {
  const definition = tool(name);
  return formatToolResult(await definition.handler(args), definition);
}

describe('settings tools', () => {
  it.each([
    ['get_settings', {}, { values: { readOnly: false } }],
    ['update_settings', { set: { readOnly: true } }, { values: { readOnly: true } }],
    ['check_connection', {}, { account: 'alice', availableTools: 42 }],
    ['find_scope_targets', { query: 'team' }, { targets: [{ path: 'team' }] }],
  ])('%s returns its data as text and structured content', async (name, args, expected) => {
    const result = await run(name, args);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject(expected);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
      result.structuredContent,
    );
  });

  it('points the host at the panel resource and tells other clients what to use', async () => {
    const panel = tool('open_settings_panel');

    expect(panel._meta).toEqual({
      ui: { resourceUri: 'ui://gitlab-mcp/settings-panel-v1.html' },
      'openai/outputTemplate': 'ui://gitlab-mcp/settings-panel-v1.html',
    });
    const result = await run('open_settings_panel');
    expect(result.structuredContent).toEqual({ opened: true });
    expect((result.content[0] as { text: string }).text).toContain(
      'get_settings, update_settings and manage_context set_scope',
    );
  });
});
