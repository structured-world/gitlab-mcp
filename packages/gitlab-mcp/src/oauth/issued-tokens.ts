/**
 * Keeping tokens GitLab issued in exchange for a single-use grant (an authorization code
 * or a device code): once spent, the grant cannot be presented again, so losing the tokens
 * loses the user's approval.
 */

import { logWarn } from '../logger';

/** Delays before the retries of a failed write; about a second in all. */
const RETRY_DELAYS_MS = [100, 300, 600];

/**
 * Write tokens GitLab just issued, retrying a failed write. When every attempt fails the
 * caller completes the authorization with the tokens in hand, which stores them with the
 * session; so this never throws.
 */
export async function keepIssuedTokens(write: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (error: unknown) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        logWarn('Could not keep issued GitLab tokens; completing with them in hand', {
          err: error as Error,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
