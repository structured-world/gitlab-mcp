/**
 * Channel-gateway MCP adapter (issue #483).
 *
 * One process that is BOTH:
 *   - a downstream MCP client to gitlab-mcp (the real tool catalog), and
 *   - an upstream channel-protocol MCP server to Claude Code (re-exposes that
 *     catalog verbatim AND pushes CI events into the session).
 *
 * The forward-path hook (detect non-final CI result -> arm a watch) lives in
 * {@link Interceptor}; this file is the transport wiring: connect/reconnect with
 * backoff, read-safe / write-no-retry forwarding, and channel delivery.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Interceptor } from './interceptor';
import { formatEvent } from './format';
import type { WatchEvent } from './watch';

/** Claude Code channel push method (Channels research preview). */
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';

/** A tool call is a read (safe to retry after reconnect) by name prefix. */
function isReadCall(name: string): boolean {
  return name.startsWith('browse_') || name.startsWith('get_') || name.startsWith('list_');
}

export interface GatewayConfig {
  /** Executable to launch the downstream gitlab-mcp (e.g. `node`). */
  downstreamCommand: string;
  /** Args for the downstream (e.g. `['dist/src/main.js', 'stdio']`). */
  downstreamArgs: string[];
  /** Environment for the downstream process (token, API url, gates). */
  downstreamEnv?: Record<string, string>;
  /** Watch poll interval in ms (default 10s). */
  pollMs?: number;
  /** Max backoff between reconnect attempts in ms (default 30s). */
  maxBackoffMs?: number;
  /** Gateway server name (becomes the channel `source` attribute). */
  name?: string;
  /** Gateway server version. */
  version?: string;
}

export class ChannelGateway {
  private readonly server: Server;
  private client: Client;
  private transport?: StdioClientTransport;
  private readonly interceptor: Interceptor;
  private connected = false;
  private reconnecting = false;
  private closing = false;

  constructor(private readonly config: GatewayConfig) {
    this.server = new Server(
      { name: config.name ?? 'gitlab-ci-gateway', version: config.version ?? '0.1.0' },
      {
        capabilities: {
          tools: {}, // re-exposes the downstream catalog
          experimental: { 'claude/channel': {} }, // allowed to push channel events
        },
        instructions:
          'Forwards the full gitlab-mcp tool catalog. When a CI pipeline/job is ' +
          'still running, it is watched in the background and a <channel> event ' +
          'is pushed on each state change and on completion.',
      },
    );
    this.client = this.newClient();
    this.interceptor = new Interceptor({
      forward: (name, args) => this.forward(name, args),
      emit: (event) => this.emit(event),
      pollMs: config.pollMs,
    });
    this.registerHandlers();
  }

  /** Connect downstream, then serve the channel protocol over stdio. */
  async start(): Promise<void> {
    await this.connectDownstream();
    await this.server.connect(new StdioServerTransport());
  }

  /** Stop watches and tear down the downstream link. */
  async stop(): Promise<void> {
    this.closing = true;
    this.interceptor.shutdown();
    await this.transport?.close().catch(() => {});
  }

  private newClient(): Client {
    return new Client({ name: this.config.name ?? 'gitlab-ci-gateway', version: '0.1.0' });
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const { tools } = await this.client.listTools();
      return { tools };
    });
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return (await this.interceptor.handleCall(name, args ?? {})) as CallToolResult;
    });
  }

  /** Establish the downstream session, retrying with exponential backoff. */
  private async connectDownstream(): Promise<void> {
    const maxBackoff = this.config.maxBackoffMs ?? 30_000;
    let backoff = 500;
    for (;;) {
      try {
        this.transport = new StdioClientTransport({
          command: this.config.downstreamCommand,
          args: this.config.downstreamArgs,
          env: this.config.downstreamEnv,
        });
        this.transport.onclose = (): void => this.handleDownstreamClose();
        this.client = this.newClient();
        await this.client.connect(this.transport);
        this.connected = true;
        return;
      } catch {
        if (this.closing) return;
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      }
    }
  }

  private handleDownstreamClose(): void {
    this.connected = false;
    if (this.closing || this.reconnecting) return;
    this.reconnecting = true;
    void this.connectDownstream().finally(() => {
      this.reconnecting = false;
    });
  }

  /** Await a live downstream link (used before a retryable read). */
  private async ensureConnected(): Promise<void> {
    const deadline = Date.now() + (this.config.maxBackoffMs ?? 30_000);
    while (!this.connected && !this.closing && Date.now() < deadline) {
      await this.sleep(100);
    }
  }

  /**
   * Forward one call to the downstream. Reads are retried once after a reconnect
   * (idempotent); writes are never blind-retried (double-execution risk) and
   * surface the error to the agent.
   */
  private async forward(name: string, args: unknown): Promise<unknown> {
    try {
      return await this.callDownstream(name, args);
    } catch (err) {
      if (isReadCall(name) && !this.closing) {
        await this.ensureConnected();
        return await this.callDownstream(name, args);
      }
      throw err;
    }
  }

  private async callDownstream(name: string, args: unknown): Promise<unknown> {
    return await this.client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  /** Push a watch event into the running session as a <channel> event. */
  private emit(event: WatchEvent): void {
    const { content, meta } = formatEvent(event);
    // Custom Channels method, carried by the SDK's open notification shape.
    void this.server.notification({ method: CHANNEL_NOTIFICATION, params: { content, meta } });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
