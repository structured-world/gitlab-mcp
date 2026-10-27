import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Exercise the real authenticated fetch and JSON MCP formatter, with no fetch mocks.
it('preserves repository file bytes through HTTP and the MCP result', async () => {
  const fixtures = [
    { path: 'report.pdf', bytes: Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80]) },
    { path: 'unicode.txt', bytes: Buffer.from('caf\u00e9 \u{1f680}') },
  ];
  const requests: { path: string | undefined; token: string | string[] | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, token: request.headers['private-token'] });
    const fixture = fixtures.find((item) => request.url?.includes(`/files/${item.path}/raw`));
    if (!fixture) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(fixture.bytes);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const originalEnv = process.env;
  try {
    process.env = {
      ...originalEnv,
      GITLAB_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      GITLAB_TOKEN: 'fixture-token',
      GITLAB_PERSONAL_ACCESS_TOKEN: '',
      OAUTH_ENABLED: 'false',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
    };
    await jest.isolateModulesAsync(async () => {
      const { filesToolRegistry } = await import('../../../../src/entities/files/registry');
      const { formatToolResult } = await import('../../../../src/utils/tool-result');
      const tool = filesToolRegistry.get('browse_files')!;
      for (const fixture of fixtures) {
        const result = await tool.handler({
          action: 'content',
          project_id: 'test/project',
          file_path: fixture.path,
          ref: 'main',
        });
        const block = formatToolResult(result, tool).content[0];
        if (block.type !== 'text') throw new Error('Expected a text MCP result');
        const payload = JSON.parse(block.text);
        expect(Buffer.from(payload.content, payload.encoding)).toEqual(fixture.bytes);
        expect(payload.size).toBe(fixture.bytes.byteLength);
        expect(payload.content_type).toBe('application/octet-stream');
      }
    });
    expect(requests).toEqual(
      fixtures.map((fixture) => ({
        path: `/api/v4/projects/test%2Fproject/repository/files/${fixture.path}/raw?ref=main`,
        token: 'fixture-token',
      })),
    );
  } finally {
    process.env = originalEnv;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
