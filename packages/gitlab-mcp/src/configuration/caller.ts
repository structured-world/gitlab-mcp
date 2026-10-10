/**
 * Who a request comes from, derived from the authenticated request only: the GitLab
 * account of the OAuth token, or the operator's token in static-token mode. A client
 * never names the account it acts for.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { getTokenContext } from '../oauth/token-context';
import { normalizeInstanceUrl } from '../utils/url';

export interface Caller {
  /** Account whose settings apply; shared by its sessions and replicas. */
  accountKey: string;
  /** MCP session of the request; session overrides apply to it only. */
  sessionKey: string;
  /** Display name of the account, never a credential. */
  accountLabel: string;
  instanceUrl: string;
  /** Whether the account is a GitLab user signed in through OAuth. */
  oauth: boolean;
}

/** Session key of a request that carries no MCP session id (the stdio transport). */
const SESSIONLESS = 'stdio';

/**
 * The caller of the current request. In OAuth mode the account is the GitLab user the
 * token was issued for on its instance; otherwise every request uses the operator's token,
 * so the account is that token's instance.
 */
export function resolveCaller(sessionId: string | undefined, instanceUrl: string): Caller {
  const token = getTokenContext();
  const sessionKey = sessionId ?? SESSIONLESS;
  if (token) {
    const instance = normalizeInstanceUrl(token.apiUrl);
    return {
      accountKey: `gitlab:${instance}#${token.gitlabUserId}`,
      sessionKey,
      accountLabel: token.gitlabUsername,
      instanceUrl: instance,
      oauth: true,
    };
  }
  const instance = normalizeInstanceUrl(instanceUrl);
  return {
    accountKey: `token:${instance}`,
    sessionKey,
    accountLabel: 'Configured access token',
    instanceUrl: instance,
    oauth: false,
  };
}

const callerStorage = new AsyncLocalStorage<Caller>();

/** Run `fn` with `caller` as the caller of everything it does. */
export function runWithCaller<T>(caller: Caller, fn: () => T): T {
  return callerStorage.run(caller, fn);
}

/** The caller of the running tool call; undefined outside one. */
export function currentCaller(): Caller | undefined {
  return callerStorage.getStore();
}
