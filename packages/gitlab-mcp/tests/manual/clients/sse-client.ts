/**
 * SSE MCP Client for testing
 */

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BaseTestClient } from './client.js';

export class SSETestClient extends BaseTestClient {
  protected readonly transportLabel = 'SSE';

  protected createTransport(url: string): Transport {
    return new SSEClientTransport(new URL(url));
  }
}
