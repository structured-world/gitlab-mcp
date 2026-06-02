/**
 * InstanceCapabilities unit tests
 *
 * Covers the pure version/tier/admin gating helpers, parameter restriction,
 * unavailability reasons, the highest-tier documentation helper, the real
 * requirements declared on shipped tool definitions, and the ConnectionManager
 * capabilities aggregator.
 */

import {
  resolveRequirement,
  meetsRequirement,
  isToolAvailable,
  getRestrictedParameters,
  getUnmetReason,
  getHighestTier,
  type CapabilityGate,
} from '../../../src/services/InstanceCapabilities';
import { ToolRequirements } from '../../../src/types';

const free17: CapabilityGate = { version: '17.0.0', tier: 'free' };
const premium17: CapabilityGate = { version: '17.0.0', tier: 'premium' };
const ultimate17: CapabilityGate = { version: '17.0.0', tier: 'ultimate' };

const reqs: ToolRequirements = {
  default: { tier: 'free', minVersion: '8.0' },
  actions: {
    approve: { tier: 'premium', minVersion: '10.6', notes: 'MR approvals' },
    restore: { tier: 'free', minVersion: '18.0', requiresAdmin: true },
  },
  parameters: {
    weight: { tier: 'premium', minVersion: '15.0' },
    healthStatus: { tier: 'ultimate', minVersion: '15.0' },
  },
};

describe('resolveRequirement', () => {
  it('returns the default requirement when no action is given', () => {
    expect(resolveRequirement(reqs)).toEqual(reqs.default);
  });

  it('returns the action-specific override when present', () => {
    expect(resolveRequirement(reqs, 'approve').tier).toBe('premium');
  });

  it('falls back to default for an action without an override', () => {
    expect(resolveRequirement(reqs, 'list')).toEqual(reqs.default);
  });

  it('falls back to default when the tool declares no actions', () => {
    const noActions: ToolRequirements = { default: { tier: 'free', minVersion: '9.0' } };
    expect(resolveRequirement(noActions, 'whatever')).toEqual(noActions.default);
  });
});

describe('meetsRequirement', () => {
  it('passes when version and tier are sufficient', () => {
    expect(meetsRequirement({ tier: 'free', minVersion: '8.0' }, free17)).toBe(true);
  });

  it('fails when the version is too old', () => {
    expect(meetsRequirement({ minVersion: '18.0' }, free17)).toBe(false);
  });

  it('fails when the tier is insufficient', () => {
    expect(meetsRequirement({ tier: 'premium', minVersion: '8.0' }, free17)).toBe(false);
  });

  it('passes a premium requirement on an ultimate instance', () => {
    expect(meetsRequirement({ tier: 'premium', minVersion: '8.0' }, ultimate17)).toBe(true);
  });

  it('treats missing tier/version as the free/8.0 default', () => {
    expect(meetsRequirement({}, free17)).toBe(true);
  });

  it('fails an admin requirement only when admin-mode elevation is known inactive', () => {
    const adminReq = { requiresAdmin: true, minVersion: '8.0' };
    // Elevation inactive (non-admin, or admin role without elevation) -> gated out.
    expect(meetsRequirement(adminReq, { ...free17, adminModeActive: false })).toBe(false);
    // Active elevation -> allowed.
    expect(meetsRequirement(adminReq, { ...free17, adminModeActive: true })).toBe(true);
    // Undefined elevation (probe did not run under OAuth, or was indeterminate) is
    // permissive (fail-open).
    expect(meetsRequirement(adminReq, free17)).toBe(true);
  });

  it('is permissive when the version is unknown (detection deferred)', () => {
    const unknown: CapabilityGate = { version: 'unknown', tier: 'free' };
    expect(meetsRequirement({ tier: 'ultimate', minVersion: '99.0' }, unknown)).toBe(true);
  });
});

describe('isToolAvailable', () => {
  it('honors action-level requirements', () => {
    expect(isToolAvailable(reqs, free17, 'list')).toBe(true);
    expect(isToolAvailable(reqs, free17, 'approve')).toBe(false);
    expect(isToolAvailable(reqs, premium17, 'approve')).toBe(true);
  });

  it('allows every tool when the version is unknown', () => {
    const unknown: CapabilityGate = { version: 'unknown', tier: 'free' };
    expect(isToolAvailable(reqs, unknown, 'approve')).toBe(true);
    expect(isToolAvailable(undefined, unknown)).toBe(true);
  });

  it('applies a conservative >= 15.0 gate to tools without declared requirements', () => {
    expect(isToolAvailable(undefined, { version: '14.9.0', tier: 'ultimate' })).toBe(false);
    expect(isToolAvailable(undefined, { version: '15.0.0', tier: 'free' })).toBe(true);
  });
});

