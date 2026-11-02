import {
  extractGroupsFromArgs,
  extractProjectsFromArgs,
  numericTargets,
} from '../profiles/scope-enforcer';
import type { ScopeConfig } from '../profiles/types';
import type { ToolRequirements } from '../types';
import { getNamespaceTier } from '../services/NamespaceTierDetector';
import { TIER_ORDER } from '../services/InstanceCapabilities';
import {
  hasNamespaceSubscriptions,
  runWithNamespaceTier,
} from '../services/namespace-tier-context';
import { canonicalProjectPath } from '../utils/api-path';
import { mapBounded } from '../utils/bounded-map';
import type { GitLabTier } from '../services/GitLabVersionDetector';

export interface NamespaceTarget {
  path: string;
  kind: 'project' | 'group' | 'either';
}

/** Stop optional lookups once one target makes a complete tier decision impossible. */
class UnknownSubscription extends Error {}

export function namespaceTargetsForScope(scope: ScopeConfig | undefined): NamespaceTarget[] {
  if (!scope) return [];
  const targets: NamespaceTarget[] = [];
  for (const path of [scope.project, ...(scope.projects ?? [])])
    if (path !== undefined) targets.push({ path, kind: 'project' });
  for (const path of [scope.group, scope.namespace, ...(scope.groups ?? [])])
    if (path !== undefined) targets.push({ path, kind: 'group' });
  return targets;
}

/** Numeric namespace arguments retain the handler's group-first ambiguity. */
export function namespaceTargetsForArgs(args: Record<string, unknown>): NamespaceTarget[] {
  const targets: NamespaceTarget[] = numericTargets(args).map(({ id, kind }) => ({
    path: id,
    kind,
  }));
  for (const path of extractProjectsFromArgs(args))
    if (!/^\d+$/.test(path)) targets.push({ path, kind: 'project' });
  for (const path of extractGroupsFromArgs(args))
    if (!/^\d+$/.test(path)) targets.push({ path, kind: 'group' });
  return targets;
}

export function needsNamespaceTier(requirements: ToolRequirements | undefined): boolean {
  if (!requirements) return false;
  return [
    requirements.default,
    ...Object.values(requirements.actions ?? {}),
    ...Object.values(requirements.parameters ?? {}),
  ].some((req) => req.tier !== undefined && req.tier !== 'free');
}

function distinctRoots(targets: readonly NamespaceTarget[]): NamespaceTarget[] | null {
  const unique = new Map<string, NamespaceTarget>();
  for (const target of targets) {
    // An opaque GID is resolved by its owning handler, not guessed to be a namespace.
    if (target.path.startsWith('gid://')) return null;
    let path: string;
    try {
      path = canonicalProjectPath(target.path);
    } catch {
      return null;
    }
    const slash = path.indexOf('/');
    const key = /^\d+$/.test(path)
      ? `${target.kind}:${path}`
      : slash < 0
        ? path
        : path.slice(0, slash);
    unique.set(key, target);
  }
  return [...unique.values()];
}

function selectedTier(tiers: readonly GitLabTier[], union: boolean): GitLabTier | null {
  let tier: GitLabTier | null = null;
  for (const observation of tiers) {
    if (!union && tier !== null && tier !== observation) return null;
    if (tier === null || TIER_ORDER[observation] > TIER_ORDER[tier]) tier = observation;
  }
  return tier;
}

/** Catalogs expose the union; a call spanning different subscriptions defers to GitLab. */
export async function withNamespaceCapabilities<T>(
  instanceUrl: string,
  targets: readonly NamespaceTarget[],
  union: boolean,
  fn: () => T,
): Promise<Awaited<T>> {
  if (!hasNamespaceSubscriptions(instanceUrl)) return await fn();
  const unique = distinctRoots(targets);
  if (unique === null) return await runWithNamespaceTier(instanceUrl, null, fn);
  let observations;
  try {
    observations = await mapBounded(unique, 5, async (target) => {
      const info = await getNamespaceTier(target.path, target.kind);
      if (info.tier === null) throw new UnknownSubscription();
      return info.tier;
    });
  } catch (error) {
    if (!(error instanceof UnknownSubscription)) throw error;
    return await runWithNamespaceTier(instanceUrl, null, fn);
  }
  return await runWithNamespaceTier(instanceUrl, selectedTier(observations, union), fn);
}
