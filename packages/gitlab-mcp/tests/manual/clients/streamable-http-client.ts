/**
 * Streamable HTTP MCP Client for testing
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BaseTestClient } from './client.js';

export class StreamableHTTPTestClient extends BaseTestClient {
  protected readonly transportLabel = 'Streamable HTTP';

  protected createTransport(url: string): Transport {
    return new StreamableHTTPClientTransport(new URL(url));
  }
}
