import { searchToolRegistry } from '../../../../src/entities/search/registry';
import { gitlab } from '../../../../src/utils/gitlab-api';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  installFetchMock,
  mockEnhancedFetch,
  mockOk,
  lastFetchCall,
} from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const search = (action: string, scope: string) =>
  searchToolRegistry.get('browse_search')!.handler({
    action,
    scope,
    search: 'needle',
    ...(action === 'group' && { group_id: 'test/team' }),
    ...(action === 'project' && { project_id: 'test/project' }),
  });

function reject(status: number, payload: object): void {
  mockEnhancedFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(payload), { status, statusText: 'Rejected' }),
  );
}

describe('Search scope diagnostics through the REST client', () => {
  // The MCP handler must retain HTTP classification and surface the project-search remedy.
  it.each(['global', 'group'])('keeps %s scope refusals structured', async (action) => {
    reject(400, { error: 'Scope not supported without Elasticsearch!' });
    await expect(search(action, 'blobs')).rejects.toMatchObject({
      structuredError: {
        error_code: 'API_ERROR',
        tool: 'browse_search',
        action,
        http_status: 400,
        suggested_fix:
          "Use browse_search with action 'project', project_id and scope 'blobs' to search within one project.",
      },
    });
  });

  // A real HTTP refusal must survive Response parsing and reach the tool as actionable advice.
  it('explains an unavailable scope returned by an HTTP endpoint', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url!);
      response.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
      response.end(
        JSON.stringify({ message: { error: 'Scope not supported without Elasticsearch!' } }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      mockEnhancedFetch.mockImplementationOnce((url, options) => {
        const target = new URL(url);
        return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, options);
      });
      await expect(search('group', 'blobs')).rejects.toMatchObject({
        structuredError: {
          suggested_fix:
            "Use browse_search with action 'project', project_id and scope 'blobs' to search within one project.",
        },
      });
      expect(requests).toEqual([
        '/api/v4/groups/test%2Fteam/search?search=needle&per_page=20&scope=blobs',
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  // Transport failures keep their original identity, allowing the owning layer to handle retries.
  it('preserves network failures', async () => {
    const failure = new Error('connection interrupted');
    mockEnhancedFetch.mockRejectedValueOnce(failure);
    await expect(search('global', 'blobs')).rejects.toBe(failure);
  });

  // CE rejects unknown scope values; EE has distinct messages before and after exact code search.
  describe.each(['global', 'group'])('%s search', (action) => {
    it.each(['blobs', 'commits', 'notes', 'wiki_blobs'])(
      'explains unavailable %s search without retrying or broadening the request',
      async (scope) => {
        for (const payload of [
          { message: 'scope does not have a valid value' },
          { error: 'Scope not supported without Elasticsearch!' },
          { message: 'Scope supported only with advanced search' },
          { error: 'Scope supported only with advanced search or exact code search' },
          { message: { error: 'Scope not supported without Elasticsearch!' } },
        ]) {
          mockEnhancedFetch.mockClear();
          reject(400, payload);
          await expect(search(action, scope)).rejects.toMatchObject({
            structuredError: {
              error_code: 'API_ERROR',
              http_status: 400,
              tool: 'browse_search',
              action,
              suggested_fix: `Use browse_search with action 'project', project_id and scope '${scope}' to search within one project.`,
            },
          });
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
          const url = new URL(lastFetchCall()[0]);
          expect(url.pathname).toBe(
            action === 'group' ? '/api/v4/groups/test%2Fteam/search' : '/api/v4/search',
          );
          expect(url.searchParams.get('scope')).toBe(scope);
        }
      },
    );

    // An enabled search backend must keep its results and issue only the original request.
    it.each(['blobs', 'commits', 'notes', 'wiki_blobs'])(
      'preserves successful %s results',
      async (scope) => {
        const results = [{ path: 'src/main.ts', data: 'needle' }];
        mockOk(results);
        expect(await search(action, scope)).toEqual({
          ...(action === 'group' && { group_id: 'test/team' }),
          scope,
          count: 1,
          results,
        });
        expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
      },
    );
  });

  // Similar words in authentication, validation or backend errors must not be misdiagnosed.
  it.each([
    ['global', 'blobs', 401, 'scope does not have a valid value'],
    ['group', 'notes', 403, 'Scope supported only with advanced search'],
    ['global', 'blobs', 500, 'Scope not supported without Elasticsearch!'],
    ['global', 'blobs', 400, 'search is missing'],
    ['group', 'blobs', 400, 'invalid regex'],
    ['global', 'blobs', 400, 'Invalid query containing Scope not supported without Elasticsearch!'],
    ['global', 'projects', 400, 'scope does not have a valid value'],
    ['project', 'blobs', 400, 'scope does not have a valid value'],
  ] as const)('preserves %s %s HTTP %s (%s)', async (action, scope, status, message) => {
    reject(status, { message });
    await expect(search(action, scope)).rejects.toThrow(
      `GitLab API error: ${status} Rejected - ${message}`,
    );
  });

  // Project search remains usable when the same scope is unavailable across projects.
  it.each(['blobs', 'commits', 'notes', 'wiki_blobs'])(
    'keeps project %s search working',
    async (scope) => {
      mockOk([]);
      expect(await search('project', scope)).toEqual({
        project_id: 'test/project',
        scope,
        count: 0,
        results: [],
      });
    },
  );

  // Callers need the real HTTP status rather than parsing provider-controlled diagnostic text.
  it('retains the HTTP status and details on REST failures', async () => {
    reject(400, { message: 'scope does not have a valid value' });
    await expect(gitlab.get('search')).rejects.toMatchObject({
      status: 400,
      details: 'scope does not have a valid value',
    });
  });
});
