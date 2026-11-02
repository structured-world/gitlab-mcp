/**
 * Subscription observations scoped to a credential and root namespace.
 * These disposable facts guide discovery, not GitLab authorization.
 */
import { createHash } from 'node:crypto';
import type { NamespaceTierInfo } from '../oauth/types';
import type { GitLabTier } from './GitLabVersionDetector';
import { getTokenContext } from '../oauth/token-context';
import { enhancedFetch, getAuthHeaders } from '../utils/fetch';
import { getGitLabBaseUrl } from '../utils/gitlab-base-url';
import { normalizeInstanceUrl } from '../utils/url';
import { readBoundedJson } from '../utils/bounded-json';
import { canonicalProjectPath, encodeApiSegment } from '../utils/api-path';
import { logWarn } from '../logger';
import { isOAuthEnabled } from '../oauth/config';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_CAPACITY = 1024;
const namespaceTierCache = new Map<string, Map<string, NamespaceTierInfo>>();

interface Identity {
  baseUrl: string;
  headers: Record<string, string>;
  credential: string;
  sessionId: string;
}

// Plan names: https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/app/models/ee/plan.rb
// Legacy plans without an equivalent in the supported three-tier model stay unknown.
const PLAN_TIERS = new Map<string, GitLabTier>([
  ['free', 'free'],
  ['default', 'free'],
  ['premium', 'premium'],
  ['premium_trial', 'premium'],
  ['silver', 'premium'],
  ['ultimate', 'ultimate'],
  ['ultimate_trial', 'ultimate'],
  ['gold', 'ultimate'],
  ['opensource', 'ultimate'],
]);

function identity(): Identity | null {
  const context = getTokenContext();
  if (isOAuthEnabled() && !context?.gitlabToken) return null;
  if (
    context?.gitlabScopes &&
    !context.gitlabScopes.some((scope) => scope === 'api' || scope === 'read_api')
  )
    return null;
  const baseUrl = getGitLabBaseUrl();
  if (!baseUrl) return null;
  const headers = getAuthHeaders(baseUrl);
  if (Object.keys(headers).length === 0) return null;
  const credential = createHash('sha256')
    .update(context ? String(context.gitlabUserId) : '')
    .update('\0')
    .update(JSON.stringify(headers))
    .digest('hex');
  return {
    baseUrl: normalizeInstanceUrl(baseUrl),
    headers,
    credential,
    sessionId: context ? context.sessionId : credential,
  };
}

/** Optional billing lookups use exactly the transport's selected instance and credential. */
export function canResolveNamespaceTier(instanceUrl: string): boolean {
  const caller = identity();
  return caller !== null && caller.baseUrl === normalizeInstanceUrl(instanceUrl);
}

function unknown(): NamespaceTierInfo {
  return { tier: null, cachedAt: new Date() };
}

function cached(sessionId: string, key: string): NamespaceTierInfo | undefined {
  const entries = namespaceTierCache.get(sessionId);
  const value = entries?.get(key);
  if (!value) return undefined;
  if (Date.now() - value.cachedAt.getTime() > CACHE_TTL_MS) {
    entries?.delete(key);
    if (entries?.size === 0) namespaceTierCache.delete(sessionId);
    return undefined;
  }
  return value;
}

function remember(sessionId: string, key: string, value: NamespaceTierInfo): void {
  let entries = namespaceTierCache.get(sessionId);
  if (!entries) {
    entries = new Map();
    namespaceTierCache.set(sessionId, entries);
  }
  entries.set(key, value);
  let count = 0;
  for (const values of namespaceTierCache.values()) count += values.size;
  if (count <= CACHE_CAPACITY) return;
  const oldestSession = namespaceTierCache.keys().next().value;
  if (oldestSession === undefined) return;
  const oldest = namespaceTierCache.get(oldestSession);
  if (!oldest) return;
  const oldestKey = oldest.keys().next().value;
  if (oldestKey !== undefined) oldest.delete(oldestKey);
  if (oldest.size === 0) namespaceTierCache.delete(oldestSession);
}

export function clearNamespaceTierCache(sessionId?: string): void {
  if (sessionId !== undefined) namespaceTierCache.delete(sessionId);
  else namespaceTierCache.clear();
}

