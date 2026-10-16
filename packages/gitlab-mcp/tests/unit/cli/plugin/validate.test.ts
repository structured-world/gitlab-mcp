/**
 * Unit tests for plugin package validation: the Agent Plugins schemas and the
 * directory submission rules a package must meet before it is written or
 * uploaded. Each rule has a failing case that names what is wrong.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  contrastRatio,
  isNonPublicHost,
  pngSize,
  PluginFlavor,
  PluginValidationError,
  validateEndpoint,
  validatePackage,
} from '../../../../src/cli/plugin/validate';

const ROOT = join(__dirname, '../../../..');
const schemas = {
  plugin: JSON.parse(
    readFileSync(join(ROOT, 'plugin/schemas/plugin.schema.json'), 'utf8'),
  ) as object,
  mcp: JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/mcp.schema.json'), 'utf8')) as object,
};

/** A PNG header with only the IHDR dimensions, which is all validation reads. */
function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

const SKILL =
  '---\nname: gitlab-setup\ndescription: Diagnose the GitLab connection.\n---\n\n# Setup\n';

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'gitlab-mcp',
    version: '1.2.3',
    description: 'GitLab tools',
    author: { name: 'Example', url: 'https://example.com' },
    homepage: 'https://example.com',
    extensions: {
      'com.openai': {
        onboardingSkill: './skills/gitlab-setup/SKILL.md',
        interface: {
          displayName: 'GitLab MCP',
          shortDescription: 'GitLab projects, MRs and CI',
          longDescription: 'Work with GitLab.',
          developerName: 'Example',
          category: 'Developer Tools',
          capabilities: ['Read'],
          defaultPrompt: ['List my merge requests'],
          brandColor: '#6B4FBB',
          websiteURL: 'https://example.com',
          supportURL: 'https://example.com/support',
          privacyPolicyURL: 'https://example.com/privacy',
          termsOfServiceURL: 'https://example.com/terms',
          composerIcon: './assets/logo.png',
          logo: './assets/logo.png',
          screenshots: [],
        },
      },
    },
    ...overrides,
  };
}

function ui(m: Record<string, unknown>): Record<string, unknown> {
  return (m.extensions as Record<string, Record<string, Record<string, unknown>>>)['com.openai']
    .interface;
}

function packageFiles(
  m: Record<string, unknown> = manifest(),
  servers: Record<string, unknown> = {
    gitlab: { type: 'streamable-http', url: 'https://mcp.example.com/mcp' },
  },
): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ['plugin.json', Buffer.from(JSON.stringify(m))],
    [
      'mcp.json',
      Buffer.from(
        JSON.stringify({
          $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
          mcpServers: servers,
        }),
      ),
    ],
    ['assets/logo.png', png(420, 420)],
    ['skills/gitlab-setup/SKILL.md', Buffer.from(SKILL)],
  ]);
}

function issuesOf(files: Map<string, Buffer>, flavor: PluginFlavor = 'public'): string[] {
  try {
    validatePackage(files, schemas, flavor);
  } catch (error) {
    if (error instanceof PluginValidationError) {
      return error.issues.map((i) => `${i.file}: ${i.message}`);
    }
    throw error;
  }
  return [];
}

describe('validateEndpoint', () => {
  it('accepts a public HTTPS endpoint for a public package', () => {
    expect(validateEndpoint('https://mcp.example.com/mcp', 'public').href).toBe(
      'https://mcp.example.com/mcp',
    );
  });

  it('accepts plain HTTP on loopback only for a private package', () => {
    expect(validateEndpoint('http://127.0.0.1:3333/mcp', 'private').port).toBe('3333');
    expect(validateEndpoint('http://localhost:3333/mcp', 'private').hostname).toBe('localhost');
    expect(() => validateEndpoint('http://localhost:3333/mcp', 'public')).toThrow(
      'Public endpoint must use HTTPS',
    );
  });

  it('refuses plain HTTP to a non-loopback host even in a private package', () => {
    expect(() => validateEndpoint('http://mcp.example.com/mcp', 'private')).toThrow(
      'plain HTTP is accepted only on loopback',
    );
  });

  it.each([
    'https://10.1.2.3/mcp',
    'https://192.168.1.10/mcp',
    'https://172.20.0.1/mcp',
    'https://localhost/mcp',
    'https://gitlab-mcp/mcp',
    'https://mcp.corp.internal/mcp',
    'https://[fd00::1]/mcp',
  ])('refuses the non-public host of %s for a public package', (url) => {
    expect(() => validateEndpoint(url, 'public')).toThrow('not publicly reachable');
  });

  it('accepts a private HTTPS host for a private package', () => {
    expect(validateEndpoint('https://mcp.corp.internal/mcp', 'private').hostname).toBe(
      'mcp.corp.internal',
    );
  });

  it('refuses credentials, queries and fragments that would leak into the package', () => {
    expect(() => validateEndpoint('https://user:pw@mcp.example.com/mcp', 'private')).toThrow(
      'must not embed credentials',
    );
    expect(() => validateEndpoint('https://mcp.example.com/mcp?token=abc', 'private')).toThrow(
      'must not carry a query or fragment',
    );
    expect(() => validateEndpoint('https://mcp.example.com/mcp#x', 'private')).toThrow(
      'must not carry a query or fragment',
    );
  });

  it('refuses a value that is not a URL', () => {
    expect(() => validateEndpoint('mcp.example.com', 'private')).toThrow('not a valid URL');
  });
});

