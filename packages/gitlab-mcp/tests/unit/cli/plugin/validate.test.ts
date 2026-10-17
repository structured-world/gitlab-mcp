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
          displayName: 'GitLab by Example',
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

  it('refuses plain HTTP to a DNS name that only looks like a loopback address', () => {
    // 127.example.com resolves through DNS to wherever its owner points it.
    expect(() => validateEndpoint('http://127.example.com/mcp', 'private')).toThrow(
      'plain HTTP is accepted only on loopback',
    );
    expect(validateEndpoint('http://127.1.2.3/mcp', 'private').hostname).toBe('127.1.2.3');
    expect(validateEndpoint('http://[::1]:3333/mcp', 'private').port).toBe('3333');
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
    expect(isNonPublicHost('2606:4700:4700::1111')).toBe(false);
  });

  it.each([
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.19.255.254',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '2001:db8::1',
    'ff02::1',
  ])('treats the reserved address %s as non-public', (host) => {
    // Documentation, benchmarking, multicast and reserved blocks never reach the internet.
    expect(isNonPublicHost(host)).toBe(true);
  });

  it('ignores the trailing root dot of an absolute DNS name', () => {
    // "localhost." and "localhost" name the same host (RFC 1034 3.1).
    expect(isNonPublicHost('localhost.')).toBe(true);
    expect(isNonPublicHost('service.local.')).toBe(true);
    expect(isNonPublicHost('mcp.example.com.')).toBe(false);
    expect(() => validateEndpoint('https://localhost./mcp', 'public')).toThrow(
      'not publicly reachable',
    );
  });

  it('keeps the public neighbours of reserved blocks public', () => {
    for (const host of [
      '192.0.3.1',
      '198.17.255.1',
      '198.20.0.1',
      '203.0.114.1',
      '223.255.255.1',
    ]) {
      expect(isNonPublicHost(host)).toBe(false);
    }
  });

  it('treats carrier-grade NAT and link-local ranges as non-public', () => {
    expect(isNonPublicHost('100.64.0.1')).toBe(true);
    expect(isNonPublicHost('169.254.1.1')).toBe(true);
    expect(isNonPublicHost('fe80::1')).toBe(true);
  });

  it('judges an IPv4-mapped IPv6 host by the IPv4 address it carries', () => {
    // URL canonicalizes [::ffff:8.8.8.8] to the hex form [::ffff:808:808].
    expect(isNonPublicHost(new URL('https://[::ffff:8.8.8.8]/').hostname)).toBe(false);
    expect(isNonPublicHost(new URL('https://[::ffff:192.168.1.1]/').hostname)).toBe(true);
    expect(isNonPublicHost(new URL('https://[::ffff:127.0.0.1]/').hostname)).toBe(true);
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

  it.each(['GitLab MCP', 'GitLab MCP Server', 'GitLab mcp server', 'GitLab Plugin'])(
    'refuses the display name %s in a public package only',
    (name) => {
      // The directory guidelines forbid these suffixes on a product name.
      const m = manifest();
      ui(m).displayName = name;
      expect(issuesOf(packageFiles(m))).toEqual([
        'plugin.json: interface.displayName must not end with "MCP", "MCP Server" or "Plugin"',
      ]);
      expect(issuesOf(packageFiles(m), 'private')).toEqual([]);
    },
  );

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

  it.each(['latest', '1.2', '01.2.3', '1.2.3-', '1.2.3-01'])(
    'refuses the non-semantic version %s',
    (version) => {
      expect(issuesOf(packageFiles(manifest({ version })))).toEqual([
        'plugin.json: version must be a Semantic Versioning 2.0.0 version',
      ]);
    },
  );

  it.each(['11.0.0', '11.0.0-rc.1', '11.0.0+ci.5', '1.2.3-beta+7'])(
    'accepts the semantic version %s, prerelease and build metadata included',
    (version) => {
      expect(issuesOf(packageFiles(manifest({ version })))).toEqual([]);
    },
  );

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

  it('refuses a listing URL that does not parse or is too long', () => {
    const m = manifest();
    ui(m).supportURL = 'not a url';
    ui(m).websiteURL = `https://example.com/${'a'.repeat(1024)}`;
    expect(issuesOf(packageFiles(m))).toEqual(
      expect.arrayContaining([
        'plugin.json: interface.websiteURL exceeds 1024 characters',
        'plugin.json: interface.supportURL is not a valid URL',
      ]),
    );
  });

  it('refuses a malformed brand color and invalid capabilities', () => {
    const m = manifest();
    ui(m).brandColor = 'purple';
    ui(m).capabilities = Array.from({ length: 21 }, (_, i) => `c${i}`);
    expect(issuesOf(packageFiles(m))).toEqual(
      expect.arrayContaining([
        'plugin.json: interface.capabilities: up to 20 strings',
        'plugin.json: interface.brandColor must be #RRGGBB',
      ]),
    );
  });

  it('refuses an icon that is not a PNG, is over 5 MiB or is not named', () => {
    const notPng = packageFiles();
    notPng.set('assets/logo.png', Buffer.from('<svg/>'));
    expect(issuesOf(notPng)).toContain('assets/logo.png: asset must be a PNG');

    const huge = packageFiles();
    huge.set('assets/logo.png', Buffer.concat([png(420, 420), Buffer.alloc(5 * 1024 * 1024)]));
    expect(issuesOf(huge)).toContain('assets/logo.png: asset exceeds 5 MiB');

    const m = manifest();
    delete ui(m).logo;
    expect(issuesOf(packageFiles(m))).toContain('plugin.json: interface.logo is required');
  });

  it('reports skill front matter that is not valid YAML', () => {
    const files = packageFiles();
    files.set('skills/gitlab-ci/SKILL.md', Buffer.from('---\nname: [unclosed\n---\n'));
    expect(issuesOf(files)).toEqual([
      'skills/gitlab-ci/SKILL.md: SKILL.md front matter is not valid YAML',
    ]);
  });

  it('finds a bracketed IPv6 loopback URL in shipped text', () => {
    const files = packageFiles();
    files.set('skills/gitlab-setup/SKILL.md', Buffer.from(`${SKILL}Open https://[::1]/privacy\n`));
    expect(issuesOf(files)).toEqual([
      'skills/gitlab-setup/SKILL.md: references a non-public URL: https://[::1]/privacy',
    ]);
  });

  it('accepts listing URLs whose path contains home or Users', () => {
    // Only a filesystem path ties a file to one machine, not a web path segment.
    const m = manifest();
    ui(m).privacyPolicyURL = 'https://operator.example/home/privacy';
    ui(m).termsOfServiceURL = 'https://operator.example/Users/terms';
    expect(issuesOf(packageFiles(m))).toEqual([]);
  });

  it('still finds a local path written after a space, a quote or a file URL', () => {
    const files = packageFiles();
    files.set(
      'skills/gitlab-setup/SKILL.md',
      Buffer.from(`${SKILL}Logs in "C:\\Users\\dev\\log" and file:///home/dev/log\n`),
    );
    expect(issuesOf(files)).toEqual([
      'skills/gitlab-setup/SKILL.md: contains a local absolute path',
    ]);
  });

  it.each(['null', '42', '[]'])('reports a manifest that is %s rather than an object', (text) => {
    const files = packageFiles();
    files.set('plugin.json', Buffer.from(text));
    expect(issuesOf(files)).toEqual(['plugin.json: must be a JSON object']);
  });

  it('skips URL-like text that does not parse as a URL', () => {
    const files = packageFiles();
    files.set(
      'skills/gitlab-setup/SKILL.md',
      Buffer.from(`${SKILL}See https://[bad for details\n`),
    );
    expect(issuesOf(files)).toEqual([]);
  });

  it('reports a missing or unreadable manifest', () => {
    const files = packageFiles();
    files.set('plugin.json', Buffer.from('{not json'));
    files.delete('mcp.json');
    expect(issuesOf(files)).toEqual(['plugin.json: not valid JSON', 'mcp.json: missing']);
  });
});
