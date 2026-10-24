/**
 * GitLab accounts a chat can work with, and the one it uses.
 *
 * With OAuth a connection signs in with one account and can link more accounts to its
 * session, on the same or other instances, each with its own tokens. With a static token
 * the server's own token is the first account, and each configured instance that names a
 * token variable is another. A chat (an MCP session; stdio is one chat) uses the first
 * account until it switches; other chats keep their own choice.
 */

import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { runWithTokenAccount } from './token-account';
import { configuredInstanceToken } from './instance-tokens';
import { InstanceRegistry } from '../services/InstanceRegistry';
import { isOAuthEnabled, loadOAuthConfig } from '../oauth/config';
import type { OAuthConfig } from '../oauth/config';
import { sessionStore } from '../oauth/session-store';
import { getTokenContext, runWithTokenContext } from '../oauth/token-context';
import { GitLabGrantRevokedError, withFreshGitLabToken } from '../oauth/gitlab-token-refresh';
import { liveGitLabAccessToken, revokeGitLabGrant } from '../oauth/grant-revocation';
import type { OAuthSession, TokenContext } from '../oauth/types';
import { accountProfileId } from '../entities/context/profile';
import { normalizeInstanceUrl } from '../utils/url';

/** An account as a chat sees it; never carries a credential. */
export interface ChatAccount {
  /** Opaque, stable id the chat names the account by. */
  id: string;
  /** Username and instance, e.g. "alice @ Corporate GitLab". */
  label: string;
  instanceUrl: string;
  username?: string;
  /** The account the connection signed in with, or the server's own token. */
  primary: boolean;
  /** The account this chat works with now. */
  active: boolean;
}

/** A configured instance a static-token chat can work with. */
interface TokenAccount {
  id: string;
  instanceUrl: string;
  label: string;
  token: string;
}

/** The chosen account cannot be used; the message says what to do. */
export class AccountUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountUnavailableError';
  }
}

/** Chat key of a request without an MCP session id (the stdio transport). */
const SESSIONLESS = 'stdio';

/**
 * Chat key -> id of the account it switched to; absent: the first account.
 *
 * Held in process like the chat's other overrides: the key is the MCP session id, and a
 * request carrying an id this process no longer serves (restart, idle eviction, another
 * replica) is answered 404 before it reaches a handler, so the client opens a new session
 * under a new id. Persisting the choice would serve no session: under the MCP session id
 * nothing reads it again, and under the OAuth session it would leak into every other chat.
 */
const selections = new Map<string, string>();

/** Passes over a linked account before an unlink gives up and asks for a retry. */
const UNLINK_ATTEMPTS = 20;
/** Wait between passes while a link or a token refresh holds the account's lease. */
const UNLINK_RETRY_MS = 100;
/** How long an unlink holds the account: a delete. */
const UNLINK_LEASE_MS = 15_000;

function chatKey(sessionId: string | undefined): string {
  return sessionId ?? SESSIONLESS;
}

function instanceName(instanceUrl: string, label: string | undefined): string {
  if (label) return label;
  try {
    return new URL(instanceUrl).host;
  } catch {
    return instanceUrl;
  }
}

function sessionInstance(session: OAuthSession): string {
  return normalizeInstanceUrl(session.gitlabApiUrl ?? GITLAB_BASE_URL);
}

function oauthAccountId(session: OAuthSession): string {
  return accountProfileId(sessionInstance(session), session.gitlabUserId);
}

function oauthAccount(session: OAuthSession, primary: boolean, activeId: string): ChatAccount {
  const instanceUrl = sessionInstance(session);
  const id = oauthAccountId(session);
  return {
    id,
    label: `${session.gitlabUsername} @ ${instanceName(instanceUrl, session.instanceLabel)}`,
    instanceUrl,
    username: session.gitlabUsername,
    primary,
    active: id === activeId,
  };
}

/** The signed-in session of the current request, with OAuth. */
async function signedInSession(): Promise<OAuthSession> {
  const context = getTokenContext();
  const session = context ? await sessionStore.getSession(context.sessionId) : undefined;
  if (!session) {
    throw new AccountUnavailableError('This connection is not signed in to GitLab.');
  }
  return session;
}

/**
 * The server's own token first, then each configured instance with a token variable
 * that is set. An instance whose variable is unset is left out: it has no token to use.
 */