describe('isNonPublicHost', () => {
  it('treats public names and addresses as public', () => {
    expect(isNonPublicHost('mcp.example.com')).toBe(false);
    expect(isNonPublicHost('8.8.8.8')).toBe(false);
    expect(isNonPublicHost('2001:db8::1')).toBe(false);
  });

  it('treats carrier-grade NAT and link-local ranges as non-public', () => {
    expect(isNonPublicHost('100.64.0.1')).toBe(true);
    expect(isNonPublicHost('169.254.1.1')).toBe(true);
    expect(isNonPublicHost('fe80::1')).toBe(true);
  });
});

describe('contrastRatio and pngSize', () => {
  it('computes the WCAG ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#6B4FBB', '#FFFFFF')).toBeGreaterThan(6);
  });

  it('reads PNG dimensions and rejects other data', () => {
    expect(pngSize(png(48, 64))).toEqual({ width: 48, height: 64 });
    expect(pngSize(Buffer.from('<svg/>'))).toBeUndefined();
  });
});

describe('validatePackage', () => {
  it('accepts a complete public package', () => {
    expect(issuesOf(packageFiles())).toEqual([]);
  });

  it('reports a schema violation in plugin.json', () => {
    expect(issuesOf(packageFiles(manifest({ unknownField: true })))).toContain(
      'plugin.json: / must NOT have additional properties',
    );
  });

  it('requires the four listing URLs for a public package but not for a private one', () => {
    const m = manifest();
    delete ui(m).privacyPolicyURL;
    delete ui(m).termsOfServiceURL;
    expect(issuesOf(packageFiles(m))).toEqual([
      'plugin.json: interface.privacyPolicyURL is required',
      'plugin.json: interface.termsOfServiceURL is required',
    ]);
    expect(issuesOf(packageFiles(m), 'private')).toEqual([]);
  });

  it('refuses a listing URL without HTTPS or with credentials', () => {
    const m = manifest();
    ui(m).supportURL = 'http://example.com/support';
    ui(m).websiteURL = 'https://user:pw@example.com';
    expect(issuesOf(packageFiles(m))).toEqual([
      'plugin.json: interface.websiteURL must not embed credentials',
      'plugin.json: interface.supportURL must use HTTPS',
    ]);
  });

  it('enforces listing text limits', () => {
    const m = manifest();
    ui(m).displayName = 'x'.repeat(31);
    ui(m).shortDescription = '';
    expect(issuesOf(packageFiles(m))).toEqual([
      'plugin.json: interface.displayName exceeds 30 characters',
      'plugin.json: interface.shortDescription is required',
    ]);
  });

  it('refuses duplicate or too many default prompts', () => {
    const m = manifest();
    ui(m).defaultPrompt = ['a', 'a'];
    expect(issuesOf(packageFiles(m))).toEqual([
      'plugin.json: interface.defaultPrompt: up to 3 unique prompts of 128 characters',
    ]);
  });

  it('refuses a brand color without 2:1 contrast against white', () => {
    const m = manifest();
    ui(m).brandColor = '#EEEEEE';
    expect(issuesOf(packageFiles(m))).toEqual([
      'plugin.json: interface.brandColor needs 2:1 contrast against white',
    ]);
  });

  it('refuses a non-semantic version', () => {
    expect(issuesOf(packageFiles(manifest({ version: 'latest' })))).toEqual([
      'plugin.json: version must be an explicit x.y.z version',
    ]);
  });

  it('refuses icons that are missing, not square or too small', () => {
    const missing = packageFiles();
    missing.delete('assets/logo.png');
    expect(issuesOf(missing)).toEqual([
      'plugin.json: interface.logo does not resolve inside the package',
      'plugin.json: interface.composerIcon does not resolve inside the package',
    ]);

    const oblong = packageFiles();
    oblong.set('assets/logo.png', png(400, 300));
    expect(issuesOf(oblong)).toContain('assets/logo.png: icon must be square, got 400x300');

    const tiny = packageFiles();
    tiny.set('assets/logo.png', png(32, 32));
    expect(issuesOf(tiny)).toContain('assets/logo.png: icon must be at least 48 px');
  });

  it('accepts a wide screenshot but refuses one over 4096 px', () => {
    const m = manifest();
    ui(m).screenshots = ['./assets/shot.png'];
    const files = packageFiles(m);
    files.set('assets/shot.png', png(1600, 1000));
    expect(issuesOf(files)).toEqual([]);
    files.set('assets/shot.png', png(5000, 1000));
    expect(issuesOf(files)).toEqual(['assets/shot.png: image exceeds 4096 px']);
  });

  it('refuses hooks and app references in the package', () => {
    const files = packageFiles();
    files.set('hooks/hooks.json', Buffer.from('{}'));
    files.set('.app.json', Buffer.from('{}'));
    expect(issuesOf(files)).toEqual([
      'hooks/hooks.json: not allowed in a directory submission',
      '.app.json: not allowed in a directory submission',
    ]);
  });

  it('finds a token, a local path and a private URL in shipped text', () => {
    const files = packageFiles();
    files.set(
      'skills/gitlab-setup/SKILL.md',
      Buffer.from(
        `${SKILL}Use glpat-abcdefghijklmnopqrstuvwx from /Users/someone/.env at http://10.0.0.5/api\n`,
      ),
    );
    expect(issuesOf(files)).toEqual([
      'skills/gitlab-setup/SKILL.md: contains a GitLab token',
      'skills/gitlab-setup/SKILL.md: contains a local absolute path',
      'skills/gitlab-setup/SKILL.md: references a non-public URL: http://10.0.0.5/api',
    ]);
  });

  it('allows a private URL in a private package', () => {
    const files = packageFiles(manifest(), {
      gitlab: { type: 'streamable-http', url: 'https://mcp.corp.internal/mcp' },
    });
    expect(issuesOf(files, 'private')).toEqual([]);
    expect(issuesOf(files, 'public')).toContain(
      'mcp.json: gitlab: Public endpoint host is not publicly reachable: mcp.corp.internal',
    );
  });

  it('requires exactly one MCP server and no headers', () => {
    const files = packageFiles(manifest(), {
      gitlab: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      },
      other: { type: 'streamable-http', url: 'https://other.example.com/mcp' },
    });
    expect(issuesOf(files)).toEqual([
      'mcp.json: must declare exactly one MCP server',
      'mcp.json: gitlab must not declare headers',
    ]);
  });

  it('requires skill front matter with a name and description', () => {
    const files = packageFiles();
    files.set('skills/gitlab-ci/SKILL.md', Buffer.from('# No header\n'));
    files.set('skills/gitlab-review/SKILL.md', Buffer.from('---\nname: review\n---\n'));
    expect(issuesOf(files)).toEqual([
      'skills/gitlab-ci/SKILL.md: SKILL.md has no YAML front matter',
      'skills/gitlab-review/SKILL.md: SKILL.md front matter needs a description',
    ]);
  });

  it('requires at least one skill and an included onboarding skill', () => {
    const files = packageFiles();
    files.delete('skills/gitlab-setup/SKILL.md');
    expect(issuesOf(files)).toEqual([
      'skills/: package has no skills',
      'plugin.json: onboardingSkill is not an included skill',
    ]);
  });

  it('reports a missing or unreadable manifest', () => {
    const files = packageFiles();
    files.set('plugin.json', Buffer.from('{not json'));
    files.delete('mcp.json');
    expect(issuesOf(files)).toEqual(['plugin.json: not valid JSON', 'mcp.json: missing']);
  });
});
