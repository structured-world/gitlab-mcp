/**
 * manage_context actions for the GitLab accounts of a connection: list them, switch the
 * chat to one, link another through the browser, unlink one.
 */

import {
  ChatAccount,
  listChatAccounts,
  switchChatAccount,
  unlinkChatAccount,
} from '../../accounts/chat-accounts';
import { startAccountLink } from '../../accounts/link';
import { currentCaller } from '../../configuration/caller';
import { currentMcpServer } from '../../mcp-server-context';
import { generateRandomString } from '../../oauth/token-utils';
import { logDebug } from '../../logger';
import type { LinkAccountInput, SwitchAccountInput, UnlinkAccountInput } from './schema';

export interface AccountChangeResult {
  success: boolean;
  account: ChatAccount;
  message: string;
}

export interface AccountLinkResult {
  url: string;
  instanceUrl: string;
  instanceLabel?: string;
  expiresAt: string;
  /** Whether the client opened the link for the user (URL elicitation). */
  opened: boolean;
  message: string;
}

function chatSessionId(): string | undefined {
  return currentCaller()?.sessionKey;
}

export async function handleListAccounts(): Promise<ChatAccount[]> {
  return listChatAccounts(chatSessionId());
}

export async function handleSwitchAccount(input: SwitchAccountInput): Promise<AccountChangeResult> {
  const sessionId = chatSessionId();
  const account = await switchChatAccount(sessionId, input.account);
  // The chat's tools follow the account's instance, version and permissions. A session moved
  // to another instance is told by the session manager; otherwise (same instance, other
  // permissions, or the sessionless stdio chat) it is told here. An instance not initialized
  // yet lists unfiltered tools now; the first call that initializes it announces the list
  // again (the tool-call bootstrap), so the client then lists the filtered tools.
  const { getSessionManager } = await import('../../session-manager');
  const sessions = getSessionManager();
  const previousUrl = sessionId ? sessions.getSessionInstanceUrl(sessionId) : undefined;
  if (previousUrl !== undefined && previousUrl !== account.instanceUrl) {
    sessions.setSessionInstanceUrl(sessionId as string, account.instanceUrl);
  } else {
    await currentMcpServer()
      ?.sendToolListChanged()
      .catch((error: unknown) =>
        logDebug('Could not announce the tool list change', { err: error }),
      );
  }
  return {
    success: true,
    account,
    message: `This chat now works with ${account.label}; other chats keep their account.`,
  };
}

/**
 * Ask the client to open the sign-in link (MCP URL elicitation) when it can; the link is
 * returned either way for the user to open.
 */
export async function handleLinkAccount(input: LinkAccountInput): Promise<AccountLinkResult> {
  const link = await startAccountLink(input.instance);
  const instance = link.instanceLabel ?? link.instanceUrl;
  let opened = false;
  const server = currentMcpServer();
  if (server?.getClientCapabilities()?.elicitation?.url) {
    try {
      const answer = await server.elicitInput({
        mode: 'url',
        message: `Sign in to ${instance} with the GitLab account to link to this connection.`,
        url: link.url,
        elicitationId: generateRandomString(16),
      });
      opened = answer.action === 'accept';
    } catch (error: unknown) {
      logDebug('URL elicitation for account linking failed', { err: error });
    }
  }
  return {
    url: link.url,
    instanceUrl: link.instanceUrl,
    instanceLabel: link.instanceLabel,
    expiresAt: new Date(link.expiresAt).toISOString(),
    opened,
    message:
      (opened ? 'The sign-in page is open. ' : 'Open the link in the browser to sign in. ') +
      `GitLab first confirms your own account, then you sign in with the account to link on ${instance}. ` +
      'The link works once and for 10 minutes; afterwards list_accounts shows the new account.',
  };
}

export async function handleUnlinkAccount(input: UnlinkAccountInput): Promise<AccountChangeResult> {
  const account = await unlinkChatAccount(chatSessionId(), input.account);
  return {
    success: true,
    account,
    message: `${account.label} is no longer linked; this server's access to it (its OAuth grant) was revoked.`,
  };
}
