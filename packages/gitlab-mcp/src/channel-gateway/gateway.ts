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
import { forwardWithPolicy, isReadCall } from './forwarding';
import type { WatchEvent } from './watch';

/** Claude Code channel push method (Channels research preview). */
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';

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
  /** Max calls buffered while the downstream link is down (default 100). */
  maxQueued?: number;
  /** How long a buffered call waits for reconnect before failing (default 30s). */
  connectTimeoutMs?: number;
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
  private pendingWaiters = 0;

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

  /**
   * Await a live downstream link, bounded. Enforces `maxQueued` (backpressure)
   * and a connect timeout so a permanently-down downstream fails calls instead
   * of hanging or buffering without limit.
   */
  private async waitForConnection(): Promise<void> {
    if (this.connected) return;
    const maxQueued = this.config.maxQueued ?? 100;
    if (this.pendingWaiters >= maxQueued) {
      throw new Error(`downstream unavailable: request buffer full (${maxQueued})`);
    }
    this.pendingWaiters++;
    try {
      const deadline = Date.now() + (this.config.connectTimeoutMs ?? 30_000);
      while (!this.connected && !this.closing && Date.now() < deadline) {
        await this.sleep(100);
      }
      if (!this.connected) {
        throw new Error('downstream unavailable: reconnect timed out');
      }
    } finally {
      this.pendingWaiters--;
    }
  }

  /** Forward one call under the read-safe / write-no-retry + bounded-buffer policy. */
  private forward(name: string, args: unknown): Promise<unknown> {
    return forwardWithPolicy(
      {
        isRead: isReadCall,
        isConnected: () => this.connected,
        waitForConnection: () => this.waitForConnection(),
        call: (n, a) => this.callDownstream(n, a),
      },
      name,
      args,
    );
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
