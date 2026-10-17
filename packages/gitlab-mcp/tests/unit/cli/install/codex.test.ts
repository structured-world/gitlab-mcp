/**
 * Unit tests for the Codex installer. The Codex CLI is replaced by a scripted
 * fake that keeps its own server table, so each test checks both the commands
 * issued and the state they leave; config.toml is a real file in a temporary
 * CODEX_HOME so backup and rollback act on disk.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sync as spawnSync } from 'cross-spawn';
import * as backup from '../../../../src/cli/install/backup';
import {
  CodexServer,
  codexConfigPath,
  codexConfigPreview,
  installCodex,
  isGitlabMcpServer,
  tomlString,
} from '../../../../src/cli/install/codex';

jest.mock('cross-spawn', () => ({ sync: jest.fn() }));
const mockSpawn = spawnSync as jest.MockedFunction<typeof spawnSync>;

const STDIO = {
  command: 'npx',
  args: ['-y', '@structured-world/gitlab-mcp'],
  env: { GITLAB_API_URL: 'https://gitlab.example.com', GITLAB_TOKEN: 'secret value' },
};
const REMOTE = { url: 'https://mcp.example.com/mcp' };

interface FakeCodex {
  /** What `mcp list` reports: global entries and those plugins provide. */
  servers: CodexServer[];
  calls: Array<{ args: string[]; stdio: unknown }>;
  failAdd?: { status: number; stderr: string; keepEntry?: boolean };
  failRemove?: boolean;
  failList?: string;
  /** Transport Codex saves instead of the requested one. */
  saveAs?: CodexServer['transport'];
  /** Raw stdout of a successful `mcp get`, replacing the saved entry. */
  getOutput?: string;
  /** Codex rewrites config.toml on remove; tests use this to change the file. */
  onRemove?: () => void;
}

/** The config.toml table of a global entry, the only place `mcp remove` edits. */
function globalTable(name: string): string {
  return `[mcp_servers.${name}]\ncommand = "old"\n`;
}

function configFile(): string {
  return join(codexHome, 'config.toml');
}

function readConfig(): string {
  return existsSync(configFile()) ? readFileSync(configFile(), 'utf8') : '';
}

function hasTable(name: string): boolean {
  return readConfig().includes(`[mcp_servers.${name}]`);
}

let codexHome: string;
let fake: FakeCodex;
const originalHome = process.env.CODEX_HOME;

function reply(status: number, stdout = '', stderr = '') {
  return { status, stdout, stderr, pid: 1, output: [], signal: null } as unknown as ReturnType<
    typeof spawnSync
  >;
}

function transportOf(args: string[]): CodexServer['transport'] {
  const url = args.indexOf('--url');
  if (url !== -1) return { type: 'streamable_http', url: args[url + 1] };
  const separator = args.indexOf('--');
  const env: Record<string, string> = {};
  for (let i = 0; i < separator; i++) {
    if (args[i] === '--env') {
      const [key, ...rest] = args[i + 1].split('=');
      env[key] = rest.join('=');
    }
  }
  return {
    type: 'stdio',
    command: args[separator + 1],
    args: args.slice(separator + 2),
    env,
  };
}

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
  process.env.CODEX_HOME = codexHome;
  fake = { servers: [], calls: [] };
  mockSpawn.mockReset();
  mockSpawn.mockImplementation((command, rawArgs, options) => {
    const args = [...(rawArgs ?? [])];
    expect(command).toBe('codex');
    fake.calls.push({ args, stdio: options?.stdio });
    const [, action, name] = args;
    switch (action) {
      case 'list':
        return fake.failList ? reply(1, '', fake.failList) : reply(0, JSON.stringify(fake.servers));
      case 'get': {
        const server = fake.servers.find((s) => s.name === name);
        if (!server) return reply(1, '', `No MCP server named '${name}' found.`);
        return reply(0, fake.getOutput ?? JSON.stringify(server));
      }
      case 'remove':
        if (fake.failRemove) return reply(1, '', 'permission denied');
        // Like Codex, an entry missing from config.toml is reported, not an error.
        if (!hasTable(name)) return reply(0, `No MCP server named '${name}' found.`);
        fake.onRemove?.();
        writeFileSync(configFile(), readConfig().replace(globalTable(name), ''));
        fake.servers = fake.servers.filter((s) => s.name !== name);
        return reply(0, `Removed global MCP server '${name}'.`);
      case 'add':
        if (fake.failAdd && !fake.failAdd.keepEntry) {
          return reply(fake.failAdd.status, '', fake.failAdd.stderr);
        }
        if (!hasTable(name)) writeFileSync(configFile(), readConfig() + globalTable(name));
        fake.servers = fake.servers.filter((s) => s.name !== name);
        fake.servers.push({ name, transport: fake.saveAs ?? transportOf(args) });
        return fake.failAdd
          ? reply(fake.failAdd.status, '', fake.failAdd.stderr)
          : reply(0, `Added global MCP server '${name}'.`);
      default:
        throw new Error(`unexpected codex call: ${args.join(' ')}`);
    }
  });
});

