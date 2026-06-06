/**
 * Unit tests for the channel-gateway format adapters (issue #483).
 */
import { formatEvent, parseJobs, parseToolResult } from '../../../src/channel-gateway/format';
import type { WatchEvent } from '../../../src/channel-gateway/watch';

describe('parseToolResult', () => {
  it('unwraps the JSON payload from an MCP text content block', () => {
    const mcp = { content: [{ type: 'text', text: '{"id":1,"status":"running"}' }] };
    expect(parseToolResult(mcp)).toEqual({ id: 1, status: 'running' });
  });

  it('returns null on malformed JSON in the text block', () => {
    const mcp = { content: [{ type: 'text', text: 'not json' }] };
    expect(parseToolResult(mcp)).toBeNull();
  });

  it('passes through a plain object unchanged', () => {
    expect(parseToolResult({ id: 1 })).toEqual({ id: 1 });
  });
});

describe('parseJobs', () => {
  it('parses a jobs array wrapped in an MCP result', () => {
    const jobs = [
      { id: 1, name: 'build', stage: 'build', status: 'success' },
      { id: 2, name: 'test', stage: 'test', status: 'running' },
    ];
    const mcp = { content: [{ type: 'text', text: JSON.stringify(jobs) }] };
    expect(parseJobs(mcp)).toEqual(jobs);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const data = [
      { id: 1, name: 'build', stage: 'build', status: 'success' },
      { name: 'broken' }, // missing id/stage/status
    ];
    expect(parseJobs(data)).toHaveLength(1);
  });

  it('returns empty for a non-array result', () => {
    expect(parseJobs({ id: 1, status: 'running' })).toEqual([]);
  });
});

describe('formatEvent', () => {
  const base: WatchEvent = {
    target: { kind: 'pipeline', projectId: 'test/ci-watch-poc', id: 1397 },
    pipelineState: 'running',
    jobs: [
      { id: 1, name: 'build', stage: 'build', status: 'success' },
      { id: 2, name: 'test-a', stage: 'test', status: 'running' },
    ],
    transitions: [{ name: 'test-a', from: 'pending', to: 'running' }],
    terminal: false,
  };

  it('renders a transition message with stable meta keys', () => {
    const { content, meta } = formatEvent(base);
    expect(content).toContain('Pipeline #1397');
    expect(content).toContain('test-a pending->running');
    expect(content).toContain('build:success');
    expect(meta).toEqual({
      pipeline_id: '1397',
      project_id: 'test/ci-watch-poc',
      state: 'running',
      terminal: 'false',
    });
  });

  it('renders a terminal message', () => {
    const { content, meta } = formatEvent({
      ...base,
      pipelineState: 'success',
      terminal: true,
      transitions: [],
    });
    expect(content).toContain('finished: success');
    expect(meta.terminal).toBe('true');
    expect(meta.state).toBe('success');
  });

  it('only uses identifier meta keys', () => {
    const { meta } = formatEvent(base);
    for (const key of Object.keys(meta)) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
