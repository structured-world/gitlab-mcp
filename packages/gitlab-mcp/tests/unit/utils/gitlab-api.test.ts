import { gitlab, paths, toQuery } from '../../../src/utils/gitlab-api';
import { installFetchMock, mockEnhancedFetch, mockOk, lastFetchCall } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

describe('REST query values', () => {
  // Preserve the provider's wait independently of its diagnostic body before the response is discarded.
  it('retains Retry-After on a typed write error', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Comment rate limit exceeded' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '30', 'Set-Cookie': 'private-cookie' },
      }),
    );
    await expect(
      gitlab.post('projects/71/merge_requests/3/notes', { body: { body: 'Hi' } }),
    ).rejects.toMatchObject({
      status: 429,
      details: 'Comment rate limit exceeded',
      retryAfterSeconds: 30,
      message: 'GitLab API error: 429 Too Many Requests - Comment rate limit exceeded',
    });
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // Unfilled client fields must not narrow a listing or trigger GitLab validation errors.
  it.each([false, true])('omits empty filters with toQuery=%s', async (useHelper) => {
    const filters = {
      milestone: '',
      search: '',
      author_username: '',
      labels: [],
      absent: undefined,
      missing: null,
    };
    mockOk([]);
    await gitlab.get('merge_requests', { query: useHelper ? toQuery(filters) : filters });
    expect(lastFetchCall()[0]).toBe('https://gitlab.example.com/api/v4/merge_requests');
  });

  // Filtering absence must preserve falsy values, exact text, sentinels and array encoding.
  it('preserves meaningful values without mutating the input', async () => {
    const filters = {
      search: ' fix & test ',
      milestone: 'None',
      archived: false,
      minimum: 0,
      labels: ['bug', 'Any'],
      ids: [0, 2],
      empty: '',
    };
    mockOk([]);
    await gitlab.get('projects', { query: toQuery(filters) });
    expect([...new URL(lastFetchCall()[0]).searchParams]).toEqual([
      ['search', ' fix & test '],
      ['milestone', 'None'],
      ['archived', 'false'],
      ['minimum', '0'],
      ['labels[]', 'bug'],
      ['labels[]', 'Any'],
      ['ids[]', '0'],
      ['ids[]', '2'],
    ]);
    expect(filters).toEqual({
      search: ' fix & test ',
      milestone: 'None',
      archived: false,
      minimum: 0,
      labels: ['bug', 'Any'],
      ids: [0, 2],
      empty: '',
    });
  });

  // An optional-query fix must not prevent clearing descriptions through either body encoder.
  it.each(['json', 'form'] as const)(
    'preserves empty write fields in %s bodies',
    async (contentType) => {
      mockOk({ description: '' });
      await gitlab.put('projects/71', {
        body: { description: '' },
        contentType,
        query: { search: '' },
      });
      const [url, options] = lastFetchCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/71');
      expect(options?.body).toBe(contentType === 'json' ? '{"description":""}' : 'description=');
    },
  );
});

describe('REST rate-limit metadata', () => {
  // Only a representable, valid delay on a rate-limit response may become a caller hint.
  it.each([
    [429, '0', 0],
    [429, '001', 1],
    [429, null, undefined],
    [429, 'not-a-delay', undefined],
    [429, '9007199254740992', undefined],
    [429, '9'.repeat(400), undefined],
    [500, '30', undefined],
    [403, '30', undefined],
  ])('handles status %i and Retry-After %j', async (status, header, expected) => {
    const headers = new Headers();
    if (header !== null) headers.set('Retry-After', header);
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response('{"message":"Rejected"}', { status, headers }),
    );
    await expect(gitlab.post('projects/71/merge_requests/3/notes')).rejects.toMatchObject({
      status,
      details: 'Rejected',
      retryAfterSeconds: expected,
    });
  });

  // An absolute date is normalized at receipt, before a slow error body changes the clock.
  it('rounds a date up from response receipt time before reading the body', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00.500Z'));
    try {
      mockEnhancedFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': 'Thu, 29 Oct 2026 12:00:31 GMT' }),
        text: async () => {
          now.mockReturnValue(Date.parse('2026-10-29T12:00:20Z'));
          return '{"message":"Rejected"}';
        },
      } as Response);
      await expect(gitlab.post('projects/71/merge_requests/3/notes')).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: 31,
      });
    } finally {
      now.mockRestore();
    }
  });
});

describe('REST pagination metadata', () => {
  // Permission filtering can empty a page without exhausting its underlying relation.
  it('preserves the continuation of an empty page', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response('[]', { headers: { 'x-next-page': '3' } }),
    );
    expect(
      await gitlab.getPage('projects/71/merge_requests/3/notes', { query: { page: 1 } }),
    ).toEqual({ items: [], nextPage: 3 });
  });

  // GitLab emits an empty X-Next-Page at exhaustion; entity normalization stays shared.
  it('returns a last page and cleans entity GIDs', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'gid://gitlab/Note/19' }]), {
        headers: { 'x-next-page': '' },
      }),
    );
    expect(await gitlab.getPage('projects/71/merge_requests/3/notes')).toEqual({
      items: [{ id: '19' }],
      nextPage: null,
    });
  });

  // Missing or malformed metadata must not authorize truncating ownership verification.
  it.each([null, '0', '-2', '1.5', 'next', '9007199254740993'])(
    'refuses continuation %j',
    async (value) => {
      const headers = new Headers();
      if (value !== null) headers.set('x-next-page', value);
      mockEnhancedFetch.mockResolvedValueOnce(new Response('[]', { headers }));
      await expect(gitlab.getPage('projects/71/merge_requests/3/notes')).rejects.toThrow(
        'pagination metadata',
      );
    },
  );
});

// The shared path builders must agree on one encoding and reject URL-normalized traversal.
describe('canonical REST path builders', () => {
  it('encodes project, group and namespace identities exactly once', () => {
    expect(paths.project(71)).toBe('projects/71');
    expect(paths.project('team%2Fapp')).toBe('projects/team%2Fapp');
    expect(paths.group('team/sub')).toBe('groups/team%2Fsub');
    expect(paths.namespace('team%2Fsub', 'groups')).toBe('groups/team%2Fsub');
    expect(paths.namespace('team/app', 'projects')).toBe('projects/team%2Fapp');
  });
});