describe('getRestrictedParameters', () => {
  it('strips parameters whose tier/version is unmet on the instance', () => {
    const restricted = getRestrictedParameters(reqs, free17);
    expect(restricted).toContain('weight');
    expect(restricted).toContain('healthStatus');
  });

  it('strips only the ultimate parameter on a premium instance', () => {
    const restricted = getRestrictedParameters(reqs, premium17);
    expect(restricted).not.toContain('weight');
    expect(restricted).toContain('healthStatus');
  });

  it('strips nothing on an ultimate instance', () => {
    expect(getRestrictedParameters(reqs, ultimate17)).toEqual([]);
  });

  it('strips nothing when the version is unknown or no parameters are gated', () => {
    expect(getRestrictedParameters(reqs, { version: 'unknown', tier: 'free' })).toEqual([]);
    expect(getRestrictedParameters({ default: { tier: 'free' } }, free17)).toEqual([]);
    expect(getRestrictedParameters(undefined, free17)).toEqual([]);
  });
});

describe('getUnmetReason', () => {
  it('returns null when the requirement is satisfied', () => {
    expect(getUnmetReason(reqs, free17, 'list')).toBeNull();
  });

  it('explains an unmet version requirement', () => {
    expect(getUnmetReason({ default: { minVersion: '18.0' } }, free17)).toContain('18.0+');
  });

  it('explains an unmet tier requirement', () => {
    expect(getUnmetReason(reqs, free17, 'approve')).toContain('premium tier');
  });

  it('explains an unmet admin requirement (once version/tier are met)', () => {
    // restore requires 18.0 + admin; use an 18.0 instance so the admin gate is reached.
    const reason = getUnmetReason(
      reqs,
      { version: '18.0.0', tier: 'free', adminModeActive: false },
      'restore',
    );
    expect(reason).toContain('admin');
  });

  it('returns null when the version is unknown', () => {
    expect(getUnmetReason(reqs, { version: 'unknown', tier: 'free' }, 'approve')).toBeNull();
  });

  it('gates an unannotated tool conservatively and reports the reason', () => {
    expect(getUnmetReason(undefined, { version: '14.0.0', tier: 'ultimate' })).toContain('15.0+');
    expect(getUnmetReason(undefined, { version: '16.0.0', tier: 'free' })).toBeNull();
  });
});

describe('getHighestTier', () => {
  it('returns free for a tool whose actions are all free', () => {
    expect(getHighestTier({ default: { tier: 'free', minVersion: '8.0' } })).toBe('free');
  });

  it('returns the strictest action tier', () => {
    expect(getHighestTier(reqs)).toBe('premium');
  });

  it('returns free for an undefined requirement', () => {
    expect(getHighestTier(undefined)).toBe('free');
  });
});

