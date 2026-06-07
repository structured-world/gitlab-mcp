/**
 * Unit tests for the CI watch core (issue #483). These assert the exact
 * behavior validated in the live PoC: detect by shape, start a timer from the
 * id, emit on every per-job change, stop on terminal — reproduced here over a
 * multi-stage DAG (build -> test-a || test-b -> deploy) with injected polls.
 */
import {
  aggregateState,
  detectWatchable,
  diffJobs,
  isTerminal,
  snapshot,
  WatchManager,
  type JobState,
  type WatchEvent,
  type WatchTarget,
} from '../../../src/channel-gateway/watch';

const job = (name: string, status: string, stage = name, id = 0): JobState => ({
  id,
  name,
  stage,
  status,
});

describe('aggregateState', () => {
  it('returns pending for no jobs', () => {
    expect(aggregateState([])).toBe('pending');
  });

  it('returns running while any job is non-final', () => {
    expect(aggregateState([job('a', 'success'), job('b', 'running')])).toBe('running');
    expect(aggregateState([job('a', 'created')])).toBe('running');
  });

  it('returns failed when a job failed and none are in flight', () => {
    expect(aggregateState([job('a', 'success'), job('b', 'failed')])).toBe('failed');
  });

  it('returns success when all jobs succeeded', () => {
    expect(aggregateState([job('a', 'success'), job('b', 'success')])).toBe('success');
  });

  it('prefers running over failed when a job is still in flight', () => {
    // A failed job must not end the watch while another job still runs.
    expect(aggregateState([job('a', 'failed'), job('b', 'running')])).toBe('running');
  });
});

describe('isTerminal', () => {
  it('treats pipeline terminal states as terminal', () => {
    expect(isTerminal('success')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('canceled')).toBe(true);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('pending')).toBe(false);
  });
});

describe('diffJobs', () => {
  it('reports first-seen jobs as transitions from null', () => {
    const t = diffJobs(new Map(), [job('a', 'created')]);
    expect(t).toEqual([{ name: 'a', from: null, to: 'created' }]);
  });

  it('reports only changed jobs', () => {
    const prev = snapshot([job('a', 'running'), job('b', 'running')]);
    const t = diffJobs(prev, [job('a', 'running'), job('b', 'success')]);
    expect(t).toEqual([{ name: 'b', from: 'running', to: 'success' }]);
  });

  it('reports nothing when unchanged', () => {
    const prev = snapshot([job('a', 'running')]);
    expect(diffJobs(prev, [job('a', 'running')])).toEqual([]);
  });
});

describe('detectWatchable', () => {
  it('detects a non-final pipeline by shape', () => {
    const r = { id: 1397, status: 'created', ref: 'main', sha: 'abc', source: 'api' };
    expect(detectWatchable('1947', r)).toEqual({ kind: 'pipeline', projectId: '1947', id: 1397 });
  });

  it('does not watch a bare job: its id is a job id, not a pipeline id', () => {
    // A job carries a stage but no pipeline markers (ref/sha/source). Arming it
    // would re-query its job id as if it were a pipeline id; the job's pipeline
    // is watched instead.
    const r = { id: 42, status: 'running', stage: 'test', name: 'test-a' };
    expect(detectWatchable('1947', r)).toBeNull();
  });

  it('does not watch a generic {id,status} lacking pipeline markers', () => {
    // Guards against a false-positive watch on any object that merely carries a
    // numeric id and a status string but is not a pipeline (no ref/sha/source).
    expect(detectWatchable('1947', { id: 99, status: 'running' })).toBeNull();
  });

  it('detects a non-final deployment by environment + deployable markers', () => {
    // A deployment also has ref/sha, so the deployment markers must win.
    const r = {
      id: 7,
      status: 'running',
      ref: 'main',
      sha: 'abc',
      environment: { name: 'prod' },
      deployable: { id: 9 },
    };
    expect(detectWatchable('1947', r)).toEqual({ kind: 'deployment', projectId: '1947', id: 7 });
  });

  it('returns null for an already-terminal deployment', () => {
    const r = { id: 7, status: 'success', environment: { name: 'prod' }, deployable: { id: 9 } };
    expect(detectWatchable('1947', r)).toBeNull();
  });

  it('treats a blocked deployment as non-final (watchable)', () => {
    const r = { id: 7, status: 'blocked', environment: { name: 'prod' }, deployable: { id: 9 } };
    expect(detectWatchable('1947', r)).toEqual({ kind: 'deployment', projectId: '1947', id: 7 });
  });

  it('returns null for an already-terminal pipeline (no watch needed)', () => {
    const r = { id: 1397, status: 'success', ref: 'main' };
    expect(detectWatchable('1947', r)).toBeNull();
  });

  it('returns null without a project id', () => {
    expect(detectWatchable('', { id: 1, status: 'running', ref: 'main' })).toBeNull();
  });

  it('returns null for non CI-shaped results', () => {
    expect(detectWatchable('1947', { foo: 'bar' })).toBeNull();
    expect(detectWatchable('1947', [{ id: 1, status: 'running' }])).toBeNull();
  });
});

