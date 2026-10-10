/**
 * Instances a user can sign in to: only configured ones, each with its own application.
 */

import { oauthAppFor, selectableOAuthApps } from '../../../src/oauth/instance-app';
import { InstanceRegistry } from '../../../src/services/InstanceRegistry';
import type { OAuthConfig } from '../../../src/oauth/config';
import { GitLabInstanceConfigSchema } from '../../../src/config/instances-schema';

/** The instance fields the resolver reads; validated as the loader does, defaults included. */
interface InstanceFixture {
  url: string;
  label?: string;
  oauth?: { clientId: string; clientSecret?: string; scopes?: string };
}

jest.mock('../../../src/config', () => ({
  ...jest.requireActual('../../../src/config'),
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}));

const config = {
  gitlabClientId: 'default-app',
  gitlabClientSecret: undefined,
  gitlabScopes: 'api,read_user',
} as OAuthConfig;

function useInstances(instances: InstanceFixture[]): void {
  const byUrl = new Map(
    instances.map((instance) => [instance.url, GitLabInstanceConfigSchema.parse(instance)]),
  );
  jest.spyOn(InstanceRegistry, 'getInstance').mockReturnValue({
    isInitialized: () => true,
    initialize: jest.fn(),
    getUrls: () => [...byUrl.keys()],
    getConfig: (url: string) => byUrl.get(url),
  } as unknown as InstanceRegistry);
}

describe('instance applications', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers the default application alone for a single-instance deployment', async () => {
    useInstances([{ url: 'https://gitlab.example.com', label: 'Default Instance' }]);

    expect(await selectableOAuthApps(config)).toEqual([
      {
        baseUrl: 'https://gitlab.example.com',
        label: 'Default Instance',
        clientId: 'default-app',
        clientSecret: undefined,
        scopes: 'api,read_user',
      },
    ]);
  });

  it('adds every instance with its own application, default first', async () => {
    useInstances([
      {
        url: 'https://git.corp.example/gitlab',
        label: 'Corp',
        oauth: { clientId: 'corp-app', clientSecret: 's' },
      },
      { url: 'https://no-oauth.example.com', label: 'No OAuth app' },
    ]);

    const apps = await selectableOAuthApps(config);

    expect(apps.map((app) => app.baseUrl)).toEqual([
      'https://gitlab.example.com',
      'https://git.corp.example/gitlab',
    ]);
    // Without an own application the instance scopes fall back to OAUTH_SCOPES.
    expect(apps[1]).toEqual({
      baseUrl: 'https://git.corp.example/gitlab',
      label: 'Corp',
      clientId: 'corp-app',
      clientSecret: 's',
      scopes: 'api,read_user',
    });
  });

  it("prefers a registered instance's own application over OAUTH_CLIENT_ID", async () => {
    useInstances([
      { url: 'https://gitlab.example.com', oauth: { clientId: 'own-app', scopes: 'read_api' } },
    ]);

    expect(await oauthAppFor(config, undefined)).toMatchObject({
      clientId: 'own-app',
      scopes: 'read_api',
    });
  });

  it.each([
    ['the default when nothing was chosen', undefined, 'https://gitlab.example.com'],
    [
      'a configured instance in any equivalent form',
      'https://git.corp.example/gitlab/api/v4/',
      'https://git.corp.example/gitlab',
    ],
    ['nothing for an instance that is not configured', 'https://attacker.example', undefined],
    [
      'nothing for a configured URL without an application',
      'https://no-oauth.example.com',
      undefined,
    ],
  ])('resolves %s', async (_c, requested, expected) => {
    useInstances([
      { url: 'https://git.corp.example/gitlab', oauth: { clientId: 'corp-app' } },
      { url: 'https://no-oauth.example.com' },
    ]);

    expect((await oauthAppFor(config, requested))?.baseUrl).toBe(expected);
  });

  it('initializes the registry before the first lookup', async () => {
    const initialize = jest.fn();
    jest.spyOn(InstanceRegistry, 'getInstance').mockReturnValue({
      isInitialized: () => false,
      initialize,
      getUrls: () => [],
      getConfig: () => undefined,
    } as unknown as InstanceRegistry);

    await selectableOAuthApps(config);

    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
