/**
 * Unit tests for context handlers
 *
 * Tests the handleManageContext dispatcher and individual handlers.
 */

import { handleManageContext } from '../../../../src/entities/context/handlers';
import { ContextManager } from '../../../../src/entities/context/context-manager';

// Mock dependencies
jest.mock('../../../../src/utils/namespace', () => ({
  detectNamespaceType: jest.fn().mockResolvedValue('group'),
  findNamespaceType: jest.fn().mockResolvedValue('group'),
}));

jest.mock('../../../../src/profiles/loader', () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    listProfiles: jest.fn().mockResolvedValue([
      {
        name: 'readonly',
        description: 'Read-only preset',
        readOnly: true,
        isBuiltIn: true,
        isPreset: true,
      },
    ]),
    loadPreset: jest.fn().mockResolvedValue({
      description: 'Test preset',
      read_only: false,
    }),
  })),
}));

jest.mock('../../../../src/entities/context/accounts', () => ({
  handleListAccounts: jest.fn().mockResolvedValue(['listed']),
  handleSwitchAccount: jest.fn().mockResolvedValue({ switched: true }),
  handleLinkAccount: jest.fn().mockResolvedValue({ linked: true }),
  handleUnlinkAccount: jest.fn().mockResolvedValue({ unlinked: true }),
}));

describe('handleManageContext', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ContextManager.resetInstance();
    jest.clearAllMocks();

    process.env = {
      ...originalEnv,
      GITLAB_API_URL: 'https://gitlab.example.com',
      GITLAB_READ_ONLY_MODE: 'false',
      OAUTH_ENABLED: 'false',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // Each account action reaches its own handler with the input it was called with.
  describe('account actions', () => {
    it('dispatches list, switch, link and unlink to the account handlers', async () => {
      const accounts = jest.requireMock('../../../../src/entities/context/accounts');

      expect(await handleManageContext({ action: 'list_accounts' })).toEqual(['listed']);
      expect(await handleManageContext({ action: 'switch_account', account: 'a' })).toEqual({
        switched: true,
      });
      expect(
        await handleManageContext({ action: 'link_account', instance: 'https://gitlab.com' }),
      ).toEqual({ linked: true });
      expect(await handleManageContext({ action: 'unlink_account', account: 'b' })).toEqual({
        unlinked: true,
      });
      expect(accounts.handleSwitchAccount).toHaveBeenCalledWith({
        action: 'switch_account',
        account: 'a',
      });
      expect(accounts.handleLinkAccount).toHaveBeenCalledWith({
        action: 'link_account',
        instance: 'https://gitlab.com',
      });
      expect(accounts.handleUnlinkAccount).toHaveBeenCalledWith({
        action: 'unlink_account',
        account: 'b',
      });
    });
  });

  describe('action: show', () => {
    it('should return current session context', async () => {
      const result = await handleManageContext({ action: 'show' });

      expect(result).toHaveProperty('host');
      expect(result).toHaveProperty('apiUrl');
      expect(result).toHaveProperty('readOnly');
      expect(result).toHaveProperty('oauthMode');
    });
  });

  describe('action: list_presets', () => {
    it('should return array of presets', async () => {
      const result = await handleManageContext({ action: 'list_presets' });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('action: switch_preset', () => {
    it('should switch to specified preset', async () => {
      const result = await handleManageContext({
        action: 'switch_preset',
        preset: 'readonly',
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('current', 'readonly');
    });
  });

  describe('action: set_scope', () => {
    it('should set scope with auto-detection', async () => {
      const result = await handleManageContext({
        action: 'set_scope',
        namespace: 'my-group',
        includeSubgroups: true,
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('scope');

      expect((result as any).scope.path).toBe('my-group');
    });

    it('should respect includeSubgroups parameter', async () => {
      const result = await handleManageContext({
        action: 'set_scope',
        namespace: 'my-group',
        includeSubgroups: false,
      });

      expect(result).toHaveProperty('success', true);

      expect((result as any).scope.includeSubgroups).toBe(false);
    });
  });

  describe('action: clear_scope', () => {
    it('drops the scope and keeps the preset of the session', async () => {
      await handleManageContext({ action: 'switch_preset', preset: 'readonly' });
      await handleManageContext({
        action: 'set_scope',
        namespace: 'my-group',
        includeSubgroups: true,
      });

      const result = await handleManageContext({ action: 'clear_scope' });

      expect(result).toMatchObject({
        success: true,
        context: { presetName: 'readonly', scope: undefined },
      });
    });
  });

  describe('action: reset', () => {
    it('should reset context to initial state', async () => {
      // First make some changes
      await handleManageContext({
        action: 'switch_preset',
        preset: 'readonly',
      });

      await handleManageContext({
        action: 'set_scope',
        namespace: 'my-group',
        includeSubgroups: true,
      });

      // Then reset
      const result = await handleManageContext({ action: 'reset' });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('context');
    });
  });
});
