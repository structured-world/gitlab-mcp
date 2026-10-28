import { gitlab, paths, toQuery } from '../../../src/utils/gitlab-api';
import { installFetchMock, mockEnhancedFetch, mockOk, lastFetchCall } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

describe('REST query values', () => {
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