describe('WatchManager', () => {
  const target: WatchTarget = { kind: 'pipeline', projectId: '1947', id: 1397 };
  // Fake poll sequence reproducing the PoC DAG: build -> test-a||test-b -> deploy.
  const sequence: JobState[][] = [
    [
      job('build', 'created', 'build'),
      job('test-a', 'created', 'test'),
      job('test-b', 'created', 'test'),
      job('deploy', 'created', 'deploy'),
    ],
    [
      job('build', 'running', 'build'),
      job('test-a', 'created', 'test'),
      job('test-b', 'created', 'test'),
      job('deploy', 'created', 'deploy'),
    ],
    [
      job('build', 'success', 'build'),
      job('test-a', 'pending', 'test'),
      job('test-b', 'pending', 'test'),
      job('deploy', 'created', 'deploy'),
    ],
    [
      job('build', 'success', 'build'),
      job('test-a', 'running', 'test'),
      job('test-b', 'running', 'test'),
      job('deploy', 'created', 'deploy'),
    ],
    [
      job('build', 'success', 'build'),
      job('test-a', 'running', 'test'),
      job('test-b', 'success', 'test'),
      job('deploy', 'created', 'deploy'),
    ],
    [
      job('build', 'success', 'build'),
      job('test-a', 'success', 'test'),
      job('test-b', 'success', 'test'),
      job('deploy', 'running', 'deploy'),
    ],
    [
      job('build', 'success', 'build'),
      job('test-a', 'success', 'test'),
      job('test-b', 'success', 'test'),
      job('deploy', 'success', 'deploy'),
    ],
  ];

  function makeManager(polls: JobState[][]): { mgr: WatchManager; events: WatchEvent[] } {
    const events: WatchEvent[] = [];
    let i = 0;
    const mgr = new WatchManager({
      pollJobs: () => Promise.resolve(polls[Math.min(i++, polls.length - 1)]),
      emit: (e) => events.push(e),
      sleep: () => Promise.resolve(), // collapse poll interval in tests
    });
    return { mgr, events };
  }

  it('emits on every change and stops on terminal', async () => {
    const { mgr, events } = makeManager(sequence);
    await mgr.watch(target, { pollMs: 1 });

    // One event per distinct snapshot (7 polls, each differs from the prior).
    expect(events).toHaveLength(7);
    expect(events[events.length - 1].terminal).toBe(true);
    expect(events[events.length - 1].pipelineState).toBe('success');
    expect(mgr.size).toBe(0); // deregistered after terminal
  });

  it('captures the parallel test jobs running at the same time', async () => {
    const { mgr, events } = makeManager(sequence);
    await mgr.watch(target, { pollMs: 1 });

    const bothRunning = events.find(
      (e) =>
        e.jobs.find((j) => j.name === 'test-a')?.status === 'running' &&
        e.jobs.find((j) => j.name === 'test-b')?.status === 'running',
    );
    expect(bothRunning).toBeDefined();
  });

  it('reports the build->running transition as a single job change', async () => {
    const { mgr, events } = makeManager(sequence);
    await mgr.watch(target, { pollMs: 1 });
    const buildRunning = events.find(
      (e) =>
        e.transitions.length === 1 &&
        e.transitions[0].name === 'build' &&
        e.transitions[0].to === 'running',
    );
    expect(buildRunning).toBeDefined();
  });

  it('deduplicates: a second watch on the same target is a no-op', async () => {
    const { mgr } = makeManager([[job('a', 'running')], [job('a', 'success')]]);
    const first = mgr.watch(target, { pollMs: 1 });
    const second = mgr.watch(target, { pollMs: 1 }); // must not start a second timer
    expect(mgr.size).toBe(1);
    await Promise.all([first, second]);
  });

  it('stops at the max-duration cap even if never terminal', async () => {
    let polls = 0;
    const events: WatchEvent[] = [];
    let clock = 0;
    const mgr = new WatchManager({
      pollJobs: () => {
        polls++;
        return Promise.resolve([job('a', 'running')]); // never terminal
      },
      emit: (e) => events.push(e),
      sleep: () => Promise.resolve(),
      now: () => (clock += 600_000), // advance 10min per call
    });
    await mgr.watch(target, { pollMs: 1, maxDurationMs: 1_000_000 });
    // Capped quickly rather than looping forever.
    expect(polls).toBeGreaterThan(0);
    expect(mgr.size).toBe(0);
  });

  it('cancel stops an in-flight watch', async () => {
    let polls = 0;
    const mgr = new WatchManager({
      pollJobs: () => {
        polls++;
        if (polls === 2) mgr.cancel(target);
        return Promise.resolve([job('a', 'running')]);
      },
      emit: () => {},
      sleep: () => Promise.resolve(),
    });
    await mgr.watch(target, { pollMs: 1 });
    expect(mgr.size).toBe(0);
  });

  it('ends the watch via onError when a poll rejects, without rejecting', async () => {
    // A detached background watch must never reject (that would be an unhandled
    // rejection): a failed poll routes through onError and ends the watch.
    const errors: unknown[] = [];
    const mgr = new WatchManager({
      pollJobs: () => Promise.reject(new Error('downstream gone')),
      emit: () => {},
      sleep: () => Promise.resolve(),
      onError: (_t, e) => errors.push(e),
    });
    await expect(mgr.watch(target, { pollMs: 1 })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('downstream gone');
    expect(mgr.size).toBe(0); // deregistered after the failed poll
  });
});
