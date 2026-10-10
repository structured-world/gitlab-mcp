/**
 * Every REST call is sent to the GitLab instance of its caller: the OAuth token's
 * instance, else the instance the server's own token works with now (it changes on
 * switch_instance), else the configured GITLAB_API_URL.
 */

let mockOAuth = false;
let mockContextUrl: string | undefined;
jest.mock('../../../src/oauth/index', () => ({
  ...jest.requireActual('../../../src/oauth/index'),
  isOAuthEnabled: () => mockOAuth,
  getGitLabApiUrlFromContext: () => mockContextUrl,
}));

import { getGitLabBaseUrl, setActiveInstanceSource } from '../../../src/utils/gitlab-base-url';

describe('getGitLabBaseUrl', () => {
  const originalUrl = process.env.GITLAB_API_URL;

  beforeEach(() => {
    mockOAuth = false;
    mockContextUrl = undefined;
    setActiveInstanceSource(() => null);
    process.env.GITLAB_API_URL = 'https://configured.example.com';
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.GITLAB_API_URL;
    else process.env.GITLAB_API_URL = originalUrl;
  });

  it("uses the OAuth token's instance", () => {
    mockOAuth = true;
    mockContextUrl = 'https://other.example.com';
    setActiveInstanceSource(() => 'https://active.example.com');

    expect(getGitLabBaseUrl()).toBe('https://other.example.com');
  });

  it("uses the instance the server's token works with now", () => {
    setActiveInstanceSource(() => 'https://switched.example.com');

    expect(getGitLabBaseUrl()).toBe('https://switched.example.com');
  });

  it('uses the active instance for an OAuth request without a token context', () => {
    mockOAuth = true;
    setActiveInstanceSource(() => 'https://active.example.com');

    expect(getGitLabBaseUrl()).toBe('https://active.example.com');
  });

  // Read at call time, as the configuration can change after startup (profiles).
  it.each([
    ['https://later.example.com/', 'https://later.example.com'],
    ['https://later.example.com/api/v4', 'https://later.example.com'],
  ])('falls back to GITLAB_API_URL %s as it is now', (configured, expected) => {
    process.env.GITLAB_API_URL = configured;

    expect(getGitLabBaseUrl()).toBe(expected);
  });

  it('falls back to gitlab.com when nothing is configured', () => {
    delete process.env.GITLAB_API_URL;

    expect(getGitLabBaseUrl()).toBe('https://gitlab.com');
  });
});
