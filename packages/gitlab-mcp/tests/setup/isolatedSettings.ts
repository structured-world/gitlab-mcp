/**
 * Settings a test reads or saves through the local settings file go to a temporary file,
 * never the user's own ~/.config/gitlab-mcp/settings.json. A test file that mocks the
 * settings store itself replaces this.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockIsolatedSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-mcp-settings-'));

jest.mock('../../src/configuration/settings-store', () => ({
  ...jest.requireActual('../../src/configuration/settings-store'),
  localSettingsPath: () => `${mockIsolatedSettingsDir}/settings.json`,
}));

afterAll(() => {
  fs.rmSync(mockIsolatedSettingsDir, { recursive: true, force: true });
});
