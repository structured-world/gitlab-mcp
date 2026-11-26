import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const MergeRequest = z.object({ iid: z.coerce.string() });
const Conflicts = z.object({
  merge_request_iid: z.string(),
  status: z.string(),
  has_conflicts: z.boolean(),
  reason: z.string(),
  files_total: z.number().optional(),
  truncated: z.boolean().optional(),
  files: z
    .array(
      z.object({
        our_path: z.string().nullable(),
        their_path: z.string().nullable(),
        conflict_count: z.number(),
        hunks: z.array(z.object({ start_line: z.number(), lines: z.array(z.string()) })),
        hunks_omitted: z.number(),
      }),
    )
    .optional(),
});
type ConflictsResult = z.infer<typeof Conflicts>;
// GitLab checks mergeability asynchronously after the merge request is created.
const CHECK_WAIT_MS = 90_000;

const BASE = 'line one\nshared line\nline three\n';

// The suite works on its own branches of the test/ project and removes them afterwards.
describe('merge request conflicts - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const id = randomUUID();
  const target = `conflicts-target-${id}`;
  const conflicting = `conflicts-source-${id}`;
  const clean = `conflicts-clean-${id}`;
  const mergeRequests: string[] = [];
  // Only what was created is removed, so a setup that failed halfway still cleans up.
  const branches: string[] = [];

  const branchFrom = async (branch: string, ref: string): Promise<void> => {
    await helper.executeTool('manage_ref', {
      action: 'create_branch',
      project_id: projectId,
      branch,
      ref,
    });
    branches.push(branch);
  };

  const commit = (branch: string, files: { file_path: string; content: string }[]) =>
    helper.executeTool('manage_files', {
      action: 'batch',
      project_id: projectId,
      branch,
      commit_message: `Conflict fixture on ${branch}`,
      overwrite: true,
      files,
    });

  const open = async (source: string): Promise<string> => {
    const { iid } = MergeRequest.parse(
      await helper.executeTool('manage_merge_request', {
        action: 'create',
        project_id: projectId,
        source_branch: source,
        target_branch: target,
        title: `Conflict fixture ${source}`,
      }),
    );
    mergeRequests.push(iid);
    return iid;
  };

  const read = async (iid: string, extra: Record<string, unknown> = {}): Promise<ConflictsResult> =>
    Conflicts.parse(
      await helper.executeTool('browse_merge_requests', {
        action: 'conflicts',
        project_id: projectId,
        merge_request_iid: iid,
        ...extra,
      }),
    );

  /** Read until GitLab has checked mergeability; each unchecked read requests the check. */
  const checked = async (iid: string): Promise<ConflictsResult> => {
    const deadline = Date.now() + CHECK_WAIT_MS;
    for (;;) {
      const result = await read(iid);
      if (result.status !== 'unchecked') return result;
      if (Date.now() > deadline)
        throw new Error(`Mergeability of !${iid} stayed unchecked for ${CHECK_WAIT_MS / 1000} s`);
      await delay(2000);
    }
  };

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Merge request conflict tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();

    await branchFrom(target, 'main');
    await commit(target, [{ file_path: 'conflict.txt', content: BASE }]);
    for (const branch of [conflicting, clean]) await branchFrom(branch, target);
    // Both sides change the same line: a genuine text conflict.
    await commit(conflicting, [
      { file_path: 'conflict.txt', content: 'line one\nsource side\nline three\n' },
    ]);
    await commit(target, [
      { file_path: 'conflict.txt', content: 'line one\ntarget side\nline three\n' },
    ]);
    // A change to another file merges cleanly.
    await commit(clean, [{ file_path: 'unrelated.txt', content: 'independent\n' }]);
  });

  // Every cleanup call runs even when one fails; the failures are reported together.
  afterAll(async () => {
    const calls = [
      ...mergeRequests.map(
        (iid) => () =>
          helper.executeTool('manage_merge_request', {
            action: 'update',
            project_id: projectId,
            merge_request_iid: iid,
            state_event: 'close',
          }),
      ),
      ...branches.reverse().map(
        (branch) => () =>
          helper.executeTool('manage_ref', {
            action: 'delete_branch',
            project_id: projectId,
            branch,
          }),
      ),
    ];
    const failures: unknown[] = [];
    for (const call of calls) {
      try {
        await call();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Conflict fixture cleanup failed');
  });

  it('returns the conflict region of a genuine text conflict', async () => {
    const iid = await open(conflicting);
    const result = await checked(iid);
    expect(result).toMatchObject({
      merge_request_iid: iid,
      status: 'has_conflicts',
      has_conflicts: true,
      files_total: 1,
      truncated: false,
    });
    expect(result.files).toEqual([
      {
        our_path: 'conflict.txt',
        their_path: 'conflict.txt',
        conflict_count: 1,
        hunks: [
          {
            start_line: 1,
            lines: [
              'line one',
              '<<<<<<< conflict.txt',
              'source side',
              '=======',
              'target side',
              '>>>>>>> conflict.txt',
              'line three',
            ],
          },
        ],
        hunks_omitted: 0,
      },
    ]);

    // Without context only the marked region comes back, numbered in the file.
    const narrow = await read(iid, { context_lines: 0 });
    expect(narrow.files?.[0].hunks).toEqual([
      {
        start_line: 2,
        lines: [
          '<<<<<<< conflict.txt',
          'source side',
          '=======',
          'target side',
          '>>>>>>> conflict.txt',
        ],
      },
    ]);

    // A path filter that names no conflicting file returns no file but keeps the count.
    const other = await read(iid, { file_path: 'missing.txt' });
    expect(other).toMatchObject({ status: 'has_conflicts', files_total: 1, files: [] });
  });

  it('reports a mergeable merge request as having no conflicts', async () => {
    const iid = await open(clean);
    const result = await checked(iid);
    expect(result).toMatchObject({ status: 'no_conflicts', has_conflicts: false });
    expect(result.files).toBeUndefined();
  });

  it('fails for a merge request that does not exist', async () => {
    await expect(read('2147483647')).rejects.toThrow(/not found or not accessible/);
  });
});
