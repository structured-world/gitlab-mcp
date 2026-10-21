/**
 * Every REST call is sent to the GitLab instance of its caller: the OAuth token's
 * instance, else the configured instance a static-token chat switched to, else the
 * instance the call started with or the server's own token works with, else the configured
 * GITLAB_API_URL.
 */

let mockOAuth = false;
let mockContextUrl: string | undefined;
jest.mock('../../../src/oauth/index', () => ({
  ...jest.requireActual('../../../src/oauth/index'),
  isOAuthEnabled: () => mockOAuth,
  getGitLabApiUrlFromContext: () => mockContextUrl,
}));

import { getGitLabBaseUrl, setActiveInstanceSource } from '../../../src/utils/gitlab-base-url';
import { resolveCaller, runWithCaller } from '../../../src/configuration/caller';
import { runWithTokenAccount } from '../../../src/accounts/token-account';

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

  // Every source yields a base URL without a trailing slash or /api/v4, so the REST paths
  // built on it stay well-formed.
  it("normalizes the OAuth token's instance URL", () => {
    mockOAuth = true;
    mockContextUrl = 'https://other.example.com/api/v4/';

    expect(getGitLabBaseUrl()).toBe('https://other.example.com');
  });

  it("uses the instance the server's token works with now", () => {
    setActiveInstanceSource(() => 'https://switched.example.com');

    expect(getGitLabBaseUrl()).toBe('https://switched.example.com');
  });

  // A static-token chat that switched to another configured instance sends its calls there,
  // whatever instance the call was pinned to by default.
  it('uses the configured instance a static-token chat switched to', () => {
    const caller = resolveCaller('s1', 'https://configured.example.com');

    const url = runWithCaller(caller, () =>
      runWithTokenAccount({ instanceUrl: 'https://gitlab.com', token: 'pat' }, () =>
        getGitLabBaseUrl(),
      ),
    );

    expect(url).toBe('https://gitlab.com');
  });

  // The instance the server's token works with must not move a call already running: its
  // requests stay on the instance the call started with.
  it('keeps a running call on the instance it started with', () => {
    let active = 'https://first.example.com';
    setActiveInstanceSource(() => active);
    const caller = resolveCaller('s1', active);

    const url = runWithCaller(caller, () => {
      active = 'https://second.example.com';
      return getGitLabBaseUrl();
    });

    expect(url).toBe('https://first.example.com');
    expect(getGitLabBaseUrl()).toBe('https://second.example.com');
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