function tokenAccounts(): TokenAccount[] {
  const primaryUrl = normalizeInstanceUrl(GITLAB_BASE_URL);
  const registry = InstanceRegistry.getInstance();
  const accounts: TokenAccount[] = [];
  if (GITLAB_TOKEN) {
    const primaryLabel = registry.isInitialized()
      ? registry.getConfig(primaryUrl)?.label
      : undefined;
    accounts.push({
      id: primaryUrl,
      instanceUrl: primaryUrl,
      label: instanceName(primaryUrl, primaryLabel),
      token: GITLAB_TOKEN,
    });
  }
  if (!registry.isInitialized()) return accounts;
  for (const url of registry.getUrls()) {
    const config = registry.getConfig(url);
    const instanceUrl = normalizeInstanceUrl(url);
    const token = configuredInstanceToken(instanceUrl);
    if (!token || accounts.some((account) => account.instanceUrl === instanceUrl)) continue;
    accounts.push({
      id: instanceUrl,
      instanceUrl,
      label: instanceName(instanceUrl, config?.label),
      token,
    });
  }
  return accounts;
}

/** The accounts the chat can work with, the one it uses marked active. */
export async function listChatAccounts(sessionId: string | undefined): Promise<ChatAccount[]> {
  const selected = selections.get(chatKey(sessionId));
  if (isOAuthEnabled()) {
    const session = await signedInSession();
    const activeId = selected ?? oauthAccountId(session);
    const linked = sessionStore.linksAccounts()
      ? await sessionStore.getLinkedSessions(session.id)
      : [];
    return [
      oauthAccount(session, true, activeId),
      ...linked.map((row) => oauthAccount(row, false, activeId)),
    ];
  }
  const accounts = tokenAccounts();
  const activeId = selected ?? accounts[0]?.id;
  return accounts.map((account, index) => ({
    id: account.id,
    label: account.label,
    instanceUrl: account.instanceUrl,
    primary: index === 0,
    active: account.id === activeId,
  }));
}

/** Make `accountId` the account the chat works with; returns it. */
export async function switchChatAccount(
  sessionId: string | undefined,
  accountId: string,
): Promise<ChatAccount> {
  const accounts = await listChatAccounts(sessionId);
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new AccountUnavailableError(
      `No account "${accountId}" in this connection; list them with manage_context list_accounts.`,
    );
  }
  if (account.primary) selections.delete(chatKey(sessionId));
  else selections.set(chatKey(sessionId), account.id);
  return { ...account, active: true };
}

/**
 * Remove a linked account from the connection's session and end its GitLab grant. The
 * account this chat works with now, and the one the connection signed in with, are
 * refused; another chat that switched to the removed account is refused on its next call.
 */
export async function unlinkChatAccount(
  sessionId: string | undefined,
  accountId: string,
): Promise<ChatAccount> {
  const config = loadOAuthConfig();
  if (!isOAuthEnabled() || !config) {
    throw new AccountUnavailableError(
      'A server with a static token has no linked accounts; its instances are configured.',
    );
  }
  if (!sessionStore.linksAccounts()) {
    throw new AccountUnavailableError(
      'The session storage of this server cannot keep linked accounts; update the database package.',
    );
  }
  const session = await signedInSession();
  const linked = await sessionStore.getLinkedSessions(session.id);
  const row = linked.find((candidate) => oauthAccountId(candidate) === accountId);
  if (!row) {
    throw new AccountUnavailableError(
      `No linked account "${accountId}"; the account this connection signed in with cannot be unlinked.`,
    );
  }
  if (selections.get(chatKey(sessionId)) === accountId) {
    throw new AccountUnavailableError(
      'This chat works with that account now; switch to another account first.',
    );
  }
  const accessToken = await removeLinkedRow(row.id, config);
  if (accessToken) await revokeGitLabGrant(row, accessToken, config);
  return oauthAccount(row, false, '');
}

/**
 * Remove a linked account's row under the lease a link replacing its grant (and a token
 * refresh) holds, so the grant removed is the one this returns: its live access token, or
 * undefined when the row is already gone. A link that comes after stores the account again.
 */
