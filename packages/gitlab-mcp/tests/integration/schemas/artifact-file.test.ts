import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { buildCiConfigBase64, getTestData } from '../../setup/testConfig';
import { randomUUID } from 'node:crypto';

const Pipeline = z.object({ id: z.coerce.string() });
const Jobs = z.array(z.object({ id: z.coerce.string(), name: z.string(), status: z.string() }));
const Window = z.object({
  text: z.string(),
  byte_start: z.number(),
  byte_end: z.number(),
  next_byte_offset: z.number().nullable(),
  complete: z.boolean(),
});
const Grep = z.object({
  hunks: z.array(
    z.object({ start_line: z.number(), byte_offset: z.number(), lines: z.array(z.string()) }),
  ),
});
// Counted from the start of the test: with one more jobs request (up to the 120 s request
// timeout of the test env) and the reads after it, the test ends within its 10-minute
// limit, so a stuck job is still cancelled in finally.
const JOB_WAIT_MS = 6 * 60_000;

// The lifecycle owns this test/ project; the suite creates and cancels only its own pipeline.
describe('individual artifact files - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Artifact tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();
    await helper.executeTool('manage_files', {
      action: 'single',
      project_id: projectId,
      file_path: '.gitlab-ci.yml',
      branch: 'main',
      content: buildCiConfigBase64(`artifact fixture ${randomUUID()}`),
      encoding: 'base64',
      commit_message: 'Prepare artifact download fixture',
      overwrite: true,
    });
  });

  // A real runner uploads nested paths; byte continuations must reconstruct UTF-8 without loss.
  it('reads uploaded text, empty files, literal delimiters and binary refusals', async () => {
    const deadline = Date.now() + JOB_WAIT_MS;
    let pipelineId: string | undefined;
    let jobComplete = false;
    try {
      const pipeline = Pipeline.parse(
        await helper.executeTool('manage_pipeline', {
          action: 'create',
          project_id: projectId,
          ref: 'main',
        }),
      );
      pipelineId = pipeline.id;
      let jobId: string | undefined;
      let lastJobs: Array<{ name: string; status: string }> = [];
      while (Date.now() < deadline) {
        const jobs = Jobs.parse(
          await helper.executeTool('browse_pipelines', {
            action: 'jobs',
            project_id: projectId,
            pipeline_id: pipelineId,
          }),
        );
        lastJobs = jobs.map(({ name, status }) => ({ name, status }));
        const job = jobs.find((item) => item.name === 'test-job');
        if (job?.status === 'success') {
          jobId = job.id;
          jobComplete = true;
          break;
        }
        if (job && ['failed', 'canceled', 'skipped'].includes(job.status)) {
          throw new Error(`Artifact fixture job ended with status ${job.status}`);
        }
        await delay(1000);
      }
      if (!jobId)
        throw new Error(
          `Artifact fixture job did not complete within ${JOB_WAIT_MS / 1000} s: ${JSON.stringify(lastJobs)}`,
        );
      const read = (path: string, extra = {}) =>
        helper.executeTool('browse_pipelines', {
          action: 'artifact_file',
          project_id: projectId,
          job_id: jobId,
          artifact_path: path,
          ...extra,
        });
      let offset: number | null = 0;
      let text = '';
      while (offset !== null) {
        const page = Window.parse(
          await read('reports/nested/result.txt', { byte_offset: offset, byte_limit: 4 }),
        );
        expect(page.byte_start).toBe(offset);
        expect(page.byte_end - page.byte_start).toBe(Buffer.byteLength(page.text));
        if (page.next_byte_offset !== null) expect(page.next_byte_offset).toBeGreaterThan(offset);
        text += page.text;
        offset = page.next_byte_offset;
      }
      expect(text).toBe('Artifact report A\u20ac\ud83d\ude00\n');
      expect(await read('reports/nested/a #?.txt')).toMatchObject({ text, complete: true });
      expect(await read('reports/nested/a%ff.txt')).toMatchObject({ text, complete: true });
      expect(await read('reports/empty.txt')).toMatchObject({
        text: '',
        complete: true,
        next_byte_offset: null,
      });
      await expect(read('reports/binary.bin')).rejects.toMatchObject({
        structuredError: {
          error_code: 'ARTIFACT_READ_REFUSED',
          reason: 'not_text',
          artifact_view_url: expect.any(String),
        },
      });
      await expect(read('reports/missing.txt')).rejects.toMatchObject({ status: 404 });

      // artifact_grep searches the same uploaded files through the same download path, and
      // its byte offset reads the matched hunk back with artifact_file.
      const grep = (path: string) =>
        helper.executeTool('browse_pipelines', {
          action: 'artifact_grep',
          project_id: projectId,
          job_id: jobId,
          artifact_path: path,
          patterns: ['report A€'],
        });
      const result = await grep('reports/nested/result.txt');
      const found = Grep.parse(result);
      expect(result).toMatchObject({
        match_count: 1,
        total_lines: 2,
        scanned_bytes: Buffer.byteLength(text),
        truncated: null,
        scan_limit_reached: false,
        // The default after-context reaches the empty line after the final newline.
        hunks: [{ start_line: 0, byte_offset: 0, lines: ['Artifact report A€😀', ''] }],
      });
      const back = Window.parse(
        await read('reports/nested/result.txt', { byte_offset: found.hunks[0].byte_offset }),
      );
      expect(back.text.startsWith(found.hunks[0].lines.join('\n'))).toBe(true);
      expect(await grep('reports/empty.txt')).toMatchObject({ match_count: 0, scanned_bytes: 0 });
      await expect(grep('reports/binary.bin')).rejects.toMatchObject({
        structuredError: {
          error_code: 'ARTIFACT_READ_REFUSED',
          reason: 'not_text',
          action: 'artifact_grep',
        },
      });
      await expect(grep('reports/missing.txt')).rejects.toMatchObject({ status: 404 });
    } finally {
      if (pipelineId !== undefined && !jobComplete) {
        await helper.executeTool('manage_pipeline', {
          action: 'cancel',
          project_id: projectId,
          pipeline_id: pipelineId,
        });
      }
    }
  });
});
