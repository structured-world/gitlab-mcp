import {
  getNamespaceTier,
  clearNamespaceTierCache,
} from '../../../src/services/NamespaceTierDetector';
import { getTokenContext } from '../../../src/oauth/token-context';
import { enhancedFetch } from '../../../src/utils/fetch';
import { getAuthHeaders } from '../../../src/utils/fetch';
import { getGitLabBaseUrl } from '../../../src/utils/gitlab-base-url';

jest.mock('../../../src/oauth/token-context');
jest.mock('../../../src/utils/fetch');
jest.mock('../../../src/utils/gitlab-base-url');

beforeEach(() => {
  jest.clearAllMocks();
  clearNamespaceTierCache();
  jest.mocked(getGitLabBaseUrl).mockReturnValue('https://gitlab.com');
  jest.mocked(getAuthHeaders).mockReturnValue({ Authorization: 'Bearer fixture-token' });
  jest.mocked(getTokenContext).mockReturnValue({
    sessionId: 'session',
    gitlabUserId: 1,
    gitlabUsername: 'test',
    gitlabToken: 'fixture-token',
    apiUrl: 'https://gitlab.com',
  });
});

// A billing field omitted for a non-owner must not disable paid namespace tools.
test('an undisclosed plan remains unknown instead of Free', async () => {
  jest
    .mocked(enhancedFetch)
    .mockResolvedValue(new Response(JSON.stringify({ id: 1, full_path: 'team' })));
  expect((await getNamespaceTier('team')).tier).toBeNull();
});

// The real REST entity has no GraphQL data.namespace envelope.
test('reads the root subscription through the GitLab 16 REST contract', async () => {
  jest.mocked(enhancedFetch).mockResolvedValue(new Response(JSON.stringify({ plan: 'ultimate' })));
  expect((await getNamespaceTier('team/subgroup/project')).tier).toBe('ultimate');
  expect(enhancedFetch).toHaveBeenCalledWith(
    'https://gitlab.com/api/v4/namespaces/team',
    expect.objectContaining({ method: 'GET' }),
  );
});
