/**
 * manage_context account actions: the chat's tool list follows a switch exactly once, and
 * a link is opened by the client when it supports URL elicitation and returned either way.
 */

jest.mock('../../../../src/accounts/chat-accounts', () => ({
  listChatAccounts: jest.fn(),
  switchChatAccount: jest.fn(),
  unlinkChatAccount: jest.fn(),
}));

jest.mock('../../../../src/accounts/link', () => ({ startAccountLink: jest.fn() }));

const mockSessions = {
  getSessionInstanceUrl: jest.fn(),
  setSessionInstanceUrl: jest.fn(),
};
jest.mock('../../../../src/session-manager', () => ({ getSessionManager: () => mockSessions }));

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  handleLinkAccount,
  handleListAccounts,
  handleSwitchAccount,
  handleUnlinkAccount,
} from '../../../../src/entities/context/accounts';
import {
  listChatAccounts,
  switchChatAccount,
  unlinkChatAccount,
} from '../../../../src/accounts/chat-accounts';
import { startAccountLink } from '../../../../src/accounts/link';
import { runWithCaller, type Caller } from '../../../../src/configuration/caller';
import { runWithMcpServer } from '../../../../src/mcp-server-context';
import { HANDLER_TIMEOUT_MS } from '../../../../src/config';

const mockList = listChatAccounts as jest.MockedFunction<typeof listChatAccounts>;
const mockSwitch = switchChatAccount as jest.MockedFunction<typeof switchChatAccount>;
const mockUnlink = unlinkChatAccount as jest.MockedFunction<typeof unlinkChatAccount>;
const mockStart = startAccountLink as jest.MockedFunction<typeof startAccountLink>;

const personal = {
  id: 'gitlab:personal',
  label: 'alice-personal @ GitLab.com',
  instanceUrl: 'https://gitlab.com',
  primary: false,
  active: true,
};

function caller(sessionKey: string): Caller {
  return {
    accountKey: 'gitlab:https://git.corp.example.com#7',
    sessionKey,
    accountLabel: 'alice',
    instanceUrl: 'https://git.corp.example.com',
    oauth: true,
  };
}

function fakeServer(capabilities: Record<string, unknown> = {}) {
  return {
    sendToolListChanged: jest.fn().mockResolvedValue(undefined),
    getClientCapabilities: jest.fn(() => capabilities),
    elicitInput: jest.fn(),
  };
}

function inChat<T>(
  sessionKey: string,
  server: ReturnType<typeof fakeServer>,
  fn: () => Promise<T>,
) {
  return runWithMcpServer(server as unknown as Server, () => runWithCaller(caller(sessionKey), fn));
}

