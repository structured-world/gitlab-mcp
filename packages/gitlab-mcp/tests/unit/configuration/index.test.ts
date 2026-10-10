/**
 * The process configuration service picks where settings live from the deployment: the
 * session storage shared by replicas under OAuth or a configured storage, otherwise the
 * local settings file. Account changes notify the account's sessions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let mockOAuth = false;
jest.mock('../../../src/oauth/config', () => ({
  isOAuthEnabled: () => mockOAuth,
}));

let mockBackendType = 'postgresql';
let mockKeepsSettings = true;
const mockSessionStore = {
  getBackendType: () => mockBackendType,
  keepsAccountSettings: () => mockKeepsSettings,
  initialize: jest.fn(async () => undefined),
  getAccountSettings: jest.fn(async () => undefined),
  putAccountSettings: jest.fn(async (accountKey: string, settings: object) => ({
    accountKey,
    settings,
    version: 1,
    updatedAt: 1,
  })),
};
jest.mock('../../../src/oauth/session-store', () => ({ sessionStore: mockSessionStore }));

jest.mock('../../../src/profiles/loader', () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    loadPreset: async (name: string) => {
      throw new Error(`Preset not found: ${name}`);
    },
  })),
}));

const mockNotify = jest.fn(async () => undefined);
jest.mock('../../../src/session-manager', () => ({
  getSessionManager: () => ({ notifyToolsListChanged: mockNotify }),
}));

let mockSettingsPath = '';
jest.mock('../../../src/configuration/settings-store', () => ({
  ...jest.requireActual('../../../src/configuration/settings-store'),
  localSettingsPath: () => mockSettingsPath,
}));

import { getConfigurationService, resetConfigurationService } from '../../../src/configuration';
import type { Caller } from '../../../src/configuration/caller';

const alice: Caller = {
  accountKey: 'token:https://gitlab.example.com',
  sessionKey: 'stdio',
  accountLabel: 'alice',
  instanceUrl: 'https://gitlab.example.com',
  oauth: false,
};

describe('getConfigurationService', () => {
  const originalStorage = process.env.OAUTH_STORAGE_TYPE;
  let dir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    resetConfigurationService();
    mockOAuth = false;
    mockBackendType = 'postgresql';
    mockKeepsSettings = true;
    delete process.env.OAUTH_STORAGE_TYPE;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-index-test-'));
    mockSettingsPath = path.join(dir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalStorage === undefined) delete process.env.OAUTH_STORAGE_TYPE;
    else process.env.OAUTH_STORAGE_TYPE = originalStorage;
  });

  it('is one service until reset', () => {
    const first = getConfigurationService();

    expect(getConfigurationService()).toBe(first);
    resetConfigurationService();
    expect(getConfigurationService()).not.toBe(first);
  });

  it('keeps a local server settings in the local file and notifies its session', async () => {
    await getConfigurationService().updateAccount(alice, { readOnly: true });

    const file = JSON.parse(fs.readFileSync(mockSettingsPath, 'utf-8'));
    expect(file.accounts[alice.accountKey].settings).toEqual({ readOnly: true });
    expect(mockSessionStore.initialize).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(['stdio']);
  });

  it.each([
    ['OAuth', () => (mockOAuth = true)],
    ['a configured session storage', () => (process.env.OAUTH_STORAGE_TYPE = 'postgresql')],
  ])('keeps settings in the shared session storage with %s', async (_label, configure) => {
    configure();
    const service = getConfigurationService();

    await service.resolve(alice);
    await service.updateAccount(alice, { readOnly: true });

    expect(mockSessionStore.initialize).toHaveBeenCalledTimes(1);
    expect(mockSessionStore.getAccountSettings).toHaveBeenCalledWith(alice.accountKey);
    expect(mockSessionStore.putAccountSettings).toHaveBeenCalledWith(
      alice.accountKey,
      { readOnly: true },
      0,
    );
    expect(fs.existsSync(mockSettingsPath)).toBe(false);
  });

  // Sessions held in memory (the OAuth default) are gone after a restart; saved settings
  // must not be, so they go to the settings file instead.
  it.each([
    ['sessions are held in memory', 'memory'],
    // A database package older than the server: calls keep working instead of failing.
    ['the database package cannot keep settings', 'postgresql'],
  ])('keeps OAuth settings in the settings file when %s', async (_label, backendType) => {
    mockOAuth = true;
    mockBackendType = backendType;
    mockKeepsSettings = false;

    await getConfigurationService().updateAccount(alice, { readOnly: true });

    const file = JSON.parse(fs.readFileSync(mockSettingsPath, 'utf-8'));
    expect(file.accounts[alice.accountKey].settings).toEqual({ readOnly: true });
    expect(mockSessionStore.putAccountSettings).not.toHaveBeenCalled();
  });

  // A storage outage at the first request must not fail every later request until restart.
  it('retries opening the shared storage after a failed first attempt', async () => {
    mockOAuth = true;
    mockSessionStore.initialize.mockRejectedValueOnce(new Error('database unavailable'));
    const service = getConfigurationService();

    await expect(service.resolve(alice)).rejects.toThrow('database unavailable');
    const resolved = await service.resolve(alice);

    expect(resolved.account).toEqual({});
    expect(mockSessionStore.initialize).toHaveBeenCalledTimes(2);
  });
});
