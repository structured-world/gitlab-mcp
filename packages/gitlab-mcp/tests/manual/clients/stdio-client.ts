/**
 * Stdio MCP Client for testing
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BaseTestClient } from './client.js';

export class StdioTestClient extends BaseTestClient {
  protected readonly transportLabel = 'stdio';

  protected createTransport(serverPath: string, options?: Record<string, unknown>): Transport {
    // Stdio launches the server as a child process; pass through the current
    // environment plus any caller overrides.
    const overrides = options as Record<string, string> | undefined;
    const serverEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) serverEnv[key] = value;
    }
    if (overrides) Object.assign(serverEnv, overrides);

    return new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: serverEnv,
    });
  }
}