async function removeLinkedRow(
  rowId: string,
  config: OAuthConfig,
  attempt = 1,
): Promise<string | undefined> {
  const stored = await sessionStore.getSession(rowId);
  if (!stored) return undefined;
  const accessToken = await liveGitLabAccessToken(stored, config);
  const current = await sessionStore.getSession(rowId);
  if (!current) return undefined;
  // The row holds the token just made live (or kept, when the refresh failed) unless a link
  // replaced the grant meanwhile; then the next pass reads the new one.
  if (current.gitlabAccessToken === accessToken) {
    const now = Date.now();
    const leaseUntil = now + UNLINK_LEASE_MS;
    // The claim holds only while the row keeps this refresh token, i.e. this very grant.
    const refreshToken = current.gitlabRefreshToken;
    if (await sessionStore.claimGitLabRefresh(rowId, refreshToken, now, leaseUntil)) {
      try {
        await sessionStore.deleteSession(rowId);
        return accessToken;
      } finally {
        await sessionStore.releaseGitLabRefresh(rowId, leaseUntil).catch(() => undefined);
      }
    }
  }
  if (attempt >= UNLINK_ATTEMPTS) {
    throw new AccountUnavailableError(
      'The account is being changed elsewhere (a sign-in or a token refresh); try again.',
    );
  }
  await new Promise((resolve) => setTimeout(resolve, UNLINK_RETRY_MS));
  return removeLinkedRow(rowId, config, attempt + 1);
}

/** Forget a closed chat's choice. */
export function forgetChat(sessionId: string): void {
  selections.delete(sessionId);
}

/** Token context of a linked account, its GitLab tokens fresh. */
async function linkedAccountContext(
  context: TokenContext,
  accountId: string,
): Promise<TokenContext> {
  const config = loadOAuthConfig();
  const row = (await sessionStore.getLinkedSessions(context.sessionId)).find(
    (candidate) => oauthAccountId(candidate) === accountId,
  );
  if (!row || !config) {
    throw new AccountUnavailableError(
      'The account this chat switched to is no longer linked; switch to another account or link it again.',
    );
  }
  let fresh: OAuthSession | undefined;
  try {
    fresh = await withFreshGitLabToken(row, config);
  } catch (error) {
    if (error instanceof GitLabGrantRevokedError) {
      throw new AccountUnavailableError(
        `GitLab no longer accepts the sign-in of ${row.gitlabUsername}; link the account again with manage_context link_account.`,
      );
    }
    // A GitLab or storage outage: the account stays linked, the call can be retried.
    const reason = error instanceof Error ? error.message : String(error);
    throw new AccountUnavailableError(
      `The sign-in of ${row.gitlabUsername} could not be refreshed now (${reason}); try again.`,
    );
  }
  if (!fresh) {
    throw new AccountUnavailableError(
      'The account this chat switched to is no longer linked; switch to another account or link it again.',
    );
  }
  return {
    ...context,
    gitlabToken: fresh.gitlabAccessToken,
    gitlabUserId: fresh.gitlabUserId,
    gitlabUsername: fresh.gitlabUsername,
    gitlabScopes: fresh.gitlabScopes,
    apiUrl: sessionInstance(fresh),
    instanceLabel: fresh.instanceLabel,
  };
}

/**
 * Run `fn` as the account the chat works with: the request's own account unless the chat
 * switched. A switched-to account that cannot be used refuses the call; it never falls
 * back to another account.
 */
export async function withChatAccount<T>(
  sessionId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const selected = selections.get(chatKey(sessionId));
  if (!selected) return fn();
  if (isOAuthEnabled()) {
    const context = getTokenContext();
    if (!context) return fn();
    if (selected === accountProfileId(normalizeInstanceUrl(context.apiUrl), context.gitlabUserId)) {
      return fn();
    }
    const accountContext = await linkedAccountContext(context, selected);
    return runWithTokenContext(accountContext, fn);
  }
  const account = tokenAccounts().find((candidate) => candidate.id === selected);
  if (!account) {
    throw new AccountUnavailableError(
      'The instance this chat switched to is no longer configured with a token; switch to another account.',
    );
  }
  return runWithTokenAccount({ instanceUrl: account.instanceUrl, token: account.token }, fn);
}

/** Clear every chat's choice (tests). */
export function resetChatAccounts(): void {
  selections.clear();
}
