import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as fileRead from '../../../src/entities/files/read';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const Content = z.object({
  content: z.string(),
  encoding: z.literal('utf8'),
  last_commit_id: z.string(),
  blob_id: z.string(),
  content_sha256: z.string(),
});
const Ranged = Content.extend({
  start_line: z.number(),
  end_line: z.number().nullable(),
  total_lines: z.number(),
  next_line: z.number().nullable(),
});
const EditResult = z.object({
  replacements: z.array(z.number()),
  diff: z.string(),
  last_commit_id: z.string(),
  commit_id: z.string().optional(),
  dry_run: z.literal(true).optional(),
});

// Mixed line endings, indentation and no final newline: the edit must keep every other byte.
const ORIGINAL =
  'replicas: 2\nresources:\n  limits:\n    cpu: 500m\r\n    memory: 1Gi\nsuspend: false';
const FILE = 'chart/values.yaml';

// The suite works on its own branch of the suite-owned test/ project and deletes it.
describe('manage_files edit - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const branch = `files-edit-${randomUUID()}`;

  const read = async () =>
    Content.parse(
      await helper.executeTool('browse_files', {
        action: 'content',
        project_id: projectId,
        file_path: FILE,
        ref: branch,
      }),
    );

  const edit = async (args: Record<string, unknown>) =>
    EditResult.parse(
      await helper.executeTool('manage_files', {
        action: 'edit',
        project_id: projectId,
        file_path: FILE,
        branch,
        commit_message: 'Edit values',
        ...args,
      }),
    );

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('File edit tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();
    await helper.executeTool('manage_ref', {
      action: 'create_branch',
      project_id: projectId,
      branch,
      ref: 'main',
    });
    await helper.executeTool('manage_files', {
      action: 'single',
      project_id: projectId,
      file_path: FILE,
      branch,
      content: ORIGINAL,
      commit_message: 'Add values fixture',
      overwrite: true,
    });
  });

  afterAll(async () => {
    await helper.executeTool('manage_ref', {
      action: 'delete_branch',
      project_id: projectId,
      branch,
    });
  });

  it('previews the diff without committing', async () => {
    const before = await read();
    expect(before.content).toBe(ORIGINAL);
    const preview = await edit({
      edits: [{ old_text: 'cpu: 500m', new_text: 'cpu: 750m' }],
      dry_run: true,
    });
    expect(preview.dry_run).toBe(true);
    expect(preview.last_commit_id).toBe(before.last_commit_id);
    expect(preview.diff).toContain('-    cpu: 500m\r\n+    cpu: 750m\r');
    const after = await read();
    expect(after.content).toBe(ORIGINAL);
    expect(after.last_commit_id).toBe(before.last_commit_id);
  });

  it('commits only the matched fragment and returns the new version', async () => {
    const before = await read();
    const result = await edit({
      edits: [{ old_text: 'cpu: 500m', new_text: 'cpu: 750m' }],
      expected_last_commit_id: before.last_commit_id,
    });
    expect(result.replacements).toEqual([1]);
    const after = await read();
    expect(after.content).toBe(ORIGINAL.replace('cpu: 500m', 'cpu: 750m'));
    expect(after.last_commit_id).toBe(result.last_commit_id);
    expect(result.commit_id).toBe(result.last_commit_id);
  });

  it('refuses an edit against a version the file has moved past', async () => {
    const stale = (await read()).last_commit_id;
    await edit({ edits: [{ old_text: 'replicas: 2', new_text: 'replicas: 3' }] });
    const current = (await read()).last_commit_id;
    await expect(
      edit({
        edits: [{ old_text: 'memory: 1Gi', new_text: 'memory: 2Gi' }],
        expected_last_commit_id: stale,
      }),
    ).rejects.toThrow(`its last_commit_id is now ${current}`);
    expect((await read()).content).toContain('memory: 1Gi');
  });

  it('reports a change pushed between its read and its write as a conflict', async () => {
    const original = fileRead.readRepositoryFile;
    // Right after the edit reads the file, another writer commits to it.
    const spy = jest
      .spyOn(fileRead, 'readRepositoryFile')
      .mockImplementationOnce(async (...args) => {
        const file = await original(...args);
        await helper.executeTool('manage_files', {
          action: 'single',
          project_id: projectId,
          file_path: FILE,
          branch,
          content: `${(await read()).content}\n# concurrent change`,
          commit_message: 'Concurrent change',
          overwrite: true,
        });
        return file;
      });
    try {
      await expect(
        edit({ edits: [{ old_text: 'suspend: false', new_text: 'suspend: true' }] }),
      ).rejects.toThrow('the file changed between reading and writing it, and GitLab refused');
    } finally {
      spy.mockRestore();
    }
    const content = (await read()).content;
    expect(content).toContain('# concurrent change');
    expect(content).toContain('suspend: false');
  });

  // A ranged read returns the stored lines (the CRLF line keeps its CR) with the same version
  // as a whole read, so an edit can be pinned to it without reading the whole file.
  it('reads a line range whose version pins an edit', async () => {
    const whole = await read();
    const lines = whole.content.split(/(?<=\n)/);
    const ranged = Ranged.parse(
      await helper.executeTool('browse_files', {
        action: 'content',
        project_id: projectId,
        file_path: FILE,
        ref: branch,
        start_line: 4,
        end_line: 5,
      }),
    );
    expect(ranged).toMatchObject({
      content: lines.slice(3, 5).join(''),
      start_line: 4,
      end_line: 5,
      total_lines: lines.length,
      next_line: 6,
      last_commit_id: whole.last_commit_id,
      blob_id: whole.blob_id,
      content_sha256: whole.content_sha256,
    });
    expect(ranged.content).toContain('\r\n');

    const result = await edit({
      edits: [{ old_text: 'memory: 1Gi', new_text: 'memory: 2Gi' }],
      expected_last_commit_id: ranged.last_commit_id,
    });
    expect(result.replacements).toEqual([1]);
    expect((await read()).content).toContain('memory: 2Gi');
  });

  // A range past the end is an empty selection that still reports the line count.
  it('returns an empty selection past the end of the file', async () => {
    const total = (await read()).content.split(/(?<=\n)/).length;
    await expect(
      helper.executeTool('browse_files', {
        action: 'content',
        project_id: projectId,
        file_path: FILE,
        ref: branch,
        start_line: total + 10,
      }),
    ).resolves.toMatchObject({ content: '', end_line: null, total_lines: total, next_line: null });
  });
});
