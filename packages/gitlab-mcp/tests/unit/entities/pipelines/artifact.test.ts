import { BrowsePipelinesSchema } from '../../../../src/entities/pipelines/schema-readonly';
import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import {
  artifactViewUrl,
  resolveArtifactRedirect,
} from '../../../../src/entities/pipelines/artifact';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const args = {
  action: 'artifact_file',
  project_id: 'test/project',
  job_id: '34',
  artifact_path: 'reports/result.txt',
  byte_limit: 8,
};

// Unicode filenames remain intact while controls following surrogate pairs are rejected.
it('preserves a supplementary Unicode filename', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(new Response('report'));
  await pipelinesToolRegistry.get('browse_pipelines')!.handler({
    ...args,
    artifact_path: 'reports/\ud83d\ude00.txt',
  });
  expect(mockEnhancedFetch).toHaveBeenCalledWith(
    'https://gitlab.example.com/api/v4/projects/test%2Fproject/jobs/34/artifacts/reports/%F0%9F%98%80.txt',
    expect.anything(),
  );
});

// A new action must reach the single-file route and expose a bounded continuation.
it('reads one text window instead of the artifacts archive', async () => {
  expect(BrowsePipelinesSchema.safeParse(args).success).toBe(true);
  mockEnhancedFetch.mockResolvedValueOnce(new Response('first report, more content'));
  const result = await pipelinesToolRegistry.get('browse_pipelines')!.handler(args);
  expect(result).toMatchObject({
    artifact_path: args.artifact_path,
    text: 'first re',
    byte_start: 0,
    byte_end: 8,
    next_byte_offset: 8,
    complete: false,
  });
  expect(mockEnhancedFetch).toHaveBeenCalledWith(
    'https://gitlab.example.com/api/v4/projects/test%2Fproject/jobs/34/artifacts/reports/result.txt',
    expect.objectContaining({ redirect: 'manual' }),
  );
});

// Archive paths and bounded windows are validated before authenticated HTTP I/O.
it.each([
  { artifact_path: '../secret' },
  { artifact_path: '/absolute' },
  { artifact_path: 'a//b' },
  { artifact_path: 'a/./b' },
  { artifact_path: 'a/%252e%252e/b' },
  { artifact_path: 'a/%2fb' },
  { artifact_path: 'a/%255cb' },
  { artifact_path: 'a/%00b' },
  { artifact_path: 'a/%ff%2fb' },
  { artifact_path: 'a\\b' },
  { artifact_path: 'a\nb' },
  { artifact_path: 'a/\ud83d\ude00\u0000' },
  { artifact_path: 'https://other.example/file' },
  { job_id: '../jobs' },
  { project_id: '../projects' },
  { byte_offset: -1 },
  { byte_offset: 20 * 1024 * 1024 + 1 },
  { byte_limit: 0 },
  { byte_limit: 1024 * 1024 + 1 },
  { byte_limit: 1.5 },
])('refuses invalid artifact input %j', async (invalid) => {
  await expect(
    pipelinesToolRegistry.get('browse_pipelines')!.handler({ ...args, ...invalid }),
  ).rejects.toThrow();
  expect(mockEnhancedFetch).not.toHaveBeenCalled();
});

// Literal query/fragment characters are filename data and cannot alter the request URL.
it('encodes nested filenames and applies documented defaults', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(new Response('small'));
  const { byte_limit: _, ...withoutLimit } = args;
  const result = await pipelinesToolRegistry.get('browse_pipelines')!.handler({
    ...withoutLimit,
    project_id: 123,
    job_id: 34,
    artifact_path: 'reports/a ?#%.txt',
  });
  expect(result).toMatchObject({ text: 'small', complete: true, next_byte_offset: null });
  expect(mockEnhancedFetch).toHaveBeenCalledWith(
    'https://gitlab.example.com/api/v4/projects/123/jobs/34/artifacts/reports/a%20%3F%23%25.txt',
    expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=0-65539' }) }),
  );
});

// A malformed provider URL must not survive in Error.input or another diagnostic property.
it('sanitizes an invalid artifact-view URL', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(new Response(Buffer.from([0])));
  mockEnhancedFetch.mockResolvedValueOnce(
    Response.json({ web_url: 'http://[invalid?sig=fixture-secret' }),
  );
  await expect(pipelinesToolRegistry.get('browse_pipelines')!.handler(args)).rejects.toThrow(
    'invalid artifact-view URL',
  );
});

// A range server reports an empty file or an offset exactly at EOF with 416 and its size.
it.each([0, 3])('recognizes EOF from a validated unsatisfied range at %i', async (offset) => {
  mockEnhancedFetch.mockResolvedValueOnce(
    new Response('error body must not become artifact text', {
      status: 416,
      headers: { 'Content-Range': `bytes */${offset}` },
    }),
  );
  expect(
    await pipelinesToolRegistry.get('browse_pipelines')!.handler({ ...args, byte_offset: offset }),
  ).toMatchObject({
    text: '',
    byte_start: offset,
    byte_end: offset,
    next_byte_offset: null,
    total_bytes: offset,
    complete: true,
    truncated: false,
  });
});

// HTTPS downloads cannot downgrade, carry userinfo, switch protocols or retain fragments.
it.each([
  'http://storage.example/file',
  'file:///etc/passwd',
  'data:text/plain,a',
  'https://user:secret@storage.example/file',
  '/file#fragment',
  'http://[invalid?sig=secret',
])('refuses unsafe redirect %s', (location) => {
  expect(() =>
    resolveArtifactRedirect(new URL('https://gitlab.example.com/file'), location),
  ).toThrow();
});

// The view link strips provider query data and safely retains the encoded archive filename.
it('builds a canonical artifact view link', () => {
  expect(
    artifactViewUrl(
      'https://gitlab.example.com/a/b/-/jobs/34?sig=secret#fragment',
      'reports/a%23.txt',
    ),
  ).toBe('https://gitlab.example.com/a/b/-/jobs/34/artifacts/file/reports/a%23.txt');
  expect(() => artifactViewUrl('https://user:secret@gitlab.example.com/job', 'file')).toThrow(
    'invalid artifact-view',
  );
});

// A literal percent sign followed by non-UTF-8 hex bytes is still a valid filename.
it('preserves literal percent sequences without allowing encoded separators', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(new Response('report'));
  expect(
    await pipelinesToolRegistry.get('browse_pipelines')!.handler({
      ...args,
      artifact_path: 'reports/a%ff.txt',
    }),
  ).toMatchObject({ text: 'report', complete: true });
  expect(mockEnhancedFetch).toHaveBeenCalledWith(
    'https://gitlab.example.com/api/v4/projects/test%2Fproject/jobs/34/artifacts/reports/a%25ff.txt',
    expect.anything(),
  );
});

// A refused download must release its connection before a metadata lookup needs the same pool.
it('cancels a binary MIME response before requesting the job view URL', async () => {
  const response = new Response(new ReadableStream({}, { highWaterMark: 0 }), {
    headers: { 'Content-Type': 'image/png' },
  });
  mockEnhancedFetch.mockResolvedValueOnce(response).mockImplementationOnce(async () => {
    expect(response.bodyUsed).toBe(true);
    return Response.json({ web_url: 'https://gitlab.example.com/test/project/-/jobs/34' });
  });
  await expect(pipelinesToolRegistry.get('browse_pipelines')!.handler(args)).rejects.toMatchObject({
    structuredError: { reason: 'not_text', artifact_view_url: expect.any(String) },
  });
});
