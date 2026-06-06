/**
 * Unit tests for the gateway interceptor (issue #483). A fake `forward` stands
 * in for the downstream gitlab-mcp; we assert the forward-path hook arms a watch
 * on a non-final CI result, polls to terminal, and never mutates the passthrough.
 */
import { Interceptor, extractProjectId } from '../../../src/channel-gateway/interceptor';
import { parseToolResult } from '../../../src/channel-gateway/format';
import type { WatchEvent } from '../../../src/channel-gateway/watch';

const mcp = (payload: unknown): { content: Array<{ type: string; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('extractProjectId', () => {
  it('reads a string project_id', () => {
    expect(extractProjectId({ project_id: 'test/proj' })).toBe('test/proj');
  });
  it('stringifies a numeric project_id', () => {
    expect(extractProjectId({ project_id: 1947 })).toBe('1947');
  });
  it('returns empty when absent', () => {
    expect(extractProjectId({})).toBe('');
    expect(extractProjectId(null)).toBe('');
  });
});

describe('Interceptor', () => {
  it('forwards verbatim and arms a watch on a non-final create result', async () => {
    const jobsSeq = [
      [{ id: 1, name: 'build', stage: 'build', status: 'running' }],
      [{ id: 1, name: 'build', stage: 'build', status: 'success' }],
    ];
    let jobsCall = 0;
    const forward = jest.fn((name: string): Promise<unknown> => {
      if (name === 'manage_pipeline')
        return Promise.resolve(mcp({ id: 1397, status: 'created', ref: 'main', source: 'api' }));
      if (name === 'browse_pipelines')
        return Promise.resolve(mcp(jobsSeq[Math.min(jobsCall++, jobsSeq.length - 1)]));
      return Promise.resolve(mcp({}));
    });

    const events: WatchEvent[] = [];
    let resolveDone: () => void = () => {};
    const finished = new Promise<void>((r) => (resolveDone = r));
    const interceptor = new Interceptor({
      forward,
      emit: (e) => {
        events.push(e);
        if (e.terminal) resolveDone();
      },
      pollMs: 1,
    });

    const result = await interceptor.handleCall('manage_pipeline', {
      action: 'create',
      project_id: '1947',
      ref: 'main',
    });

    // Passthrough is unchanged.
    expect(parseToolResult(result)).toMatchObject({ id: 1397, status: 'created' });
    // Watch armed immediately.
    expect(interceptor.activeWatches).toBe(1);

    await finished;
    expect(events.some((e) => e.terminal && e.pipelineState === 'success')).toBe(true);
    await tick();
    expect(interceptor.activeWatches).toBe(0); // deregistered after terminal
  });

  it('does not arm a watch for an already-terminal result', async () => {
    const forward = jest.fn(() => Promise.resolve(mcp({ id: 1, status: 'success', ref: 'main' })));
    const interceptor = new Interceptor({ forward, emit: () => {}, pollMs: 1 });
    await interceptor.handleCall('browse_pipelines', {
      action: 'get',
      project_id: '1947',
      pipeline_id: 1,
    });
    expect(interceptor.activeWatches).toBe(0);
  });

  it('does not arm a watch for a non-CI result', async () => {
    const forward = jest.fn(() => Promise.resolve(mcp({ name: 'some-project' })));
    const interceptor = new Interceptor({ forward, emit: () => {}, pollMs: 1 });
    await interceptor.handleCall('browse_projects', { action: 'get', project_id: '1947' });
    expect(interceptor.activeWatches).toBe(0);
  });

  // A `get` returns a single pipeline object (watchable); a `jobs` poll returns
  // an array. The interceptor uses the same downstream for both, so the fake
  // must branch on action exactly like the real tool.
  const pipelineThenJobs = (jobStatus: string) =>
    jest.fn((name: string, args: unknown): Promise<unknown> => {
      const action = (args as { action?: string }).action;
      if (name === 'browse_pipelines' && action === 'jobs')
        return Promise.resolve(mcp([{ id: 1, name: 'build', stage: 'build', status: jobStatus }]));
      if (name === 'browse_pipelines' && action === 'get')
        return Promise.resolve(mcp({ id: 1397, status: 'running', ref: 'main' }));
      return Promise.resolve(mcp({}));
    });

  it('deduplicates concurrent watches on the same pipeline', async () => {
    // jobs poll never terminal, so the watch stays alive for the assertion window.
    const interceptor = new Interceptor({
      forward: pipelineThenJobs('running'),
      emit: () => {},
      pollMs: 50,
    });

    await interceptor.handleCall('browse_pipelines', {
      action: 'get',
      project_id: '1947',
      pipeline_id: 1397,
    });
    await interceptor.handleCall('browse_pipelines', {
      action: 'get',
      project_id: '1947',
      pipeline_id: 1397,
    });
    expect(interceptor.activeWatches).toBe(1);
    interceptor.shutdown();
    await tick();
  });

  it('shutdown cancels active watches', async () => {
    const interceptor = new Interceptor({
      forward: pipelineThenJobs('running'),
      emit: () => {},
      pollMs: 50,
    });
    await interceptor.handleCall('browse_pipelines', {
      action: 'get',
      project_id: '1947',
      pipeline_id: 1397,
    });
    expect(interceptor.activeWatches).toBe(1);
    interceptor.shutdown();
    expect(interceptor.activeWatches).toBe(0);
  });
});
