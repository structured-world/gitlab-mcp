/**
 * Unit tests for building the plugin package from this repository's real
 * package.json, skills and assets into a temporary directory.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
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
      mcpServers: {
        'gitlab-sw': { type: 'streamable-http', url: 'https://mcp.example.com/mcp' },
      },
    });

    const manifest = readJson(join(result.pluginDir, 'plugin.json'));
    expect(manifest.name).toBe('gitlab-mcp');
    expect(manifest.version).toBe(version);
    const ui = (manifest.extensions as Record<string, Record<string, Record<string, unknown>>>)[
      'com.openai'
    ].interface;
    expect(ui.privacyPolicyURL).toBe('https://example.com/privacy');
    expect(ui.termsOfServiceURL).toBe('https://example.com/terms');
    // The logo tile serves both themes; the bare composer glyph has one per theme.
    expect(ui).toMatchObject({
      logo: './assets/logo.png',
      composerIcon: './assets/composer-icon.png',
      composerIconDark: './assets/composer-icon-dark.png',
      screenshots: ['./assets/screenshot-1.png', './assets/screenshot-2.png'],
      brandColor: '#6B4FBB',
      brandColorDark: '#B197FC',
    });

    expect(readJson(result.marketplacePath)).toEqual({
      name: 'gitlab-mcp',
      interface: { displayName: 'GitLab by Structured World' },
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

  it('adds its entry to an existing marketplace and keeps the other plugins', () => {
    // A team marketplace lists several plugins; rebuilding one must not drop the rest.
    const marketplacePath = join(outDir, '.agents', 'plugins', 'marketplace.json');
    const other = {
      name: 'other',
      source: { source: 'local', path: './plugins/other' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    };
    mkdirSync(join(outDir, '.agents', 'plugins'), { recursive: true });
    writeFileSync(
      marketplacePath,
      JSON.stringify({
        name: 'team-tools',
        interface: { displayName: 'Team tools' },
        plugins: [other, { name: 'gitlab-mcp', source: { source: 'local', path: './old' } }],
      }),
    );

    buildPlugin({ ...PUBLIC, outDir });
    const marketplace = readJson(marketplacePath) as {
      name: string;
      interface: unknown;
      plugins: Array<{ name: string; source: unknown }>;
    };
    expect(marketplace.name).toBe('team-tools');
    expect(marketplace.interface).toEqual({ displayName: 'Team tools' });
    expect(marketplace.plugins.map((p) => p.name)).toEqual(['other', 'gitlab-mcp']);
    expect(marketplace.plugins[0]).toEqual(other);
    expect(marketplace.plugins[1].source).toEqual({
      source: 'local',
      path: './plugins/gitlab-mcp',
    });
  });

  it('writes nothing when the existing marketplace cannot be read', () => {
    const marketplacePath = join(outDir, '.agents', 'plugins', 'marketplace.json');
    mkdirSync(join(outDir, '.agents', 'plugins'), { recursive: true });
    writeFileSync(marketplacePath, '{not json');

    expect(() => buildPlugin({ ...PUBLIC, outDir })).toThrow(
      `Cannot read the existing marketplace ${marketplacePath}`,
    );
    expect(readFileSync(marketplacePath, 'utf8')).toBe('{not json');
    expect(existsSync(join(outDir, 'plugins'))).toBe(false);
  });

  it.each(['null', '{"name":"team-tools"}'])(
    'refuses an existing marketplace without a plugins list: %s',
    (text) => {
      const marketplacePath = join(outDir, '.agents', 'plugins', 'marketplace.json');
      mkdirSync(join(outDir, '.agents', 'plugins'), { recursive: true });
      writeFileSync(marketplacePath, text);
      expect(() => buildPlugin({ ...PUBLIC, outDir })).toThrow(
        'expected an object with a plugins list',
      );
    },
  );

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
      'gitlab-sw': { type: 'streamable-http', url: 'http://localhost:3333/mcp' },
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

describe('buildPlugin from a minimal package', () => {
  let root: string;

  /** A package root with only the files the build reads. */
  function writePackage(pkg: Record<string, unknown>): void {
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    cpSync(join(ROOT, 'plugin', 'schemas'), join(root, 'plugin', 'schemas'), { recursive: true });
    cpSync(join(ROOT, 'plugin', 'assets'), join(root, 'plugin', 'assets'), { recursive: true });
    mkdirSync(join(root, 'skills', 'gitlab-setup'), { recursive: true });
    cpSync(
      join(ROOT, 'skills', 'gitlab-setup', 'SKILL.md'),
      join(root, 'skills', 'gitlab-setup', 'SKILL.md'),
    );
    // Neither a stray file nor a folder without SKILL.md is a skill.
    writeFileSync(join(root, 'skills', 'README.md'), '# Skills\n');
    mkdirSync(join(root, 'skills', 'drafts'));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gitlab-mcp-root-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('takes links from string fields and the npm homepage when there is no mcp block', () => {
    writePackage({
      name: '@structured-world/gitlab-mcp',
      version: '1.2.3',
      description: 'GitLab tools',
      author: 'Jane Doe',
      license: 'Apache-2.0',
      homepage: 'https://docs.example.com',
      repository: 'https://github.example.com/acme/gitlab-mcp',
      bugs: 'https://github.example.com/acme/gitlab-mcp/issues',
    });
    const result = buildPlugin({ ...PUBLIC, outDir, packageRoot: root });

    // Only the listed images are packaged: the SVG sources stay out.
    expect(result.files).toEqual([
      'assets/composer-icon-dark.png',
      'assets/composer-icon.png',
      'assets/logo.png',
      'assets/screenshot-1.png',
      'assets/screenshot-2.png',
      'mcp.json',
      'plugin.json',
      'skills/gitlab-setup/SKILL.md',
    ]);
    const manifest = readJson(join(result.pluginDir, 'plugin.json'));
    expect(manifest).toMatchObject({
      version: '1.2.3',
      author: { name: 'Jane Doe', url: 'https://docs.example.com' },
      homepage: 'https://docs.example.com',
      repository: 'https://github.example.com/acme/gitlab-mcp',
    });
    const ui = (manifest.extensions as Record<string, Record<string, Record<string, unknown>>>)[
      'com.openai'
    ].interface;
    expect(ui.supportURL).toBe('https://github.example.com/acme/gitlab-mcp/issues');
  });

  it('lists the missing author and links of a package.json without them', () => {
    writePackage({ name: '@structured-world/gitlab-mcp', version: '1.2.3', description: 'x' });
    let error: unknown;
    try {
      buildPlugin({ ...PUBLIC, outDir, packageRoot: root });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PluginValidationError);
    expect((error as PluginValidationError).issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['author.name is required', 'interface.websiteURL is required']),
    );
  });

  it('refuses a package.json without a version', () => {
    writePackage({ name: '@structured-world/gitlab-mcp' });
    expect(() => buildPlugin({ ...PUBLIC, outDir, packageRoot: root })).toThrow(
      'package.json has no version',
    );
  });
});

describe('findPackageRoot', () => {
  it('finds the core package from a nested directory', () => {
    expect(findPackageRoot(join(ROOT, 'src', 'cli', 'plugin'))).toBe(ROOT);
  });

  it('fails outside the package', () => {
    expect(() => findPackageRoot(tmpdir())).toThrow('Cannot locate the');
  });

  it('walks past the package.json of another package', () => {
    const other = mkdtempSync(join(tmpdir(), 'other-package-'));
    try {
      writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'other' }));
      expect(() => findPackageRoot(other)).toThrow('Cannot locate the');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
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
