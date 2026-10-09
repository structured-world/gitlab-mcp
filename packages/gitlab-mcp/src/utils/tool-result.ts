import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { EnhancedToolDefinition } from '../types';

const validators = new WeakMap<object, ReturnType<AjvJsonSchemaValidator['getValidator']>>();

/** Preserve the published text contract unless a tool explicitly returns an MCP envelope. */
export function formatToolResult(
  result: unknown,
  tool: EnhancedToolDefinition | null,
): CallToolResult {
  if (tool?.resultFormat !== 'mcp') {
    const text = JSON.stringify(result, null, 2);
    if (text === undefined) throw new Error('Tool returned no output');
    return { content: [{ type: 'text', text }] };
  }

  const parsed = CallToolResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Invalid MCP tool output: ${parsed.error.message}`);
  const envelope = parsed.data;
  // MCP 2025-11-25 server/tools#structured-content: success must match outputSchema;
  // https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content
  // execution errors are exempt. The low-level SDK Server only validates the envelope.
  if (tool.outputSchema && !envelope.isError) {
    if (envelope.structuredContent === undefined) {
      throw new Error('Tool output is missing required structuredContent');
    }
    let validate = validators.get(tool.outputSchema);
    if (!validate) {
      // One compiler per immutable schema avoids $id collisions between tool definitions.
      validate = new AjvJsonSchemaValidator().getValidator(tool.outputSchema);
      validators.set(tool.outputSchema, validate);
    }
    const validation = validate(envelope.structuredContent);
    if (!validation.valid)
      throw new Error(`Invalid structured tool output: ${validation.errorMessage}`);
  }
  // Validation must not duplicate the payload or alter vendor extensions/content blocks.
  return result as CallToolResult;
}

/** Errors retain the text contract used by existing clients and expose typed error data. */
export function errorToolResult(error: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
    structuredContent: { error },
    isError: true,
  };
}
