/**
 * Response Write Timeout Middleware
 *
 * Detects and kills zombie connections where res.write()/res.end() stalls
 * because the downstream TCP peer (Cloudflare/Envoy/client) stopped reading.
 *
 * Problem: When a client disconnects mid-flight (laptop sleep, network change),
 * the TCP connection may remain half-open. Node.js writes the HTTP response into
 * the TCP send buffer, which fills up. TCP retransmits for ~125s before RST.
 * During this time, the request appears stuck with no error.
 *
 * Solution: After response headers are sent, start a timer. If the response
 * doesn't finish (all data flushed to OS) within the timeout, destroy the socket.
 * SSE streams are excluded — they have their own heartbeat-based dead connection
 * detection (see startSseHeartbeat in server.ts).
 *
 * @see https://github.com/structured-world/gitlab-mcp/issues/391
 */

import type { Request, Response, NextFunction } from 'express';
import { RESPONSE_WRITE_TIMEOUT_MS } from '../config';
import { logWarn } from '../logger';

/** Normalize Content-Type header to lowercase string for comparison.
 *  Handles string, string[] (Node.js allows both), and undefined. */
function normalizeContentType(value: string | number | string[] | undefined): string {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return value.join(',').toLowerCase();
  return '';
}

/**
 * Express middleware that destroys sockets when response writes stall.
 *
 * Intercepts writeHead() to start a timer when response headers are sent.
 * If the response `finish` event doesn't fire within RESPONSE_WRITE_TIMEOUT_MS,
 * the socket is destroyed to free resources.
 *
 * Skips:
 * - SSE responses (Content-Type: text/event-stream) — handled by heartbeat
 * - When RESPONSE_WRITE_TIMEOUT_MS is 0 (disabled)
 */
export function responseWriteTimeoutMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Disabled when timeout is 0
    if (RESPONSE_WRITE_TIMEOUT_MS <= 0) {
      next();
      return;
    }

    let writeTimer: ReturnType<typeof setTimeout> | undefined;

    // Intercept writeHead to detect when response writing begins.
    // This pattern is used by established Express middleware (morgan, compression, on-headers).
    const originalWriteHead = res.writeHead.bind(res) as (
      ...a: Parameters<typeof res.writeHead>
    ) => ReturnType<typeof res.writeHead>;

    (res as unknown as Record<string, unknown>).writeHead = (
      ...args: Parameters<typeof res.writeHead>
    ): Response => {
      // Call originalWriteHead FIRST so headers passed as arguments are applied
      // (e.g., Content-Type: text/event-stream via writeHead(200, headers)).
      // Only then can res.getHeader() return the final effective Content-Type.
      const result = originalWriteHead(...args);

      // Start timer only once, and only for non-SSE responses
      if (!writeTimer) {
        const isSSE = normalizeContentType(res.getHeader('content-type')).includes(
          'text/event-stream',
        );

        if (!isSSE) {
          writeTimer = setTimeout(() => {
            if (!res.writableFinished && !res.destroyed) {
              // Mark response so close handler can use 'write_timeout' reason
              res.locals = res.locals ?? {};
              res.locals.writeTimedOut = true;

              const rawSessionId = req.headers['mcp-session-id'];
              const sessionId = typeof rawSessionId === 'string' ? rawSessionId : rawSessionId?.[0];
              logWarn('Response write timeout — destroying zombie connection', {
                method: req.method,
                path: req.path,
                timeoutMs: RESPONSE_WRITE_TIMEOUT_MS,
                sessionId,
                reason: 'write_timeout',
              });

              res.destroy();
            }
          }, RESPONSE_WRITE_TIMEOUT_MS);
        }
      }

      return result;
    };

    const cleanup = () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = undefined;
      }
    };

    // Clear timer when response completes normally or connection closes
    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  };
}
