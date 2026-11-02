import * as fs from 'fs';
import { homedir } from 'os';
import { dirname, join, normalize } from 'path';
import { installRooCode } from '../../../../src/cli/install/installers';
import { detectClient } from '../../../../src/cli/install/detector';

jest.mock('fs');
jest.mock('../../../../src/cli/install/backup', () => ({
  createBackup: jest.fn(() => ({ created: false })),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Roo Code global installation', () => {
  const platform = process.platform;
  const appData = process.env.APPDATA;
  const configHome = process.env.XDG_CONFIG_HOME;
  const vscodeAppData = process.env.VSCODE_APPDATA;

  beforeEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.VSCODE_APPDATA;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    if (appData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appData;
    if (configHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = configHome;
    if (vscodeAppData === undefined) delete process.env.VSCODE_APPDATA;
    else process.env.VSCODE_APPDATA = vscodeAppData;
    jest.clearAllMocks();
  });

  // A relocated VS Code config directory must be the file the installer preserves and updates.
  it('honors the Linux XDG configuration directory', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.XDG_CONFIG_HOME = '/custom/config';
    const expected =
      '/custom/config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json';
    mockedFs.existsSync.mockImplementation((path) => String(path) === expected);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }),
    );

    const result = installRooCode({ command: 'node', args: ['server.js'], env: {} });

    expect(result.success).toBe(true);
    expect(result.configPath).toBe(expected);
    const written = JSON.parse(mockedFs.writeFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.other).toEqual({ command: 'other-server' });
    expect(written.mcpServers.gitlab).toEqual({ command: 'node', args: ['server.js'] });
  });

  // VS Code's application-data override wins over platform defaults for detection and writes.
  test.each(['linux', 'darwin', 'win32'])(
    'uses VSCODE_APPDATA for detection and installation on %s',
    (os) => {
      Object.defineProperty(process, 'platform', { value: os });
      process.env.XDG_CONFIG_HOME = join(homedir(), 'unused-config');
      process.env.VSCODE_APPDATA = join(homedir(), 'custom-vscode-data');
      const expected = `${process.env.VSCODE_APPDATA}/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`;
      mockedFs.existsSync.mockImplementation(
        (path) =>
          normalize(String(path)) === normalize(expected) ||
          normalize(String(path)) === dirname(normalize(expected)),
      );
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }),
      );

      expect(detectClient('roo-code')).toMatchObject({
        detected: true,
        configExists: true,
        configPath: expected,
      });
      expect(installRooCode({ command: 'node', args: ['server.js'], env: {} })).toMatchObject({
        success: true,
        configPath: expected,
      });
      const written = JSON.parse(mockedFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.mcpServers).toEqual({
        other: { command: 'other-server' },
        gitlab: { command: 'node', args: ['server.js'] },
      });
    },
  );

  // Prevent successful installs into an unused home-level .roo file on any supported OS.
  test.each([
    ['darwin', join(homedir(), 'Library/Application Support/Code/User/globalStorage')],
    ['linux', join(homedir(), '.config/Code/User/globalStorage')],
    ['win32', 'C:/Profiles/test/AppData/Roaming/Code/User/globalStorage'],
  ])('writes the active default VS Code extension configuration on %s', (os, storage) => {
    Object.defineProperty(process, 'platform', { value: os });
    process.env.APPDATA = 'C:/Profiles/test/AppData/Roaming';
    const suffix = 'rooveterinaryinc.roo-cline/settings/mcp_settings.json';
    const expected = os === 'win32' ? `${storage}/${suffix}` : join(storage, suffix);
    const existing = { mcpServers: { other: { command: 'other-server' } } };
    mockedFs.existsSync.mockImplementation((path) => String(path) === expected);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));
    const config = { command: 'node', args: ['server.js'], env: {} };

    const result = installRooCode(config);

    expect(result.success).toBe(true);
    expect(result.configPath).toBe(expected);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expected,
      JSON.stringify(
        {
          mcpServers: {
            other: existing.mcpServers.other,
            gitlab: { command: 'node', args: ['server.js'] },
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  });
});
