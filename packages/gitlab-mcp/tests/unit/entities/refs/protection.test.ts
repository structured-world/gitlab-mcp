import { refsToolRegistry } from '../../../../src/entities/refs/registry';
import { getRestrictedParameters, getUnavailableActions } from '../../../../src/services/InstanceCapabilities';
import { installFetchMock, mockEnhancedFetch, mockOk } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const manage = (args: Record<string, unknown>) => refsToolRegistry.get('manage_ref')!.handler({
  project_id: 'test/project', name: 'release-*', ...args,
});

describe('Ref protection capabilities and applied settings', () => {
  // Protected-tag operations exist in CE and EE Free from the supported floor.
  it.each([
    ['browse_refs', 'list_protected_tags'],
    ['manage_ref', 'protect_tag'],
    ['manage_ref', 'unprotect_tag'],
  ])('offers %s %s on Free 16.0', (tool, action) => {
    const unavailable = getUnavailableActions(refsToolRegistry.get(tool)!.requirements, { version: '16.0.0', tier: 'free' });
    expect(unavailable.has(action)).toBe(false);
  });

  // Mixed access lists stay visible for Free EE roles; only the scalar code-owner setting is paid.
  it('restricts code owners without hiding role-based access lists', () => {
    const requirements = refsToolRegistry.get('manage_ref')!.requirements;
    expect(getRestrictedParameters(requirements, { version: '16.0.0', tier: 'free' })).toEqual(['code_owner_approval_required']);
    expect(getRestrictedParameters(requirements, { version: '16.0.0', tier: 'premium' })).toEqual([]);
  });

  // CE can ignore EE request fields and still return success with default role access.
  it.each([
    ['protect_tag', 'allowed_to_create', 'create_access_levels'],
    ['protect_branch', 'allowed_to_push', 'push_access_levels'],
    ['protect_branch', 'allowed_to_merge', 'merge_access_levels'],
    ['protect_branch', 'allowed_to_unprotect', 'unprotect_access_levels'],
    ['update_branch_protection', 'allowed_to_push', 'push_access_levels'],
    ['update_branch_protection', 'allowed_to_merge', 'merge_access_levels'],
    ['update_branch_protection', 'allowed_to_unprotect', 'unprotect_access_levels'],
  ])('reports ignored %s %s entries', async (action, setting, returnedField) => {
    const returned = { name: 'release-*', [returnedField]: [{ access_level: 40 }] };
    mockOk(returned);
    const result = await manage({ action, [setting]: [{ user_id: 17 }, { group_id: 29 }] });
    expect(result).toMatchObject({ ...returned, not_applied: [
      { setting: `${setting}[0]`, requested: { user_id: 17 }, requires: expect.any(String) },
      { setting: `${setting}[1]`, requested: { group_id: 29 }, requires: expect.any(String) },
    ] });
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // A granted user at the same role does not prove that role-wide access was applied.
  it('does not mistake a user grant for a role grant', async () => {
    mockOk({ name: 'release-*', create_access_levels: [{ user_id: 17, access_level: 40 }] });
    const result = await manage({ action: 'protect_tag', allowed_to_create: [{ access_level: 40 }] });
    expect(result).toMatchObject({ not_applied: [{ setting: 'allowed_to_create[0]', requested: { access_level: 40 } }] });
  });

  // Premium responses and Free EE role entries keep their original shape when applied.
  it.each([
    [{ access_level: 0 }, { access_level: 0, user_id: null, group_id: null }],
    [{ access_level: 30 }, { access_level: 30 }],
    [{ user_id: 17 }, { user_id: 17, access_level: 40 }],
    [{ group_id: 29 }, { group_id: 29, access_level: 40 }],
  ])('preserves an applied access rule %j', async (requested, applied) => {
    const returned = { name: 'release-*', create_access_levels: [applied] };
    mockOk(returned);
    expect(await manage({ action: 'protect_tag', allowed_to_create: [requested] })).toEqual(returned);
  });

  // Missing licensed attributes must not imply code-owner approval was enabled.
  it.each(['protect_branch', 'update_branch_protection'])('reports ignored code owners for %s', async (action) => {
    mockOk({ name: 'release-*', code_owner_approval_required: false });
    expect(await manage({ action, code_owner_approval_required: true })).toMatchObject({
      not_applied: [{ setting: 'code_owner_approval_required', requested: true, requires: expect.any(String) }],
    });
  });

  // A server can apply only part of a mixed list; retain its entity and identify only omissions.
  it('reports only the unapplied entries of a mixed list', async () => {
    mockOk({ name: 'release-*', create_access_levels: [{ access_level: 30 }] });
    expect(await manage({ action: 'protect_tag', allowed_to_create: [{ access_level: 30 }, { user_id: 17 }] })).toMatchObject({
      not_applied: [{ setting: 'allowed_to_create[1]', requested: { user_id: 17 } }],
    });
  });
});
