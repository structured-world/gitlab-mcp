import * as config from '../../../../src/config';
import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { DIFF_WAIT_MS } from '../../../../src/entities/pipelines/merge-request-pipeline';
import { ManagePipelineSchema } from '../../../../src/entities/pipelines/schema';
import { GitLabApiError } from '../../../../src/utils/gitlab-api';
import {
  installFetchMock,
  mockOk,
  lastFetchCall,
  mockEnhancedFetch,
} from '../../helpers/fetch-mock';

// Per-file mock declaration is required (jest.mock is hoisted per module).
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

installFetchMock();

const handler = (args: unknown): Promise<unknown> =>
  pipelinesToolRegistry.get('manage_pipeline')!.handler(args);

/** Issue paths and messages of a rejected input, for asserting which rule fired. */
function issuesOf(input: unknown): { path: string; message: string }[] {
  const result = ManagePipelineSchema.safeParse(input);
  if (result.success) throw new Error('Expected the input to be rejected');
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function mockError(status: number, statusText: string, body: unknown): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    headers: new Headers(),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response);
}

describe('manage_pipeline create - target selection (schema)', () => {
  // A merge request target alone is a complete request; the IID is normalized to a string.
  it.each([42, '42'])('accepts a merge request target given as %p', (iid) => {
    const result = ManagePipelineSchema.safeParse({
      action: 'create',
      project_id: 'group/project',
      merge_request_iid: iid,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merge_request_iid: '42' });
    expect(result.data).not.toHaveProperty('ref');
  });

  // Neither target: the request names nothing to run, and the error says which two exist.
  it('rejects a create with neither ref nor merge_request_iid', () => {
    expect(issuesOf({ action: 'create', project_id: '1' })).toEqual([
      { path: 'ref', message: 'create requires exactly one target: ref or merge_request_iid' },
    ]);
  });

  // Both targets would silently run only one of them.
  it('rejects ref together with merge_request_iid', () => {
    expect(
      issuesOf({ action: 'create', project_id: '1', ref: 'main', merge_request_iid: '7' }),
    ).toEqual([
      {
        path: 'ref',
        message:
          'ref cannot be combined with merge_request_iid: a merge request pipeline takes no ref',
      },
    ]);
  });

  // The endpoint has no variables or inputs; GitLab would ignore them without an error.
  it('rejects variables and inputs on a merge request target, naming each', () => {
    const issues = issuesOf({
      action: 'create',
      project_id: '1',
      merge_request_iid: '7',
      variables: [{ key: 'A', value: 'b' }],
      inputs: { environment: 'staging' },
    });
    expect(issues.map((issue) => issue.path)).toEqual(['variables', 'inputs']);
    expect(issues[0].message).toContain('variables cannot be combined with merge_request_iid');
    expect(issues[1].message).toContain('inputs cannot be combined with merge_request_iid');
  });

  // Empty containers carry nothing that could be dropped, as for a ref pipeline.
  it('accepts empty variables and inputs on a merge request target', () => {
    const result = ManagePipelineSchema.safeParse({
      action: 'create',
      project_id: '1',
      merge_request_iid: '7',
      variables: [],
      inputs: {},
    });
    expect(result.success).toBe(true);
  });

  it.each([0, -3, '1.5', 'abc', '', '7/pipelines'])(
    'rejects %p as merge_request_iid before any request',
    (iid) => {
      expect(issuesOf({ action: 'create', project_id: '1', merge_request_iid: iid })).toEqual([
        { path: 'merge_request_iid', message: 'Expected a positive integer ID' },
      ]);
    },
  );

  // Clients that read the flat JSON Schema must see the MR target and an optional ref.
  it('publishes merge_request_iid and no longer requires ref in the tool schema', () => {
    const schema = pipelinesToolRegistry.get('manage_pipeline')!.inputSchema as {
      oneOf?: { properties: Record<string, { const?: string }>; required?: string[] }[];
      anyOf?: { properties: Record<string, { const?: string }>; required?: string[] }[];
    };
    const create = (schema.oneOf ?? schema.anyOf ?? []).find(
      (variant) => variant.properties.action.const === 'create',
    );
    expect(create).toBeDefined();
    expect(create!.properties).toHaveProperty('merge_request_iid');
    expect(create!.required).toEqual(['action', 'project_id']);
  });
});

