import assert from 'node:assert/strict';
import { createServer } from 'node:http';

/** Scripted provider responses drive the real CLI without credentials or model inference. */
export async function startScriptedGemini(call) {
  const requests = [];
  let invoked = false;
  let failure;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.ok(request.url.endsWith(':streamGenerateContent?alt=sse'));
      assert.ok(requests.length < 16, 'Unexpected provider request loop');
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 8 * 1024 * 1024, 'Provider request exceeds fixture limit');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ path: request.url, body });
      let parts = [{ text: 'Qualification complete.' }];
      // Auxiliary title/summary requests have no tools. Only the actual MCP dispatch is scripted.
      if (body.tools && !invoked) {
        const declarations = body.tools.flatMap(({ functionDeclarations }) => functionDeclarations);
        assert.ok(declarations.some(({ name }) => name === 'call_mcp_tool'));
        invoked = true;
        parts = [
          {
            functionCall: {
              name: 'call_mcp_tool',
              args: {
                ServerName: 'gitlab',
                ToolName: call.name,
                Arguments: call.arguments,
              },
            },
          },
        ];
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        })}\n\n`,
      );
    } catch (error) {
      failure = error;
      response.writeHead(500);
      response.end('Fixture rejected request');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    verify() {
      if (failure) throw failure;
      assert.equal(invoked, true);
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
