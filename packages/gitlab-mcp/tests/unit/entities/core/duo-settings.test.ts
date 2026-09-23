/**
 * GitLab Duo settings on manage_project / manage_namespace update.
 *
 * GitLab answers 200 while dropping a Duo setting the instance cannot honour
 * (missing add-on, licensed feature or feature flag), so a plain pass-through
 * would report success for a setting that never changed. These tests pin the
 * detection of such drops, the request body, and the tier/version gating that
 * keeps the parameters off instances where GitLab does not accept them at all.
 */

import {
  GROUP_DUO_SETTINGS,
  PROJECT_DUO_SETTINGS,
  withUnappliedSettings,
} from '../../../../src/entities/core/duo-settings';
import { coreToolRegistry } from '../../../../src/entities/core/registry';
import { getRestrictedParameters } from '../../../../src/services/InstanceCapabilities';
import { installFetchMock, lastFetchCall, mockOk } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

jest.mock('../../../../src/config', () => ({
  isActionDenied: jest.fn(() => false),
}));

installFetchMock();

const DUO_PROJECT_PARAMS = Object.keys(PROJECT_DUO_SETTINGS);

describe('withUnappliedSettings', () => {
  it('returns the response untouched when every requested setting was applied', () => {
    const response = { id: 1, auto_duo_code_review_enabled: true };

    const result = withUnappliedSettings(
      { auto_duo_code_review_enabled: true },
      response,
      PROJECT_DUO_SETTINGS,
    );

    // Same reference: no `not_applied` key is added on the success path.
    expect(result).toBe(response);
  });

  it('reports a setting GitLab kept at its previous value, with the current value', () => {
    const result = withUnappliedSettings(
      { auto_duo_code_review_enabled: true },
      { id: 1, auto_duo_code_review_enabled: false },
      PROJECT_DUO_SETTINGS,
    );

    expect(result).toEqual({
      id: 1,
      auto_duo_code_review_enabled: false,
      not_applied: [
        {
          setting: 'auto_duo_code_review_enabled',
          requested: true,
          current: false,
          requires: PROJECT_DUO_SETTINGS.auto_duo_code_review_enabled,
        },
      ],
    });
  });

  it('reports a setting the response does not expose at all, without a current value', () => {
    // GitLab hides the attribute from the entity when the gating add-on or flag
    // is off, which is exactly when it also drops the write.
    const result = withUnappliedSettings(
      { duo_secret_detection_fp_enabled: true },
      { id: 1 },
      PROJECT_DUO_SETTINGS,
    ) as { not_applied: Array<Record<string, unknown>> };

    expect(result.not_applied).toEqual([
      {
        setting: 'duo_secret_detection_fp_enabled',
        requested: true,
        requires: PROJECT_DUO_SETTINGS.duo_secret_detection_fp_enabled,
      },
    ]);
    expect(result.not_applied[0]).not.toHaveProperty('current');
  });

  it('reports a disable request that GitLab left enabled', () => {
    // The negative direction: turning a setting off must be verified too, not
    // only turning it on.
    const result = withUnappliedSettings(
      { duo_remote_flows_enabled: false },
      { id: 1, duo_remote_flows_enabled: true },
      PROJECT_DUO_SETTINGS,
    ) as { not_applied: Array<Record<string, unknown>> };

    expect(result.not_applied).toEqual([
      expect.objectContaining({
        setting: 'duo_remote_flows_enabled',
        requested: false,
        current: true,
      }),
    ]);
  });

  it('lists only the dropped settings when some were applied and some were not', () => {
    const result = withUnappliedSettings(
      { auto_duo_code_review_enabled: true, duo_sast_fp_detection_enabled: true },
      { id: 1, auto_duo_code_review_enabled: false, duo_sast_fp_detection_enabled: true },
      PROJECT_DUO_SETTINGS,
    ) as { not_applied: Array<{ setting: string }> };

    expect(result.not_applied.map((entry) => entry.setting)).toEqual([
      'auto_duo_code_review_enabled',
    ]);
  });

  it('ignores requested fields that are not tracked Duo settings', () => {
    // `name` is not echoed back as requested here; it must not produce a report,
    // otherwise every non-Duo update would carry noise.
    const response = { id: 1, name: 'normalized' };

    const result = withUnappliedSettings({ name: 'raw name' }, response, PROJECT_DUO_SETTINGS);

    expect(result).toBe(response);
  });

  it('ignores tracked settings that were not requested', () => {
    const response = { id: 1, auto_duo_code_review_enabled: false };

    const result = withUnappliedSettings({ name: 'x' }, response, PROJECT_DUO_SETTINGS);

    expect(result).toBe(response);
  });

  it.each([
    ['null', null],
    ['an array', [{ id: 1 }]],
    ['a string', 'ok'],
  ])('passes %s through unchanged', (_label, response) => {
    expect(
      withUnappliedSettings({ auto_duo_code_review_enabled: true }, response, PROJECT_DUO_SETTINGS),
    ).toBe(response);
  });
});

