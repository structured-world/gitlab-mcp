import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { closeLineGrepWorkers } from '../../../../src/entities/pipelines/line-grep-worker';
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
installFetchMock();
afterEach(() => closeLineGrepWorkers());

const ESC = '\x1b';
const start = (stamp: number, name: string) => `section_start:${stamp}:${name}\r${ESC}[0K`;
const end = (stamp: number, name: string) => `section_end:${stamp}:${name}\r${ESC}[0K`;

// Lines 0-1 before the script, 2-7 the step_script section, 8-9 after it.
const LOG = [
  'Running with gitlab-runner',
  'Preparing',
  `${start(10, 'step_script')}Executing "step_script" stage`,
  '$ make',
  'one',
  'two',
  'error: three',
  end(20, 'step_script'),
  'error: after',
  'Job failed',
].join('\n');

const browse = (args: Record<string, unknown>) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    project_id: 'test/project',
    job_id: '7',
    ...args,
  });

/** A trace response that records how many bytes the reader pulled before stopping. */
function trace(text: string, chunkSize = 16): { response: Response; pulled: () => number } {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const response = new Response(
    new ReadableStream({
      type: 'bytes',
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          controller.byobRequest?.respond(0);
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    }),
  );
  return { response, pulled: () => offset };
}

const serve = (...texts: string[]) => {
  for (const text of texts) mockEnhancedFetch.mockResolvedValueOnce(trace(text).response);
};

describe('browse_pipelines log_sections', () => {
  it('lists the sections of the job log', async () => {
    serve(LOG);
    await expect(browse({ action: 'log_sections' })).resolves.toEqual({
      sections: [
        {
          name: 'step_script',
          occurrence: 0,
          depth: 0,
          start_line: 2,
          end_line: 7,
          line_count: 6,
          duration_seconds: 10,
          collapsed: false,
          terminated: true,
        },
      ],
      sections_truncated: false,
      sections_unread_from_line: null,
      total_lines: 10,
      complete: true,
    });
    expect(mockEnhancedFetch.mock.calls[0][0]).toMatch(
      /\/projects\/test%2Fproject\/jobs\/7\/trace$/,
    );
  });
});

describe('browse_pipelines logs with section', () => {
  // Pagination counts within the section; startLine and the header keep absolute numbers.
  it('reads a page from the start of the section', async () => {
    serve(LOG, LOG);
    await expect(
      browse({ action: 'logs', section: 'step_script', start: 1, per_page: 2 }),
    ).resolves.toEqual({
      trace: "[SECTION step_script: lines 3-4 of the log, 1-2 of the section's 6]\n$ make\none",
      section: {
        name: 'step_script',
        index: 0,
        start_line: 2,
        end_line: 7,
        line_count: 6,
        terminated: true,
      },
      totalLines: 6,
      shownLines: 2,
      startLine: 3,
      hasMore: true,
      nextStart: 3,
    });
  });

  // The default page is the tail of the section, not of the whole log.
  it('reads the tail of the section by default', async () => {
    serve(LOG, LOG);
    const page = (await browse({ action: 'logs', section: 'step_script', per_page: 2 })) as {
      trace: string;
      startLine: number;
      hasMore: boolean;
    };
    expect(page.trace.split('\n').slice(1)).toEqual(['error: three', end(20, 'step_script')]);
    expect(page.startLine).toBe(6);
    expect(page.hasMore).toBe(false);
  });

  it('counts a negative start from the end of the section', async () => {
    serve(LOG, LOG);
    const page = (await browse({ action: 'logs', section: 'step_script', start: -3 })) as {
      startLine: number;
      shownLines: number;
    };
    expect(page).toMatchObject({ startLine: 5, shownLines: 3 });
  });

  it('reports a start past the end of the section without reading the page', async () => {
    serve(LOG);
    const page = (await browse({ action: 'logs', section: 'step_script', start: 6 })) as {
      trace: string;
      shownLines: number;
    };
    expect(page.trace).toBe(
      "[OUT OF BOUNDS: Start position 6 exceeds the 6 lines of section 'step_script'. Available range: 0-5]",
    );
    expect(page.shownLines).toBe(0);
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  // Neither pass reads the trace past what it needs: the section's end, then the page's end.
  it('stops reading the trace at the section and at the page', async () => {
    const tail = Array.from({ length: 2000 }, () => 'later output line').join('\n');
    const locate = trace(`${LOG}\n${tail}`);
    const read = trace(`${LOG}\n${tail}`);
    mockEnhancedFetch.mockResolvedValueOnce(locate.response).mockResolvedValueOnce(read.response);
    await browse({ action: 'logs', section: 'step_script', start: 0, per_page: 2 });
    expect(locate.pulled()).toBeLessThan(LOG.length + 200);
    expect(read.pulled()).toBeLessThan(LOG.length);
  });

  // A section line past the per-line limit is clipped on the page, and the page says so.
  it('reports clipped lines on a section page', async () => {
    const log = [start(1, 'long'), 'x'.repeat(17_000), end(2, 'long')].join('\n');
    serve(log, log);
    const page = (await browse({ action: 'logs', section: 'long', start: 0 })) as {
      trace: string;
      truncation?: { lines: Array<{ line: number }> };
    };
    expect(page.trace.split('\n')[0]).toBe(
      '[LOG CONTENT TRUNCATED: 1 source lines are incomplete due to byte limits. See truncation.lines; line pagination cannot recover omitted bytes.]',
    );
    expect(page.truncation?.lines.map((line) => line.line)).toEqual([1]);
  });

  it('names the available sections for an unknown section', async () => {
    serve(LOG);
    await expect(browse({ action: 'logs', section: 'build' })).rejects.toThrow(
      "Section 'build' not found; sections: step_script",
    );
  });
});

describe('browse_pipelines log_grep with section', () => {
  it('searches only inside the section', async () => {
    serve(LOG);
    const result = (await browse({
      action: 'log_grep',
      patterns: ['error'],
      section: 'step_script',
    })) as { hunks: Array<{ start_line: number }>; match_count: number; section: unknown };
    expect(result.match_count).toBe(1);
    expect(result.hunks.map((hunk) => hunk.start_line)).toEqual([4]);
    expect(result.section).toMatchObject({ start_line: 2, end_line: 7 });
  });
});

describe('browse_pipelines section parameters', () => {
  it('rejects section_index without section', async () => {
    await expect(browse({ action: 'logs', section_index: 1 })).rejects.toThrow(
      "'section_index' needs 'section'",
    );
    await expect(browse({ action: 'log_grep', patterns: ['x'], section_index: 1 })).rejects.toThrow(
      "'section_index' needs 'section'",
    );
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // Names follow the GitLab marker grammar; anything else can never match a section.
  it('rejects a name outside the marker grammar', async () => {
    await expect(browse({ action: 'logs', section: 'step script' })).rejects.toThrow(
      'Section names use letters, digits, _ . and -',
    );
  });
});
