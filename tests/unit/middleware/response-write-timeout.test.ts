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

import { EventEmitter } from 'events';
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
  const res = Object.assign(emitter, {
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
  return res;
}

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'POST',
    path: '/mcp',
    headers: { 'mcp-session-id': 'test-session-123' },
    ...overrides,
  } as unknown as Request;
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
    // Simulates the zombie connection scenario: writeHead called (headers sent),
    // but response never finishes because TCP peer stopped reading.
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate response headers being sent (triggers timeout start)
    res.writeHead(200);

    // Advance past timeout — response hasn't finished
    jest.advanceTimersByTime(600);

    expect(res.destroy).toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      'Response write timeout — destroying zombie connection',
      expect.objectContaining({
        timeoutMs: 500,
        reason: 'write_timeout',
      }),
    );
  });

  it('does NOT destroy socket when response finishes before timeout', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    // Response finishes normally before timeout
    (res as unknown as Record<string, boolean>).writableFinished = true;
    res.emit('finish');

    // Advance past timeout
    jest.advanceTimersByTime(600);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('does NOT destroy socket when response is closed before timeout', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    // Client disconnects (close event)
    res.emit('close');

    jest.advanceTimersByTime(600);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('skips SSE responses (text/event-stream content type)', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes({
      getHeader: jest.fn().mockReturnValue('text/event-stream'),
    });
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    // Advance well past timeout
    jest.advanceTimersByTime(60000);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('skips SSE when Content-Type is provided via writeHead headers', () => {
    // Regression: Content-Type set via writeHead(200, {headers}) must be
    // detected after originalWriteHead applies headers, not before.
    const headers: Record<string, string> = {};
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes({
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
    });
    const next = jest.fn();

    middleware(req, res, next);
    // SSE Content-Type only comes via writeHead args, not setHeader
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });

    jest.advanceTimersByTime(60000);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('skips SSE with mixed-case Content-Type header', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes({
      getHeader: jest.fn().mockReturnValue('Text/Event-Stream'),
    });
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    jest.advanceTimersByTime(60000);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('is disabled when RESPONSE_WRITE_TIMEOUT_MS is 0', () => {
    mockTimeoutMs = 0;
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    jest.advanceTimersByTime(200000);

    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('does not double-destroy if already destroyed', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes({ destroyed: true });
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    jest.advanceTimersByTime(600);

    // destroy() should NOT be called because res.destroyed is already true
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('sets res.locals.writeTimedOut for close handler reason detection', () => {
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);
    res.writeHead(200);

    jest.advanceTimersByTime(600);

    expect(res.locals.writeTimedOut).toBe(true);
  });

  it('handles writeHead called multiple times gracefully', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const middleware = responseWriteTimeoutMiddleware();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    // Call writeHead twice (shouldn't start two timers)
    res.writeHead(200);
    res.writeHead(200);

    jest.advanceTimersByTime(600);

    // Only one timer should be registered despite two writeHead calls
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    // destroy called exactly once
    expect(res.destroy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });
});
