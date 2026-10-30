#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConnectionStore } from './connection-store';
import { Connections } from './connections';
import { createPluginServer } from './server';

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir || dir.includes('${'))
    throw new Error('The host must provide the plugin data directory.');
  const connections = new Connections(new ConnectionStore(dir));
  const server = createPluginServer(connections);
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await connections.close();
    await server.close();
  };
  server.onclose = () => {
    void close();
  };
  process.stdin.once('end', () => {
    void close();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void close();
    });
  await server.connect(new StdioServerTransport());
}
void main().catch(() => {
  console.error('GitLab plugin could not start. Check Node.js 24+ and the plugin data directory.');
  process.exitCode = 1;
});
