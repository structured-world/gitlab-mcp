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
  effectiveMinVersion,
  MIN_SUPPORTED_VERSION,
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

  it('treats missing tier/version as free at the supported floor', () => {
    expect(meetsRequirement({}, free17)).toBe(true);
    expect(meetsRequirement({}, { version: '15.11.0', tier: 'ultimate' })).toBe(false);
  });

  it('never lets a declared minVersion lower the supported floor', () => {
    // A stale sub-floor declaration must not re-admit an unsupported instance.
    expect(meetsRequirement({ minVersion: '8.0' }, { version: '15.11.0', tier: 'free' })).toBe(
      false,
    );
    expect(effectiveMinVersion({ minVersion: '8.0' })).toBe(MIN_SUPPORTED_VERSION);
    expect(effectiveMinVersion({ minVersion: '17.2' })).toBe('17.2');
    expect(effectiveMinVersion(undefined)).toBe(MIN_SUPPORTED_VERSION);
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

  it('still enforces the admin gate when version is unknown', () => {
    // version-unknown fail-open covers version/tier, but admin elevation is a
    // separate known signal: inactive elevation must still gate admin requirements.
    const unknownNoElevation: CapabilityGate = {
      version: 'unknown',
      tier: 'free',
      adminModeActive: false,
    };
    expect(meetsRequirement({ requiresAdmin: true }, unknownNoElevation)).toBe(false);
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

  it('applies the supported version floor to tools without declared requirements', () => {
    expect(isToolAvailable(undefined, { version: '15.11.0', tier: 'ultimate' })).toBe(false);
    expect(isToolAvailable(undefined, { version: '16.0.0', tier: 'free' })).toBe(true);
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

  it('strips an admin-gated param when elevation is inactive even if version is unknown', () => {
    const adminReqs = {
      default: { tier: 'free' as const },
      parameters: { include_deleted: { requiresAdmin: true } },
    };
    expect(
      getRestrictedParameters(adminReqs, {
        version: 'unknown',
        tier: 'free',
        adminModeActive: false,
      }),
    ).toContain('include_deleted');
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

  it('gates an unannotated tool at the supported floor and reports the reason', () => {
    expect(getUnmetReason(undefined, { version: '15.11.0', tier: 'ultimate' })).toContain('16.0+');
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
  it('marks browse_iterations as premium at the supported floor', () => {
    const { iterationsToolRegistry } = require('../../../src/entities/iterations/registry');
    const req = iterationsToolRegistry.get('browse_iterations')?.requirements;
    expect(req?.default).toEqual({ tier: 'premium', notes: 'Iterations/Sprints' });
  });

  it('keeps work items available from the floor, gating only the link mutations', () => {
    // Queries adapt to the instance schema and fall back to project/group
    // queries, so only the linked-items mutations (no older equivalent) are gated.
    const { workitemsToolRegistry } = require('../../../src/entities/workitems/registry');
    const browse = workitemsToolRegistry.get('browse_work_items')?.requirements;
    const floor = { version: '16.0.0', tier: 'ultimate' as const };
    expect(isToolAvailable(browse, floor, 'list')).toBe(true);
    expect(isToolAvailable(browse, floor, 'get')).toBe(true);

    const manage = workitemsToolRegistry.get('manage_work_item')?.requirements;
    const at = (version: string) => ({ version, tier: 'ultimate' as const });
    expect(isToolAvailable(manage, at('16.0.0'), 'create')).toBe(true);
    expect(isToolAvailable(manage, at('16.0.0'), 'update')).toBe(true);
    expect(isToolAvailable(manage, at('16.3.0'), 'add_link')).toBe(false);
    expect(isToolAvailable(manage, at('16.4.0'), 'remove_link')).toBe(true);
    expect(manage?.parameters?.weight?.tier).toBe('premium');
    expect(manage?.parameters?.iterationId?.tier).toBe('premium');
    expect(manage?.parameters?.healthStatus?.tier).toBe('ultimate');
  });

  it('keeps the MR approvals action premium while the tool default stays free', () => {
    const { mrsToolRegistry } = require('../../../src/entities/mrs/registry');
    const req = mrsToolRegistry.get('browse_merge_requests')?.requirements;
    expect(req?.default.tier).toBe('free');
    expect(req?.actions?.approvals?.tier).toBe('premium');
  });

  it.each([
    // [registry module, tool, action or undefined, parameter or undefined, first version]
    // Only capabilities GitLab cannot provide on older instances are gated; the
    // rest are emulated in the handlers.
    ['files', 'browse_files', 'download_attachment', undefined, '17.4'],
    ['webhooks', 'manage_webhook', 'test', undefined, '16.11'],
    ['webhooks', 'manage_webhook', undefined, 'feature_flag_events', '17.5'],
    ['webhooks', 'manage_webhook', undefined, 'project_events', '18.2'],
    ['pipelines', 'manage_pipeline', undefined, 'inputs', '17.10'],
    ['workitems', 'manage_work_item', 'add_link', undefined, '16.4'],
  ])('%s: %s %s %s requires GitLab %s', (module, toolName, action, param, version) => {
    // Versions verified against GitLab sources at the release tags (see AGENTS.md).
    const registry: Map<string, { requirements: ToolRequirements }> = Object.values(
      require(`../../../src/entities/${module}/registry`),
    ).find((v) => v instanceof Map) as Map<string, { requirements: ToolRequirements }>;
    const reqs = registry.get(toolName)!.requirements;
    const [major, minor] = version.split('.').map(Number);
    const before = { version: `${major}.${minor - 1}.0`, tier: 'ultimate' as const };
    const at = { version: `${version}.0`, tier: 'ultimate' as const };
    if (param) {
      expect(getRestrictedParameters(reqs, before)).toContain(param);
      expect(getRestrictedParameters(reqs, at)).not.toContain(param);
    } else {
      expect(isToolAvailable(reqs, before, action)).toBe(false);
      expect(isToolAvailable(reqs, at, action)).toBe(true);
    }
  });

  it('marks the milestones burndown action premium', () => {
    const { milestonesToolRegistry } = require('../../../src/entities/milestones/registry');
    const req = milestonesToolRegistry.get('browse_milestones')?.requirements;
    expect(req?.actions?.burndown).toEqual({ tier: 'premium', notes: 'Burndown charts' });
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

    // Free strips all gated params; ultimate on 17.0 strips only the version-gated
    // ones (allowed email domains 17.4, automatic Duo review 18.7). Order is
    // irrelevant, so compare as sets.
    const free = { version: '17.0.0', tier: 'free' as const };
    const ultimate = { version: '17.0.0', tier: 'ultimate' as const };
    expect(new Set(getRestrictedParameters(tool.requirements, free))).toEqual(
      new Set(Object.keys(params)),
    );
    expect(new Set(getRestrictedParameters(tool.requirements, ultimate))).toEqual(
      new Set(['allowed_email_domains_list', 'auto_duo_code_review_enabled']),
    );
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

    // Premium instance keeps premium params, still strips the ultimate ones and
    // every GitLab Duo setting, all of which postdate 17.0.
    const premium = { version: '17.0.0', tier: 'premium' as const };
    expect(new Set(getRestrictedParameters(tool.requirements, premium))).toEqual(
      new Set([
        'only_allow_merge_if_all_status_checks_passed',
        'requirements_access_level',
        'auto_duo_code_review_enabled',
        'duo_remote_flows_enabled',
        'duo_sast_fp_detection_enabled',
        'duo_sast_vr_workflow_enabled',
        'duo_secret_detection_fp_enabled',
        'duo_dependency_bump_breaking_changes_enabled',
      ]),
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
