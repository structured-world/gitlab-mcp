/**
 * The MCP server object of the session a tool call belongs to, so a tool can ask its own
 * client something (an elicitation) or tell it its tool list changed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const serverStorage = new AsyncLocalStorage<Server>();

/** Run `fn` as part of a request `server` received. */
export function runWithMcpServer<T>(server: Server, fn: () => T): T {
  return serverStorage.run(server, fn);
}

/** The server whose request is running; undefined outside one. */
export function currentMcpServer(): Server | undefined {
  return serverStorage.getStore();
}
