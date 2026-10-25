import { gitlab, paths } from '../../../src/utils/gitlab-api';
import { installFetchMock, mockEnhancedFetch } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

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