afterEach(() => {
  rmSync(codexHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalHome;
});

function actions(): string[] {
  return fake.calls.map((c) => c.args.slice(1, 3).join(' '));
}

describe('codexConfigPath', () => {
  it('follows CODEX_HOME', () => {
    expect(codexConfigPath()).toBe(join(codexHome, 'config.toml'));
  });
});

describe('installCodex', () => {
  it('registers a local server through codex mcp add with every argument intact', () => {
    const config = { ...STDIO, command: '/Applications/My Tools/node' };
    const result = installCodex(config, false);

    expect(result).toEqual({
      client: 'codex',
      success: true,
      backupPath: undefined,
      configPath: join(codexHome, 'config.toml'),
      wasAlreadyConfigured: false,
      notes: [],
    });
    const add = fake.calls.find((c) => c.args[1] === 'add');
    expect(add?.args).toEqual([
      'mcp',
      'add',
      'gitlab',
      '--env',
      'GITLAB_API_URL=https://gitlab.example.com',
      '--env',
      'GITLAB_TOKEN=secret value',
      '--',
      '/Applications/My Tools/node',
      '-y',
      '@structured-world/gitlab-mcp',
    ]);
    expect(add?.stdio).toBe('pipe');
    expect(actions()).toEqual(['list --json', 'add gitlab', 'get gitlab']);
  });

  it('refuses to replace an existing gitlab entry without force and changes nothing', () => {
    writeFileSync(configFile(), globalTable('gitlab'));
    fake.servers = [{ name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } }];
    const result = installCodex(STDIO, false);

    expect(result.success).toBe(false);
    expect(result.wasAlreadyConfigured).toBe(true);
    expect(result.error).toBe('gitlab-mcp is already configured. Use --force to overwrite.');
    expect(actions()).toEqual(['list --json']);
    expect(fake.servers[0].transport).toEqual({ type: 'stdio', command: 'old', args: [] });
  });

  it('with force, backs up config.toml and replaces only the gitlab entry', () => {
    const original = `model = "o3"\n${globalTable('gitlab')}`;
    writeFileSync(configFile(), original);
    fake.servers = [
      { name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } },
      {
        name: 'github',
        transport: { type: 'streamable_http', url: 'https://api.github.example/mcp' },
      },
    ];
    const result = installCodex(STDIO, true);

    expect(result.success).toBe(true);
    expect(result.wasAlreadyConfigured).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(readFileSync(result.backupPath as string, 'utf8')).toBe(original);
    expect(actions()).toEqual(['list --json', 'remove gitlab', 'add gitlab', 'get gitlab']);
    expect(fake.servers.map((s) => s.name).sort()).toEqual(['github', 'gitlab']);
  });

  it('restores config.toml from the backup when the add fails after the old entry was removed', () => {
    const configPath = join(codexHome, 'config.toml');
    writeFileSync(configPath, '[mcp_servers.gitlab]\ncommand = "old"\n');
    fake.servers = [{ name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } }];
    fake.failAdd = { status: 1, stderr: 'invalid server name' };
    fake.onRemove = () => writeFileSync(configPath, '');

    const result = installCodex(STDIO, true);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'codex mcp add failed: invalid server name; the previous Codex configuration was restored',
    );
    expect(readFileSync(configPath, 'utf8')).toBe('[mcp_servers.gitlab]\ncommand = "old"\n');
  });

  it('says where the backup is when restoring it fails after the old entry was removed', () => {
    // Otherwise the user would not know the previous configuration is gone.
    writeFileSync(configFile(), globalTable('gitlab'));
    fake.servers = [{ name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } }];
    fake.failAdd = { status: 1, stderr: 'invalid server name' };
    const restoreSpy = jest.spyOn(backup, 'restoreBackup').mockReturnValueOnce(false);
    try {
      const result = installCodex(STDIO, true);
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'codex mcp add failed: invalid server name; restoring the previous Codex configuration ' +
          `failed, restore it by hand from ${result.backupPath}`,
      );
    } finally {
      restoreSpy.mockRestore();
    }
  });

  it('reports a failed add without a backup to restore', () => {
    fake.failAdd = { status: 2, stderr: 'boom' };
    const result = installCodex(STDIO, false);
    expect(result).toMatchObject({ success: false, error: 'codex mcp add failed: boom' });
    expect(readdirSync(codexHome)).toEqual([]);
  });

  it('stops when the old entry cannot be removed', () => {
    writeFileSync(configFile(), globalTable('gitlab'));
    fake.servers = [{ name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } }];
    fake.failRemove = true;
    const result = installCodex(STDIO, true);
    expect(result).toMatchObject({
      success: false,
      error: 'Failed to remove the existing gitlab entry: permission denied',
    });
    expect(actions()).toEqual(['list --json', 'remove gitlab']);
  });

  it('keeps the duplicate-registration notes when the old entry cannot be removed', () => {
    writeFileSync(configFile(), globalTable('gitlab'));
    fake.servers = [
      { name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } },
      {
        name: 'gl',
        transport: { type: 'stdio', command: 'npx', args: ['@structured-world/gitlab-mcp'] },
      },
    ];
    fake.failRemove = true;
    const result = installCodex(STDIO, true);
    expect(result.success).toBe(false);
    expect(result.notes).toEqual([
      '"gl" also runs GitLab MCP, so Codex lists its tools twice; remove the one you do not use (codex mcp remove gl, or disable the plugin).',
    ]);
  });

  it('leaves the existing entry alone when config.toml cannot be backed up', () => {
    // Without a backup a failed add after the remove could not be undone.
    writeFileSync(join(codexHome, 'config.toml'), '[mcp_servers.gitlab]\ncommand = "old"\n');
    fake.servers = [{ name: 'gitlab', transport: { type: 'stdio', command: 'old', args: [] } }];
    // Simulated rather than provoked with chmod, which Windows does not honour.
    const backupSpy = jest
      .spyOn(backup, 'createBackup')
      .mockReturnValueOnce({ created: false, error: 'ENOSPC: no space left on device' });
    try {
      const result = installCodex(STDIO, true);
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        `Could not back up ${join(codexHome, 'config.toml')}: ENOSPC: no space left on device`,
      );
      expect(actions()).toEqual(['list --json']);
      expect(fake.servers[0].transport).toEqual({ type: 'stdio', command: 'old', args: [] });
    } finally {
      backupSpy.mockRestore();
    }
  });

  it('fails when Codex saved the entry without the requested environment', () => {
    mockSpawn.mockImplementation((_c, rawArgs) => {
      const args = [...(rawArgs ?? [])];
      if (args[1] === 'list') return reply(0, '[]');
      if (args[1] === 'add') return reply(0, 'ok');
      return reply(
        0,
        JSON.stringify({
          name: 'gitlab',
          transport: {
            type: 'stdio',
            command: STDIO.command,
            args: STDIO.args,
            env: { GITLAB_API_URL: 'https://gitlab.example.com' },
          },
        }),
      );
    });
    expect(installCodex(STDIO, false)).toMatchObject({ success: false });
  });

  it('accepts a saved entry without an env table when none was requested', () => {
    mockSpawn.mockImplementation((_c, rawArgs) => {
      const args = [...(rawArgs ?? [])];
      if (args[1] === 'list') return reply(0, '[]');
      if (args[1] === 'add') return reply(0, 'ok');
      return reply(
        0,
        JSON.stringify({
          name: 'gitlab',
          transport: { type: 'stdio', command: 'npx', args: ['x'], env: null },
        }),
      );
    });
    expect(installCodex({ command: 'npx', args: ['x'], env: {} }, false).success).toBe(true);
  });

  it('removes a partly saved new entry when there was no configuration to restore', () => {
    // Codex saved the entry with the wrong arguments and no config.toml existed before.
    fake.saveAs = { type: 'stdio', command: 'npx', args: [] };
    fake.failAdd = { status: 1, stderr: 'interrupted', keepEntry: true };
    const result = installCodex(STDIO, false);
    expect(result).toMatchObject({
      success: false,
      error: 'codex mcp add failed: interrupted; the partly saved gitlab entry was removed',
    });
    expect(actions()).toEqual(['list --json', 'add gitlab', 'get gitlab', 'remove gitlab']);
    expect(hasTable('gitlab')).toBe(false);
  });

  it('removes a new entry whose read-back output cannot be parsed', () => {
    // add wrote the entry before get could confirm it, so it must not outlive the failure.
    fake.getOutput = 'gitlab: stdio npx';
    const result = installCodex(STDIO, false);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('; the partly saved gitlab entry was removed') as string,
    });
    expect(hasTable('gitlab')).toBe(false);
  });

  it('stops with the parser message when config.toml is not valid TOML', () => {
    writeFileSync(configFile(), 'model = \n');
    const result = installCodex(STDIO, true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      new RegExp(`^Cannot read ${configFile().replace(/[.\\/]/g, '\\$&')}: `),
    );
    expect(actions()).toEqual(['list --json']);
  });

  it('treats a config.toml whose mcp_servers is not a table as having no gitlab entry', () => {
    writeFileSync(configFile(), 'mcp_servers = "none"\n');
    expect(installCodex(STDIO, false).success).toBe(true);
  });

  it('does not take over a gitlab server that a plugin or project configuration provides', () => {
    // mcp remove edits only the global config.toml, so a forced replace would only shadow it.
    fake.servers = [{ name: 'gitlab', transport: { type: 'streamable_http', url: REMOTE.url } }];
    const result = installCodex(STDIO, true);
    expect(result).toMatchObject({
      success: false,
      error:
        'Codex already runs a server named "gitlab" from a plugin or project configuration; ' +
        'disable it there before installing.',
    });
    expect(actions()).toEqual(['list --json']);
  });

  it('fails without rolling back when another configuration disables the entry', () => {
    // A project or managed config.toml can disable the server; undoing the user's entry would not help.
    mockSpawn.mockImplementation((_c, rawArgs, options) => {
      const args = [...(rawArgs ?? [])];
      fake.calls.push({ args, stdio: options?.stdio });
      if (args[1] === 'list') return reply(0, '[]');
      if (args[1] === 'add') return reply(0, 'ok');
      return reply(
        0,
        JSON.stringify({
          name: 'gitlab',
          enabled: false,
          disabled_reason: 'disabled by /repo/.codex/config.toml',
          transport: { type: 'stdio', ...STDIO },
        }),
      );
    });
    expect(installCodex(STDIO, false)).toMatchObject({
      success: false,
      error:
        'Codex saved the gitlab entry but keeps it disabled: disabled by /repo/.codex/config.toml',
    });
    expect(actions()).toEqual(['list --json', 'add gitlab', 'get gitlab']);
  });

  it('names the missing executable when Codex is not installed', () => {
    mockSpawn.mockImplementation(
      () =>
        ({
          status: null,
          stdout: null,
          stderr: null,
          error: new Error('spawnSync codex ENOENT'),
        }) as unknown as ReturnType<typeof spawnSync>,
    );
    expect(installCodex(STDIO, false)).toMatchObject({
      success: false,
      error: 'codex mcp list failed: spawnSync codex ENOENT',
    });
  });

  it('falls back to the exit status when Codex prints nothing', () => {
    mockSpawn.mockImplementation(() => reply(1));
    expect(installCodex(STDIO, false).error).toBe('codex mcp list failed: codex exited with 1');
  });

  it('refuses a server list that is not an array', () => {
    mockSpawn.mockImplementation(() => reply(0, '{"servers":[]}'));
    expect(installCodex(STDIO, false).error).toBe('codex mcp list returned an unexpected format');
  });

  it('fails with the CLI message when the server list cannot be read', () => {
    fake.failList = 'config.toml: invalid TOML';
    expect(installCodex(STDIO, false)).toEqual({
      client: 'codex',
      success: false,
      error: 'codex mcp list failed: config.toml: invalid TOML',
    });
  });

  it('reports GitLab MCP registered under other names and leaves them in place', () => {
    fake.servers = [
      {
        name: 'gitlab-mcp',
        transport: { type: 'streamable_http', url: 'https://other.example/mcp' },
      },
      {
        name: 'gl',
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@structured-world/gitlab-mcp@9.0.0'],
        },
      },
      { name: 'github', transport: { type: 'stdio', command: 'github-mcp', args: [] } },
    ];
    const result = installCodex(STDIO, false);

    expect(result.success).toBe(true);
    expect(result.notes).toEqual([
      '"gitlab-mcp" also runs GitLab MCP, so Codex lists its tools twice; remove the one you do not use (codex mcp remove gitlab-mcp, or disable the plugin).',
      '"gl" also runs GitLab MCP, so Codex lists its tools twice; remove the one you do not use (codex mcp remove gl, or disable the plugin).',
    ]);
    expect(fake.servers.map((s) => s.name)).toEqual(['gitlab-mcp', 'gl', 'github', 'gitlab']);
  });

  it('registers a remote endpoint with the terminal attached for the browser sign-in', () => {
    const result = installCodex(REMOTE, false);
    const add = fake.calls.find((c) => c.args[1] === 'add');
    expect(add?.args).toEqual(['mcp', 'add', 'gitlab', '--url', 'https://mcp.example.com/mcp']);
    expect(add?.stdio).toBe('inherit');
    expect(result.success).toBe(true);
    expect(result.notes).toEqual([]);
  });

  it('keeps a saved remote entry and says how to finish an interrupted sign-in', () => {
    fake.failAdd = { status: 1, stderr: 'login cancelled', keepEntry: true };
    const result = installCodex(REMOTE, false);
    expect(result.success).toBe(true);
    expect(result.notes).toEqual(['Sign-in did not complete; run: codex mcp login gitlab']);
  });

  it('treats an entry with the same remote endpoint as a duplicate', () => {
    fake.servers = [{ name: 'corp', transport: { type: 'streamable_http', url: REMOTE.url } }];
    const result = installCodex(REMOTE, false);
    expect(result.notes).toHaveLength(1);
    expect(result.notes?.[0]).toContain('"corp" also runs GitLab MCP');
  });

  it('fails when Codex saved something other than what was requested', () => {
    fake.saveAs = { type: 'stdio', command: 'other', args: [] };
    // The wrong entry is new, so it is removed rather than left for the next run to trip on.
    expect(installCodex(STDIO, false)).toMatchObject({
      success: false,
      error:
        "codex mcp add failed: Added global MCP server 'gitlab'.; the partly saved gitlab entry was removed",
    });
    expect(hasTable('gitlab')).toBe(false);
  });
});

