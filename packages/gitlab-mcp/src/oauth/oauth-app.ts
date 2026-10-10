/**
 * GitLab OAuth application a sign-in runs against: the instance and the application
 * registered on it. Every GitLab OAuth call of one account uses the same application.
 */

import { GITLAB_BASE_URL } from '../config';
import { normalizeInstanceUrl } from '../utils/url';
import type { OAuthConfig } from './config';

export interface GitLabOAuthApp {
  /** Instance base URL, normalized; may include a base path. */
  baseUrl: string;
  /** Human-readable instance label, when configured. */
  label?: string;
  /** OAuth application ID on that instance. */
  clientId: string;
  /** Secret, only for confidential applications. */
  clientSecret?: string;
  /** Scopes requested from GitLab (comma or space separated). */
  scopes: string;
}

/** Application from OAUTH_CLIENT_ID on GITLAB_API_URL, used when no instance was chosen. */
export function defaultOAuthApp(config: OAuthConfig): GitLabOAuthApp {
  return {
    baseUrl: normalizeInstanceUrl(GITLAB_BASE_URL),
    clientId: config.gitlabClientId,
    clientSecret: config.gitlabClientSecret,
    scopes: config.gitlabScopes,
  };
}
