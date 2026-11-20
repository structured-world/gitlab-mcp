import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { closeLineGrepWorkers } from '../../../../src/entities/pipelines/line-grep-worker';
import { runInCallScope } from '../../../../src/configuration/call-scope';
import { ScopeEnforcer } from '../../../../src/profiles/scope-enforcer';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
jest.mock('node:worker_threads', () => ({
  ...jest.requireActual<typeof import('node:worker_threads')>('node:worker_threads'),
  // A plain constructor: mock resets between tests must not erase the worker stand-in.
  Worker: function Worker() {
    return jest
      .requireActual<typeof import('../../helpers/in-process-grep-worker')>(
        '../../helpers/in-process-grep-worker',
      )
      .createFakeGrepWorker();
  },
}));
// Scan time is what the scanner reads from this clock: frozen by default, so no budget
// stop happens unless a test advances it on every reading.
const mockClock = { now: 0, step: 0 };
jest.mock('node:perf_hooks', () => ({
  performance: {
    now: () => {
      mockClock.now += mockClock.step;
      return mockClock.now;
    },
  },
}));
installFetchMock();
afterEach(() => {
  mockClock.step = 0;
  return closeLineGrepWorkers();
});

const PIPELINE = '/api/v4/projects/test%2Fproject/pipelines/100';

interface Row {
  id: number;
  [field: string]: unknown;
}

const job = (id: number, extra: Record<string, unknown> = {}): Row => ({
  id,
  name: `job-${id}`,
  stage: 'test',
  status: 'failed',
  allow_failure: false,
  failure_reason: 'script_failure',
  web_url: `https://gitlab.example.com/jobs/${id}`,
  ...extra,
});

const bridge = (id: number, downstream: { id: number; project_id: number } | null): Row =>
  job(id, { stage: 'deploy', downstream_pipeline: downstream });

const identity = (row: Row, projectId = 'test/project', pipelineId = '100') => ({
  job_id: String(row.id),
  name: row.name,
  stage: row.stage,
  status: row.status,
  failure_reason: row.failure_reason ?? null,
  project_id: projectId,
  pipeline_id: pipelineId,
  web_url: row.web_url,
});

/**
 * Answer GitLab requests by path: listings from `listings` (one page each, unless a path
 * maps to several pages, or an HTTP error status for the listing or for one of its pages),
 * filtered by `scope[]` as GitLab does; single resources given as `{ resource }`; traces
 * from `traces`; anything else fails the test.
 */
function serve(
  listings: Record<string, Row[] | Array<Row[] | number> | number | { resource: object }>,
  traces: Record<string, string | number>,
): void {
  mockEnhancedFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const trace = /\/jobs\/(\d+)\/trace$/.exec(url.pathname);
    if (trace) {
      const body = traces[trace[1]];
      if (body === undefined) throw new Error(`unexpected trace ${url.pathname}`);
      if (typeof body === 'number')
        return new Response('denied', { status: body, statusText: 'Forbidden' });
      return new Response(new TextEncoder().encode(body));
    }
    const listing = listings[url.pathname];
    if (listing === undefined) {
      if (url.pathname.endsWith('/bridges'))
        return new Response('[]', { headers: { 'x-next-page': '' } });
      return new Response('{"message":"404 Not found"}', { status: 404, statusText: 'Not Found' });
    }
    const failure = (status: number) =>
      new Response('{"message":"unavailable"}', { status, statusText: 'Error' });
    if (typeof listing === 'number') return failure(listing);
    if (!Array.isArray(listing)) return new Response(JSON.stringify(listing.resource));
    const paged = listing.some((entry) => Array.isArray(entry) || typeof entry === 'number');
    const pages = paged ? (listing as Array<Row[] | number>) : [listing as Row[]];
    const page = Number(url.searchParams.get('page') ?? '1');
    const scope = url.searchParams.getAll('scope[]');
    const served = pages[page - 1] ?? [];
    if (typeof served === 'number') return failure(served);
    // GitLab hides superseded attempts (marked `retried` here) unless include_retried is set.
    const retried = url.searchParams.get('include_retried') === 'true';
    const rows = served.filter(
      (row) =>
        (retried || row.retried !== true) &&
        (scope.length === 0 || scope.includes(String(row.status))),
    );
    return new Response(JSON.stringify(rows), {
      headers: { 'x-next-page': page < pages.length ? String(page + 1) : '' },
    });
  });
}