describe('shipped tool requirements (real data)', () => {
  // These assert that the requirements migrated onto real tool definitions are
  // correct, end-to-end — a regression here means a tool would be mis-gated.
  it('marks browse_iterations as premium 13.1', () => {
    const { iterationsToolRegistry } = require('../../../src/entities/iterations/registry');
    const req = iterationsToolRegistry.get('browse_iterations')?.requirements;
    expect(req?.default).toEqual({
      tier: 'premium',
      minVersion: '13.1',
      notes: 'Iterations/Sprints',
    });
  });

  it('gates browse_work_items at free 15.0 and manage_work_item params by tier', () => {
    const { workitemsToolRegistry } = require('../../../src/entities/workitems/registry');
    expect(workitemsToolRegistry.get('browse_work_items')?.requirements?.default).toEqual({
      tier: 'free',
      minVersion: '15.0',
    });
    const params = workitemsToolRegistry.get('manage_work_item')?.requirements?.parameters;
    expect(params?.weight?.tier).toBe('premium');
    expect(params?.iterationId?.tier).toBe('premium');
    expect(params?.healthStatus?.tier).toBe('ultimate');
  });

  it('keeps the MR approvals action premium while the tool default stays free', () => {
    const { mrsToolRegistry } = require('../../../src/entities/mrs/registry');
    const req = mrsToolRegistry.get('browse_merge_requests')?.requirements;
    expect(req?.default.tier).toBe('free');
    expect(req?.actions?.approvals?.tier).toBe('premium');
  });

  it('marks the milestones burndown action premium 12.0', () => {
    const { milestonesToolRegistry } = require('../../../src/entities/milestones/registry');
    const req = milestonesToolRegistry.get('browse_milestones')?.requirements;
    expect(req?.actions?.burndown).toEqual({
      tier: 'premium',
      minVersion: '12.0',
      notes: 'Burndown charts',
    });
  });

  it('tier-gates the premium/ultimate group attributes on manage_namespace', () => {
    const { coreToolRegistry } = require('../../../src/entities/core/registry');
    const tool = coreToolRegistry.get('manage_namespace');
    const params = tool?.requirements?.parameters;
    expect(params?.membership_lock?.tier).toBe('premium');
    expect(params?.wiki_access_level?.tier).toBe('premium');
    expect(params?.unique_project_download_limit?.tier).toBe('ultimate');

    // Gated params must actually exist in the tool schema — otherwise the gate
    // is dead config that strips nothing.
    const schemaJson = JSON.stringify(tool?.inputSchema);
    for (const name of Object.keys(params)) {
      expect(schemaJson).toContain(name);
    }

    // Free strips all gated params; ultimate strips none. Order is irrelevant,
    // so compare as sets.
    const free = { version: '17.0.0', tier: 'free' as const };
    const ultimate = { version: '17.0.0', tier: 'ultimate' as const };
    expect(new Set(getRestrictedParameters(tool.requirements, free))).toEqual(
      new Set(Object.keys(params)),
    );
    expect(getRestrictedParameters(tool.requirements, ultimate)).toEqual([]);
  });

  it('tier-gates the premium/ultimate project attributes on manage_project', () => {
    const { coreToolRegistry } = require('../../../src/entities/core/registry');
    const tool = coreToolRegistry.get('manage_project');
    const params = tool?.requirements?.parameters;
    expect(params?.merge_pipelines_enabled?.tier).toBe('premium');
    expect(params?.issues_template?.tier).toBe('premium');
    expect(params?.requirements_access_level?.tier).toBe('ultimate');
    expect(params?.only_allow_merge_if_all_status_checks_passed?.tier).toBe('ultimate');

    const schemaJson = JSON.stringify(tool?.inputSchema);
    for (const name of Object.keys(params)) {
      expect(schemaJson).toContain(name);
    }

    // Premium instance keeps premium params, still strips the ultimate ones.
    const premium = { version: '17.0.0', tier: 'premium' as const };
    expect(new Set(getRestrictedParameters(tool.requirements, premium))).toEqual(
      new Set(['only_allow_merge_if_all_status_checks_passed', 'requirements_access_level']),
    );
  });
});

describe('ConnectionManager.getInstanceCapabilities', () => {
  it('composes instance info and token scopes into one blob', () => {
    const { ConnectionManager } = require('../../../src/services/ConnectionManager');
    const cm = ConnectionManager.getInstance();
    const features = { workItems: true } as any;
    jest.spyOn(cm, 'getInstanceInfo').mockReturnValue({
      version: '17.0.0',
      tier: 'premium',
      features,
      detectedAt: new Date('2024-01-15T10:00:00Z'),
    });
    jest.spyOn(cm, 'getTokenScopeInfo').mockReturnValue({ scopes: ['api', 'read_user'] } as any);

    const caps = cm.getInstanceCapabilities();

    expect(caps).toEqual({
      version: '17.0.0',
      tier: 'premium',
      features,
      scopes: ['api', 'read_user'],
    });
    expect(caps.isAdmin).toBeUndefined();
  });

  it('defaults scopes to an empty array when scope detection is unavailable', () => {
    const { ConnectionManager } = require('../../../src/services/ConnectionManager');
    const cm = ConnectionManager.getInstance();
    jest.spyOn(cm, 'getInstanceInfo').mockReturnValue({
      version: '16.0.0',
      tier: 'free',
      features: {} as any,
      detectedAt: new Date(),
    });
    jest.spyOn(cm, 'getTokenScopeInfo').mockReturnValue(null);

    expect(cm.getInstanceCapabilities().scopes).toEqual([]);
  });
});
