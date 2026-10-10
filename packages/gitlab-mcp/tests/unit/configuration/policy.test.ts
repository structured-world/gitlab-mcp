/**
 * The caller's policy narrows tool use: read-only mode, switched-off groups, a preset's
 * whitelist, exclusions and denied actions, and the working scope. Configuration tools
 * stay usable whatever is restricted, so a caller can always undo a restriction.
 */

import {
  buildPolicy,
  callRestriction,
  toolRestriction,
  type ToolFacts,
} from '../../../src/configuration/policy';
import type { Preset } from '../../../src/profiles/types';

const browse: ToolFacts = { name: 'browse_merge_requests', group: 'mrs', readOnly: true };
const manage: ToolFacts = { name: 'manage_merge_request', group: 'mrs', readOnly: false };
const core: ToolFacts = { name: 'browse_projects', readOnly: true };

describe('buildPolicy', () => {
  it('restricts nothing without a preset, settings or overrides', () => {
    const policy = buildPolicy(undefined, {}, {});

    expect(policy).toMatchObject({ readOnly: false, presetName: undefined, scope: undefined });
    expect(policy.disabledGroups.size).toBe(0);
    expect(toolRestriction(policy, manage)).toBeNull();
  });

  it('turns read-only on from the account, the session or the preset', () => {
    expect(buildPolicy(undefined, { readOnly: true }, {}).readOnly).toBe(true);
    expect(buildPolicy(undefined, {}, { readOnly: true }).readOnly).toBe(true);
    expect(buildPolicy({ read_only: true }, {}, {}).readOnly).toBe(true);
  });

  // The session's own choice replaces the account default for that session only.
  it('lets the session turn off the read-only mode its account set', () => {
    expect(buildPolicy(undefined, { readOnly: true }, { readOnly: false }).readOnly).toBe(false);
  });

  // A read-only preset stays read-only: a session toggle cannot widen what it selected.
  it('keeps a read-only preset read-only whatever the session toggle says', () => {
    expect(buildPolicy({ read_only: true }, {}, { readOnly: false }).readOnly).toBe(true);
  });

  it('selects the session preset before the account preset', () => {
    expect(buildPolicy(undefined, { preset: 'pm' }, { preset: 'readonly' }).presetName).toBe(
      'readonly',
    );
    expect(buildPolicy(undefined, { preset: 'pm' }, {}).presetName).toBe('pm');
  });

  it('switches off the account groups and the groups the preset disables', () => {
    const preset: Preset = { features: { wiki: false, mrs: true } };
    const policy = buildPolicy(preset, { disabledToolGroups: ['pipelines'] }, {});

    expect([...policy.disabledGroups].sort()).toEqual(['pipelines', 'wiki']);
  });

  it('parses denied actions and ignores malformed entries', () => {
    const policy = buildPolicy(
      { denied_actions: ['manage_merge_request:merge', 'nocolon', ':merge'] },
      {},
      {},
    );

    expect([...policy.deniedActions.keys()]).toEqual(['manage_merge_request']);
  });

  it('takes the session scope, then the account scope, then the preset scope', () => {
    const preset: Preset = { scope: { group: 'preset-group' } };
    const account = {
      scope: { type: 'group' as const, path: 'acct-group', includeSubgroups: false },
    };
    const session = { scope: { type: 'project' as const, path: 'g/p', includeSubgroups: false } };

    expect(buildPolicy(preset, account, session).scope).toEqual({ project: 'g/p' });
    expect(buildPolicy(preset, account, {}).scope).toEqual({
      group: 'acct-group',
      includeSubgroups: false,
    });
    expect(buildPolicy(preset, {}, {}).scope).toEqual({ group: 'preset-group' });
  });
});

describe('toolRestriction', () => {
  it('hides write tools in read-only mode and keeps read tools', () => {
    const policy = buildPolicy(undefined, { readOnly: true }, {});

    expect(toolRestriction(policy, manage)).toBe('read-only mode is on');
    expect(toolRestriction(policy, browse)).toBeNull();
  });

  it('hides the tools of a switched-off group only', () => {
    const policy = buildPolicy(undefined, { disabledToolGroups: ['mrs'] }, {});

    expect(toolRestriction(policy, browse)).toBe("the 'mrs' tool group is turned off");
    expect(toolRestriction(policy, core)).toBeNull();
  });

  it('keeps only the tools a preset whitelists', () => {
    const policy = buildPolicy({ allowed_tools: ['browse_projects'] }, { preset: 'mine' }, {});

    expect(toolRestriction(policy, core)).toBeNull();
    expect(toolRestriction(policy, browse)).toBe("preset 'mine' does not include it");
  });

  it('hides the tools a preset excludes by pattern', () => {
    const policy = buildPolicy({ denied_tools_regex: '^manage_' }, { preset: 'mine' }, {});

    expect(toolRestriction(policy, manage)).toBe("preset 'mine' excludes it");
    expect(toolRestriction(policy, browse)).toBeNull();
  });

  // Otherwise read-only mode or a whitelist could lock the caller out of the very tool
  // that turns them off again.
  it.each(['manage_context', 'get_settings', 'update_settings', 'open_settings_panel'])(
    'never restricts %s',
    (name) => {
      const policy = buildPolicy(
        { allowed_tools: ['browse_projects'], denied_tools_regex: '.*' },
        { readOnly: true },
        {},
      );

      expect(toolRestriction(policy, { name, readOnly: false })).toBeNull();
    },
  );
});

