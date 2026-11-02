/** Namespace selection must preserve independent subscriptions without duplicating capability rules. */
import {
  namespaceTargetsForArgs,
  namespaceTargetsForScope,
  needsNamespaceTier,
  withNamespaceCapabilities,
} from '../../../src/configuration/namespace-capabilities';
import { getNamespaceTier } from '../../../src/services/NamespaceTierDetector';
import { currentNamespaceTier } from '../../../src/services/namespace-tier-context';

jest.mock('../../../src/services/NamespaceTierDetector');
const lookup = jest.mocked(getNamespaceTier);
const url = 'https://gitlab.com';
const observed = () => currentNamespaceTier(url)?.tier;

describe('namespace capabilities', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    lookup.mockImplementation(async (path) => ({
      tier: path.startsWith('paid') ? 'ultimate' : 'free',
      cachedAt: new Date(),
    }));
  });

  // Scope metadata and actual arguments must retain project/group ID namespaces.
  it('extracts configured scopes and typed numeric targets', () => {
    expect(namespaceTargetsForScope({ project: 'a/p', groups: ['b', 'c'] })).toEqual([
      { path: 'a/p', kind: 'project' },
      { path: 'b', kind: 'group' },
      { path: 'c', kind: 'group' },
    ]);
    expect(namespaceTargetsForArgs({ project_id: '7', group_id: '7' })).toEqual([
      { path: '7', kind: 'project' },
      { path: '7', kind: 'group' },
    ]);
    expect(namespaceTargetsForScope(undefined)).toEqual([]);
  });

  // Configured plural scopes and path arguments must retain all relevant roots and kinds.
  it('extracts plural scopes and nonnumeric argument paths', () => {
    expect(namespaceTargetsForScope({ projects: ['team/a'], namespace: 'group' })).toEqual([
      { path: 'team/a', kind: 'project' },
      { path: 'group', kind: 'group' },
    ]);
    expect(namespaceTargetsForArgs({ project_id: 'team/a', group_id: 'group' })).toEqual([
      { path: 'team/a', kind: 'project' },
      { path: 'group', kind: 'group' },
    ]);
  });

  // Numeric projects and groups must not deduplicate just because their IDs coincide.
  it('retains numeric target kinds and agrees on equal subscriptions', async () => {
    const targets = [
      { path: '7', kind: 'project' as const },
      { path: '7', kind: 'group' as const },
      { path: 'team', kind: 'group' as const },
    ];
    expect(await withNamespaceCapabilities(url, targets, false, observed)).toBe('free');
    expect(lookup.mock.calls.map(([path, kind]) => ({ path, kind }))).toEqual(targets);
  });

  // Union selection cannot downgrade when a lower subscription appears later in the input.
  it('retains the higher tier when a lower tier follows it', async () => {
    expect(
      await withNamespaceCapabilities(
        url,
        [
          { path: 'paid/a', kind: 'project' },
          { path: 'free/b', kind: 'project' },
        ],
        true,
        observed,
      ),
    ).toBe('ultimate');
  });

  // Free-only tools do not pay for optional billing observations.
  it('requests observations only for declared paid capabilities', () => {
    expect(needsNamespaceTier(undefined)).toBe(false);
    expect(needsNamespaceTier({ default: { tier: 'free' } })).toBe(false);
    expect(needsNamespaceTier({ default: {}, parameters: { weight: { tier: 'premium' } } })).toBe(
      true,
    );
    expect(needsNamespaceTier({ default: {}, actions: { audit: { tier: 'ultimate' } } })).toBe(
      true,
    );
  });

  // Descendants inherit one root plan; catalog union and cross-project execution differ.
  it('deduplicates root observations and selects a catalog union', async () => {
    const targets = [
      { path: 'free/p', kind: 'project' as const },
      { path: 'paid/p', kind: 'project' as const },
      { path: 'paid/nested/p', kind: 'project' as const },
    ];
    expect(await withNamespaceCapabilities(url, targets, true, observed)).toBe('ultimate');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await withNamespaceCapabilities(url, targets, false, observed)).toBeNull();
    expect(currentNamespaceTier(url)).toBeUndefined();
  });

  // Concurrent chats on one host must not exchange a request-local tier or instance.
  it('isolates concurrent calls and restores the caller context', async () => {
    const call = (path: string) =>
      withNamespaceCapabilities(url, [{ path, kind: 'project' }], false, async () => {
        await Promise.resolve();
        expect(currentNamespaceTier('https://other.example')).toBeUndefined();
        return observed();
      });
    expect(await Promise.all([call('free/p'), call('paid/p')])).toEqual(['free', 'ultimate']);
    expect(observed()).toBeUndefined();
  });

  // Missing plans cannot establish Free; stop queued optional reads after that fact.
  it('bounds lookups and stops queued work on an unknown subscription', async () => {
    lookup.mockResolvedValue({ tier: null, cachedAt: new Date() });
    const targets = Array.from({ length: 20 }, (_, i) => ({
      path: `team${i}/p`,
      kind: 'project' as const,
    }));
    expect(await withNamespaceCapabilities(url, targets, true, observed)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(5);
  });

  // Opaque identities and invalid paths are not resolved by guessing a namespace.
  it.each(['gid://gitlab/Project/7', '../outside'])(
    'leaves %s to its owning handler',
    async (path) => {
      expect(
        await withNamespaceCapabilities(url, [{ path, kind: 'project' }], false, observed),
      ).toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  // Self-hosted licenses and unexpected programming failures retain their existing paths.
  it('does not query namespaces on self-hosted instances or conceal unexpected errors', async () => {
    expect(
      await withNamespaceCapabilities('https://gitlab.example', [], true, () => 'self-hosted'),
    ).toBe('self-hosted');
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRejectedValue(new Error('unexpected failure'));
    await expect(
      withNamespaceCapabilities(url, [{ path: 'team', kind: 'group' }], false, observed),
    ).rejects.toThrow('unexpected failure');
    expect(observed()).toBeUndefined();
  });
});