describe('manage_pipeline create - merge request pipeline (HTTP contract)', () => {
  const pipeline = {
    id: 91,
    iid: 12,
    project_id: 5,
    status: 'created',
    source: 'merge_request_event',
    ref: 'refs/merge-requests/7/head',
    sha: 'abc123',
    web_url: 'https://gitlab.example.com/group/project/-/pipelines/91',
  };

  // One bodiless POST to the merge request's pipelines endpoint; the result is GitLab's pipeline.
  it('POSTs to the merge request pipelines endpoint and returns the created pipeline', async () => {
    mockOk(pipeline);

    const result = await handler({
      action: 'create',
      project_id: 'group/project',
      merge_request_iid: 7,
    });

    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
    expect(lastFetchCall()).toEqual([
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/7/pipelines',
      { method: 'POST' },
    ]);
    expect(result).toEqual(pipeline);
  });

  // The branch endpoint must not be touched for an MR target, and vice versa.
  it('keeps a ref target on the branch pipeline endpoint', async () => {
    mockOk({ id: 3, status: 'pending', ref: 'main' });

    await handler({ action: 'create', project_id: 'group/project', ref: 'main' });

    expect(lastFetchCall()[0]).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/pipeline?ref=main',
    );
  });

  // A rejected combination never reaches GitLab.
  it('sends nothing when the target is ambiguous', async () => {
    await expect(
      handler({ action: 'create', project_id: '1', ref: 'main', merge_request_iid: '7' }),
    ).rejects.toThrow('ref cannot be combined with merge_request_iid');
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  const refused = (): void =>
    mockError(405, 'Method Not Allowed', { message: '405 Method Not Allowed' });
  const mergeRequestUrl = 'https://gitlab.example.com/api/v4/projects/1/merge_requests/7';
  const requestedUrls = (): string[] => mockEnhancedFetch.mock.calls.map((call) => String(call[0]));

  // GitLab refuses with 405 while a new merge request has no diff yet. The call waits for
  // the diff (changes_count turns from null into a string) and only then asks again.
  it('waits for the diff of a new merge request and then creates the pipeline', async () => {
    refused();
    mockOk({ changes_count: null });
    mockOk({ changes_count: '1' });
    mockOk(pipeline);

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).resolves.toEqual(pipeline);

    expect(requestedUrls()).toEqual([
      `${mergeRequestUrl}/pipelines`,
      mergeRequestUrl,
      mergeRequestUrl,
      `${mergeRequestUrl}/pipelines`,
    ]);
  });

  // A merge request whose diff exists and is still refused has nothing to build: the error
  // says so, and no branch pipeline is started instead.
  it('reports a merge request with no commits after one more attempt', async () => {
    refused();
    mockOk({ changes_count: '0' });
    refused();

    const failure = handler({ action: 'create', project_id: '1', merge_request_iid: '7' });

    await expect(failure).rejects.toBeInstanceOf(GitLabApiError);
    await expect(failure).rejects.toMatchObject({
      status: 405,
      message: expect.stringContaining(
        'GitLab cannot create a pipeline for merge request !7: it has no commits to build',
      ),
    });
    expect(requestedUrls()).toEqual([
      `${mergeRequestUrl}/pipelines`,
      mergeRequestUrl,
      `${mergeRequestUrl}/pipelines`,
    ]);
  });

  // The wait is bounded: a diff that never appears ends in an error naming the cause,
  // without a second creation attempt.
  it('gives up when the diff is not prepared within the wait', async () => {
    jest.useFakeTimers();
    try {
      refused();
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue({ changes_count: null }),
      } as unknown as Response);

      const failure = handler({ action: 'create', project_id: '1', merge_request_iid: '7' });
      const assertion = expect(failure).rejects.toThrow(
        `its diff is still being prepared after ${DIFF_WAIT_MS / 1000} s; try again later`,
      );
      await jest.advanceTimersByTimeAsync(DIFF_WAIT_MS + 1000);
      await assertion;

      const urls = requestedUrls();
      expect(urls.filter((url) => url.endsWith('/pipelines'))).toHaveLength(1);
      expect(urls.slice(1).every((url) => url === mergeRequestUrl)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  // A merge request answer without changes_count says nothing about the diff. Reading it as
  // "ready" would repeat the creation at once and blame a merge request that has commits.
  it.each([{}, { changes_count: 3 }, 'not an object'])(
    'does not treat a merge request answer %j as a ready diff',
    async (answer) => {
      refused();
      mockOk(answer);

      await expect(
        handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
      ).rejects.toThrow('GitLab returned an unexpected merge request while waiting for its diff');
      expect(requestedUrls()).toEqual([`${mergeRequestUrl}/pipelines`, mergeRequestUrl]);
    },
  );

  // A 2xx without a pipeline in it leaves the outcome unknown: the error says so and the
  // creation is not repeated, on the first attempt or on the one after the wait.
  it('reports an unknown outcome when the created pipeline is not in the answer', async () => {
    mockOk({ message: 'accepted' });

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).rejects.toThrow(
      'GitLab accepted the request for merge request !7 but did not return a pipeline; one may have been created, check browse_pipelines before another attempt',
    );
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown outcome for the attempt made after the wait as well', async () => {
    refused();
    mockOk({ changes_count: '1' });
    mockOk({ id: 'ninety-one' });

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).rejects.toThrow('did not return a pipeline');
    expect(requestedUrls().filter((url) => url.endsWith('/pipelines'))).toHaveLength(2);
  });

  // Fields GitLab adds beyond the checked ones reach the caller untouched.
  it('keeps pipeline fields it does not check', async () => {
    mockOk({ ...pipeline, detailed_status: { text: 'created' } });

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).resolves.toMatchObject({ detailed_status: { text: 'created' }, sha: 'abc123' });
  });

  // A failure of the second attempt other than a refusal is GitLab's answer, passed on as is.
  it('passes on a different failure of the attempt made after the wait', async () => {
    refused();
    mockOk({ changes_count: '2' });
    mockError(400, 'Bad Request', { message: { base: ['No stages / jobs for this pipeline.'] } });

    const failure = handler({ action: 'create', project_id: '1', merge_request_iid: '7' });

    await expect(failure).rejects.toMatchObject({ status: 400 });
    await expect(failure).rejects.not.toThrow('no commits to build');
  });

  // GitLab's own reason (no jobs for the event, no permission) reaches the caller unchanged.
  it.each([
    [
      400,
      'Bad Request',
      { message: { base: ['Pipeline will not run for the selected trigger.'] } },
    ],
    [404, 'Not Found', { message: '404 Not found' }],
    [403, 'Forbidden', { message: '403 Forbidden' }],
  ])('passes a %i from GitLab through without a retry', async (status, statusText, body) => {
    mockError(status, statusText, body);

    const failure = handler({ action: 'create', project_id: '1', merge_request_iid: '7' });

    await expect(failure).rejects.toMatchObject({ status });
    await expect(failure).rejects.not.toThrow('no commits to build');
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // A timeout leaves the outcome unknown; repeating the POST could start a second pipeline.
  it('does not repeat the request after a network failure', async () => {
    mockEnhancedFetch.mockRejectedValueOnce(new Error('Connection timeout'));

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).rejects.toThrow('Connection timeout');
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('manage_pipeline create - profile restrictions', () => {
  afterEach(() => jest.restoreAllMocks());

  // Profiles such as code-reviewer deny manage_pipeline:create; that must cover the
  // merge request target too, or the restriction would be bypassed by switching targets.
  it('refuses a merge request pipeline when create is denied, before any request', async () => {
    jest
      .spyOn(config, 'isActionDenied')
      .mockImplementation((tool, action) => tool === 'manage_pipeline' && action === 'create');

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).rejects.toThrow("Action 'create' is not allowed for manage_pipeline tool");
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // Denying an unrelated action leaves the merge request target available.
  it('allows a merge request pipeline when only retry is denied', async () => {
    jest
      .spyOn(config, 'isActionDenied')
      .mockImplementation((tool, action) => tool === 'manage_pipeline' && action === 'retry');
    mockOk({
      id: 1,
      status: 'created',
      ref: 'refs/merge-requests/7/head',
      web_url: 'https://gitlab.example.com/group/project/-/pipelines/1',
    });

    await expect(
      handler({ action: 'create', project_id: '1', merge_request_iid: '7' }),
    ).resolves.toMatchObject({ id: 1 });
  });
});
