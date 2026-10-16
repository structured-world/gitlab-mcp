/**
 * REST calls of every tool go to the caller's GitLab instance. With OAuth that is the
 * token's instance, which can differ from the configured GITLAB_API_URL; sending the call
 * to the configured instance would also hand it a token issued by another one.
 */

let mockOAuth = true;
jest.mock('../../../src/oauth/index', () => ({
  ...jest.requireActual('../../../src/oauth/index'),
  isOAuthEnabled: () => mockOAuth,
  getGitLabApiUrlFromContext: () => 'https://caller.example.com',
}));

const mockFetch = jest.fn();
jest.mock('../../../src/utils/fetch', () => ({
  ...jest.requireActual('../../../src/utils/fetch'),
  enhancedFetch: (...args: unknown[]) => mockFetch(...args),
}));

import { gitlab } from '../../../src/utils/gitlab-api';
import { detectNamespaceType } from '../../../src/utils/namespace';
import { smartUserSearch } from '../../../src/utils/smart-user-search';
import { coreToolRegistry } from '../../../src/entities/core/registry';
import { filesToolRegistry } from '../../../src/entities/files/registry';
import { pipelinesToolRegistry } from '../../../src/entities/pipelines/registry';
import { iterationsToolRegistry } from '../../../src/entities/iterations/registry';
import type { ToolRegistry } from '../../../src/types';

function response(): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => [],
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const run = (registry: ToolRegistry, tool: string, args: Record<string, unknown>) =>
  registry.get(tool)!.handler(args);

describe('routing of REST calls to the caller instance', () => {
  const originalUrl = process.env.GITLAB_API_URL;

  beforeEach(() => {
    mockOAuth = true;
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => response());
    process.env.GITLAB_API_URL = 'https://configured.example.com';
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.GITLAB_API_URL;
    else process.env.GITLAB_API_URL = originalUrl;
  });

  it.each<[string, () => Promise<unknown>]>([
    ['the shared GitLab client', () => gitlab.get('projects')],
    ['namespace detection', () => detectNamespaceType('team').catch(() => undefined)],
    ['user search', () => smartUserSearch('Alice Example')],
    ['core tools', () => run(coreToolRegistry, 'browse_projects', { action: 'search', q: 'x' })],
    [
      'file tools',
      () =>
        run(filesToolRegistry, 'browse_files', {
          action: 'content',
          project_id: 'team/app',
          file_path: 'README.md',
        }),
    ],
    [
      'pipeline tools',
      () =>
        run(pipelinesToolRegistry, 'browse_pipelines', {
          action: 'logs',
          project_id: 'team/app',
          job_id: '1',
        }),
    ],
    [
      'iteration tools',
      () => run(iterationsToolRegistry, 'browse_iterations', { action: 'list', group_id: 'team' }),
    ],
  ])('sends %s to the caller instance', async (_label, call) => {
    await call();

    expect(mockFetch).toHaveBeenCalled();
    for (const [url] of mockFetch.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/caller\.example\.com\/api\/v4\//);
    }
  });
});
