#!/usr/bin/env node
/**
 * Entry point for the gitlab-ci channel-gateway (issue #483).
 *
 * Launches the downstream gitlab-mcp (by default `node dist/src/main.js stdio`,
 * inheriting this process's environment so the token / API url / USE_* gates
 * carry through) and serves the channel protocol on stdio. Register it as a
 * channel:
 *
 *   .mcp.json:  { "mcpServers": { "gitlab-ci": {
 *                 "command": "node",
 *                 "args": ["dist/src/channel-gateway/main.js"] } } }
 *   launch:     claude --dangerously-load-development-channels server:gitlab-ci
 */
import { join } from 'node:path';
import { ChannelGateway } from './gateway';

/** Drop undefined-valued env entries so the child gets a clean string map. */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v;
  return out;
}

async function main(): Promise<void> {
  // Resolve the downstream gitlab-mcp relative to this file so the gateway runs
  // from any working directory (a channel is launched with an arbitrary cwd).
  const args = process.env.GATEWAY_DOWNSTREAM_ARGS
    ? process.env.GATEWAY_DOWNSTREAM_ARGS.split(' ').filter(Boolean)
    : [join(__dirname, '..', 'main.js'), 'stdio'];

  const gateway = new ChannelGateway({
    downstreamCommand: process.env.GATEWAY_DOWNSTREAM_COMMAND ?? 'node',
    downstreamArgs: args,
    downstreamEnv: cleanEnv(process.env),
    pollMs: Number(process.env.GATEWAY_POLL_MS) || 10_000,
  });

  const stop = (): void => {
    void gateway.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await gateway.start();
}

main().catch((err: unknown) => {
  process.stderr.write(`channel-gateway failed: ${String(err)}\n`);
  process.exit(1);
});
