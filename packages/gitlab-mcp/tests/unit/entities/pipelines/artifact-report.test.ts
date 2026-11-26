import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { BrowsePipelinesSchema } from '../../../../src/entities/pipelines/schema-readonly';
import { REPORT_TYPES } from '../../../../src/entities/pipelines/artifact-report';
import { enhancedFetch } from '../../../../src/utils/fetch';

// Per-file mock declaration is required (jest.mock is hoisted per module).
jest.mock('../../../../src/utils/fetch', () => ({
  ...jest.requireActual('../../../../src/utils/fetch'),
  enhancedFetch: jest.fn(),
}));

let mockVersion = '19.4.0';
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      getInstanceInfo: () => ({ version: mockVersion, tier: 'free' }),
    }),
  },
}));

const mockFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: 'https://gitlab.example.com',
    GITLAB_TOKEN: 'test-token-12345',
  };
});
afterAll(() => {
  process.env = originalEnv;
});
beforeEach(() => {
  mockFetch.mockReset();
  mockVersion = '19.4.0';
});

const tool = pipelinesToolRegistry.get('browse_pipelines')!;
const base = { project_id: 'group/project', job_id: '34' };

/** Issue paths and messages of a rejected input, for asserting which rule fired. */
function issuesOf(input: unknown): { path: string; message: string }[] {
  const result = BrowsePipelinesSchema.safeParse(input);
  if (result.success) throw new Error('Expected the input to be rejected');
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe.each(['artifact_file', 'artifact_grep'] as const)('%s file selection', (action) => {
  const extra = action === 'artifact_grep' ? { patterns: ['x'] } : {};

  it('accepts a report type alone', () => {
    const result = BrowsePipelinesSchema.safeParse({
      action,
      ...base,
      ...extra,
      report_type: 'junit',
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('artifact_path');
  });

  it('still accepts an archive path alone', () => {
    const result = BrowsePipelinesSchema.safeParse({
      action,
      ...base,
      ...extra,
      artifact_path: 'reports/junit.xml',
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('report_type');
  });

  // Both would read only one of the two files; neither names no file at all.
  it('rejects a path together with a report type', () => {
    expect(
      issuesOf({ action, ...base, ...extra, artifact_path: 'a.txt', report_type: 'junit' }),
    ).toEqual([
      { path: 'report_type', message: 'Give exactly one of artifact_path or report_type' },
    ]);
  });

  it('rejects a call that names no file', () => {
    expect(issuesOf({ action, ...base, ...extra })).toEqual([
      { path: 'artifact_path', message: 'Give exactly one of artifact_path or report_type' },
    ]);
  });

  // The archive has its own selector, and a zip report is never text.
  it.each(['archive', 'lsif', 'metadata', 'trace', '', 'JUNIT'])(
    'rejects %p as a report type',
    (reportType) => {
      const issues = issuesOf({ action, ...base, ...extra, report_type: reportType });
      expect(issues.map((issue) => issue.path)).toEqual(['report_type']);
    },
  );
});

it('offers every report type of the list and no other', () => {
  for (const reportType of REPORT_TYPES) {
    expect(
      BrowsePipelinesSchema.safeParse({ action: 'artifact_file', ...base, report_type: reportType })
        .success,
    ).toBe(true);
  }
  expect(new Set(REPORT_TYPES).size).toBe(REPORT_TYPES.length);
});

describe('instances older than the report type parameter', () => {
  // The registry hides the parameter there, so the catalog never offers what cannot work.
  it('declares the parameter as available from GitLab 19.4', () => {
    expect(tool.requirements?.parameters).toEqual({
      report_type: { tier: 'free', minVersion: '19.4' },
    });
  });

  // An older release ignores the parameter and would send the archive: no request is made.
  it.each(['artifact_file', 'artifact_grep'] as const)(
    'refuses %s by report type before any request',
    async (action) => {
      mockVersion = '19.3.5';
      const extra = action === 'artifact_grep' ? { patterns: ['x'] } : {};

      await expect(
        tool.handler({ action, ...base, ...extra, report_type: 'junit' }),
      ).rejects.toThrow('Reading a report artifact by report_type requires GitLab 19.4+');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  // The archive path does not depend on the release.
  it('still reads an archive entry there', async () => {
    mockVersion = '16.0.0';
    mockFetch.mockResolvedValueOnce(new Response('text'));

    await expect(
      tool.handler({ action: 'artifact_file', ...base, artifact_path: 'reports/result.txt' }),
    ).resolves.toMatchObject({ text: 'text', artifact_path: 'reports/result.txt' });
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/jobs/34/artifacts/reports/result.txt',
    );
  });

  // From the first release that has it, the report is requested.
  it('requests the report on GitLab 19.4', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<testsuite/>'));

    await expect(
      tool.handler({ action: 'artifact_file', ...base, report_type: 'junit' }),
    ).resolves.toMatchObject({ text: '<testsuite/>', report_type: 'junit', complete: true });
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/jobs/34/artifacts?file_type=junit',
    );
  });
});

// A successful answer without a body (204) is not an empty report: there is nothing to read.
it('fails when the report download has no body', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

  await expect(
    tool.handler({ action: 'artifact_file', ...base, report_type: 'junit' }),
  ).rejects.toThrow('Artifact response has no readable body');
});

// Clients reading the flat JSON Schema see the selector on both actions, with neither required.
it('publishes report_type next to an optional artifact_path', () => {
  const schema = tool.inputSchema as {
    oneOf?: { properties: Record<string, { const?: string }>; required?: string[] }[];
    anyOf?: { properties: Record<string, { const?: string }>; required?: string[] }[];
  };
  for (const action of ['artifact_file', 'artifact_grep']) {
    const variant = (schema.oneOf ?? schema.anyOf ?? []).find(
      (item) => item.properties.action.const === action,
    );
    expect(variant?.properties).toHaveProperty('report_type');
    expect(variant?.required).not.toContain('artifact_path');
    expect(variant?.required).not.toContain('report_type');
  }
});
