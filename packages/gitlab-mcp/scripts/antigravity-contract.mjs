import assert from 'node:assert/strict';
import { CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';

/** Validate the envelope independently of the client's display representation. */
export function validateEnvelope(result, tool) {
  CallToolResultSchema.parse(result);
  if (tool.outputSchema && !result.isError) {
    assert.notEqual(result.structuredContent, undefined, 'Missing required structured result');
    const validation = new AjvJsonSchemaValidator().getValidator(tool.outputSchema)(
      result.structuredContent,
    );
    assert.equal(validation.valid, true, validation.errorMessage);
  }
}

/** Correlate actual request IDs, including the tool definition received by the client. */
export function recordedCall(records, expected) {
  const requests = records.filter(
    ({ direction, message }) => direction === 'request' && message.method === 'tools/call',
  );
  assert.equal(requests.length, 1, 'Expected exactly one MCP tool invocation');
  const request = requests[0].message;
  CallToolRequestSchema.parse(request);
  // Client-owned request metadata stays in the capture, outside the tool's input contract.
  assert.deepEqual({ name: request.params.name, arguments: request.params.arguments }, expected);
  const response = records.find(
    ({ direction, message }) => direction === 'response' && message.id === request.id,
  );
  assert.ok(response?.message.result, 'Missing MCP tool result');
  const definitions = records.filter(
    ({ direction, message }) => direction === 'response' && Array.isArray(message.result?.tools),
  );
  const tool = definitions
    .flatMap(({ message }) => message.result.tools)
    .find(({ name }) => name === expected.name);
  assert.ok(tool, 'Invoked tool was not advertised');
  validateEnvelope(response.message.result, tool);
  return { request, result: response.message.result, tool };
}

/** Exercise the actual published transport, never a copied implementation of its fix. */
export function historicalResult(McpComplianceTransport, original) {
  const underlying = { start: async () => {}, close: async () => {}, send: async () => {} };
  const transport = new McpComplianceTransport(underlying);
  let received;
  transport.onmessage = (message) => {
    received = message;
  };
  underlying.onmessage({ jsonrpc: '2.0', id: 1, result: globalThis.structuredClone(original) });
  assert.ok(received, 'Historical transport did not deliver its response');
  const validation = CallToolResultSchema.safeParse(received.result);
  return {
    result: received.result,
    valid: validation.success,
    issues: validation.success ? [] : validation.error.issues,
  };
}

/** Check the CLI's actual decoded result and the provider's subsequent tool response. */
export function clientResult(events, requests, expected, text, isError) {
  const tools = events.filter(
    ({ step_update: step }) => step?.step_type === 'tool' && ['DONE', 'ERROR'].includes(step.state),
  );
  assert.equal(tools.length, 1, 'Expected one completed AGY tool');
  const completed = tools[0].step_update;
  assert.equal(completed.state, isError ? 'ERROR' : 'DONE');
  assert.equal(completed.tool_name, 'call_mcp_tool');
  assert.deepEqual(completed.tool_info.parameters, {
    ServerName: 'gitlab',
    ToolName: expected.name,
    Arguments: expected.arguments,
  });
  assert.equal(completed.tool_info.output, text, 'Client changed the result text');
  if (isError) assert.deepEqual(completed.tool_info.error, { type: 'TOOL_ERROR', message: text });
  else assert.equal(Object.hasOwn(completed.tool_info, 'error'), false);
  const replies = requests
    .flatMap(({ body }) => body.contents.flatMap(({ parts }) => parts))
    .filter(({ functionResponse }) => functionResponse?.name === 'call_mcp_tool');
  assert.equal(replies.length, 1, 'Expected exactly one provider tool response');
  const response = replies[0].functionResponse.response;
  const key = isError ? 'error' : 'output';
  assert.deepEqual(Object.keys(response), [key]);
  const lines = response[key].split('\n');
  for (const [index, label] of ['Created At: ', 'Completed At: '].entries()) {
    assert.ok(lines[index].startsWith(label));
    assert.equal(Number.isNaN(Date.parse(lines[index].slice(label.length))), false);
  }
  assert.equal(
    lines.slice(2).join('\n'),
    isError ? `Encountered error in tool execution: ${text}` : text,
  );
  const final = events.filter(({ event }) => event === 'result');
  assert.equal(final.length, 1);
  assert.equal(final[0].result.status, 'SUCCESS');
  return { decoded: completed.tool_info, providerResponse: response };
}