describe('working everywhere in one chat', () => {
  // The chat drops the account's default scope; nothing else of the account changes.
  it("drops the account's default scope for the chat", () => {
    const policy = buildPolicy(
      undefined,
      { readOnly: true, scope: { type: 'group', path: 'team', includeSubgroups: true } },
      { scope: 'everywhere' },
    );

    expect(policy.scope).toBeUndefined();
    expect(policy.scopeEnforcer).toBeUndefined();
    expect(policy.readOnly).toBe(true);
  });

  // A preset's own scope is part of the preset the chat chose; it still applies.
  it("keeps the preset's scope", () => {
    const policy = buildPolicy({ scope: { project: 'team/app' } }, {}, { scope: 'everywhere' });

    expect(policy.scope).toEqual({ project: 'team/app' });
  });
});

// The host identifies the connection's account with get_profile: a preset's tool list or
// read-only mode must not hide it.
it('keeps the account profile tool under any preset', () => {
  const policy = buildPolicy(
    { allowed_tools: ['browse_projects'], denied_tools_regex: '^get_', read_only: true },
    { preset: 'narrow' },
    {},
  );
  const profile: ToolFacts = { name: 'get_profile', readOnly: true };

  expect(toolRestriction(policy, profile)).toBeNull();
  expect(callRestriction(policy, profile, {})).toBeNull();
});

describe('callRestriction', () => {
  it('refuses an action the preset denies and allows the others', () => {
    const policy = buildPolicy(
      { denied_actions: ['manage_merge_request:merge'] },
      { preset: 'mine' },
      {},
    );

    expect(callRestriction(policy, manage, { action: 'merge' })).toBe(
      "preset 'mine' denies the 'merge' action",
    );
    expect(callRestriction(policy, manage, { action: 'create' })).toBeNull();
  });

  it('refuses a project outside the working scope and allows one inside', () => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'group', path: 'team', includeSubgroups: true } },
      {},
    );

    expect(callRestriction(policy, browse, { project_id: 'other/app' })).toMatch(
      /outside the allowed scope/,
    );
    expect(callRestriction(policy, browse, { project_id: 'team/sub/app' })).toBeNull();
  });

  // The namespace of a created or forked project is the group it goes into: naming the scope
  // group itself is allowed also when its subgroups are not part of the scope.
  it.each([
    [{ action: 'create', name: 'app', namespace: 'team' }, null],
    [{ action: 'fork', project_id: 'team/app', namespace: 'team' }, null],
    [{ action: 'create', name: 'app', namespace: 'team/sub' }, /outside the allowed scope/],
    [{ action: 'create', name: 'app', namespace: 'other' }, /outside the allowed scope/],
  ])('checks the namespace of %j as the group it goes into', (args, expected) => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'group', path: 'team', includeSubgroups: false } },
      {},
    );
    const project: ToolFacts = { name: 'manage_project', readOnly: false };

    const reason = callRestriction(policy, project, args);
    if (expected === null) expect(reason).toBeNull();
    else expect(reason).toMatch(expected);
  });

  // A numeric id cannot be checked against a path scope without a lookup: refused.
  it('refuses a numeric project id under a scope', () => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'project', path: 'team/app', includeSubgroups: false } },
      {},
    );

    expect(callRestriction(policy, browse, { project_id: '42' })).toMatch(
      /outside the allowed scope/,
    );
  });

  // Tool schemas accept ids as JSON numbers too; a number must not slip past the scope.
  it.each([[{ project_id: 42 }], [{ group_id: 7 }]])(
    'refuses a numeric id %j outside the working scope',
    (args) => {
      const policy = buildPolicy(
        undefined,
        { scope: { type: 'group', path: 'team', includeSubgroups: true } },
        {},
      );

      expect(callRestriction(policy, browse, args)).toMatch(/outside the allowed scope/);
    },
  );

  // Only a scope violation is a refusal; a failing check is a fault, not a reason to show.
  it('propagates an error of the scope check that is not a violation', () => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'project', path: 'team/app', includeSubgroups: false } },
      {},
    );
    const broken = {
      ...policy,
      scopeEnforcer: {
        enforce: () => {
          throw new TypeError('enforcer broke');
        },
      } as unknown as NonNullable<typeof policy.scopeEnforcer>,
    };

    expect(() => callRestriction(broken, browse, { project_id: 'team/app' })).toThrow(
      'enforcer broke',
    );
  });

  it('reports the tool restriction before looking at the arguments', () => {
    const policy = buildPolicy(undefined, { readOnly: true }, {});

    expect(callRestriction(policy, manage, { action: 'create' })).toBe('read-only mode is on');
  });

  it('lets configuration tools run under a scope', () => {
    const policy = buildPolicy(
      undefined,
      { scope: { type: 'project', path: 'team/app', includeSubgroups: false } },
      {},
    );

    expect(
      callRestriction(
        policy,
        { name: 'manage_context', readOnly: false },
        { action: 'set_scope', namespace: 'elsewhere' },
      ),
    ).toBeNull();
  });
});
