import express, { type RequestHandler } from 'express';

/** Parse admitted MCP messages once and report size errors in the JSON-RPC envelope. */
export function mcpJsonBodyParser(limit: number): RequestHandler {
  const parse = express.json({ limit });
  return (req, res, next) => {
    parse(req, res, (error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        res.status(413).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: `JSON request exceeds ${limit} bytes; configure MCP_REQUEST_BODY_LIMIT to raise the limit.`,
          },
        });
        return;
      }
      next(error);
    });
  };
}
