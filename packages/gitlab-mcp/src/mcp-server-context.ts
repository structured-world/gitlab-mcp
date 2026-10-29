/**
 * The MCP server object of the session a tool call belongs to, so a tool can ask its own
 * client something (an elicitation) or tell it its tool list changed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const serverStorage = new AsyncLocalStorage<{ server: Server; signal?: AbortSignal }>();

/** Run `fn` as part of a request `server` received. */
export function runWithMcpServer<T>(server: Server, fn: () => T, signal?: AbortSignal): T {
  return serverStorage.run({ server, signal }, fn);
}

/** The server whose request is running; undefined outside one. */
export function currentMcpServer(): Server | undefined {
  return serverStorage.getStore()?.server;
}

/** Cancellation and deadline of this request, never another session's call. */
export function currentMcpAbortSignal(): AbortSignal | undefined {
  return serverStorage.getStore()?.signal;
}
