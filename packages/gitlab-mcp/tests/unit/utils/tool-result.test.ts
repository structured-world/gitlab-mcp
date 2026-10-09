import { formatToolResult, errorToolResult } from '../../../src/utils/tool-result';
import type { EnhancedToolDefinition } from '../../../src/types';

const native: EnhancedToolDefinition = {
  name: 'native',
  description: 'Native output',
  inputSchema: { type: 'object' },
  resultFormat: 'mcp',
  handler: async () => ({}),
  outputSchema: {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'integer' } } },
    required: ['items'],
  },
};

describe('MCP result contract', () => {
  it('preserves the published data text format even when data resembles an envelope', () => {
    // Entity payloads named content/_meta must never accidentally become protocol data.
    const entity = { content: [], _meta: { entity: true } };
    expect(formatToolResult(entity, null)).toEqual({
      content: [{ type: 'text', text: JSON.stringify(entity, null, 2) }],
    });
    expect(formatToolResult([], null)).toEqual({ content: [{ type: 'text', text: '[]' }] });
    expect(formatToolResult(null, null)).toEqual({ content: [{ type: 'text', text: 'null' }] });
  });

  it('returns validated structured output without copying or duplicating its payload', () => {
    // Preserve UI-only metadata and any supported content blocks by reference after validation.
    const result = {
      content: [],
      structuredContent: { items: [1, 2] },
      _meta: { privateDisplay: 'hint' },
    };
    expect(formatToolResult(result, native)).toBe(result);
    expect(formatToolResult({ content: [], structuredContent: { items: [] } }, native)).toEqual({
      content: [],
      structuredContent: { items: [] },
    });
  });

  it('refuses malformed, missing and schema-invalid successful native output', () => {
    // All paths must reject invalid envelopes and missing required structured content.
    expect(() => formatToolResult(undefined, null)).toThrow('no output');
    expect(() => formatToolResult({ content: [{ type: 'text' }] }, native)).toThrow('Invalid MCP');
    expect(() => formatToolResult({ content: [] }, native)).toThrow('missing');
    expect(() =>
      formatToolResult({ content: [], structuredContent: { items: ['bad'] } }, native),
    ).toThrow('Invalid structured');
  });

  it('preserves auth challenges and execution errors without imposing the success schema', () => {
    // An authorization/error envelope is not a successful output-schema result.
    const result = {
      content: [{ type: 'text', text: 'Connect account' }],
      isError: true,
      _meta: {
        'mcp/www_authenticate': [
          'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
        ],
      },
    };
    expect(formatToolResult(result, native)).toBe(result);
    expect(errorToolResult({ code: 'TIMEOUT', retryable: false })).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ code: 'TIMEOUT', retryable: false }, null, 2) },
      ],
      structuredContent: { error: { code: 'TIMEOUT', retryable: false } },
      isError: true,
    });
  });
});
