/** Wire-level coverage using the production GraphQL client and isolated local servers. */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GraphQLClient } from '../../../../src/graphql/client';
import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';

const mockClients = new Map<string, GraphQLClient>();
let mockInstance: string;
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: (url: string) => mockClients.get(url) }) },
}));
jest.mock('../../../../src/oauth/token-context', () => ({
  ...jest.requireActual('../../../../src/oauth/token-context'),
  getGitLabApiUrlFromContext: () => mockInstance,
}));

const servers: http.Server[] = [];
const seen: Array<{
  token: string | undefined;
  query: string;
  variables: Record<string, unknown>;
}> = [];
beforeAll(async () => {
  for (const account of ['a', 'b']) {
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        const { query, variables } = JSON.parse(body) as {
          query: string;
          variables: Record<string, unknown>;
        };
        seen.push({ token: req.headers.authorization, query, variables });
        const data = query.includes('mutation ReorderIssueCard')
          ? {
              issueMoveList: {
                issue: { id: 'gid://gitlab/Issue/10', iid: '7', relativePosition: 100 },
                errors: [],
              },
            }
          : {
              target: {
                id: 'gid://gitlab/WorkItem/10',
                iid: '7',
                project: {
                  id: 'gid://gitlab/Project/1',
                  fullPath: 'test/project',
                  boards: { nodes: [{ id: 'gid://gitlab/Board/9' }] },
                  group: { fullPath: 'test' },
                },
              },
              before: {
                id: 'gid://gitlab/WorkItem/20',
                iid: '8',
                project: {
                  id: 'gid://gitlab/Project/1',
                  fullPath: 'test/project',
                  group: { fullPath: 'test' },
                },
              },
            };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
    mockClients.set(
      account,
      new GraphQLClient(url, { headers: { Authorization: `Bearer fixture-${account}` } }),
    );
  }
});
afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  mockClients.clear();
});

// Each selected connection must send its own credentials and discover its own board context.
it('reorders through GraphQL independently on two instances without accepting boardId', async () => {
  for (const account of ['a', 'b']) {
    mockInstance = account;
    const result = await workitemsToolRegistry.get('manage_work_item')!.handler({
      action: 'reorder',
      id: '10',
      beforeId: '20',
    });
    expect(result).toEqual({ id: '10', iid: '7', relativePosition: 100 });
  }
  expect(seen.map((call) => call.token)).toEqual([
    'Bearer fixture-a',
    'Bearer fixture-a',
    'Bearer fixture-b',
    'Bearer fixture-b',
  ]);
  for (const index of [1, 3]) {
    expect(seen[index].query).toContain('issueMoveList');
    expect(seen[index].variables).toEqual({
      input: {
        boardId: 'gid://gitlab/Board/9',
        projectPath: 'test/project',
        iid: '7',
        moveAfterId: '20',
      },
    });
  }
});