async function readMetadata(
  path: string,
  caller: Identity,
  limit: number,
): Promise<{ status: number; value: unknown }> {
  const response = await enhancedFetch(`${caller.baseUrl}/api/v4/${path}`, {
    method: 'GET',
    headers: caller.headers,
    rateLimitBaseUrl: caller.baseUrl,
  });
  if (!response.ok) {
    await response.body?.cancel();
    logWarn('Namespace subscription metadata is unavailable', { status: response.status });
    return { status: response.status, value: null };
  }
  return { status: response.status, value: await readBoundedJson(response, limit) };
}

function stringField(value: unknown, field: string): string | null {
  if (value === null || typeof value !== 'object' || !(field in value)) return null;
  const result = (value as Record<string, unknown>)[field];
  return typeof result === 'string' ? result : null;
}

/** GitLab namespaces inherit the subscription of their root namespace. */
function rootOf(path: string): string | null {
  const canonical = canonicalProjectPath(path);
  const separator = canonical.indexOf('/');
  const root = separator === -1 ? canonical : canonical.slice(0, separator);
  // Namespace::URL_MAX_LENGTH, app/models/namespace.rb at v16.0.0-ee.
  return root.length > 0 && root.length <= 255 ? root : null;
}

/** Match the handlers' group-first resolution, falling through only on a confirmed 404. */
async function numericTargetPath(
  id: string,
  kind: 'project' | 'group' | 'either',
  caller: Identity,
): Promise<string | null> {
  const collection = kind === 'project' ? 'projects' : 'groups';
  const query = collection === 'groups' ? '?with_projects=false' : '';
  const { status, value } = await readMetadata(
    `${collection}/${encodeApiSegment(id)}${query}`,
    caller,
    1024 * 1024,
  );
  if (kind === 'either' && status === 404) return numericTargetPath(id, 'project', caller);
  return stringField(value, kind === 'project' ? 'path_with_namespace' : 'full_path');
}

/**
 * Read a root subscription, resolving typed numeric targets first.
 * GitLab 16.0 exposes plan only with admin_namespace permission:
 * https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/lib/ee/api/entities/namespace.rb#L28-30
 */
export async function getNamespaceTier(
  namespacePath: string,
  targetKind?: 'project' | 'group' | 'either',
): Promise<NamespaceTierInfo> {
  const canonical = canonicalProjectPath(namespacePath);
  const root = rootOf(canonical);
  if (root === null) return unknown();
  const caller = identity();
  if (caller === null) return unknown();
  const numeric = targetKind !== undefined && /^\d+$/.test(canonical);
  const target = numeric ? `${targetKind}:${canonical}` : `namespace:${root}`;
  const key = JSON.stringify([caller.baseUrl, caller.credential, target]);
  const previous = cached(caller.sessionId, key);
  if (previous) return previous;

  let observation: NamespaceTierInfo;
  try {
    const path = numeric ? await numericTargetPath(canonical, targetKind, caller) : root;
    const namespace = path === null ? null : rootOf(path);
    if (namespace === null) observation = unknown();
    else {
      const { value } = await readMetadata(
        `namespaces/${encodeApiSegment(namespace)}`,
        caller,
        64 * 1024,
      );
      const plan = stringField(value, 'plan');
      const tier = plan === null ? undefined : PLAN_TIERS.get(plan.toLowerCase());
      observation = { tier: tier ?? null, cachedAt: new Date() };
    }
  } catch {
    // Provider bodies and parser exceptions can contain secrets; never include them.
    logWarn('Namespace subscription metadata could not be read');
    observation = unknown();
  }
  remember(caller.sessionId, key, observation);
  return observation;
}

export function getNamespaceTierCacheMetrics(): {
  totalEntries: number;
  entriesBySession: Map<string, number>;
} {
  const entriesBySession = new Map<string, number>();
  let totalEntries = 0;
  for (const [sessionId, entries] of namespaceTierCache) {
    entriesBySession.set(sessionId, entries.size);
    totalEntries += entries.size;
  }
  return { totalEntries, entriesBySession };
}
