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
    // writeHead has complex overloads that make precise typing impractical for monkey-patching.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalWriteHead: (...a: unknown[]) => Response = res.writeHead.bind(res);

    (res as unknown as Record<string, unknown>).writeHead = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...args: any[]
    ): Response => {
      // Start timer only once, and only for non-SSE responses
      if (!writeTimer) {
        const contentType = res.getHeader('content-type');
        const isSSE = typeof contentType === 'string' && contentType.includes('text/event-stream');

        if (!isSSE) {
          writeTimer = setTimeout(() => {
            if (!res.writableFinished && !res.destroyed) {
              // Mark response so close handler can use 'write_timeout' reason
              res.locals = res.locals ?? {};
              res.locals.writeTimedOut = true;

              const sessionId = req.headers['mcp-session-id'] as string | undefined;
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return originalWriteHead(...args);
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
