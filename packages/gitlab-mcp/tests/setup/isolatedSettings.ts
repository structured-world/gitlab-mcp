/**
 * Settings a test reads or saves through the local settings directory go to a temporary
 * directory, never the user's own ~/.config/gitlab-mcp/settings. A test file that mocks the
 * settings store itself replaces this.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Created on first use: Jest skips afterAll in a file where no test runs, so a directory
// made at load time would stay behind for every skipped suite.
let mockIsolatedSettingsDir: string | undefined;

jest.mock('../../src/configuration/settings-store', () => ({
  ...jest.requireActual('../../src/configuration/settings-store'),
  localSettingsDir: () => {
    const { mkdtempSync } = jest.requireActual<typeof fs>('node:fs');
    const { tmpdir } = jest.requireActual<typeof os>('node:os');
    const { join } = jest.requireActual<typeof path>('node:path');
    mockIsolatedSettingsDir ??= mkdtempSync(join(tmpdir(), 'gitlab-mcp-settings-'));
    return `${mockIsolatedSettingsDir}/settings`;
  },
}));

afterAll(() => {
  if (mockIsolatedSettingsDir) fs.rmSync(mockIsolatedSettingsDir, { recursive: true, force: true });
});
