/**
 * Response Write Timeout Middleware Unit Tests
 *
 * Validates that zombie connections (where res.write()/res.end() stalls because
 * the downstream TCP peer stopped reading) are detected and killed.
 *
 * Bug: POST responses hang for ~125s (TCP retransmit timeout) when the client
 * disconnects mid-flight. This middleware detects the stall and destroys the
 * socket after a configurable timeout (default 10s).
 */

import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

// Default timeout for tests — overridden per-test via jest.mock
let mockTimeoutMs = 500;

jest.mock('../../../src/config', () => ({
  get RESPONSE_WRITE_TIMEOUT_MS() {
    return mockTimeoutMs;
  },
}));

jest.mock('../../../src/logger', () => ({
  logWarn: jest.fn(),
  logDebug: jest.fn(),
}));

import { responseWriteTimeoutMiddleware } from '../../../src/middleware/response-write-timeout';
import { logWarn } from '../../../src/logger';

/** Minimal mock Response that emits 'finish' and 'close' events */
function createMockRes(overrides: Record<string, unknown> = {}): Response & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    locals: {},
    writableFinished: false,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    getHeader: jest.fn().mockReturnValue('application/json'),
    writeHead: jest.fn().mockImplementation(function (this: Response) {
      (this as unknown as Record<string, boolean>).headersSent = true;
      return this;
    }),
    destroy: jest.fn().mockImplementation(function (this: Response) {
      (this as unknown as Record<string, boolean>).destroyed = true;
      emitter.emit('close');
    }),
    socket: { destroy: jest.fn() },
    ...overrides,
  }) as unknown as Response & EventEmitter;
}

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'POST',
    path: '/mcp',
    headers: { 'mcp-session-id': 'test-session-123' },
    ...overrides,
  } as unknown as Request;
}

/** Apply middleware, call writeHead, and return the wired response for assertions */
function setupMiddleware(
  reqOverrides: Record<string, unknown> = {},
  resOverrides: Record<string, unknown> = {},
) {
  const middleware = responseWriteTimeoutMiddleware();
  const req = createMockReq(reqOverrides);
  const res = createMockRes(resOverrides);
  const next = jest.fn();
  middleware(req, res, next);
  return { req, res, next };
}

describe('Response Write Timeout Middleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockTimeoutMs = 500;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('destroys socket when non-SSE response write stalls past timeout', () => {
    const { res, next } = setupMiddleware();

    expect(next).toHaveBeenCalled();
    res.writeHead(200);
    jest.advanceTimersByTime(600);

    expect(res.destroy).toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      'Response write timeout — destroying zombie connection',
      expect.objectContaining({ timeoutMs: 500, reason: 'write_timeout' }),
    );
  });

  it('does NOT destroy socket when response finishes before timeout', () => {
    const { res } = setupMiddleware();

    res.writeHead(200);
    (res as unknown as Record<string, boolean>).writableFinished = true;
    res.emit('finish');
    jest.advanceTimersByTime(600);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('does NOT destroy socket when response is closed before timeout', () => {
    const { res } = setupMiddleware();

    res.writeHead(200);
    res.emit('close');
    jest.advanceTimersByTime(600);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  // SSE detection — all variants must skip the write timeout
  describe('SSE exclusion', () => {
    /** Build a writeHead mock that applies headers to a backing store */
    function createWriteHeadWithHeaders() {
      const headers: Record<string, string> = {};
      return {
        headers,
        getHeader: jest.fn((name: string) => headers[name.toLowerCase()]),
        writeHead: jest.fn().mockImplementation(function (
          this: Response,
          _statusCode: number,
          h?: Record<string, string>,
        ) {
          if (h) {
            for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
          }
          (this as unknown as Record<string, boolean>).headersSent = true;
          return this;
        }),
      };
    }

    it.each([
      ['string', { getHeader: jest.fn().mockReturnValue('text/event-stream') }],
      ['mixed-case string', { getHeader: jest.fn().mockReturnValue('Text/Event-Stream') }],
      ['array', { getHeader: jest.fn().mockReturnValue(['text/event-stream']) }],
    ])('skips when Content-Type is a %s value', (_label, resOverrides) => {
      const { res } = setupMiddleware({ method: 'GET' }, resOverrides);
      res.writeHead(200);
      jest.advanceTimersByTime(60000);
      expect(res.destroy).not.toHaveBeenCalled();
    });

    it('skips when Content-Type is provided via writeHead headers', () => {
      const { getHeader, writeHead } = createWriteHeadWithHeaders();
      const { res } = setupMiddleware({ method: 'GET' }, { getHeader, writeHead });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      jest.advanceTimersByTime(60000);
      expect(res.destroy).not.toHaveBeenCalled();
    });
  });

  it('is disabled when RESPONSE_WRITE_TIMEOUT_MS is 0', () => {
    mockTimeoutMs = 0;
    const { res } = setupMiddleware();
    res.writeHead(200);
    jest.advanceTimersByTime(200000);
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('does not double-destroy if already destroyed', () => {
    const { res } = setupMiddleware({}, { destroyed: true });
    res.writeHead(200);
    jest.advanceTimersByTime(600);
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('sets res.locals.writeTimedOut for close handler reason detection', () => {
    const { res } = setupMiddleware();
    res.writeHead(200);
    jest.advanceTimersByTime(600);
    expect(res.locals.writeTimedOut).toBe(true);
  });

  it('handles writeHead called multiple times gracefully', () => {
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    const { res } = setupMiddleware();

    res.writeHead(200);
    res.writeHead(200);
    jest.advanceTimersByTime(600);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(res.destroy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });
});
