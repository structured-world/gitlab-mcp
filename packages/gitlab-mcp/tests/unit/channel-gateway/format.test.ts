/**
 * Unit tests for the channel-gateway format adapters (issue #483).
 */
import {
  formatEvent,
  parseDeployments,
  parseJobs,
  parseToolResult,
} from '../../../src/channel-gateway/format';
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

  it('passes through when content is present but not an array', () => {
    // Some results carry a `content` field that is an object/string, not the MCP
    // content-block array. Probing it with .find() would throw; it must pass
    // through unchanged instead.
    expect(parseToolResult({ content: { foo: 'bar' } })).toEqual({ content: { foo: 'bar' } });
    expect(parseToolResult({ content: 'plain' })).toEqual({ content: 'plain' });
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

describe('parseDeployments', () => {
  it('projects each deployment into a pseudo-job named by environment', () => {
    const deployments = [
      { id: 9, status: 'running', environment: { name: 'prod' } },
      { id: 8, status: 'success', environment: { name: 'staging' } },
    ];
    const mcp = { content: [{ type: 'text', text: JSON.stringify(deployments) }] };
    expect(parseDeployments(mcp)).toEqual([
      { id: 9, name: 'prod', stage: 'deploy', status: 'running' },
      { id: 8, name: 'staging', stage: 'deploy', status: 'success' },
    ]);
  });

  it('falls back to a synthetic name when environment is absent', () => {
    expect(parseDeployments([{ id: 5, status: 'running' }])).toEqual([
      { id: 5, name: 'deployment-5', stage: 'deploy', status: 'running' },
    ]);
  });

  it('returns empty for a non-array result', () => {
    expect(parseDeployments({ id: 1 })).toEqual([]);
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
      kind: 'pipeline',
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

  it('labels a deployment as a deployment, not a pipeline', () => {
    // A deployment rides the same job machinery; the message and meta id key must
    // name it correctly rather than mislabel it "Pipeline #.../pipeline_id".
    const { content, meta } = formatEvent({
      ...base,
      target: { kind: 'deployment', projectId: 'test/ci-watch-poc', id: 7 },
      pipelineState: 'success',
      terminal: true,
      transitions: [],
    });
    expect(content).toContain('Deployment #7');
    expect(content).not.toContain('Pipeline #7');
    expect(meta).toMatchObject({ deployment_id: '7', kind: 'deployment' });
    expect(meta).not.toHaveProperty('pipeline_id');
  });

  it('only uses identifier meta keys', () => {
    const { meta } = formatEvent(base);
    for (const key of Object.keys(meta)) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
