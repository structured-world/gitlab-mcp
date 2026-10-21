/**
 * The configured instance and token a static-token call works with when its chat switched
 * to one. Kept apart from the account list so the HTTP layer can read it without importing
 * the instance registry.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TokenAccountContext {
  instanceUrl: string;
  token: string;
}

const storage = new AsyncLocalStorage<TokenAccountContext>();

/** Run `fn` with the chat's chosen instance and token. */
export function runWithTokenAccount<T>(account: TokenAccountContext, fn: () => T): T {
  return storage.run(account, fn);
}

/** The instance and token of the running call, when its chat switched to one. */
export function currentTokenAccount(): TokenAccountContext | undefined {
  return storage.getStore();
}
