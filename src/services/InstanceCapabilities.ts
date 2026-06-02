import type { GitLabTier, GitLabFeatures } from './GitLabVersionDetector';
import type { GitLabScope } from './TokenScopeDetector';
import type { ToolRequirement, ToolRequirements } from '../types';
import { parseVersion } from '../utils/version';

/**
 * Aggregated, session-scoped view of a single GitLab instance's capabilities.
 *
 * Composes the previously scattered detection signals (version + tier + features
 * from {@link GitLabInstanceInfo}, token scopes from the token-scope detector,
 * admin elevation from #434) into one typed blob. The registry consults this to
 * decide which tools, actions, and parameters the instance can satisfy instead
 * of letting unsupported calls fail at the GitLab API with an opaque error.
 */
export interface InstanceCapabilities {
  /** Detected GitLab version (semver string), or 'unknown' when not yet probed. */
  version: string;
  /** Licensed tier. Free covers CE and EE-without-license. */
  tier: GitLabTier;
  /** Per-feature availability map (epics, iterations, vulnerabilities, ...). */
  features: GitLabFeatures;
  /** Token scopes (api, read_api, ...). Empty when scope detection was skipped. */
  scopes: GitLabScope[];
  /**
   * Whether the authenticated user is an instance admin. `undefined` when the
   * admin probe did not run (OAuth mode) or failed — treated as fail-open.
   */
  isAdmin?: boolean;
  /**
   * Whether GitLab admin-mode elevation is currently active for the session.
   * `undefined` when the admin probe did not run (OAuth mode) or failed.
   * OAuth tokens cannot elevate admin mode, so it stays undefined under OAuth.
   */
  adminModeActive?: boolean;
}

/**
 * Minimal slice of {@link InstanceCapabilities} needed to evaluate a tool
 * requirement. The registry holds only version/tier during cache builds (the
 * feature map and scopes are not consulted for version/tier/admin gating), so
 * the gating helpers accept this narrower shape and a full InstanceCapabilities
 * satisfies it structurally.
 */
export type CapabilityGate = Pick<InstanceCapabilities, 'version' | 'tier' | 'adminModeActive'>;

/** Tier hierarchy for comparison: free < premium < ultimate. */
const TIER_ORDER: Record<string, number> = { free: 0, premium: 1, ultimate: 2 };

/** Default requirement applied when a tool/action omits explicit thresholds. */
const DEFAULT_TIER = 'free' as const;
const DEFAULT_MIN_VERSION = '8.0';

/**
 * Conservative gate for GitLab-backed tools that declare no requirements at all
 * (a tool author forgot to annotate, or it is a future tool). Mirrors the legacy
 * "unknown tool" fallback so behaviour does not regress.
 */
const UNKNOWN_TOOL_MIN_VERSION = '15.0';

function isTierSufficient(actual: GitLabTier, required: ToolRequirement['tier']): boolean {
  const actualLevel = TIER_ORDER[actual] ?? 0;
  const requiredLevel = TIER_ORDER[required ?? DEFAULT_TIER] ?? 0;
  return actualLevel >= requiredLevel;
}

/**
 * Resolve the effective requirement for a tool, narrowing to an action-specific
 * override when one exists. Returns the tool default otherwise.
 */
export function resolveRequirement(reqs: ToolRequirements, action?: string): ToolRequirement {
  const override = action ? reqs.actions?.[action] : undefined;
  return override ?? reqs.default;
}

/**
 * Check whether the instance satisfies a single requirement (version + tier +
 * admin). When the version is unknown the requirement is treated as met
 * (fail-open) so tools are not hidden before detection completes. The admin gate
 * keys on admin-mode ELEVATION, not the role: admin-only endpoints return 403
 * unless admin mode is active, so an admin without elevation is gated out just
 * like a non-admin. It only filters when elevation is *known* inactive; an
 * undefined status (probe not landed / OAuth) is permissive.
 */
