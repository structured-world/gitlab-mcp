import * as fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { installRooCode } from '../../../../src/cli/install/installers';

jest.mock('fs');
jest.mock('../../../../src/cli/install/backup', () => ({
  createBackup: jest.fn(() => ({ created: false })),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Roo Code global installation', () => {
  const platform = process.platform;
  const appData = process.env.APPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    if (appData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = appData;
    jest.clearAllMocks();
  });

  // Prevent successful installs into an unused home-level .roo file on any supported OS.
  test.each([
    ['darwin', join(homedir(), 'Library/Application Support/Code/User/globalStorage')],
    ['linux', join(homedir(), '.config/Code/User/globalStorage')],
    ['win32', 'C:/Profiles/test/AppData/Roaming/Code/User/globalStorage'],
  ])('writes the active default VS Code extension configuration on %s', (os, storage) => {
    Object.defineProperty(process, 'platform', { value: os });
    process.env.APPDATA = 'C:/Profiles/test/AppData/Roaming';
    const expected = `${storage}/rooveterinaryinc.roo-cline/settings/mcp_settings.json`;
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
