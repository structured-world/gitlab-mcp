/**
 * Unit tests for the channel-gateway MCP adapter (issue #483).
 *
 * The MCP SDK (downstream Client, upstream Server, stdio transports) is mocked,
 * so these exercise the gateway's own wiring without a live gitlab-mcp or a
 * Claude Code session: handler registration, catalog/forward passthrough, the
 * watch -> channel-notification path, reconnect-with-backoff, and the bounded
 * request buffer (backpressure + connect timeout).
 */
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Shared mock surfaces (must be `mock`-prefixed to be usable in jest.mock factories).
const mockClientConnect = jest.fn<Promise<void>, [unknown]>();
const mockClientListTools = jest.fn();
const mockClientCallTool = jest.fn();
const mockServerHandlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
const mockServerConnect = jest.fn();
const mockServerNotification = jest.fn();
const mockTransportClose = jest.fn();
// The most recently constructed downstream transport, so a test can fire onclose.
let mockTransportInstance: { onclose?: () => void; close: jest.Mock };

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    listTools: mockClientListTools,
    callTool: mockClientCallTool,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => {
    mockTransportInstance = { onclose: undefined, close: mockTransportClose };
    return mockTransportInstance;
  }),
}));

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: (schema: unknown, handler: (req: unknown) => Promise<unknown>) => {
      mockServerHandlers.set(schema, handler);
    },
    connect: mockServerConnect,
    notification: mockServerNotification,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}));

import { ChannelGateway, type GatewayConfig } from '../../../src/channel-gateway/gateway';

/** Wrap a payload in the MCP tool-result content shape the gateway forwards. */
const mcp = (payload: unknown): { content: Array<{ type: string; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const baseConfig: GatewayConfig = {
  downstreamCommand: 'node',
  downstreamArgs: ['dist/src/main.js', 'stdio'],
};

const callTool = (name: string, args: Record<string, unknown> = {}): Promise<unknown> =>
  mockServerHandlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } });

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ChannelGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerHandlers.clear();
    mockClientConnect.mockResolvedValue(undefined);
    mockClientListTools.mockResolvedValue({ tools: [] });
    mockClientCallTool.mockResolvedValue(mcp({ ok: true }));
    mockTransportClose.mockResolvedValue(undefined);
  });

  it('registers ListTools and CallTool handlers on construction', () => {
    const gw = new ChannelGateway(baseConfig);
    expect(gw).toBeInstanceOf(ChannelGateway);
    expect(mockServerHandlers.has(ListToolsRequestSchema)).toBe(true);
    expect(mockServerHandlers.has(CallToolRequestSchema)).toBe(true);
  });

  it('connects the downstream client and serves the channel on start', async () => {
    const gw = new ChannelGateway(baseConfig);
    await gw.start();
    expect(mockClientConnect).toHaveBeenCalledTimes(1);
    expect(mockServerConnect).toHaveBeenCalledTimes(1);
  });

  it('forwards the downstream catalog verbatim for ListTools', async () => {
    const tools = [{ name: 'browse_projects' }, { name: 'manage_pipeline' }];
    mockClientListTools.mockResolvedValue({ tools });
    const gw = new ChannelGateway(baseConfig);
    await gw.start();

    const result = await mockServerHandlers.get(ListToolsRequestSchema)!({});

    expect(result).toEqual({ tools });
  });

  it('forwards a read call to the downstream and returns the result unchanged', async () => {
    const payload = mcp({ projects: [{ id: 1 }] });
    mockClientCallTool.mockResolvedValue(payload);
    const gw = new ChannelGateway(baseConfig);
    await gw.start();

    const result = await callTool('browse_projects', { search: 'x' });

    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'browse_projects',
      arguments: { search: 'x' },
    });
    expect(result).toEqual(payload);
  });

  it('arms a watch on a non-final pipeline and pushes a channel event on terminal', async () => {
    const jobsSeq = [
      [{ id: 1, name: 'build', stage: 'build', status: 'running' }],
      [{ id: 1, name: 'build', stage: 'build', status: 'success' }],
    ];
    let jobsCall = 0;
    mockClientCallTool.mockImplementation((req: { name: string }) => {
      if (req.name === 'manage_pipeline') {
        return Promise.resolve(mcp({ id: 1397, status: 'running', ref: 'main', source: 'api' }));
      }
      if (req.name === 'browse_pipelines') {
        return Promise.resolve(mcp(jobsSeq[Math.min(jobsCall++, jobsSeq.length - 1)]));
      }
      return Promise.resolve(mcp({}));
    });

    const gw = new ChannelGateway({ ...baseConfig, pollMs: 5 });
    await gw.start();

    const result = await callTool('manage_pipeline', { project_id: 'test/p', action: 'create' });
    // Passthrough is unchanged even though a watch was armed.
    expect(result).toEqual(mcp({ id: 1397, status: 'running', ref: 'main', source: 'api' }));

    // Let the watch poll to terminal and emit.
    await wait(60);

    const channelCall = mockServerNotification.mock.calls.find(
      ([msg]: [{ method: string }]) => msg.method === 'notifications/claude/channel',
    );
    expect(channelCall).toBeDefined();
    expect(channelCall![0].params).toHaveProperty('content');

    await gw.stop();
  });

  it('tears down the downstream transport and watches on stop', async () => {
    const gw = new ChannelGateway(baseConfig);
    await gw.start();
    await gw.stop();
    expect(mockTransportClose).toHaveBeenCalledTimes(1);
  });

  it('reconnects when the downstream transport closes', async () => {
    const gw = new ChannelGateway(baseConfig);
    await gw.start();
    expect(mockClientConnect).toHaveBeenCalledTimes(1);

    mockTransportInstance.onclose!();
    await wait(10);

    expect(mockClientConnect).toHaveBeenCalledTimes(2);
  });

  it('emits link-health channel events on link loss and restore', async () => {
    const gw = new ChannelGateway(baseConfig);
    await gw.start();
    mockServerNotification.mockClear();

    mockTransportInstance.onclose!(); // link lost -> reconnect (mock connect resolves) -> restored
    await wait(10);

    const linkStates = mockServerNotification.mock.calls
      .map(
        ([msg]: [{ method: string; params?: { meta?: { kind?: string; state?: string } } }]) => msg,
      )
      .filter((m) => m.method === 'notifications/claude/channel' && m.params?.meta?.kind === 'link')
      .map((m) => m.params!.meta!.state);
    expect(linkStates).toEqual(['lost', 'restored']);

    await gw.stop();
  });

  it('retries the downstream connection with backoff', async () => {
    jest.useFakeTimers();
    try {
      mockClientConnect.mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
      const gw = new ChannelGateway(baseConfig);
      const started = gw.start();
      // Let the first attempt reject and enter the backoff sleep.
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(500);
      await started;
      expect(mockClientConnect).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects calls when the request buffer is full (backpressure)', async () => {
    // Never started -> downstream not connected; maxQueued 0 fails immediately.
    const gw = new ChannelGateway({ ...baseConfig, maxQueued: 0 });
    expect(gw).toBeInstanceOf(ChannelGateway);
    await expect(callTool('browse_projects')).rejects.toThrow(/buffer full/);
  });

  it('rejects calls when the downstream reconnect times out', async () => {
    const gw = new ChannelGateway({ ...baseConfig, connectTimeoutMs: 30, maxQueued: 5 });
    expect(gw).toBeInstanceOf(ChannelGateway);
    await expect(callTool('browse_projects')).rejects.toThrow(/timed out/);
  });
});
