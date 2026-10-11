/**
 * Settings a test reads or saves through the local settings directory go to a temporary
 * directory, never the user's own ~/.config/gitlab-mcp/settings. A test file that mocks the
 * settings store itself replaces this.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mockIsolatedSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-mcp-settings-'));

jest.mock('../../src/configuration/settings-store', () => ({
  ...jest.requireActual('../../src/configuration/settings-store'),
  localSettingsDir: () => `${mockIsolatedSettingsDir}/settings`,
}));

afterAll(() => {
  fs.rmSync(mockIsolatedSettingsDir, { recursive: true, force: true });
});