describe('isGitlabMcpServer', () => {
  it('recognizes a source checkout and the published package', () => {
    expect(
      isGitlabMcpServer({
        name: 'local',
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/home/dev/gitlab-mcp/packages/gitlab-mcp/dist/src/main.js', 'stdio'],
        },
      }),
    ).toBe(true);
    expect(
      isGitlabMcpServer({
        name: 'pkg',
        transport: {
          type: 'stdio',
          command: 'yarn',
          args: ['dlx', '@structured-world/gitlab-mcp@latest'],
        },
      }),
    ).toBe(true);
  });

  it('recognizes the globally installed executable on every platform', () => {
    for (const command of [
      'gitlab-mcp',
      '/usr/local/bin/gitlab-mcp',
      'C:\\Users\\dev\\AppData\\Roaming\\npm\\gitlab-mcp.cmd',
    ]) {
      expect(
        isGitlabMcpServer({ name: 'g', transport: { type: 'stdio', command, args: [] } }),
      ).toBe(true);
    }
  });

  it('does not claim unrelated servers', () => {
    // An unscoped package of the same name is another project, run through npx.
    expect(
      isGitlabMcpServer({
        name: 'other',
        transport: { type: 'stdio', command: 'npx', args: ['-y', 'gitlab-mcp'] },
      }),
    ).toBe(false);
    expect(
      isGitlabMcpServer({
        name: 'lite',
        transport: { type: 'stdio', command: '/usr/local/bin/gitlab-mcp-lite', args: [] },
      }),
    ).toBe(false);
    expect(
      isGitlabMcpServer({
        name: 'gitlab-ci-lint',
        transport: { type: 'stdio', command: 'npx', args: ['@other/gitlab-mcp-lite'] },
      }),
    ).toBe(false);
    expect(
      isGitlabMcpServer(
        { name: 'remote', transport: { type: 'streamable_http', url: 'https://a.example/mcp' } },
        REMOTE,
      ),
    ).toBe(false);
  });
});

describe('codex config preview', () => {
  it('escapes TOML basic strings', () => {
    expect(tomlString('C:\\Tools\\"x"\n\u0001')).toBe('"C:\\\\Tools\\\\\\"x\\"\\n\\u0001"');
  });

  it('shows the stdio entry Codex will hold', () => {
    expect(codexConfigPreview(STDIO)).toBe(
      [
        '[mcp_servers.gitlab]',
        'command = "npx"',
        'args = ["-y", "@structured-world/gitlab-mcp"]',
        '',
        '[mcp_servers.gitlab.env]',
        'GITLAB_API_URL = "https://gitlab.example.com"',
        'GITLAB_TOKEN = "secret value"',
      ].join('\n'),
    );
  });

  it('quotes environment names that are not bare TOML keys', () => {
    expect(codexConfigPreview({ command: 'x', args: [], env: { 'A.B': '1' } })).toContain(
      '"A.B" = "1"',
    );
  });

  it('shows the remote entry Codex will hold', () => {
    expect(codexConfigPreview(REMOTE)).toBe(
      '[mcp_servers.gitlab]\nurl = "https://mcp.example.com/mcp"',
    );
  });
});
