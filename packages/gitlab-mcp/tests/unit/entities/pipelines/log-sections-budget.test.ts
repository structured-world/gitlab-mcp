import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { closeLineGrepWorkers } from '../../../../src/entities/pipelines/line-grep-worker';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
// No processing budget: a scan stops at its first budget check.
jest.mock('../../../../src/entities/pipelines/pipeline-grep', () => ({
  ...jest.requireActual<typeof import('../../../../src/entities/pipelines/pipeline-grep')>(
    '../../../../src/entities/pipelines/pipeline-grep',
  ),
  LOG_GREP_BUDGET_MS: 0,
}));
jest.mock('node:worker_threads', () => ({
  ...jest.requireActual<typeof import('node:worker_threads')>('node:worker_threads'),
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

// A section that starts at once and runs on far past the first budget check.
const LOG = [
  'section_start:1:long\r\x1b[0Kopen',
  ...Array.from({ length: 2000 }, (_, i) => `line ${i}`),
  'section_end:2:long\r\x1b[0K',
].join('\n');

const browse = (args: Record<string, unknown>) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    project_id: 'test/project',
    job_id: '7',
    ...args,
  });

describe('section reads stopped by the processing budget', () => {
  // A page cannot be placed in a section whose end was never reached: an error, not a guess.
  it('refuses a section page when the section end was not reached', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(new Response(LOG));
    await expect(browse({ action: 'logs', section: 'long' })).rejects.toThrow(
      "Section 'long' could not be located within the processing budget; read the log with start instead",
    );
  });

  // The listing still returns what it saw, marked incomplete, with the open section unended.
  it('lists the sections seen so far as incomplete', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(new Response(LOG));
    await expect(browse({ action: 'log_sections' })).resolves.toMatchObject({
      sections: [{ name: 'long', start_line: 0, end_line: null }],
      total_lines: null,
      complete: false,
    });
  });
});
