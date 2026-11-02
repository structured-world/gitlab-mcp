/** REST subscription observations, credential isolation and bounded cache lifecycle. */
import {
  canResolveNamespaceTier,
  clearNamespaceTierCache,
  getNamespaceTier,
  getNamespaceTierCacheMetrics,
} from '../../../src/services/NamespaceTierDetector';
import * as tokenContext from '../../../src/oauth/token-context';
import { isOAuthEnabled } from '../../../src/oauth/config';
import * as fetchUtils from '../../../src/utils/fetch';
import { getGitLabBaseUrl } from '../../../src/utils/gitlab-base-url';

jest.mock('../../../src/oauth/token-context');
jest.mock('../../../src/oauth/config', () => ({ isOAuthEnabled: jest.fn(() => false) }));
jest.mock('../../../src/utils/fetch');
jest.mock('../../../src/utils/gitlab-base-url');
jest.mock('../../../src/logger', () => ({
  logDebug: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));
const mockedGetTokenContext = jest.mocked(tokenContext.getTokenContext);
const mockedEnhancedFetch = jest.mocked(fetchUtils.enhancedFetch);

describe('NamespaceTierDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isOAuthEnabled).mockReturnValue(false);
    clearNamespaceTierCache();
    jest.mocked(getGitLabBaseUrl).mockImplementation(() => mockedGetTokenContext()?.apiUrl ?? '');
    jest.mocked(fetchUtils.getAuthHeaders).mockImplementation((): Record<string, string> => {
      const token = mockedGetTokenContext()?.gitlabToken;
      return token ? { Authorization: `Bearer ${token}` } : {};
    });
  });

  const context = {
    sessionId: 'session-one',
    gitlabToken: 'fixture-token',
    gitlabUserId: 1,
    gitlabUsername: 'fixture-user',
    apiUrl: 'https://gitlab.com',
  };

  beforeEach(() => {
    mockedGetTokenContext.mockReturnValue({ ...context });
    mockedEnhancedFetch.mockImplementation(
      async () => new Response(JSON.stringify({ plan: 'premium' })),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // Plan visibility is permission-dependent, so absence and failure never establish Free.
  test.each([
    ['free', 'free'],
    ['default', 'free'],
    ['premium', 'premium'],
    ['ultimate', 'ultimate'],
    ['gold', 'ultimate'],
    ['silver', 'premium'],
    ['bronze', null],
    ['starter', null],
    ['PREMIUM', 'premium'],
    ['premium_trial', 'premium'],
    ['ultimate_trial', 'ultimate'],
    ['opensource', 'ultimate'],
    [null, null],
    [undefined, null],
    ['unrecognized-plan', null],
  ])('normalizes the REST subscription %s to %s', async (plan, expected) => {
    mockedEnhancedFetch.mockImplementation(async () => new Response(JSON.stringify({ plan })));
    expect((await getNamespaceTier('team')).tier).toBe(expected);
  });

  // Only a string plan in an object establishes subscription evidence.
  test.each([null, [], 'premium', { plan: 42 }, { plan: ['premium'] }])(
    'keeps malformed namespace metadata unknown: %j',
    async (value) => {
      mockedEnhancedFetch.mockResolvedValue(new Response(JSON.stringify(value)));
      expect((await getNamespaceTier('team')).tier).toBeNull();
    },
  );

  // Static-token mode has no OAuth user or session but still uses its own credential identity.
  it('supports authenticated metadata without an OAuth context', async () => {
    mockedGetTokenContext.mockReturnValue(undefined);
    jest.mocked(getGitLabBaseUrl).mockReturnValue('https://gitlab.com');
    jest.mocked(fetchUtils.getAuthHeaders).mockReturnValue({ 'PRIVATE-TOKEN': 'fixture-static' });
    expect((await getNamespaceTier('team')).tier).toBe('premium');
    expect((await getNamespaceTier('team/subgroup')).tier).toBe('premium');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // A response without a body still carries no billing evidence and needs no stream cancellation.
  it('handles an unavailable metadata response without a body', async () => {
    mockedEnhancedFetch.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await getNamespaceTier('team')).tier).toBeNull();
  });

  // Namespace limits are checked before allocating a provider response.
  it('does not request an overlong root namespace', async () => {
    expect((await getNamespaceTier('a'.repeat(256))).tier).toBeNull();
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });

  // Malformed numeric metadata must not be interpreted as another target's namespace.
  test.each(['project', 'group'] as const)('rejects malformed %s metadata', async (kind) => {
    mockedEnhancedFetch.mockResolvedValue(
      new Response(JSON.stringify({ path_with_namespace: 7, full_path: [] })),
    );
    expect((await getNamespaceTier('7', kind)).tier).toBeNull();
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // A valid group match must not fall through to a project with the same numeric ID.
  it('resolves an ambiguous target as a group when the group exists', async () => {
    mockedEnhancedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ full_path: 'team/subgroup' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plan: 'ultimate' })));
    expect((await getNamespaceTier('7', 'either')).tier).toBe('ultimate');
    expect(mockedEnhancedFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://gitlab.com/api/v4/groups/7?with_projects=false',
      'https://gitlab.com/api/v4/namespaces/team',
    ]);
  });

  // Descendants share the root subscription and do not issue duplicate metadata requests.
  it('uses the root REST entity and shares its observation with descendants', async () => {
    const first = await getNamespaceTier('team/subgroup/project');
    expect(first.tier).toBe('premium');
    expect(first.cachedAt).toBeInstanceOf(Date);
    expect((await getNamespaceTier('team/another')).tier).toBe('premium');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(1);
    expect(mockedEnhancedFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/namespaces/team',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer fixture-token' },
      }),
    );
  });

  // An account switch or token replacement must not reuse another credential's metadata.
  it('separates accounts, credentials and instances within one session', async () => {
    await getNamespaceTier('team');
    mockedGetTokenContext.mockReturnValue({
      ...context,
      gitlabUserId: 2,
      gitlabToken: 'second-token',
    });
    await getNamespaceTier('team');
    mockedGetTokenContext.mockReturnValue({ ...context, gitlabToken: 'rotated-token' });
    await getNamespaceTier('team');
    mockedGetTokenContext.mockReturnValue({
      ...context,
      apiUrl: 'https://gitlab.example.com/subpath',
    });
    await getNamespaceTier('team');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(4);
    expect(mockedEnhancedFetch).toHaveBeenLastCalledWith(
      'https://gitlab.example.com/subpath/api/v4/namespaces/team',
      expect.any(Object),
    );
  });

  // Static-token connections use the transport's credential selection and isolate rotations.
  it('uses the selected static credential when no OAuth context exists', async () => {
    mockedGetTokenContext.mockReturnValue(undefined);
    jest.mocked(getGitLabBaseUrl).mockReturnValue('https://gitlab.com');
    jest.mocked(fetchUtils.getAuthHeaders).mockReturnValue({ 'PRIVATE-TOKEN': 'static-one' });
    await getNamespaceTier('team');
    jest.mocked(fetchUtils.getAuthHeaders).mockReturnValue({ 'PRIVATE-TOKEN': 'static-two' });
    await getNamespaceTier('team');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(2);
    expect(mockedEnhancedFetch).toHaveBeenLastCalledWith(
      'https://gitlab.com/api/v4/namespaces/team',
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'static-two' } }),
    );
  });

  // Cache invalidation is scoped to the exact session, including separator characters.
  it('clears one session without discarding another session', async () => {
    await getNamespaceTier('team');
    const second = 'session:with:separators';
    mockedGetTokenContext.mockReturnValue({ ...context, sessionId: second });
    await getNamespaceTier('team');
    expect(getNamespaceTierCacheMetrics().totalEntries).toBe(2);
    clearNamespaceTierCache(context.sessionId);
    expect(getNamespaceTierCacheMetrics().entriesBySession).toEqual(new Map([[second, 1]]));
    await getNamespaceTier('team');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(2);
    clearNamespaceTierCache();
    expect(getNamespaceTierCacheMetrics()).toEqual({
      totalEntries: 0,
      entriesBySession: new Map(),
    });
  });

  // A changed subscription becomes visible after the documented five-minute TTL.
  it('refreshes an expired observation', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    await getNamespaceTier('team');
    jest.setSystemTime(new Date('2026-01-01T00:05:00.001Z'));
    mockedEnhancedFetch.mockImplementation(
      async () => new Response(JSON.stringify({ plan: 'ultimate' })),
    );
    expect((await getNamespaceTier('team')).tier).toBe('ultimate');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(2);
  });

  // Missing context must not trigger an unauthenticated request or claim a Free subscription.
  it('returns unknown without usable authentication', async () => {
    mockedGetTokenContext.mockReturnValue({ ...context, gitlabToken: '' });
    expect((await getNamespaceTier('team')).tier).toBeNull();
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });

  // Known insufficient OAuth scopes must avoid optional billing requests entirely.
  it('returns unknown when the credential cannot read API metadata', async () => {
    mockedGetTokenContext.mockReturnValue({ ...context, gitlabScopes: ['read_user'] });
    expect(canResolveNamespaceTier(context.apiUrl)).toBe(false);
    expect((await getNamespaceTier('team')).tier).toBeNull();
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });

  // OAuth mode must not borrow static credentials when no user token is selected.
  it('returns unknown without an OAuth token context', async () => {
    jest.mocked(isOAuthEnabled).mockReturnValue(true);
    mockedGetTokenContext.mockReturnValue(undefined);
    expect(canResolveNamespaceTier(context.apiUrl)).toBe(false);
    expect((await getNamespaceTier('team')).tier).toBeNull();
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });

  // Billing observations belong only to the authenticated transport's selected instance.
  it('resolves metadata only for the selected instance', () => {
    expect(canResolveNamespaceTier(context.apiUrl)).toBe(true);
    expect(canResolveNamespaceTier('https://other.example')).toBe(false);
    jest.mocked(getGitLabBaseUrl).mockReturnValue('');
    expect(canResolveNamespaceTier(context.apiUrl)).toBe(false);
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });

  // Neither an HTTP error nor malformed provider output constitutes subscription evidence.
  test.each([403, 404, 429, 500])('returns unknown for metadata HTTP %s', async (status) => {
    mockedEnhancedFetch.mockImplementation(async () => new Response('fixture error', { status }));
    expect((await getNamespaceTier('team')).tier).toBeNull();
  });

  it('returns unknown for a network failure', async () => {
    mockedEnhancedFetch.mockRejectedValue(new Error('fixture network failure'));
    expect((await getNamespaceTier('team')).tier).toBeNull();
  });

  it('does not log malformed provider content', async () => {
    mockedEnhancedFetch.mockImplementation(
      async () => new Response('fixture-secret-must-not-appear'),
    );
    expect((await getNamespaceTier('team')).tier).toBeNull();
    const warnings = jest.requireMock('../../../src/logger').logWarn.mock.calls;
    expect(JSON.stringify(warnings)).not.toContain('fixture-secret-must-not-appear');
  });

  // Numeric project IDs and group IDs occupy distinct spaces on the same instance.
  it('resolves and caches a numeric project independently of a group with the same ID', async () => {
    mockedEnhancedFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/projects/7'))
        return new Response(JSON.stringify({ path_with_namespace: 'paid/project' }));
      if (url.includes('/groups/7?with_projects=false'))
        return new Response(JSON.stringify({ full_path: 'free-team/subgroup' }));
      return new Response(JSON.stringify({ plan: url.endsWith('/paid') ? 'ultimate' : 'free' }));
    });
    expect((await getNamespaceTier('7', 'project')).tier).toBe('ultimate');
    expect((await getNamespaceTier('7', 'group')).tier).toBe('free');
    expect((await getNamespaceTier('7', 'project')).tier).toBe('ultimate');
    expect(mockedEnhancedFetch).toHaveBeenCalledTimes(4);
  });

  // The existing namespace convention tries groups first, falling through only on 404.
  it('resolves an ambiguous numeric namespace in group-first order', async () => {
    mockedEnhancedFetch
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_with_namespace: 'team/project' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plan: 'ultimate' })));
    expect((await getNamespaceTier('7', 'either')).tier).toBe('ultimate');
    expect(mockedEnhancedFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://gitlab.com/api/v4/groups/7?with_projects=false',
      'https://gitlab.com/api/v4/projects/7',
      'https://gitlab.com/api/v4/namespaces/team',
    ]);
  });

  // Optional metadata cannot grow without bound when many different targets are requested.
  it('evicts old observations at the cache capacity', async () => {
    await getNamespaceTier('oldest');
    await Promise.all(
      Array.from({ length: 1024 }, (_, index) => getNamespaceTier('team-' + index)),
    );
    expect(getNamespaceTierCacheMetrics().totalEntries).toBeLessThanOrEqual(1024);
    mockedEnhancedFetch.mockImplementation(
      async () => new Response(JSON.stringify({ plan: 'ultimate' })),
    );
    expect((await getNamespaceTier('oldest')).tier).toBe('ultimate');
  });

  // Invalid path syntax must be rejected before a metadata resolver sees it.
  it('rejects path traversal before network access', async () => {
    await expect(getNamespaceTier('../team')).rejects.toThrow('dot segment');
    expect(mockedEnhancedFetch).not.toHaveBeenCalled();
  });
});
