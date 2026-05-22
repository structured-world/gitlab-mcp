/**
 * Tier-gating helper for integration tests.
 *
 * Some integration tests exercise features that require a paid GitLab tier
 * (Premium/Ultimate). When the target instance is GitLab Free (or EE binary
 * without a license), those tests must be SKIPPED rather than failed — the
 * underlying behavior is "feature unavailable", not "code broken".
 *
 * Tier is detected once in globalSetup.js (one HTTP call against currentLicense)
 * and written to a tmp file. This module reads it synchronously at module load
 * so describeIfTier can be used at module top-level inside test files.
 *
 * Usage:
 *
 *   import { describeIfTier, itIfTier } from '../setup/tierGate';
 *
 *   describeIfTier('ultimate', 'Requirements verification', () => {
 *     it('verifies a requirement', async () => { ... });
 *   });
 *
 *   describe('mixed-tier suite', () => {
 *     it('runs on all tiers', () => { ... });
 *     itIfTier('premium', 'runs on premium and ultimate', () => { ... });
 *   });
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

export type GitLabTier = 'free' | 'premium' | 'ultimate';

/**
 * Internal detection result. 'unknown' is a sentinel meaning globalSetup
 * could not determine the tier (network failure / 4xx / GraphQL error).
 * We never gate on 'unknown' — it bypasses skip logic so the suite runs
 * and fails loudly with the real underlying error instead of producing a
 * misleading green run with silent skips.
 */
type DetectedTier = GitLabTier | 'unknown';

const TIER_RANK: Record<GitLabTier, number> = { free: 0, premium: 1, ultimate: 2 };

// Cache file is written by globalSetup.js across a process boundary, so treat
// it as untrusted input and validate with Zod (project convention for any
// external/runtime-loaded payload).
const TierCacheSchema = z.object({
  tier: z.enum(['free', 'premium', 'ultimate', 'unknown']).optional(),
  detectionFailed: z.boolean().optional(),
  reason: z.string().optional(),
});

// Mirror globalSetup.js: namespace by checkout root hash so concurrent runs
// across worktrees (or NFS-shared tmpdirs) don't collide on the same cache file.
// sha256 here is a cache-key digest, not a security primitive.
const REPO_HASH = crypto
  .createHash('sha256')
  .update(path.resolve(__dirname, '../..'))
  .digest('hex')
  .slice(0, 12);

const TIER_FILE = path.join(os.tmpdir(), `gitlab-mcp-detected-tier-${REPO_HASH}.json`);

function readDetectedTier(): DetectedTier {
  try {
    if (!fs.existsSync(TIER_FILE)) return 'unknown';
    const parsed = TierCacheSchema.safeParse(JSON.parse(fs.readFileSync(TIER_FILE, 'utf8')));
    if (!parsed.success || !parsed.data.tier) return 'unknown';
    return parsed.data.tier;
  } catch {
    return 'unknown';
  }
}

const DETECTED_TIER: DetectedTier = readDetectedTier();

/**
 * Return the tier detected during globalSetup. Returns 'unknown' when
 * detection failed (network/auth/cache-miss) — caller can distinguish a
 * confirmed Free instance from a failed detection.
 */
export function getDetectedTier(): DetectedTier {
  return DETECTED_TIER;
}

/**
 * True if the detected tier satisfies (>=) the required tier.
 * When detection failed ('unknown'), returns true — we'd rather run the
 * gated suite and fail loudly with the real error than silently skip and
 * hide regressions behind a misleading green-with-pending run.
 */
export function tierSatisfies(required: GitLabTier): boolean {
  if (DETECTED_TIER === 'unknown') return true;
  return TIER_RANK[DETECTED_TIER] >= TIER_RANK[required];
}

/**
 * Describe block that runs only when the detected GitLab tier meets the
 * required minimum. Otherwise emits describe.skip so the suite reports as
 * pending instead of failing.
 */
export function describeIfTier(required: GitLabTier, name: string, fn: () => void): void {
  if (tierSatisfies(required)) {
    describe(name, fn);
  } else {
    describe.skip(`${name} [skipped: requires ${required}, detected ${DETECTED_TIER}]`, fn);
  }
}

/**
 * It block that runs only when the detected GitLab tier meets the required
 * minimum. Useful for a single tier-gated assertion inside an otherwise
 * tier-agnostic describe block.
 */
export function itIfTier(
  required: GitLabTier,
  name: string,
  fn: jest.ProvidesCallback,
  timeout?: number,
): void {
  if (tierSatisfies(required)) {
    it(name, fn, timeout);
  } else {
    it.skip(`${name} [skipped: requires ${required}, detected ${DETECTED_TIER}]`, fn, timeout);
  }
}
