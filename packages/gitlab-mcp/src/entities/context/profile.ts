/**
 * Account profile of the connection
 *
 * The identity comes from the validated credentials of the request: the GitLab instance and
 * the user GitLab reports for the token. The id is opaque and stable across token refresh
 * and reconnect, and differs for equal user ids on different instances; display values are
 * returned only when GitLab provides them.
 */

import { createHash } from 'crypto';
import { GITLAB_BASE_URL } from '../../config';
import { logDebug } from '../../logger';
import { getGitLabApiUrlFromContext, getTokenContext } from '../../oauth/token-context';
import { enhancedFetch } from '../../utils/fetch';
import { normalizeInstanceUrl } from '../../utils/url';

/** Profile returned to the host (OpenAI `openai/profile` contract). */
export interface AccountProfile {
  id: string;
  name?: string;
  email?: string;
  nickname?: string;
}

/** Output schema of the profile tool; the host renders exactly these fields. */
export const ACCOUNT_PROFILE_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', minLength: 1, pattern: '\\S' },
    name: { type: 'string' },
    email: { type: 'string' },
    nickname: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
};

interface GitLabCurrentUser {
  id: number;
  username: string;
  name?: string;
  email?: string;
  public_email?: string;
}

/** Opaque id of one GitLab user on one instance; no name, email or token goes into it. */
export function accountProfileId(instanceUrl: string, gitlabUserId: number): string {
  const digest = createHash('sha256')
    .update(`${normalizeInstanceUrl(instanceUrl)}\n${gitlabUserId}`)
    .digest('base64url');
  return `gitlab:${digest}`;
}

async function fetchCurrentUser(instanceUrl: string): Promise<GitLabCurrentUser | null> {
  try {
    const response = await enhancedFetch(`${instanceUrl}/api/v4/user`, { retry: false });
    if (!response.ok) {
      logDebug('Profile: GitLab did not return the current user', { status: response.status });
      return null;
    }
    return (await response.json()) as GitLabCurrentUser;
  } catch (error) {
    logDebug('Profile: failed to fetch the current user', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function instanceName(instanceUrl: string, label: string | undefined): string {
  if (label) return label;
  try {
    return new URL(instanceUrl).host;
  } catch {
    return instanceUrl;
  }
}

/**
 * Resolve the profile of the account behind this request. With OAuth the user id comes
 * from the linked account; otherwise from GitLab for the configured token.
 *
 * @throws Error when no account can be identified
 */
export async function getAccountProfile(): Promise<AccountProfile> {
  const context = getTokenContext();
  const instanceUrl = normalizeInstanceUrl(getGitLabApiUrlFromContext() ?? GITLAB_BASE_URL);
  const user = await fetchCurrentUser(instanceUrl);

  const userId = context?.gitlabUserId ?? user?.id;
  const username = context?.gitlabUsername ?? user?.username;
  if (userId === undefined || username === undefined) {
    throw new Error('GitLab did not identify the account for this connection');
  }

  const email = user?.email ?? user?.public_email;
  return {
    id: accountProfileId(instanceUrl, userId),
    ...(user?.name ? { name: user.name } : {}),
    ...(email ? { email } : {}),
    nickname: `${username} @ ${instanceName(instanceUrl, context?.instanceLabel)}`,
  };
}
