import * as path from 'path';
import * as fs from 'fs';
// Get package.json path
const packageJsonPath = path.resolve(process.cwd(), 'package.json');

// Environment variables
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
export const GITLAB_AUTH_COOKIE_PATH = process.env.GITLAB_AUTH_COOKIE_PATH;
export const IS_OLD = process.env.GITLAB_IS_OLD === 'true';
export const GITLAB_READ_ONLY_MODE = process.env.GITLAB_READ_ONLY_MODE === 'true';
export const GITLAB_DENIED_TOOLS_REGEX = process.env.GITLAB_DENIED_TOOLS_REGEX
  ? new RegExp(process.env.GITLAB_DENIED_TOOLS_REGEX)
  : undefined;
export const USE_GITLAB_WIKI = process.env.USE_GITLAB_WIKI !== 'false';
export const USE_MILESTONE = process.env.USE_MILESTONE !== 'false';
export const USE_PIPELINE = process.env.USE_PIPELINE !== 'false';
export const USE_WORKITEMS = process.env.USE_WORKITEMS !== 'false';
export const SSE = process.env.SSE === 'true';
export const STREAMABLE_HTTP = process.env.STREAMABLE_HTTP === 'true';
export const HOST = process.env.HOST ?? '0.0.0.0';
export const PORT = process.env.PORT ?? 3002;

// Proxy configuration
export const HTTP_PROXY = process.env.HTTP_PROXY;
export const HTTPS_PROXY = process.env.HTTPS_PROXY;
export const NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
export const GITLAB_CA_CERT_PATH = process.env.GITLAB_CA_CERT_PATH;

// GitLab API configuration
function normalizeGitLabApiUrl(url?: string): string {
  if (!url) {
    return 'https://gitlab.com/api/v4';
  }

  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  if (url.endsWith('/api/v4')) {
    return url;
  }

  return `${url}/api/v4`;
}

export const GITLAB_API_URL = normalizeGitLabApiUrl(process.env.GITLAB_API_URL ?? '');
export const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
export const GITLAB_ALLOWED_PROJECT_IDS =
  process.env.GITLAB_ALLOWED_PROJECT_IDS?.split(',').map((id) => id.trim()) ?? [];

export function getEffectiveProjectId(projectId: string): string {
  if (GITLAB_PROJECT_ID) {
    return GITLAB_PROJECT_ID;
  }

  if (GITLAB_ALLOWED_PROJECT_IDS.length > 0) {
    if (!GITLAB_ALLOWED_PROJECT_IDS.includes(projectId)) {
      throw new Error(
        `Project ID ${projectId} is not allowed. Allowed project IDs: ${GITLAB_ALLOWED_PROJECT_IDS.join(', ')}`,
      );
    }
  }

  return projectId;
}

// Package info
let packageName = 'gitlab-mcp';
let packageVersion = 'unknown';

try {
  const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    name?: string;
    version?: string;
  };
  packageName = packageInfo.name ?? packageName;
  packageVersion = packageInfo.version ?? packageVersion;
} catch {
  // Ignore errors when reading package.json
}

export { packageName, packageVersion };
