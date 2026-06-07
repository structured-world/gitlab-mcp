/**
 * Unit tests for the channel-gateway entry point (issue #483). ChannelGateway is
 * mocked, so importing the module exercises only the launcher: how it derives the
 * downstream command/args/poll interval from the environment and starts the
 * gateway. The signal-handler and fatal-catch branches call process.exit and are
 * intentionally left to the live PoC rather than killing the test worker.
 */
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockGatewayCtor = jest.fn().mockImplementation(() => ({ start: mockStart, stop: mockStop }));

jest.mock('../../../src/channel-gateway/gateway', () => ({
  ChannelGateway: mockGatewayCtor,
}));

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('channel-gateway entry point', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...origEnv };
    delete process.env.GATEWAY_DOWNSTREAM_ARGS;
    delete process.env.GATEWAY_DOWNSTREAM_COMMAND;
    delete process.env.GATEWAY_POLL_MS;
  });

  afterEach(() => {
    process.env = origEnv;
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('launches the gateway with the default downstream and a clean env', async () => {
    process.env.GITLAB_TOKEN = 'tok';
    process.env.UNDEFINED_VAR = undefined;
    await jest.isolateModulesAsync(async () => {
      await import('../../../src/channel-gateway/main');
    });
    await wait(0);

    expect(mockGatewayCtor).toHaveBeenCalledTimes(1);
    const cfg = mockGatewayCtor.mock.calls[0][0];
    expect(cfg.downstreamCommand).toBe('node');
    expect(cfg.downstreamArgs[1]).toBe('stdio');
    expect(cfg.downstreamArgs[0]).toMatch(/main\.js$/);
    // cleanEnv keeps string values and drops undefined ones.
    expect(cfg.downstreamEnv.GITLAB_TOKEN).toBe('tok');
    expect(cfg.downstreamEnv).not.toHaveProperty('UNDEFINED_VAR');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('honors GATEWAY_DOWNSTREAM_* and poll-interval overrides', async () => {
    process.env.GATEWAY_DOWNSTREAM_COMMAND = 'bun';
    process.env.GATEWAY_DOWNSTREAM_ARGS = 'server.js stdio';
    process.env.GATEWAY_POLL_MS = '2500';
    await jest.isolateModulesAsync(async () => {
      await import('../../../src/channel-gateway/main');
    });
    await wait(0);

    const cfg = mockGatewayCtor.mock.calls[0][0];
    expect(cfg.downstreamCommand).toBe('bun');
    expect(cfg.downstreamArgs).toEqual(['server.js', 'stdio']);
    expect(cfg.pollMs).toBe(2500);
  });
});
