/**
 * Unit tests for building the plugin package from this repository's real
 * package.json, skills and assets into a temporary directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildPlugin, findPackageRoot, parseAuthor } from '../../../../src/cli/plugin/build';
import { PluginValidationError } from '../../../../src/cli/plugin/validate';

const ROOT = join(__dirname, '../../../..');
const PUBLIC = {
  endpoint: 'https://mcp.example.com/mcp',
  flavor: 'public' as const,
  privacyPolicyUrl: 'https://example.com/privacy',
  termsOfServiceUrl: 'https://example.com/terms',
};

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'gitlab-mcp-plugin-'));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('buildPlugin', () => {
  it('writes the plugin folder, a local marketplace and a ZIP for the endpoint', () => {
    const result = buildPlugin({ ...PUBLIC, outDir });
    const version = (readJson(join(ROOT, 'package.json')) as { version: string }).version;

    expect(result.version).toBe(version);
    expect(result.files).toEqual(
      expect.arrayContaining([
        'plugin.json',
        'mcp.json',
        'assets/logo.png',
        'skills/gitlab-setup/SKILL.md',
      ]),
    );
    expect(readJson(join(result.pluginDir, 'mcp.json'))).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { gitlab: { type: 'streamable-http', url: 'https://mcp.example.com/mcp' } },
    });

    const manifest = readJson(join(result.pluginDir, 'plugin.json'));
    expect(manifest.name).toBe('gitlab-mcp');
    expect(manifest.version).toBe(version);
    const ui = (manifest.extensions as Record<string, Record<string, Record<string, unknown>>>)[
      'com.openai'
    ].interface;
    expect(ui.privacyPolicyURL).toBe('https://example.com/privacy');
    expect(ui.termsOfServiceURL).toBe('https://example.com/terms');
    expect(ui.logo).toBe('./assets/logo.png');

    expect(readJson(result.marketplacePath)).toEqual({
      name: 'gitlab-mcp',
      interface: { displayName: 'GitLab MCP' },
      plugins: [
        {
          name: 'gitlab-mcp',
          source: { source: 'local', path: './plugins/gitlab-mcp' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Developer Tools',
        },
      ],
    });
    expect(result.zipPath).toBe(join(outDir, `gitlab-mcp-${version}.zip`));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same ZIP checksum on a rebuild', () => {
    const first = buildPlugin({ ...PUBLIC, outDir });
    const second = buildPlugin({ ...PUBLIC, outDir });
    expect(second.sha256).toBe(first.sha256);
  });

  it('replaces only its own plugin folder in the output directory', () => {
    const stale = join(outDir, 'plugins', 'gitlab-mcp', 'stale.md');
    const unrelated = join(outDir, 'plugins', 'other', 'plugin.json');
    mkdirSync(join(outDir, 'plugins', 'gitlab-mcp'), { recursive: true });
    mkdirSync(join(outDir, 'plugins', 'other'), { recursive: true });
    writeFileSync(stale, 'old');
    writeFileSync(unrelated, '{}');

    buildPlugin({ ...PUBLIC, outDir });
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(unrelated, 'utf8')).toBe('{}');
  });

  it('builds a private package for a loopback endpoint without legal links', () => {
    const result = buildPlugin({
      endpoint: 'http://localhost:3333/mcp',
      flavor: 'private',
      outDir,
    });
    const manifest = readJson(join(result.pluginDir, 'plugin.json'));
    const ui = (manifest.extensions as Record<string, Record<string, Record<string, unknown>>>)[
      'com.openai'
    ].interface;
    expect(ui.privacyPolicyURL).toBeUndefined();
    expect(readJson(join(result.pluginDir, 'mcp.json')).mcpServers).toEqual({
      gitlab: { type: 'streamable-http', url: 'http://localhost:3333/mcp' },
    });
  });

  it('writes nothing when the endpoint is refused', () => {
    expect(() => buildPlugin({ ...PUBLIC, endpoint: 'https://localhost/mcp', outDir })).toThrow(
      'not publicly reachable',
    );
    expect(existsSync(join(outDir, 'plugins'))).toBe(false);
  });

  it('writes nothing when a public package lacks its legal links', () => {
    let error: unknown;
    try {
      buildPlugin({ endpoint: PUBLIC.endpoint, flavor: 'public', outDir });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PluginValidationError);
    expect((error as PluginValidationError).issues.map((i) => i.message)).toEqual([
      'interface.privacyPolicyURL is required',
      'interface.termsOfServiceURL is required',
    ]);
    expect(existsSync(join(outDir, 'plugins'))).toBe(false);
    expect(existsSync(join(outDir, '.agents'))).toBe(false);
  });
});

describe('findPackageRoot', () => {
  it('finds the core package from a nested directory', () => {
    expect(findPackageRoot(join(ROOT, 'src', 'cli', 'plugin'))).toBe(ROOT);
  });

  it('fails outside the package', () => {
    expect(() => findPackageRoot(tmpdir())).toThrow('Cannot locate the');
  });
});

describe('parseAuthor', () => {
  it('splits the npm author string', () => {
    expect(parseAuthor('Jane Doe <jane@example.com>')).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
    expect(parseAuthor('Jane Doe <jane@example.com> (https://example.com)')).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
    expect(parseAuthor('Jane Doe')).toEqual({ name: 'Jane Doe' });
  });
});
