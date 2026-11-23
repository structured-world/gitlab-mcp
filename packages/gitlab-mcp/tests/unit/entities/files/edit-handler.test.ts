import { filesToolRegistry } from '../../../../src/entities/files/registry';
import { EDIT_MAX_FILE_BYTES } from '../../../../src/entities/files/edit';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const READ_COMMIT = 'aaaa1111';
const NEW_COMMIT = 'bbbb2222';
const values = 'replicas: 2\nresources:\n  cpu: 500m\nsuspend: false\n';

/** The raw file response, with the version headers GitLab sends. */
function rawFile(body: string | Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: {
      'content-type': 'text/plain',
      'x-gitlab-last-commit-id': READ_COMMIT,
      'x-gitlab-blob-id': 'blob1',
      'x-gitlab-content-sha256': 'sha1',
      ...headers,
    },
  });
}

function json(payload: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

const edit = (args: Record<string, unknown> = {}) =>
  filesToolRegistry.get('manage_files')!.handler({
    action: 'edit',
    project_id: 'group/project',
    file_path: 'chart/values.yaml',
    branch: 'main',
    commit_message: 'Raise CPU',
    edits: [{ old_text: 'cpu: 500m', new_text: 'cpu: 750m' }],
    ...args,
  });

/** The JSON body sent with a fetch call. */
function sentBody(call: number): Record<string, unknown> {
  const init = mockEnhancedFetch.mock.calls[call][1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('manage_files edit', () => {
  it('previews the diff with dry_run and commits nothing', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(rawFile(values));
    const result = await edit({ dry_run: true });
    expect(result).toMatchObject({
      dry_run: true,
      replacements: [1],
      blob_id: 'blob1',
      last_commit_id: READ_COMMIT,
    });
    expect((result as { diff: string }).diff).toContain('-  cpu: 500m\n+  cpu: 750m');
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
    expect(mockEnhancedFetch.mock.calls[0][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/repository/files/chart%2Fvalues.yaml/raw?ref=main',
    );
  });

  it('commits only the changed fragment, conditioned on the version it read', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ id: NEW_COMMIT }, 201, 'Created'));
    const result = await edit();
    expect(result).toMatchObject({
      file_path: 'chart/values.yaml',
      branch: 'main',
      replacements: [1],
      commit_id: NEW_COMMIT,
      last_commit_id: NEW_COMMIT,
    });
    expect(mockEnhancedFetch.mock.calls[1][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/repository/commits',
    );
    expect(sentBody(1)).toEqual({
      branch: 'main',
      commit_message: 'Raise CPU',
      stats: false,
      actions: [
        {
          action: 'update',
          file_path: 'chart/values.yaml',
          content: values.replace('cpu: 500m', 'cpu: 750m'),
          encoding: 'text',
          last_commit_id: READ_COMMIT,
        },
      ],
    });
  });

  it('reads from start_branch and passes the commit options through', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ id: NEW_COMMIT }, 201, 'Created'));
    await edit({
      branch: 'feature',
      start_branch: 'main',
      author_name: 'Bot',
      author_email: 'bot@example.com',
    });
    expect(mockEnhancedFetch.mock.calls[0][0]).toContain('/raw?ref=main');
    expect(sentBody(1)).toMatchObject({
      branch: 'feature',
      start_branch: 'main',
      author_name: 'Bot',
      author_email: 'bot@example.com',
    });
  });

  it('keeps a byte order mark and CRLF line endings in the committed content', async () => {
    const text = '﻿a: 1\r\nb: 2\r\n';
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(Buffer.from(text)))
      .mockResolvedValueOnce(json({ id: NEW_COMMIT }, 201, 'Created'));
    await edit({ edits: [{ old_text: 'b: 2', new_text: 'b: 3' }] });
    const action = (sentBody(1).actions as Array<{ content: string }>)[0];
    expect(Buffer.from(action.content)).toEqual(Buffer.from('﻿a: 1\r\nb: 3\r\n'));
  });

  it('accepts an older commit id that names the same version of the file', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json([{ id: READ_COMMIT }]))
      .mockResolvedValueOnce(json({ id: NEW_COMMIT }, 201, 'Created'));
    await expect(edit({ expected_last_commit_id: 'branch-head-sha' })).resolves.toMatchObject({
      last_commit_id: NEW_COMMIT,
    });
    expect(mockEnhancedFetch.mock.calls[1][0]).toContain(
      '/repository/commits?ref_name=branch-head-sha&path=chart%2Fvalues.yaml&per_page=1',
    );
    // The write is conditioned on the version the server read, never the caller's id.
    const action = (sentBody(2).actions as Array<{ last_commit_id: string }>)[0];
    expect(action.last_commit_id).toBe(READ_COMMIT);
  });

  it('refuses a stale expected_last_commit_id before writing, with the current id', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json([{ id: 'older0000' }]));
    await expect(edit({ expected_last_commit_id: 'older0000' })).rejects.toThrow(
      `manage_files edit: the file changed since it was read; its last_commit_id is now ${READ_COMMIT}`,
    );
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
  });

  it('refuses an expected commit GitLab does not know, which GitLab itself would ignore', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ message: '404 Commit Not Found' }, 404, 'Not Found'));
    await expect(edit({ expected_last_commit_id: 'deadbeef' })).rejects.toThrow(
      'the file changed since it was read',
    );
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
  });

  it('propagates a failed version lookup instead of calling it a conflict', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ message: 'boom' }, 500, 'Internal Server Error'));
    await expect(edit({ expected_last_commit_id: 'deadbeef' })).rejects.toThrow(/500/);
  });

  it('reports GitLab refusing a file changed between read and write as a conflict', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(rawFile(values)).mockResolvedValueOnce(
      json(
        {
          message: 'The file has changed since you started editing it: chart/values.yaml',
        },
        400,
        'Bad Request',
      ),
    );
    await expect(edit()).rejects.toThrow(
      'manage_files edit: the file changed between reading and writing it, and GitLab refused the update',
    );
  });

  it('propagates other commit failures as they are', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ message: 'You are not allowed to push' }, 403, 'Forbidden'));
    await expect(edit()).rejects.toThrow(/403/);
  });

  it('refuses an edit that does not apply, naming it, without committing', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(rawFile(values));
    await expect(edit({ edits: [{ old_text: 'cpu: 900m', new_text: 'x' }] })).rejects.toThrow(
      'manage_files edit: edit 0: old_text was not found in the file; nothing was committed',
    );
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that is not UTF-8 text', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(rawFile(new Uint8Array([0x61, 0xff, 0x62])));
    await expect(edit()).rejects.toThrow('the file is not valid UTF-8 text');
  });

  it('refuses a Git LFS pointer', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      rawFile('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n'),
    );
    await expect(edit()).rejects.toThrow('the file is stored in Git LFS');
  });

  it('refuses a missing file and points to single', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      json({ message: '404 File Not Found' }, 404, 'Not Found'),
    );
    await expect(edit()).rejects.toThrow(
      'chart/values.yaml is not a file at main; edit changes existing files, create one with action single',
    );
  });

  it('propagates a missing ref as GitLab reported it', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      json({ message: '404 Commit Not Found' }, 404, 'Not Found'),
    );
    await expect(edit()).rejects.toThrow(/404 Not Found - .*Commit Not Found/);
  });

  it('refuses an oversized file from its reported size without reading it', async () => {
    const response = rawFile('x', { 'x-gitlab-size': String(EDIT_MAX_FILE_BYTES + 1) });
    const read = jest.spyOn(response, 'arrayBuffer');
    mockEnhancedFetch.mockResolvedValueOnce(response);
    await expect(edit()).rejects.toThrow(
      `manage_files edit: the file is ${EDIT_MAX_FILE_BYTES + 1} bytes, over the ${EDIT_MAX_FILE_BYTES}-byte limit; replace the file with action single`,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses an oversized file without a size header from its body', async () => {
    const big = 'x'.repeat(EDIT_MAX_FILE_BYTES + 1);
    const response = new Response(big, { headers: { 'x-gitlab-last-commit-id': READ_COMMIT } });
    mockEnhancedFetch.mockResolvedValueOnce(response);
    await expect(edit()).rejects.toThrow('over the 1048576-byte limit');
  });

  it('refuses an edit whose result would exceed the size limit', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(rawFile(values));
    await expect(
      edit({
        edits: [{ old_text: 'cpu: 500m', new_text: 'x'.repeat(EDIT_MAX_FILE_BYTES) }],
      }),
    ).rejects.toThrow('the edited file would be');
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a file whose last commit GitLab did not report', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(values, { headers: { 'content-type': 'text/plain' } }),
    );
    await expect(edit()).rejects.toThrow('GitLab did not report the last commit of the file');
  });

  it('fails on a commit response without an id', async () => {
    mockEnhancedFetch
      .mockResolvedValueOnce(rawFile(values))
      .mockResolvedValueOnce(json({ unexpected: true }, 201, 'Created'));
    await expect(edit()).rejects.toThrow('GitLab API error: unexpected commit response');
  });

  it('validates the edits list in the tool schema', async () => {
    await expect(edit({ edits: [] })).rejects.toThrow();
    await expect(
      edit({ edits: Array.from({ length: 51 }, () => ({ old_text: 'a', new_text: 'b' })) }),
    ).rejects.toThrow();
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });
});
