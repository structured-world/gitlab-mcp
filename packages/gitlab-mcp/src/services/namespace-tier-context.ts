import { AsyncLocalStorage } from 'node:async_hooks';
import type { GitLabTier } from './GitLabVersionDetector';
import { normalizeInstanceUrl } from '../utils/url';

interface NamespaceTierContext {
  instanceUrl: string;
  tier: GitLabTier | null;
}

const storage = new AsyncLocalStorage<NamespaceTierContext>();

/** GitLab.com subscriptions attach to top-level groups, not the shared instance.
 * https://docs.gitlab.com/subscriptions/manage_subscription/ */
export function hasNamespaceSubscriptions(instanceUrl: string): boolean {
  return normalizeInstanceUrl(instanceUrl) === 'https://gitlab.com';
}

export function currentNamespaceTier(instanceUrl: string): NamespaceTierContext | undefined {
  const context = storage.getStore();
  return context?.instanceUrl === normalizeInstanceUrl(instanceUrl) ? context : undefined;
}

/** A request's subscription never changes another request or the connection's metadata. */
export function runWithNamespaceTier<T>(
  instanceUrl: string,
  tier: GitLabTier | null,
  fn: () => T,
): T {
  return storage.run({ instanceUrl: normalizeInstanceUrl(instanceUrl), tier }, fn);
}
