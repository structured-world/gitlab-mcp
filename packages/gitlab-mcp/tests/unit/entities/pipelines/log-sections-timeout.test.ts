import { listLogSections } from '../../../../src/entities/pipelines/job-log-sections';
import { grepStream } from '../../../../src/entities/pipelines/line-grep-worker';

// The pool's result for a scan whose worker was killed for outrunning its time.
jest.mock('../../../../src/entities/pipelines/line-grep-worker', () => ({
  grepStream: jest.fn(),
}));

it('explains a section listing cut off by a worker timeout', async () => {
  jest.mocked(grepStream).mockResolvedValueOnce({
    hunks: [],
    match_count: 0,
    match_count_complete: false,
    scanned_lines: 120,
    total_lines: null,
    truncated: 'worker_timeout',
    resume_from: 120,
  });
  await expect(
    listLogSections({ action: 'log_sections', project_id: 'test/project', job_id: '7' }),
  ).rejects.toThrow(
    'The log sections could not be read within the processing time limit; read the log with logs instead',
  );
});