describe('manage_context account actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the accounts of the calling chat', async () => {
    mockList.mockResolvedValue([personal]);

    expect(await inChat('chat-1', fakeServer(), () => handleListAccounts())).toEqual([personal]);
    expect(mockList).toHaveBeenCalledWith('chat-1');
  });

  // A session moved to another instance is told by the session manager; telling it here
  // too would make the client fetch the list twice.
  it('lets the session manager announce a switch to another instance', async () => {
    mockSwitch.mockResolvedValue(personal);
    mockSessions.getSessionInstanceUrl.mockReturnValue('https://git.corp.example.com');
    const server = fakeServer();

    const result = await inChat('chat-1', server, () =>
      handleSwitchAccount({ action: 'switch_account', account: personal.id }),
    );

    expect(mockSwitch).toHaveBeenCalledWith('chat-1', personal.id);
    expect(mockSessions.setSessionInstanceUrl).toHaveBeenCalledWith('chat-1', 'https://gitlab.com');
    expect(server.sendToolListChanged).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, account: personal });
    expect(result.message).toContain('other chats keep their account');
  });

  // Another account on the same instance can have other permissions: the list still changes.
  it('announces a switch that keeps the instance itself', async () => {
    mockSwitch.mockResolvedValue({ ...personal, instanceUrl: 'https://git.corp.example.com' });
    mockSessions.getSessionInstanceUrl.mockReturnValue('https://git.corp.example.com');
    const server = fakeServer();

    await inChat('chat-1', server, () =>
      handleSwitchAccount({ action: 'switch_account', account: personal.id }),
    );

    expect(mockSessions.setSessionInstanceUrl).not.toHaveBeenCalled();
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  it('announces a switch of the sessionless stdio chat', async () => {
    mockSwitch.mockResolvedValue(personal);
    mockSessions.getSessionInstanceUrl.mockReturnValue(undefined);
    const server = fakeServer();

    await inChat('stdio', server, () =>
      handleSwitchAccount({ action: 'switch_account', account: personal.id }),
    );

    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  // The announcement is best effort: a client that cannot take it still has the switch.
  it('switches when the tool list change cannot be announced', async () => {
    mockSwitch.mockResolvedValue(personal);
    mockSessions.getSessionInstanceUrl.mockReturnValue(undefined);
    const server = fakeServer();
    server.sendToolListChanged.mockRejectedValueOnce(new Error('transport closed'));

    const result = await inChat('stdio', server, () =>
      handleSwitchAccount({ action: 'switch_account', account: personal.id }),
    );

    expect(result).toMatchObject({ success: true, account: personal });
  });

  // Without a caller (no chat of its own) there is no session to move: the switch is
  // announced to the client directly.
  it('announces a switch made without a chat session', async () => {
    mockSwitch.mockResolvedValue(personal);
    const server = fakeServer();

    await runWithMcpServer(server as unknown as Server, () =>
      handleSwitchAccount({ action: 'switch_account', account: personal.id }),
    );

    expect(mockSwitch).toHaveBeenCalledWith(undefined, personal.id);
    expect(mockSessions.getSessionInstanceUrl).not.toHaveBeenCalled();
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  describe('link_account', () => {
    const start = {
      url: 'https://git.corp.example.com/oauth/authorize?state=abc',
      instanceUrl: 'https://gitlab.com',
      instanceLabel: 'GitLab.com',
      expiresAt: Date.UTC(2026, 9, 17, 12, 10),
    };

    beforeEach(() => {
      mockStart.mockResolvedValue(start);
    });

    it('asks the client to open the sign-in link when it supports URL elicitation', async () => {
      const server = fakeServer({ elicitation: { url: {} } });
      server.elicitInput.mockResolvedValue({ action: 'accept' });

      const result = await inChat('chat-1', server, () =>
        handleLinkAccount({ action: 'link_account', instance: 'https://gitlab.com' }),
      );

      // The link keeps the elicitation and the chat that asked, to tell it when it completes.
      const [, elicitation] = mockStart.mock.calls[0];
      expect(mockStart).toHaveBeenCalledWith('https://gitlab.com', {
        mcpSessionId: 'chat-1',
        elicitationId: expect.any(String),
      });
      expect(server.elicitInput).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'url',
          url: start.url,
          elicitationId: elicitation?.elicitationId,
        }),
        expect.anything(),
      );
      expect(result).toMatchObject({
        url: start.url,
        instanceUrl: 'https://gitlab.com',
        expiresAt: '2026-10-17T12:10:00.000Z',
        opened: true,
      });
      expect(result.message).toContain('The sign-in page is open');
    });

    // An instance without a label is named by its URL in the sign-in text.
    it('names an instance without a label by its URL', async () => {
      mockStart.mockResolvedValueOnce({ ...start, instanceLabel: undefined });

      const result = await inChat('chat-1', fakeServer(), () =>
        handleLinkAccount({ action: 'link_account' }),
      );

      expect(result.message).toContain('on https://gitlab.com');
    });

    // A URL elicitation is answered once the user consents to open the link; a client that
    // holds it until the sign-in ends must not hold the tool call past its own timeout.
    it('bounds the wait for the client to open the link below the tool timeout', async () => {
      const server = fakeServer({ elicitation: { url: {} } });
      server.elicitInput.mockResolvedValue({ action: 'accept' });

      await inChat('chat-1', server, () => handleLinkAccount({ action: 'link_account' }));

      const options = server.elicitInput.mock.calls[0][1] as { timeout?: number } | undefined;
      expect(options?.timeout).toBeGreaterThan(0);
      expect(options?.timeout).toBeLessThan(HANDLER_TIMEOUT_MS);
    });

    it('returns the link for the user when the client cannot open it', async () => {
      const server = fakeServer({ elicitation: { form: {} } });

      const result = await inChat('chat-1', server, () =>
        handleLinkAccount({ action: 'link_account' }),
      );

      // No elicitation to complete later.
      expect(mockStart).toHaveBeenCalledWith(undefined, undefined);
      expect(server.elicitInput).not.toHaveBeenCalled();
      expect(result).toMatchObject({ url: start.url, opened: false });
      expect(result.message).toContain('Open the link in the browser');
    });

    it('returns the link when the user declines or the elicitation fails', async () => {
      const declining = fakeServer({ elicitation: { url: {} } });
      declining.elicitInput.mockResolvedValue({ action: 'decline' });
      const failing = fakeServer({ elicitation: { url: {} } });
      failing.elicitInput.mockRejectedValue(new Error('client went away'));

      const declined = await inChat('chat-1', declining, () =>
        handleLinkAccount({ action: 'link_account' }),
      );
      const failed = await inChat('chat-1', failing, () =>
        handleLinkAccount({ action: 'link_account' }),
      );

      expect(declined.opened).toBe(false);
      expect(failed.opened).toBe(false);
      expect(failed.url).toBe(start.url);
    });
  });

  // Revoking the grant ends this server's access, not a browser sign-in; the message says so.
  it('unlinks an account and says its OAuth grant was revoked', async () => {
    mockUnlink.mockResolvedValue({ ...personal, active: false });

    const result = await inChat('chat-1', fakeServer(), () =>
      handleUnlinkAccount({ action: 'unlink_account', account: personal.id }),
    );

    expect(mockUnlink).toHaveBeenCalledWith('chat-1', personal.id);
    expect(result.message).toBe(
      "alice-personal @ GitLab.com is no longer linked; this server's access to it (its OAuth grant) was revoked.",
    );
  });
});