describe('manage_project update with Duo settings', () => {
  it('sends the Duo settings and reports the one GitLab dropped', async () => {
    mockOk({
      id: 7,
      auto_duo_code_review_enabled: false,
      duo_sast_fp_detection_enabled: true,
    });

    const result = await coreToolRegistry.get('manage_project')!.handler({
      action: 'update',
      project_id: 'my-group/my-project',
      auto_duo_code_review_enabled: true,
      duo_sast_fp_detection_enabled: true,
    });

    const [url, init] = lastFetchCall();
    expect(url).toBe('https://gitlab.example.com/api/v4/projects/my-group%2Fmy-project');
    expect(init?.method).toBe('PUT');
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('auto_duo_code_review_enabled')).toBe('true');
    expect(body.get('duo_sast_fp_detection_enabled')).toBe('true');

    expect(result).toEqual({
      id: 7,
      auto_duo_code_review_enabled: false,
      duo_sast_fp_detection_enabled: true,
      not_applied: [
        {
          setting: 'auto_duo_code_review_enabled',
          requested: true,
          current: false,
          requires: PROJECT_DUO_SETTINGS.auto_duo_code_review_enabled,
        },
      ],
    });
  });

  it('coerces string booleans before comparing with the response', async () => {
    // Agents often send "true"; after coercion it must match GitLab's boolean
    // and not be reported as dropped.
    mockOk({ id: 7, duo_remote_flows_enabled: true });

    const result = await coreToolRegistry.get('manage_project')!.handler({
      action: 'update',
      project_id: '7',
      duo_remote_flows_enabled: 'true',
    });

    expect(result).toEqual({ id: 7, duo_remote_flows_enabled: true });
  });

  it('accepts every tracked Duo setting in the update schema', async () => {
    mockOk({ id: 7 });

    const args = Object.fromEntries(DUO_PROJECT_PARAMS.map((name) => [name, false]));
    await coreToolRegistry.get('manage_project')!.handler({
      action: 'update',
      project_id: '7',
      ...args,
    });

    // Zod would strip an undeclared key, so its presence in the body proves the
    // schema declares it.
    const body = new URLSearchParams(lastFetchCall()[1]?.body as string);
    for (const name of DUO_PROJECT_PARAMS) {
      expect(body.get(name)).toBe('false');
    }
  });
});

describe('manage_namespace update with Duo settings', () => {
  it('reports automatic Duo code review that GitLab dropped for the group', async () => {
    // Group entity omits the attribute when the setting is unavailable.
    mockOk({ id: 5, name: 'grp' });

    const result = await coreToolRegistry.get('manage_namespace')!.handler({
      action: 'update',
      group_id: 'grp',
      auto_duo_code_review_enabled: true,
    });

    const body = new URLSearchParams(lastFetchCall()[1]?.body as string);
    expect(body.get('auto_duo_code_review_enabled')).toBe('true');
    expect(result).toEqual({
      id: 5,
      name: 'grp',
      not_applied: [
        {
          setting: 'auto_duo_code_review_enabled',
          requested: true,
          requires: GROUP_DUO_SETTINGS.auto_duo_code_review_enabled,
        },
      ],
    });
  });

  it('returns the group unchanged when automatic Duo code review was applied', async () => {
    mockOk({ id: 5, auto_duo_code_review_enabled: true });

    const result = await coreToolRegistry.get('manage_namespace')!.handler({
      action: 'update',
      group_id: 'grp',
      auto_duo_code_review_enabled: true,
    });

    expect(result).toEqual({ id: 5, auto_duo_code_review_enabled: true });
  });
});

describe('Duo parameter gating', () => {
  const projectReqs = () => coreToolRegistry.get('manage_project')!.requirements;
  const groupReqs = () => coreToolRegistry.get('manage_namespace')!.requirements;
  const restrictedDuo = (version: string, tier: 'free' | 'premium' | 'ultimate') =>
    getRestrictedParameters(projectReqs(), { version, tier }).filter((name) =>
      DUO_PROJECT_PARAMS.includes(name),
    );

  it('gates every tracked Duo setting', () => {
    // A tracked setting without a requirement would be offered on instances
    // whose API rejects or ignores it.
    const params = projectReqs()?.parameters ?? {};
    for (const name of DUO_PROJECT_PARAMS) {
      expect(params[name]).toBeDefined();
    }
    for (const name of Object.keys(GROUP_DUO_SETTINGS)) {
      expect(groupReqs()?.parameters?.[name]).toBeDefined();
    }
  });

  it('offers all Duo settings on an Ultimate instance recent enough for all of them', () => {
    expect(restrictedDuo('19.2.0', 'ultimate')).toEqual([]);
  });

  it('strips settings newer than the instance version', () => {
    // 19.0 predates duo_dependency_bump_breaking_changes_enabled (19.2) only.
    expect(restrictedDuo('19.0.0', 'ultimate')).toEqual([
      'duo_dependency_bump_breaking_changes_enabled',
    ]);
    // 18.9 also lacks secret detection FP (18.10); numeric compare, not lexical.
    expect(new Set(restrictedDuo('18.9.0', 'ultimate'))).toEqual(
      new Set(['duo_secret_detection_fp_enabled', 'duo_dependency_bump_breaking_changes_enabled']),
    );
  });

  it('keeps only the Premium Duo settings on a Premium instance', () => {
    expect(new Set(restrictedDuo('19.2.0', 'premium'))).toEqual(
      new Set([
        'duo_sast_fp_detection_enabled',
        'duo_sast_vr_workflow_enabled',
        'duo_secret_detection_fp_enabled',
        'duo_dependency_bump_breaking_changes_enabled',
      ]),
    );
  });

  it('strips every Duo setting on a Free instance', () => {
    expect(new Set(restrictedDuo('19.2.0', 'free'))).toEqual(new Set(DUO_PROJECT_PARAMS));
  });

  it('strips group automatic Duo code review before 18.7', () => {
    expect(getRestrictedParameters(groupReqs(), { version: '18.6.0', tier: 'ultimate' })).toEqual([
      'auto_duo_code_review_enabled',
    ]);
    expect(getRestrictedParameters(groupReqs(), { version: '18.7.0', tier: 'ultimate' })).toEqual(
      [],
    );
    expect(
      getRestrictedParameters(groupReqs(), { version: '18.7.0', tier: 'premium' }),
    ).not.toContain('auto_duo_code_review_enabled');
  });
});
