/**
 * Linking another GitLab account to a signed-in session, from a chat.
 *
 * The chat receives a sign-in link. The browser first signs in with the session's own
 * account and continues only when GitLab reports that same user: otherwise a link opened by
 * another person would attach their GitLab account to this session. Then it signs in with
 * the account to link, and the callback stores that account with the session. That second
 * step completes only in the browser that passed the first (a cookie it was given there):
 * its sign-in URL forwarded to someone else would otherwise link their account. Every step
 * is a stored, single-use, expiring flow, so it works when requests land on different
 * replicas.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { GITLAB_BASE_URL } from '../config';
import type { OAuthConfig } from '../oauth/config';
import { isOAuthEnabled, loadOAuthConfig } from '../oauth/config';
import { sessionStore } from '../oauth/session-store';
import { getTokenContext } from '../oauth/token-context';
import { oauthAppFor, selectableOAuthApps } from '../oauth/instance-app';
import type { GitLabOAuthApp } from '../oauth/oauth-app';
import { buildGitLabAuthUrl, getGitLabUser, revokeGitLabToken } from '../oauth/gitlab-device-flow';
import { exchangeFlowCode } from '../oauth/code-exchange';
import { discardAuthCodeFlow } from '../oauth/grant-revocation';
import { claimSessionLease } from '../oauth/gitlab-token-refresh';
import { grantedGitlabScopes } from '../oauth/granted-scopes';
import { calculateTokenExpiry, generateRandomString } from '../oauth/token-utils';
import type { AccountLinkStep, AuthCodeFlowState, OAuthSession } from '../oauth/types';
import { normalizeInstanceUrl } from '../utils/url';
import { escapeHtml } from '../utils/html';
import { logInfo, logWarn, truncateId } from '../logger';
import { AccountUnavailableError } from './chat-accounts';

/** How long a link stays usable; long enough to sign in, short enough not to linger. */
const LINK_TTL_MS = 10 * 60 * 1000;

/** Passes over the stored account before a link gives up and asks for a reload. */
const STORE_ATTEMPTS = 20;
/** Wait between passes while another link or a token refresh holds the account's lease. */
const STORE_RETRY_MS = 100;
/** How long a replacement holds the account: a lookup and one write. */
const REPLACE_LEASE_MS = 15_000;
/**
 * How long a link holds its session while it completes: the check, the store (with the
 * account's own lease and its passes) and spending the link.
 */
const LINK_COMPLETION_LEASE_MS = REPLACE_LEASE_MS + STORE_ATTEMPTS * STORE_RETRY_MS + 5_000;

/**
 * Storage id of an account linked to a session: one per session, instance and user. The
 * session id holds no colon and the user id is numeric, so the parts never run together.
 */
function linkedAccountId(sessionId: string, instance: string, userId: number): string {
  return `linked:${sessionId}:${userId}@${instance}`;
}

/** The URL elicitation through which a chat's client opened a link. */
export interface LinkElicitation {
  mcpSessionId: string;
  elicitationId: string;
}

export interface AccountLinkStart {
  /** Where the user signs in; opened in the browser, never shown to anyone else. */
  url: string;
  instanceUrl: string;
  instanceLabel?: string;
  expiresAt: number;
}

