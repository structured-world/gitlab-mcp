/**
 * Admin elevation detection.
 *
 * GitLab separates the admin ROLE (`is_admin` on the user) from admin-mode
 * ELEVATION: on 17/18+ a personal access token of an admin user still gets 403
 * on admin endpoints unless admin mode is active. OAuth tokens cannot elevate at
 * all (gitlab-org/gitlab#427766). Reporting only the role gives a false picture:
 * the agent thinks admin tools work and hits a 403 at call time.
 *
 * This module probes BOTH signals so the capabilities snapshot can gate
 * admin-only tools honestly. The result is session-scoped: the caller
 * (ConnectionManager) stores it alongside the token-scope info and never
 * re-probes per request, so this function holds no cache of its own.
 */

import { z } from 'zod';
import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { logDebug } from '../logger';
import { normalizeInstanceUrl } from '../utils/url';
import { enhancedFetch } from '../utils/fetch';

/**
 * Admin status of the authenticated session on one instance.
 *
 * `isAdmin` is the role flag; `adminModeActive` is whether the token can
 * actually reach admin endpoints right now. An admin user without elevation is
 * `{ isAdmin: true, adminModeActive: false }`.
 */
export interface AdminInfo {
  isAdmin: boolean;
  adminModeActive: boolean;
}

const UserAdminSchema = z.object({ is_admin: z.boolean().optional() });

/**
 * Detect admin role and admin-mode elevation for the current static token.
 *
 * @returns the detected {@link AdminInfo}, or `null` when the role cannot be
 *   determined (no token, or `/user` failed). `null` is fail-open: consumers
 *   leave the capability undefined and do not hide admin tools on a probe error.
 *   Only runs in static-token mode (the caller skips it under OAuth, where tokens
 *   cannot elevate and per-user status must not be cached in shared instance state).
 */
export async function detectAdminStatus(baseUrl?: string): Promise<AdminInfo | null> {
  const url = normalizeInstanceUrl(baseUrl ?? GITLAB_BASE_URL);
  if (!url || !GITLAB_TOKEN) {
    return null;
  }

  try {
    const userResponse = await enhancedFetch(`${url}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN, Accept: 'application/json' },
      retry: false,
    });

    if (!userResponse.ok) {
      logDebug('Admin detection: /user request failed', { status: userResponse.status, url });
      await userResponse.body?.cancel().catch(() => {});
      return null;
    }

    const parsed = UserAdminSchema.safeParse(await userResponse.json());
    if (!parsed.success) {
      // Unexpected shape (proxy HTML, API change). Cannot determine the role, so
      // stay fail-open rather than gating admin tools off on a transient blip.
      logDebug('Admin detection: /user response did not match the expected shape', { url });
      return null;
    }
    const isAdmin = parsed.data.is_admin ?? false;

    if (!isAdmin) {
      return { isAdmin: false, adminModeActive: false };
    }

    // Admin role confirmed. Probe a cheap admin-only listing to learn whether
    // admin mode is actually elevated: include_pending_delete is admin-gated.
    const probe = await enhancedFetch(
      `${url}/api/v4/projects?include_pending_delete=true&per_page=1`,
      { headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN, Accept: 'application/json' }, retry: false },
    );
    const status = probe.status;
    await probe.body?.cancel().catch(() => {});

    // Only 200 proves elevation; 403 is the expected "role without elevation"
    // (and the result for OAuth admins, which cannot elevate). Any other status
    // (5xx/429/...) is an indeterminate one-shot failure - fail open with null
    // rather than wrongly reporting elevation as inactive for the whole session.
    if (probe.ok) {
      return { isAdmin: true, adminModeActive: true };
    }
    if (status === 403) {
      return { isAdmin: true, adminModeActive: false };
    }
    logDebug('Admin detection: elevation probe returned an unexpected status', { status, url });
    return null;
  } catch (error) {
    logDebug('Admin detection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