export function meetsRequirement(req: ToolRequirement, caps: CapabilityGate): boolean {
  // The admin gate is independent of version detection: if elevation is known
  // inactive, the endpoint will 403 regardless of whether the version probe
  // landed, so gate it BEFORE the version-unknown fail-open.
  if (req.requiresAdmin && caps.adminModeActive === false) return false;
  if (caps.version === 'unknown') return true;
  if (parseVersion(caps.version) < parseVersion(req.minVersion ?? DEFAULT_MIN_VERSION)) {
    return false;
  }
  if (!isTierSufficient(caps.tier, req.tier)) return false;
  return true;
}

/**
 * Whether a tool is available on the instance for the given (optional) action.
 *
 * @param reqs - The tool's declared requirements, or undefined when the tool
 *   declares none — in which case a conservative >= 15.0 gate applies (matching
 *   the legacy unknown-tool behaviour).
 */
export function isToolAvailable(
  reqs: ToolRequirements | undefined,
  caps: CapabilityGate,
  action?: string,
): boolean {
  if (!reqs) {
    // Unannotated tools have no admin gate; only the conservative version floor.
    return caps.version === 'unknown'
      ? true
      : parseVersion(caps.version) >= parseVersion(UNKNOWN_TOOL_MIN_VERSION);
  }
  // Delegate to meetsRequirement so the admin gate applies even when version is
  // unknown (it short-circuits version/tier internally).
  return meetsRequirement(resolveRequirement(reqs, action), caps);
}

/**
 * Names of parameters that must be stripped from a tool's JSON Schema because
 * the instance tier/version does not meet their declared requirement. Empty when
 * the tool gates no parameters or the version is unknown.
 */
export function getRestrictedParameters(
  reqs: ToolRequirements | undefined,
  caps: CapabilityGate,
): string[] {
  if (!reqs?.parameters) return [];
  // No blanket version-unknown skip: meetsRequirement still fail-opens version/tier
  // when unknown, but an admin-gated param with inactive elevation stays restricted.
  return Object.entries(reqs.parameters)
    .filter(([, req]) => !meetsRequirement(req, caps))
    .map(([name]) => name);
}

/**
 * Human-readable reason a tool/action is unavailable, or null when available.
 * Intended for diagnostics that explain why a tool was filtered.
 */
export function getUnmetReason(
  reqs: ToolRequirements | undefined,
  caps: CapabilityGate,
  action?: string,
): string | null {
  // Admin gate first — independent of version detection (see meetsRequirement).
  if (reqs && resolveRequirement(reqs, action).requiresAdmin && caps.adminModeActive === false) {
    return 'Requires active admin-mode elevation';
  }
  if (caps.version === 'unknown') return null;
  if (!reqs) {
    return parseVersion(caps.version) >= parseVersion(UNKNOWN_TOOL_MIN_VERSION)
      ? null
      : `Requires GitLab ${UNKNOWN_TOOL_MIN_VERSION}+, current version is ${caps.version}`;
  }
  const req = resolveRequirement(reqs, action);
  if (parseVersion(caps.version) < parseVersion(req.minVersion ?? DEFAULT_MIN_VERSION)) {
    return `Requires GitLab ${req.minVersion ?? DEFAULT_MIN_VERSION}+, current version is ${caps.version}`;
  }
  if (!isTierSufficient(caps.tier, req.tier)) {
    return `Requires GitLab ${req.tier ?? DEFAULT_TIER} tier or higher, current tier is ${caps.tier}`;
  }
  return null;
}

/**
 * Highest tier required by any of a tool's actions (or its default). Used by the
 * documentation generator to label a consolidated tool with its strictest tier.
 */
export function getHighestTier(reqs: ToolRequirements | undefined): GitLabTier {
  if (!reqs) return 'free';
  let highest: GitLabTier = reqs.default.tier ?? 'free';
  if (reqs.actions) {
    for (const req of Object.values(reqs.actions)) {
      const tier = req.tier ?? 'free';
      if ((TIER_ORDER[tier] ?? 0) > (TIER_ORDER[highest] ?? 0)) {
        highest = tier;
      }
    }
  }
  return highest;
}
