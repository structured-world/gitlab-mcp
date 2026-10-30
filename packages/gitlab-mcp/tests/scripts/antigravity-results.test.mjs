import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorkflowGitLab } from '../manual/fixtures/workflow-gitlab.mjs';
import {
  clientResult,
  recordedCall,
  validateEnvelope,
} from '../../scripts/antigravity-contract.mjs';
import { runEvaluation } from '../../scripts/evaluation-process.mjs';
import { startScriptedGemini } from '../manual/fixtures/scripted-gemini.mjs';

test('MR fixture can return an empty list without changing its single-MR default', async () => {
  // Empty results must reach the actual client as [], rather than a substituted entity.
  for (const emptyMergeRequests of [false, true]) {
    const fixture = await startWorkflowGitLab({ emptyMergeRequests });
    try {
      const response = await fetch(`${fixture.url}/api/v4/projects/71/merge_requests`);
      assert.deepEqual(await response.json(), emptyMergeRequests ? [] : [fixture.mr]);
    } finally {
      await fixture.close();
    }
  }
});

test('recording preserves metadata and correlates the advertised tool with the actual response', () => {
  // A passing client exit alone must not qualify an absent, different or schema-invalid invocation.
  const expected = { name: 'fixture', arguments: {} };
  const result = {
    content: [{ type: 'text', text: '{"value":1}' }],
    structuredContent: { value: 1 },
    _meta: { display: 'fixture' },
  };
  const tool = {
    name: 'fixture',
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      properties: { value: { type: 'integer' } },
      required: ['value'],
    },
  };
  const records = [
    {
      direction: 'request',
      message: {
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: { ...expected, _meta: { progressToken: 'progress' } },
      },
    },
    {
      direction: 'response',
      message: { jsonrpc: '2.0', id: 'unrelated', result: { content: [] } },
    },
    { direction: 'response', message: { jsonrpc: '2.0', id: 'list', result: { tools: [tool] } } },
    { direction: 'response', message: { jsonrpc: '2.0', id: 'call', result } },
  ];
  const captured = recordedCall(records, expected);
  assert.equal(captured.result, result);
  assert.deepEqual(captured.request.params._meta, { progressToken: 'progress' });
  assert.throws(() => recordedCall(records, { ...expected, arguments: { different: true } }));
  assert.throws(() => recordedCall(records.slice(0, 3), expected), /Missing MCP tool result/);
  assert.throws(() => recordedCall(records.slice(1), expected), /exactly one/);
  assert.throws(() => validateEnvelope({ ...result, structuredContent: { value: 'wrong' } }, tool));
  assert.throws(() => validateEnvelope({ content: [] }, tool), /Missing required/);
  assert.throws(() => validateEnvelope({ content: [], structuredContent: [] }, tool));
  validateEnvelope({ content: [{ type: 'text', text: 'denied' }], isError: true }, tool);
});

test('client environment is isolated from inherited credentials', async () => {
  // Passing a clean environment must reach the client instead of silently inheriting the caller.
  const result = await runEvaluation(
    process.execPath,
    [
      '-e',
      'console.log(JSON.stringify({ marker: process.env.QUALIFICATION_MARKER, gitlab: Object.hasOwn(process.env,"GITLAB_TOKEN") }))',
    ],
    {
      cwd: process.cwd(),
      env: { QUALIFICATION_MARKER: 'fixture-only' },
      timeoutMs: 30000,
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: 'fixture-only', gitlab: false });
});

test('client qualification rejects changed payloads, lost errors and missing provider responses', () => {
  // A tool transcript must agree with the wire payload and with the next provider request.
  const call = { name: 'fixture', arguments: {} };
  for (const isError of [false, true]) {
    const text = isError ? '{"error":"denied"}' : '[]';
    const info = {
      name: 'call_mcp_tool',
      parameters: { ServerName: 'gitlab', ToolName: call.name, Arguments: call.arguments },
      output: text,
    };
    if (isError) info.error = { type: 'TOOL_ERROR', message: text };
    const events = [
      {
        step_update: {
          step_type: 'tool',
          state: isError ? 'ERROR' : 'DONE',
          tool_name: 'call_mcp_tool',
          tool_info: info,
        },
      },
      { event: 'result', result: { status: 'SUCCESS' } },
    ];
    const key = isError ? 'error' : 'output';
    const response = {
      [key]:
        'Created At: 2026-10-30T00:00:00Z\nCompleted At: 2026-10-30T00:00:01Z\n' +
        (isError ? 'Encountered error in tool execution: ' : '') +
        text,
    };
    const requests = [
      {
        body: {
          contents: [{ parts: [{ functionResponse: { name: 'call_mcp_tool', response } }] }],
        },
      },
    ];
    assert.deepEqual(clientResult(events, requests, call, text, isError), {
      decoded: info,
      providerResponse: response,
    });
    assert.throws(() => clientResult(events, requests, call, '{}', isError), /changed the result/);
    assert.throws(() => clientResult(events, [], call, text, isError), /provider tool response/);
    assert.throws(() => clientResult(events, requests, call, text, !isError));
    const changed = globalThis.structuredClone(requests);
    changed[0].body.contents[0].parts[0].functionResponse.response[key] += 'changed';
    assert.throws(() => clientResult(events, changed, call, text, isError));
  }
});

test('scripted provider leaves auxiliary requests alone and emits only the selected MCP call', async () => {
  // AGY may generate a title first; that must not consume or replace the measured MCP invocation.
  const call = {
    name: 'browse_merge_requests',
    arguments: { action: 'list', project_id: 'test/backend' },
  };
  const provider = await startScriptedGemini(call);
  const send = async (body) => {
    const response = await fetch(
      `${provider.url}/v1beta/models/fixture:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.startsWith('data: ') && text.endsWith('\n\n'));
    return JSON.parse(text.slice(6, -2)).candidates[0].content.parts;
  };
  try {
    assert.deepEqual(await send({ contents: [] }), [{ text: 'Qualification complete.' }]);
    assert.throws(() => provider.verify());
    assert.deepEqual(
      await send({ tools: [{ functionDeclarations: [{ name: 'call_mcp_tool' }] }] }),
      [
        {
          functionCall: {
            name: 'call_mcp_tool',
            args: { ServerName: 'gitlab', ToolName: call.name, Arguments: call.arguments },
          },
        },
      ],
    );
    assert.deepEqual(await send({ contents: [] }), [{ text: 'Qualification complete.' }]);
    provider.verify();
    assert.equal(provider.requests.length, 3);
  } finally {
    await provider.close();
  }
});