const grep = (args: Record<string, unknown>) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    action: 'log_grep',
    project_id: 'test/project',
    pipeline_id: '100',
    before: 0,
    after: 0,
    ...args,
  }) as Promise<Record<string, unknown>>;

const requested = (pattern: RegExp) =>
  mockEnhancedFetch.mock.calls.map(([url]) => String(url)).filter((url) => pattern.test(url));

describe('browse_pipelines log_grep with pipeline_id', () => {
  // One call answers "why did this pipeline fail": failed jobs are searched with the
  // failures preset, a failed allow_failure job is reported as skipped, and a job in
  // another requested status that may fail is still searched.
  it('searches the failed jobs of a pipeline and skips allowed failures', async () => {
    const failed = job(1);
    const allowed = job(2, { allow_failure: true });
    const canceled = job(3, { status: 'canceled', allow_failure: true, failure_reason: undefined });
    serve(
      { [`${PIPELINE}/jobs`]: [failed, allowed, canceled] },
      { 1: '$ make\nmain.c:3: error: expected ;\n', 3: 'Job canceled\nERROR: Job failed\n' },
    );

    const result = await grep({ job_scope: ['failed', 'canceled'] });

    const listing = new URL(requested(/\/pipelines\/100\/jobs\?/)[0]);
    expect(listing.searchParams.getAll('scope[]')).toEqual(['failed', 'canceled']);
    expect(result).toEqual({
      pipeline_id: '100',
      jobs: [
        {
          ...identity(failed),
          hunks: [
            {
              start_line: 1,
              lines: ['main.c:3: error: expected ;'],
              matches: [{ line: 1, patterns: [0] }],
            },
          ],
          match_count: 1,
          match_count_complete: true,
          scanned_lines: 3,
          total_lines: 3,
          truncated: null,
          resume_from: null,
        },
        expect.objectContaining({
          ...identity(canceled),
          failure_reason: null,
          match_count: 1,
          truncated: null,
        }),
      ],
      jobs_scanned: 2,
      jobs_skipped: [{ ...identity(allowed), reason: 'allowed_failure' }],
      listing_complete: true,
      resume: null,
      preset_index: 0,
    });
  });

  // Failures of child and multi-project pipelines are invisible from the parent's job
  // list; trigger jobs lead to them, two levels down, with their own project.
  it('follows trigger jobs into downstream pipelines', async () => {
    const parent = job(1);
    const child = job(20);
    const grandchild = job(30);
    const toChild = bridge(10, { id: 200, project_id: 55 });
    const noPipeline = bridge(11, null);
    const toGrandchild = bridge(21, { id: 300, project_id: 55 });
    const tooDeep = bridge(31, { id: 400, project_id: 55 });
    serve(
      {
        [`${PIPELINE}/jobs`]: [parent],
        [`${PIPELINE}/bridges`]: [toChild, noPipeline],
        '/api/v4/projects/55/pipelines/200/jobs': [child],
        '/api/v4/projects/55/pipelines/200/bridges': [toGrandchild],
        '/api/v4/projects/55/pipelines/300/jobs': [grandchild],
        '/api/v4/projects/55/pipelines/300/bridges': [tooDeep],
      },
      { 1: 'error: parent\n', 20: 'error: child\n', 30: 'error: grandchild\n' },
    );

    const result = await grep({});

    expect(result.jobs).toEqual([
      expect.objectContaining({ ...identity(parent), match_count: 1 }),
      expect.objectContaining({ ...identity(child, '55', '200'), match_count: 1 }),
      expect.objectContaining({ ...identity(grandchild, '55', '300'), match_count: 1 }),
    ]);
    expect(requested(/\/jobs\/\d+\/trace$/)).toEqual([
      expect.stringMatching(/\/projects\/test%2Fproject\/jobs\/1\/trace$/),
      expect.stringMatching(/\/projects\/55\/jobs\/20\/trace$/),
      expect.stringMatching(/\/projects\/55\/jobs\/30\/trace$/),
    ]);
    expect(result.jobs_skipped).toEqual([
      { ...identity(noPipeline), reason: 'no_downstream_pipeline' },
      { ...identity(tooDeep, '55', '300'), reason: 'downstream_depth' },
    ]);
    expect(result.listing_complete).toBe(true);
  });

  // A trigger with the default strategy succeeds once its pipeline is created, however that
  // pipeline ends; the failed jobs inside it are still found. Only the jobs are filtered by
  // job_scope, and a trigger job outside it without a pipeline is not worth reporting.
  it('follows a successful trigger job into its failed downstream pipeline', async () => {
    const child = job(20);
    const toChild = bridge(10, { id: 200, project_id: 55 });
    toChild.status = 'success';
    const manual = bridge(11, null);
    manual.status = 'manual';
    serve(
      {
        [`${PIPELINE}/jobs`]: [],
        [`${PIPELINE}/bridges`]: [toChild, manual],
        '/api/v4/projects/55/pipelines/200/jobs': [child, job(21, { status: 'success' })],
      },
      { 20: 'error: child\n' },
    );

    const result = await grep({});

    expect(result.jobs).toEqual([
      expect.objectContaining({ ...identity(child, '55', '200'), match_count: 1 }),
    ]);
    expect(result.jobs_skipped).toEqual([]);
    expect(result.listing_complete).toBe(true);
  });

  // A failed trigger job listing does not discard the failed jobs already listed; the gap
  // in discovery is reported instead.
  it('keeps the listed jobs when trigger jobs cannot be listed', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1)], [`${PIPELINE}/bridges`]: 503 }, { 1: 'error: a\n' });

    const result = await grep({});

    expect(result.jobs).toEqual([expect.objectContaining({ ...identity(job(1)), match_count: 1 })]);
    expect(result.listing_errors).toEqual([
      { project_id: 'test/project', pipeline_id: '100', error: expect.stringContaining('503') },
    ]);
    expect(result.listing_complete).toBe(false);
  });

  // A job listing page failing after earlier pages were read keeps the jobs already listed,
  // still follows the pipeline's triggers and reports the gap, for the searched pipeline
  // and a triggered one alike.
  it('keeps the jobs of pages read before a later listing page fails', async () => {
    const toChild = bridge(10, { id: 200, project_id: 55 });
    const toGrandchild = bridge(21, { id: 300, project_id: 55 });
    serve(
      {
        [`${PIPELINE}/jobs`]: [[job(1)], 503],
        [`${PIPELINE}/bridges`]: [toChild],
        '/api/v4/projects/55/pipelines/200/jobs': [[job(20)], 502],
        '/api/v4/projects/55/pipelines/200/bridges': [toGrandchild],
        '/api/v4/projects/55/pipelines/300/jobs': [job(30)],
      },
      { 1: 'error: a\n', 20: 'error: b\n', 30: 'error: c\n' },
    );

    const result = await grep({});

    expect((result.jobs as Array<{ job_id: string }>).map((entry) => entry.job_id)).toEqual([
      '1',
      '20',
      '30',
    ]);
    expect(result.listing_errors).toEqual([
      { project_id: 'test/project', pipeline_id: '100', error: expect.stringContaining('503') },
      { project_id: '55', pipeline_id: '200', error: expect.stringContaining('502') },
    ]);
    expect(result.jobs_skipped).toEqual([]);
    expect(result.listing_complete).toBe(false);
  });

  // The searched pipeline itself must be listable: nothing read means the call fails.
  it('fails when the first job listing page of the pipeline fails', async () => {
    serve({ [`${PIPELINE}/jobs`]: [503, [job(1)]] }, {});
    await expect(grep({})).rejects.toThrow('503');
  });

  // A trigger marked allow_failure that failed after the first call still leads to the
  // resumed job inside its pipeline; the cursor is kept, not reported as not found.
  it('resumes a job behind a trigger that became an allowed failure', async () => {
    const toChild = bridge(10, { id: 200, project_id: 55 });
    toChild.allow_failure = true;
    serve(
      {
        [`${PIPELINE}/jobs`]: [],
        [`${PIPELINE}/bridges`]: [toChild],
        '/api/v4/projects/55/pipelines/200/jobs': [job(20)],
      },
      { 20: 'a\nerror: b\n' },
    );

    const result = await grep({ resume: [{ job_id: '20', start_line: 1 }] });

    expect(result.jobs).toEqual([expect.objectContaining({ job_id: '20', match_count: 1 })]);
    expect(result.jobs_skipped).toEqual([]);
  });

  // A triggered pipeline in a project outside the call's scope is not read: its trigger job
  // is reported instead, and a pipeline in a project inside the scope is still searched.
  it('does not follow a trigger into a project outside the scope', async () => {
    const toOther = bridge(10, { id: 200, project_id: 55 });
    const toTeam = bridge(11, { id: 300, project_id: 56 });
    serve(
      {
        [`${PIPELINE}/jobs`]: [],
        [`${PIPELINE}/bridges`]: [toOther, toTeam],
        '/api/v4/projects/55': { resource: { path_with_namespace: 'other/secret' } },
        '/api/v4/projects/56': { resource: { path_with_namespace: 'team/child' } },
        '/api/v4/projects/55/pipelines/200/jobs': [job(20)],
        '/api/v4/projects/56/pipelines/300/jobs': [job(30)],
      },
      { 20: 'error: secret\n', 30: 'error: child\n' },
    );

    const scope = new ScopeEnforcer({ projects: ['test/project'], groups: ['team'] });
    const result = await runInCallScope(scope, () => grep({}));

    expect((result.jobs as Array<{ job_id: string }>).map((entry) => entry.job_id)).toEqual(['30']);
    expect(result.jobs_skipped).toEqual([
      { ...identity(toOther), reason: 'downstream_out_of_scope' },
    ]);
    expect(requested(/\/projects\/55\/(pipelines|jobs)\//)).toEqual([]);
  });

  // Caller patterns are checked once before the listing and then used for every job.
  it('searches with valid caller patterns', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1)] }, { 1: 'ok\ntimed out after 30s\n' });
    const result = await grep({ patterns: ['(?i)timed? ?out'] });
    expect(result.jobs).toEqual([
      expect.objectContaining({
        hunks: [
          { start_line: 1, lines: ['timed out after 30s'], matches: [{ line: 1, patterns: [0] }] },
        ],
      }),
    ]);
    expect(result).not.toHaveProperty('preset_index');
  });

  // A failed trigger marked allow_failure leads to failures the pipeline tolerates: skipped
  // by default, followed when allowed failures are asked for.
  it.each([
    [false, [], [{ reason: 'allowed_failure' }]],
    [true, ['20'], []],
  ])(
    'follows an allowed-failure trigger only on request (include: %s)',
    async (include, searched, skipped) => {
      const toChild = bridge(10, { id: 200, project_id: 55 });
      toChild.allow_failure = true;
      serve(
        {
          [`${PIPELINE}/jobs`]: [],
          [`${PIPELINE}/bridges`]: [toChild],
          '/api/v4/projects/55/pipelines/200/jobs': [job(20)],
        },
        { 20: 'error: child\n' },
      );
      const result = await grep({ include_allowed_failures: include });
      expect((result.jobs as Array<{ job_id: string }>).map((entry) => entry.job_id)).toEqual(
        searched,
      );
      expect(result.jobs_skipped).toEqual(
        skipped.map((entry) => ({ ...identity(toChild), ...entry })),
      );
    },
  );

  // include_downstream: false keeps the search to the pipeline itself.
  it('stays in the pipeline without include_downstream', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1)] }, { 1: 'error: x\n' });
    const result = await grep({ include_downstream: false });
    expect(result.jobs_scanned).toBe(1);
    expect(requested(/\/bridges\?/)).toEqual([]);
  });

  // A triggered pipeline in a project the token cannot read does not hide the failures
  // found elsewhere; its trigger job is reported with the reason.
  it('reports an unreadable downstream pipeline and keeps the rest', async () => {
    const toOther = bridge(10, { id: 200, project_id: 66 });
    serve(
      { [`${PIPELINE}/jobs`]: [job(1)], [`${PIPELINE}/bridges`]: [toOther] },
      { 1: 'error: parent\n' },
    );
    const result = await grep({});
    expect(result.jobs_scanned).toBe(1);
    expect(result.jobs_skipped).toEqual([
      {
        ...identity(toOther),
        reason: 'downstream_unreadable',
        error: expect.stringContaining('404'),
      },
    ]);
  });

  // max_jobs bounds the traces read; the rest are named so they can be searched next.
  it('stops at max_jobs and lists the jobs beyond it', async () => {
    const rows = [job(1), job(2), job(3)];
    serve({ [`${PIPELINE}/jobs`]: rows }, { 1: 'error: a\n', 2: 'error: b\n' });
    const result = await grep({ max_jobs: 2 });
    expect((result.jobs as Array<{ job_id: string }>).map((entry) => entry.job_id)).toEqual([
      '1',
      '2',
    ]);
    expect(result.jobs_skipped).toEqual([{ ...identity(rows[2]), reason: 'max_jobs' }]);
    expect(result.listing_complete).toBe(false);
    expect(requested(/\/bridges\?/)).toEqual([]);
  });

  // Listing follows GitLab's pagination before the job limit applies.
  it('reads every page of the job listing', async () => {
    serve({ [`${PIPELINE}/jobs`]: [[job(1)], [job(2)]] }, { 1: 'error: a\n', 2: 'error: b\n' });
    const result = await grep({});
    expect(result.jobs_scanned).toBe(2);
    expect(result.listing_complete).toBe(true);
  });

  // A trace that cannot be read is reported on its job; the other jobs still answer.
  it('reports a failed trace fetch per job', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1), job(2)] }, { 1: 403, 2: 'error: b\n' });
    const result = await grep({});
    expect(result.jobs).toEqual([
      { ...identity(job(1)), error: 'GitLab API error: 403 Forbidden' },
      expect.objectContaining({ ...identity(job(2)), match_count: 1 }),
    ]);
    expect(result.jobs_scanned).toBe(1);
    expect(result.resume).toBeNull();
  });

  // The processing budget is shared by the call's jobs: once spent, scans stop at a line
  // and unstarted jobs wait. The resume list continues every job without losing or
  // repeating a match.
  it('returns a resume list when the budget runs out', async () => {
    const log = Array.from({ length: 600 }, (_, line) =>
      line === 5 || line === 400 ? `error: at ${line}` : `line ${line}`,
    ).join('\n');
    const rows = [job(1), job(2), job(3), job(4)];
    serve({ [`${PIPELINE}/jobs`]: rows }, Object.fromEntries(rows.map((row) => [row.id, log])));

    mockClock.step = 10_000;
    const first = await grep({});
    mockClock.step = 0;

    const resume = first.resume as Array<{ job_id: string; start_line: number }>;
    expect(resume.map((entry) => entry.job_id).sort()).toEqual(['1', '2', '3', '4']);
    const scanned = first.jobs as Array<{
      job_id: string;
      truncated: string;
      resume_from: number;
      hunks: Array<{ start_line: number }>;
    }>;
    expect(scanned.length).toBe(first.jobs_scanned);
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.length).toBeLessThan(rows.length);
    for (const entry of scanned) {
      expect(entry).toMatchObject({ truncated: 'budget' });
      expect(entry.hunks.map((hunk) => hunk.start_line)).toEqual([5]);
      expect(resume).toContainEqual({ job_id: entry.job_id, start_line: entry.resume_from });
    }
    for (const entry of resume.filter((r) => !scanned.some((s) => s.job_id === r.job_id)))
      expect(entry.start_line).toBe(0);

    const rest = await grep({ resume });
    const lines = (rest.jobs as Array<{ job_id: string; hunks: Array<{ start_line: number }> }>)
      .map((entry) => [entry.job_id, entry.hunks.map((hunk) => hunk.start_line)] as const)
      .sort();
    const wasScanned = (id: string) => scanned.some((entry) => entry.job_id === id);
    expect(lines).toEqual(
      ['1', '2', '3', '4'].map((id) => [id, wasScanned(id) ? [400] : [5, 400]] as const),
    );
    expect(rest).toMatchObject({ resume: null, jobs_skipped: [] });
  });

  // A resume entry for a job the pipeline no longer lists is reported, not dropped.
  it('reports resume jobs that are not in the pipeline', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1)] }, { 1: 'error: a\n' });
    const result = await grep({
      resume: [
        { job_id: '1', start_line: 0 },
        { job_id: '9', start_line: 3 },
      ],
    });
    expect(result.jobs_scanned).toBe(1);
    expect(result.jobs_skipped).toEqual([{ job_id: '9', reason: 'not_found' }]);
  });

  // A job that left the searched status keeps its cursor: the resume finds it by id.
  it('resumes a job whose status changed since the previous call', async () => {
    serve({ [`${PIPELINE}/jobs`]: [job(1, { status: 'success' })] }, { 1: 'a\nerror: b\n' });

    const result = await grep({ job_scope: ['running'], resume: [{ job_id: '1', start_line: 1 }] });

    expect(result.jobs).toEqual([
      expect.objectContaining({ job_id: '1', status: 'success', match_count: 1 }),
    ]);
    expect(result.jobs_skipped).toEqual([]);
  });

  // A job retried after the previous call keeps its id on the superseded attempt, which
  // GitLab lists only on request: the resume still finds it and finishes its log, while
  // a first call searches only the latest attempts.
  it('resumes a job that was retried since the previous call', async () => {
    serve(
      { [`${PIPELINE}/jobs`]: [job(1, { retried: true }), job(2)] },
      { 1: 'a\nerror: b\n', 2: 'error: c\n' },
    );

    const resumed = await grep({ resume: [{ job_id: '1', start_line: 1 }] });
    expect(resumed.jobs).toEqual([expect.objectContaining({ job_id: '1', match_count: 1 })]);
    expect(resumed.jobs_skipped).toEqual([]);

    const first = await grep({});
    expect(first.jobs).toEqual([expect.objectContaining({ job_id: '2' })]);
  });

  // A resumed job inside a pipeline that cannot be listed this time is not lost: it stays
  // in resume with its line, and the unreadable pipeline is reported.
  it('keeps resume entries whose pipeline cannot be listed', async () => {
    const toChild = bridge(10, { id: 200, project_id: 55 });
    serve(
      {
        [`${PIPELINE}/jobs`]: [job(1)],
        [`${PIPELINE}/bridges`]: [toChild],
        '/api/v4/projects/55/pipelines/200/jobs': 503,
      },
      { 1: 'error: a\n' },
    );

    const result = await grep({
      resume: [
        { job_id: '1', start_line: 0 },
        { job_id: '20', start_line: 7 },
      ],
    });

    expect(result.jobs_scanned).toBe(1);
    expect(result.resume).toEqual([{ job_id: '20', start_line: 7 }]);
    expect(result.jobs_skipped).toEqual([
      {
        ...identity(toChild),
        reason: 'downstream_unreadable',
        error: expect.stringContaining('503'),
      },
    ]);
    expect(result.listing_complete).toBe(false);
  });

  // Invalid RE2 fails the call before GitLab is asked anything, even when the pipeline has
  // no job to search.
  it.each([[[job(1), job(2)]], [[]]])(
    'rejects an invalid pattern before any request (jobs: %j)',
    async (rows) => {
      serve({ [`${PIPELINE}/jobs`]: rows }, {});
      await expect(grep({ patterns: ['a**'] })).rejects.toThrow('Invalid RE2 pattern 0');
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    },
  );

  // Job and pipeline modes are exclusive, and each refuses the other's parameters.
  it.each([
    { job_id: '7' },
    { pipeline_id: undefined },
    { pipeline_id: undefined, job_id: '7', job_scope: ['failed'] },
    { pipeline_id: undefined, job_id: '7', max_jobs: 10 },
    { start_line: 3 },
    { max_jobs: 21 },
    { job_scope: [] },
  ])('rejects %j before any request', async (args) => {
    await expect(grep(args)).rejects.toThrow();
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });
});