function callbackUri(config: OAuthConfig): string {
  return `${config.issuer}/oauth/callback`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cookie of one link's connect step, named after its state so parallel links coexist. */
function bindingCookieName(state: string): string {
  return `gitlab_mcp_link_${sha256Hex(state).slice(0, 16)}`;
}

/** Hand the browser that passed `verify` the nonce its connect step checks. */
function bindBrowser(res: Response, config: OAuthConfig, state: string, nonce: string): void {
  res.cookie(bindingCookieName(state), nonce, {
    httpOnly: true,
    // Sent on GitLab's top-level redirect back to the callback, never on cross-site requests.
    sameSite: 'lax',
    secure: new URL(config.issuer).protocol === 'https:',
    path: new URL(callbackUri(config)).pathname,
    maxAge: LINK_TTL_MS,
  });
}

/** Whether the request completing a connect step comes from the browser bound to it. */
function fromBoundBrowser(res: Response, state: string, link: AccountLinkStep): boolean {
  const name = bindingCookieName(state);
  const nonce = (res.req?.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim().split('='))
    .find(([key]) => key === name)?.[1];
  if (!nonce || !link.browserBinding) return false;
  const expected = Buffer.from(link.browserBinding, 'hex');
  const actual = Buffer.from(sha256Hex(nonce), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requestedScopes(app: GitLabOAuthApp): string[] {
  return app.scopes.split(/[,\s]+/).filter(Boolean);
}

/** A stored step of a link: its state and the GitLab sign-in URL that continues it. */
interface StoredLinkStep {
  state: string;
  url: string;
}

/** Store one step of a link. */
async function storeLinkStep(
  config: OAuthConfig,
  session: OAuthSession,
  app: GitLabOAuthApp,
  link: AccountLinkStep,
): Promise<StoredLinkStep> {
  const state = generateRandomString(32);
  const flow: AuthCodeFlowState = {
    requestedGitlabScopes: requestedScopes(app),
    selectedInstance: app.baseUrl,
    selectedInstanceLabel: app.label,
    clientId: session.clientId,
    // A link signs no MCP client in: no client PKCE, state or redirect.
    codeChallenge: '',
    codeChallengeMethod: 'S256',
    clientState: '',
    internalState: state,
    clientRedirectUri: '',
    callbackUri: callbackUri(config),
    expiresAt: Date.now() + LINK_TTL_MS,
    scopes: [],
    link,
  };
  await sessionStore.storeAuthCodeFlow(state, flow);
  return { state, url: buildGitLabAuthUrl(config, callbackUri(config), state, app) };
}

/**
 * Start linking an account on `instance` (default: the session's own instance) to the
 * connection's session; returns the sign-in link for the user. With `elicitation`, the chat
 * whose client opens the link is told when the account is linked.
 */
export async function startAccountLink(
  instance: string | undefined,
  elicitation?: LinkElicitation,
): Promise<AccountLinkStart> {
  const config = loadOAuthConfig();
  if (!isOAuthEnabled() || !config) {
    throw new AccountUnavailableError(
      'Linking accounts needs a server that signs users in with GitLab; with a static token, configure the instance with a token instead.',
    );
  }
  if (!sessionStore.linksAccounts()) {
    throw new AccountUnavailableError(
      'The session storage of this server cannot keep linked accounts; update the database package.',
    );
  }
  const context = getTokenContext();
  const session = context ? await sessionStore.getSession(context.sessionId) : undefined;
  if (!session) {
    throw new AccountUnavailableError('This connection is not signed in to GitLab.');
  }
  const own = await oauthAppFor(config, session.gitlabApiUrl);
  if (!own) {
    throw new AccountUnavailableError(
      'The instance this connection signed in with is no longer configured; sign in again.',
    );
  }
  const target = instance ? await oauthAppFor(config, normalizeInstanceUrl(instance)) : own;
  if (!target) {
    const known = (await selectableOAuthApps(config)).map((app) => app.baseUrl).join(', ');
    throw new AccountUnavailableError(
      `No GitLab instance ${instance} is configured for sign-in; configured: ${known}.`,
    );
  }
  const { url } = await storeLinkStep(config, session, own, {
    sessionId: session.id,
    stage: 'verify',
    instance: target.baseUrl,
    instanceLabel: target.label,
    ...elicitation,
  });
  logInfo('Account link started', {
    sessionId: truncateId(session.id),
    instance: target.baseUrl,
  });
  return {
    url,
    instanceUrl: target.baseUrl,
    instanceLabel: target.label,
    expiresAt: Date.now() + LINK_TTL_MS,
  };
}

/** A button on a link page that continues to `href`. */
interface LinkPageAction {
  href: string;
  label: string;
}

/** Page the browser ends on; `message` is plain text. */
function linkPage(
  res: Response,
  status: number,
  title: string,
  message: string,
  action?: LinkPageAction,
): void {
  const button = action
    ? `\n    <p><a class="button" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></p>`
    : '';
  res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitLab MCP - ${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f5f5f5; }
    .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; font-size: 24px; margin: 0 0 16px; }
    p { color: #555; line-height: 1.5; }
    .button { display: inline-block; padding: 10px 20px; background: #6b4fbb; color: white; border-radius: 6px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>${button}
  </div>
</body>
</html>`);
}

/** End a link the browser cannot complete. */
export function failAccountLink(res: Response, message: string): void {
  linkPage(res, 400, 'Account not linked', message);
}

async function revokeQuietly(
  token: string,
  config: OAuthConfig,
  app: GitLabOAuthApp,
): Promise<void> {
  try {
    await revokeGitLabToken(token, config, app);
  } catch (error: unknown) {
    logWarn('Failed to revoke a GitLab token of an account link', { err: error as Error });
  }
}

/** First step: the browser proves it belongs to the session's own user, then goes on. */
async function verifyOwnAccount(
  res: Response,
  state: string,
  flow: AuthCodeFlowState,
  link: AccountLinkStep,
  code: string,
  config: OAuthConfig,
  session: OAuthSession,
): Promise<void> {
  const own = await oauthAppFor(config, flow.selectedInstance);
  const target = await oauthAppFor(config, link.instance);
  if (!own || !target) {
    failAccountLink(res, 'A GitLab instance of this link is no longer configured.');
    return;
  }
  const tokens = flow.gitlabTokens ?? (await exchangeFlowCode(state, flow, code, config, own));
  const user = await getGitLabUser(tokens.access_token, own.baseUrl);
  if (user.id !== session.gitlabUserId) {
    const consumed = await sessionStore.consumeAuthCodeFlow(state);
    await revokeQuietly(tokens.access_token, config, own);
    if (!consumed) {
      failAccountLink(res, 'This link was already used. Ask for a new one in the chat.');
      return;
    }
    logWarn('Account link refused: the browser signed in as another user', {
      sessionId: truncateId(session.id),
    });
    failAccountLink(
      res,
      `This link belongs to ${session.gitlabUsername}, but GitLab signed you in as ${user.username}. ` +
        'Only the person who asked for the link can complete it.',
    );
    return;
  }
  // The next step is stored before this one is spent: a failed write leaves this step and
  // its tokens in place, so reloading the page retries it. It keeps only a digest of the
  // nonce this browser receives below.
  const nonce = generateRandomString(32);
  const next = await storeLinkStep(config, session, target, {
    ...link,
    stage: 'connect',
    browserBinding: sha256Hex(nonce),
  });
  const consumed = await sessionStore.consumeAuthCodeFlow(state);
  // Only the identity was needed; this grant must not outlive the check. It is a grant of its
  // own, never the session's: GitLab leaves Doorkeeper's reuse_access_token off (and hashes
  // token secrets, which rules it out), so every code exchange issues a new token.
  await revokeQuietly(tokens.access_token, config, own);
  if (!consumed) {
    await sessionStore.deleteAuthCodeFlow(next.state);
    failAccountLink(res, 'This link was already used. Ask for a new one in the chat.');
    return;
  }
  bindBrowser(res, config, next.state, nonce);
  if (normalizeInstanceUrl(target.baseUrl) !== normalizeInstanceUrl(own.baseUrl)) {
    res.redirect(next.url);
    return;
  }
  // On its own instance the browser is still signed in to GitLab as the account just
  // verified, which GitLab would authorize again; the user signs in with the other one first,
  // in this browser (another one, a private window included, lacks the cookie of this step).
  linkPage(
    res,
    200,
    'Sign in with the account to link',
    `GitLab confirmed you as ${user.username}. To link another account on ${target.label ?? new URL(target.baseUrl).host}, ` +
      'sign out of GitLab in this browser (or switch to that account there), then continue here.',
    { href: next.url, label: 'Continue to GitLab sign-in' },
  );
}

type LinkedGrant = Pick<
  OAuthSession,
  'gitlabAccessToken' | 'gitlabRefreshToken' | 'gitlabTokenExpiry' | 'gitlabScopes'
>;

/** The account a link stores with a session, and the grant it stores. */
interface LinkedAccountWrite {
  session: OAuthSession;
  link: AccountLinkStep;
  user: { id: number; username: string };
  instance: string;
  grant: LinkedGrant;
}

/** What one pass over the stored account achieved; `wait` asks for a pause before the next. */
type StorePass = { done: true; displaced: string | undefined } | { done: false; wait: boolean };

async function findLinkedAccount(write: LinkedAccountWrite): Promise<OAuthSession | undefined> {
  return (await sessionStore.getLinkedSessions(write.session.id)).find(
    (row) =>
      normalizeInstanceUrl(row.gitlabApiUrl ?? GITLAB_BASE_URL) === write.instance &&
      row.gitlabUserId === write.user.id,
  );
}

/** Store the account's row; another pass is needed when another link stored it meanwhile. */
async function createLinkedAccount(write: LinkedAccountWrite): Promise<StorePass> {
  const { session, link, user, instance, grant } = write;
  const now = Date.now();
  try {
    // The id follows from the session and the account, so a concurrent link of the same
    // account collides on it in storage instead of storing the account twice.
    await sessionStore.createSession({
      id: linkedAccountId(session.id, instance, user.id),
      mcpAccessToken: '',
      mcpRefreshToken: '',
      mcpTokenExpiry: 0,
      ...grant,
      gitlabUserId: user.id,
      gitlabUsername: user.username,
      gitlabApiUrl: instance,
      instanceLabel: link.instanceLabel,
      clientId: session.clientId,
      scopes: [],
      linkedToSessionId: session.id,
      createdAt: now,
      updatedAt: now,
    });
    return { done: true, displaced: undefined };
  } catch (error: unknown) {
    // Only a collision with another link that stored the account meanwhile is retried
    // (the next pass replaces its grant); a storage failure surfaces at once.
    if (!(await findLinkedAccount(write))) throw error;
    return { done: false, wait: false };
  }
}

/** Give the stored account the new grant while holding its lease. */
async function replaceLinkedGrant(
  write: LinkedAccountWrite,
  stored: OAuthSession,
): Promise<StorePass> {
  const now = Date.now();
  const leaseUntil = now + REPLACE_LEASE_MS;
  const claimed = await sessionStore.claimGitLabRefresh(
    stored.id,
    stored.gitlabRefreshToken,
    now,
    leaseUntil,
  );
  if (!claimed) {
    // Another link or a token refresh is changing the row: wait for its turn to end.
    return { done: false, wait: true };
  }
  try {
    // Read before the update: a backend may hand out the stored record, which it changes.
    const displaced = stored.gitlabAccessToken;
    const updates = { ...write.grant, gitlabUsername: write.user.username };
    if (await sessionStore.updateSession(stored.id, updates)) return { done: true, displaced };
    // Unlinked meanwhile in another chat: the next pass stores the account again.
    return { done: false, wait: false };
  } finally {
    await sessionStore.releaseGitLabRefresh(stored.id, leaseUntil).catch(() => undefined);
  }
}

/**
 * Store the account with the session, or give an account linked before the new grant;
 * returns the access token of the grant it displaced, if any. Replacements of one account
 * take turns under the lease a GitLab token refresh holds (claimed only while the row still
 * holds the refresh token read), so each knows exactly which grant it displaced.
 */
async function storeLinkedAccount(
  write: LinkedAccountWrite,
  attempt = 1,
): Promise<string | undefined> {
  const stored = await findLinkedAccount(write);
  const pass = stored ? await replaceLinkedGrant(write, stored) : await createLinkedAccount(write);
  if (pass.done) return pass.displaced;
  if (attempt >= STORE_ATTEMPTS) {
    throw new Error('The linked account is being changed elsewhere');
  }
  if (pass.wait) await new Promise((resolve) => setTimeout(resolve, STORE_RETRY_MS));
  return storeLinkedAccount(write, attempt + 1);
}

/** Second step: store the signed-in account with the session, or refresh it when linked. */
async function connectAccount(
  res: Response,
  state: string,
  flow: AuthCodeFlowState,
  link: AccountLinkStep,
  code: string,
  config: OAuthConfig,
  session: OAuthSession,
): Promise<void> {
  // Checked before the code is exchanged: a browser this step was forwarded to gets no
  // grant at all, and the step is spent so the forwarded link cannot be retried.
  if (!fromBoundBrowser(res, state, link)) {
    logWarn('Account link refused: continued in another browser', {
      sessionId: truncateId(session.id),
    });
    await discardAuthCodeFlow(state, flow, config);
    failAccountLink(
      res,
      'Continue the link in the browser where you confirmed your own account; a link cannot be passed on. Ask for a new one in the chat.',
    );
    return;
  }
  const app = await oauthAppFor(config, flow.selectedInstance);
  if (!app) {
    failAccountLink(res, 'The GitLab instance of this link is no longer configured.');
    return;
  }
  const tokens = flow.gitlabTokens ?? (await exchangeFlowCode(state, flow, code, config, app));
  const user = await getGitLabUser(tokens.access_token, app.baseUrl);
  const instance = normalizeInstanceUrl(app.baseUrl);
  const ownInstance = normalizeInstanceUrl(session.gitlabApiUrl ?? GITLAB_BASE_URL);
  if (instance === ownInstance && user.id === session.gitlabUserId) {
    await sessionStore.consumeAuthCodeFlow(state);
    await revokeQuietly(tokens.access_token, config, app);
    failAccountLink(
      res,
      `GitLab signed you in as ${user.username} again, the account this connection already uses. ` +
        'To link another account, sign out of GitLab or sign in with the other account first.',
    );
    return;
  }

  // The completions of the session's links take turns under its lease, from the check that
  // this link is still unspent until it is spent: a delivery that lost to another delivery of
  // the same callback stores nothing, so it cannot put back a grant a later link replaced and
  // ended. A revocation of the session holds the same lease from before it reads the linked
  // accounts until it deletes them, so it either sees this account or this link sees it gone.
  const turn = await claimSessionLease(session.id, LINK_COMPLETION_LEASE_MS);
  if (turn === undefined) {
    await sessionStore.consumeAuthCodeFlow(state);
    await revokeQuietly(tokens.access_token, config, app);
    failAccountLink(res, 'The connection that asked for this link has signed out.');
    return;
  }
  let replacedToken: string | undefined;
  let outcome: 'completed' | 'spent' | 'signed-out';
  try {
    if (!(await sessionStore.getAuthCodeFlow(state))) {
      outcome = 'spent';
    } else {
      // From here the grant is the account's: if a step below fails, the flow keeps its
      // tokens for a retry, and ending that flow later leaves a grant a linked account
      // stores alone. A retry reuses the grant a failed attempt already stored.
      replacedToken = await storeLinkedAccount({
        session,
        link,
        user,
        instance,
        grant: {
          gitlabAccessToken: tokens.access_token,
          gitlabRefreshToken: tokens.refresh_token,
          gitlabTokenExpiry: calculateTokenExpiry(tokens.expires_in),
          gitlabScopes: grantedGitlabScopes(tokens.scope, flow.requestedGitlabScopes),
        },
      });
      // The flow can still go between the check and here (expired and discarded): the
      // account is stored all the same, so only the page says so.
      const spent = (await sessionStore.consumeAuthCodeFlow(state)) === undefined;
      // A session removed without its lease (storage cleanup) leaves the row behind.
      if (!(await sessionStore.getSession(session.id))) {
        await sessionStore.deleteSession(linkedAccountId(session.id, instance, user.id));
        outcome = 'signed-out';
      } else {
        outcome = spent ? 'spent' : 'completed';
      }
    }
  } finally {
    await sessionStore.releaseGitLabRefresh(session.id, turn).catch(() => undefined);
  }
  // The displaced grant is no longer stored. A grant this link already stored is not one.
  if (replacedToken && replacedToken !== tokens.access_token) {
    await revokeQuietly(replacedToken, config, app);
  }
  if (outcome === 'signed-out') {
    await revokeQuietly(tokens.access_token, config, app);
    failAccountLink(res, 'The connection that asked for this link has signed out.');
    return;
  }
  if (outcome === 'spent') {
    failAccountLink(res, 'This link was already completed.');
    return;
  }
  res.clearCookie(bindingCookieName(state), { path: new URL(callbackUri(config)).pathname });
  const label = `${user.username} @ ${link.instanceLabel ?? new URL(instance).host}`;
  logInfo('Account linked', { sessionId: truncateId(session.id), instance });
  linkPage(
    res,
    200,
    'Account linked',
    `${label} is linked to your GitLab MCP connection. Return to the chat and switch to it with manage_context switch_account.`,
  );
  await announceLinked(link);
}

/**
 * Tell the chat whose client opened the link (MCP URL elicitation) that it completed. The
 * client's answer to the elicitation only meant consent to open it; this is how it learns
 * the outcome. Best effort: the callback may reach a replica that does not hold the chat.
 */
async function announceLinked(link: AccountLinkStep): Promise<void> {
  if (!link.mcpSessionId || !link.elicitationId) return;
  try {
    const { getSessionManager } = await import('../session-manager');
    await getSessionManager().notifyElicitationComplete(link.mcpSessionId, link.elicitationId);
  } catch (error: unknown) {
    // The page is already sent: a failed announcement must not reach the error page.
    logWarn('Could not announce a completed account link', { err: error as Error });
  }
}

/** Complete a step of an account link from GitLab's callback. */
export async function completeAccountLink(
  res: Response,
  state: string,
  flow: AuthCodeFlowState,
  code: string,
  config: OAuthConfig,
): Promise<void> {
  const link = flow.link as AccountLinkStep;
  if (Date.now() > flow.expiresAt) {
    await discardAuthCodeFlow(state, flow, config);
    failAccountLink(res, 'This link expired. Ask for a new one in the chat.');
    return;
  }
  try {
    const session = await sessionStore.getSession(link.sessionId);
    if (!session) {
      await discardAuthCodeFlow(state, flow, config);
      failAccountLink(res, 'The connection that asked for this link has signed out.');
      return;
    }
    if (link.stage === 'verify') {
      await verifyOwnAccount(res, state, flow, link, code, config, session);
    } else {
      await connectAccount(res, state, flow, link, code, config, session);
    }
  } catch (error: unknown) {
    logWarn('Account link failed', { err: error as Error });
    // The flow is kept unless it was completed, so reloading the page retries it.
    linkPage(
      res,
      500,
      'Account not linked',
      'Linking failed for a temporary reason; reload this page to try again.',
    );
  }
}
