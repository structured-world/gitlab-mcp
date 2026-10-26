const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const process = require('node:process');
const { test } = require('node:test');

// Exercise real HTTP authentication, registry handlers and the final MCP result formatter.
test('project credentials never reach formatted MCP results over real HTTP', async () => {
  const requests = [];
  const entity = {
    id: 123,
    name: 'example',
    runners_token: 'registration-secret',
    import_url: 'https://user:import-secret@example.com/repository.git',
    projects: [{ id: 456, name: 'nested', runners_token: 'nested-secret' }],
  };
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      token: request.headers['private-token'],
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url.includes('/search?') ? [entity] : entity));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const originalEnv = { ...process.env };
  try {
    process.env.GITLAB_API_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.GITLAB_TOKEN = 'fixture-token';
    process.env.GITLAB_PERSONAL_ACCESS_TOKEN = '';
    process.env.OAUTH_ENABLED = 'false';
    process.env.GITLAB_READ_ONLY_MODE = 'false';
    process.env.HTTP_PROXY = '';
    process.env.HTTPS_PROXY = '';
    const { coreToolRegistry } = require('../../dist/src/entities/core/registry');
    const { searchToolRegistry } = require('../../dist/src/entities/search/registry');
    const { formatToolResult } = require('../../dist/src/utils/tool-result');
    const safe = { id: 123, name: 'example', projects: [{ id: 456, name: 'nested' }] };
    for (const [registry, name, args, expected] of [
      [coreToolRegistry, 'browse_projects', { action: 'get', project_id: 'test/project' }, safe],
      [coreToolRegistry, 'manage_project', { action: 'archive', project_id: 'test/project' }, safe],
      [
        coreToolRegistry,
        'browse_namespaces',
        { action: 'verify', namespace_id: 'test' },
        { exists: true, status: 200, namespace: 'test', data: safe },
      ],
      [
        coreToolRegistry,
        'manage_namespace',
        { action: 'update', group_id: 'test', description: 'updated' },
        safe,
      ],
      [
        searchToolRegistry,
        'browse_search',
        { action: 'global', scope: 'projects', search: 'example' },
        { scope: 'projects', count: 1, results: [safe] },
      ],
    ]) {
      const definition = registry.get(name);
      const result = await definition.handler(args);
      assert.deepEqual(result, expected);
      const formatted = formatToolResult(result, definition);
      assert.doesNotMatch(
        JSON.stringify(formatted),
        /registration-secret|import-secret|nested-secret|runners_token|import_url/,
      );
      assert.deepEqual(JSON.parse(formatted.content[0].text), expected);
    }
    assert.equal(requests.length, 5);
    assert(requests.every((request) => request.token === 'fixture-token'));
    assert.deepEqual(
      requests.map((request) => request.method),
      ['GET', 'POST', 'GET', 'PUT', 'GET'],
    );
  } finally {
    process.env = originalEnv;
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
