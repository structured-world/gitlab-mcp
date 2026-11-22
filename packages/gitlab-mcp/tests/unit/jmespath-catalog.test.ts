import { RegistryManager } from '../../src/registry-manager';
import { extractActionsFromSchema, flattenDiscriminatedUnion } from '../../src/utils/schema-utils';
import { JMESPATH_ARGUMENT, JMESPATH_MAX_LENGTH } from '../../src/utils/jmespath-projection';
import type { EnhancedToolDefinition } from '../../src/types';

type Branch = { properties?: Record<string, { const?: string; enum?: string[] } & object> };
type Schema = Branch & { oneOf?: Branch[] };

const actionOf = (branch: Branch): string | undefined =>
  branch.properties?.action?.const ?? branch.properties?.action?.enum?.[0];

/** Every tool the server can list, with its catalog schema. */
const catalog = (): EnhancedToolDefinition[] =>
  RegistryManager.getInstance().getAllToolDefinitionsTierless();

/** Actions whose schema offers the projection argument, from a discriminated schema. */
function offeringActions(schema: Schema): string[] {
  return (schema.oneOf ?? [])
    .filter((branch) => branch.properties?.[JMESPATH_ARGUMENT] !== undefined)
    .map((branch) => actionOf(branch) ?? '');
}

describe('jmespath projection in the tool catalog', () => {
  it('declares only actions the tool has, so a typo cannot silently hide the parameter', () => {
    for (const tool of catalog()) {
      const actions = extractActionsFromSchema(tool.inputSchema);
      for (const action of tool.projectableActions ?? []) {
        expect({ tool: tool.name, action, known: actions.includes(action) }).toEqual({
          tool: tool.name,
          action,
          known: true,
        });
      }
    }
  });

  it('offers the parameter on exactly the declared actions of a discriminated schema', async () => {
    const previous = process.env.GITLAB_SCHEMA_MODE;
    process.env.GITLAB_SCHEMA_MODE = 'discriminated';
    try {
      await jest.isolateModulesAsync(async () => {
        // Schema mode is read when the config module loads, so the registry is loaded anew.
        const isolated = await import('../../src/registry-manager');
        const tools = isolated.RegistryManager.getInstance().getAllToolDefinitionsTierless();
        const declaring = tools.filter((tool) => (tool.projectableActions?.length ?? 0) > 0);
        expect(declaring.length).toBeGreaterThan(25);
        for (const tool of declaring) {
          const schema = tool.inputSchema as Schema;
          expect({ tool: tool.name, union: Array.isArray(schema.oneOf) }).toEqual({
            tool: tool.name,
            union: true,
          });
          expect({ tool: tool.name, offered: offeringActions(schema).sort() }).toEqual({
            tool: tool.name,
            offered: [...(tool.projectableActions ?? [])].sort(),
          });
        }
      });
    } finally {
      if (previous === undefined) delete process.env.GITLAB_SCHEMA_MODE;
      else process.env.GITLAB_SCHEMA_MODE = previous;
    }
  });

  it('names the accepting actions in a flat schema where not all actions accept it', () => {
    const pipelines = catalog().find((tool) => tool.name === 'browse_pipelines');
    const flat = pipelines?.inputSchema as { properties: Record<string, { description?: string }> };
    expect(flat.properties[JMESPATH_ARGUMENT]?.description).toMatch(
      /Only for 'list', 'jobs', 'triggers'\.$/,
    );
  });

  it('describes the parameter as a bounded optional string', () => {
    const pipelines = catalog().find((tool) => tool.name === 'browse_pipelines');
    const flat = flattenDiscriminatedUnion(pipelines?.inputSchema as Schema) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(flat.properties[JMESPATH_ARGUMENT]).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: JMESPATH_MAX_LENGTH,
    });
    expect(flat.required).not.toContain(JMESPATH_ARGUMENT);
  });

  it('never offers it on write tools, context tools or tools with an outputSchema', () => {
    const offered = (tool: EnhancedToolDefinition): boolean =>
      JSON.stringify(tool.inputSchema).includes(`"${JMESPATH_ARGUMENT}"`);
    for (const tool of catalog()) {
      if (tool.name.startsWith('manage_') || tool.outputSchema || tool.resultFormat === 'mcp')
        expect({ tool: tool.name, offered: offered(tool) }).toEqual({
          tool: tool.name,
          offered: false,
        });
    }
  });

  it('accepts a projection only for a declared action', () => {
    const registry = RegistryManager.getInstance();
    expect(registry.acceptsProjection('browse_pipelines', 'jobs')).toBe(true);
    expect(registry.acceptsProjection('browse_pipelines', 'logs')).toBe(false);
    expect(registry.acceptsProjection('browse_pipelines', undefined)).toBe(false);
    expect(registry.acceptsProjection('manage_pipeline', 'create')).toBe(false);
    expect(registry.acceptsProjection('get_settings', 'read')).toBe(false);
    expect(registry.acceptsProjection('no_such_tool', 'list')).toBe(false);
  });
});
