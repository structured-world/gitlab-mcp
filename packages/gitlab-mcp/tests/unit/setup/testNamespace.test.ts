import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const {
  findTestRoot,
  deleteLifecycleGroup,
  cleanupStaleRun,
  listLifecycleGroups,
  acquireRunLock,
  releaseRunLock,
} = require('../../setup/testNamespace.js');

describe('Integration namespace boundary', () => {
  const apiUrl = 'https://gitlab.example';
  const token = 'test-token';
  const request = jest.fn();
  const root = { id: 73, full_path: 'test', parent_id: null };
  const group = {
    id: 91,
    full_path: 'test/lifecycle-test-1791488000000',
    parent_id: root.id,
  };
  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  beforeEach(() => request.mockReset());

  // Missing or non-root namespaces must fail before any group creation.
  it('resolves only the existing root test group', async () => {
    request.mockResolvedValueOnce(ok(root));
    await expect(findTestRoot(request, apiUrl, token)).resolves.toEqual(root);
    expect(request).toHaveBeenCalledWith(`${apiUrl}/api/v4/groups/test`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it.each([
    { id: 73, full_path: 'other/test', parent_id: 12 },
    { id: 73, full_path: 'test', parent_id: 12 },
    { full_path: 'test', parent_id: null },
  ])('rejects an invalid test root before mutation: %j', async (body) => {
    request.mockResolvedValueOnce(ok(body));
    await expect(findTestRoot(request, apiUrl, token)).rejects.toThrow('root test group');
    expect(request).toHaveBeenCalledTimes(1);
  });

  // Cleanup must verify live provider ownership, not trust a saved group ID.
  it('deletes only its verified lifecycle subgroup', async () => {
    request.mockResolvedValueOnce(ok(root)).mockResolvedValueOnce(ok(group));
    request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 404 });
    await deleteLifecycleGroup(request, apiUrl, token, group);
    expect(request).toHaveBeenNthCalledWith(3, `${apiUrl}/api/v4/groups/${group.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(request).toHaveBeenLastCalledWith(`${apiUrl}/api/v4/groups/${group.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(request).toHaveBeenCalledTimes(4);
  });

  // With retention enabled the first DELETE only schedules deletion. The
  // provider renames the group; its updated full_path confirms permanent removal.
  it('requests permanent removal after deletion is scheduled', async () => {
    const scheduled = { ...group, full_path: `${group.full_path}-deletion_scheduled-91` };
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true, status: 202 })
      .mockResolvedValueOnce(ok(scheduled))
      .mockResolvedValueOnce({ ok: true, status: 202 });
    await deleteLifecycleGroup(request, apiUrl, token, group);
    expect(request.mock.calls.map((call) => call[1].method || 'GET')).toEqual([
      'GET',
      'GET',
      'DELETE',
      'GET',
      'DELETE',
    ]);
    expect(request).toHaveBeenLastCalledWith(`${apiUrl}/api/v4/groups/${group.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_path: scheduled.full_path, permanently_remove: true }),
    });
  });

  // A failed permanent request must retain the fixture record by rejecting
  // teardown rather than treating the scheduled deletion as completed cleanup.
  it('propagates permanent-removal failures', async () => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow('403');
  });

  // GitLab 18.5 can forbid bypassing retention. Only that exact policy response
  // plus a verified pending deletion is successful scheduled cleanup.
  it('reports scheduled cleanup when instance policy forbids immediate deletion', async () => {
    const scheduled = { ...group, marked_for_deletion_on: '2026-10-09' };
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(scheduled))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: '`permanently_remove` option is not permitted on this instance.',
        }),
      })
      .mockResolvedValueOnce(ok(scheduled));
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).resolves.toBe(
      'deletion_scheduled',
    );
    expect(request).toHaveBeenCalledTimes(6);
  });

  // Retention can expire while handling the policy response: a provider 404
  // proves removal, whereas a failed verification must not be called success.
  it('reports removal if the scheduled group disappears after the policy refusal', async () => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: '`permanently_remove` option is not permitted on this instance.',
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).resolves.toBe('removed');
  });

  it('propagates failed verification after the policy refusal', async () => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: '`permanently_remove` option is not permitted on this instance.',
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow('503');
  });

  // Do not hide unrelated validation errors behind the successful first DELETE.
  it('rejects unrelated permanent-deletion validation errors', async () => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: '`full_path` is incorrect.' }),
      });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow('400');
    expect(request).toHaveBeenCalledTimes(5);
  });

  // A group restored or moved after scheduling is not a successful cleanup.
  it.each([
    { ...group, marked_for_deletion_on: null },
    { ...group, parent_id: 4, marked_for_deletion_on: '2026-10-09' },
    { ...group, id: 92, marked_for_deletion_on: '2026-10-09' },
    { ...group, full_path: 'test/unrelated', marked_for_deletion_on: '2026-10-09' },
  ])('rejects a policy refusal without verified scheduled deletion: %j', async (pending) => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: '`permanently_remove` option is not permitted on this instance.',
        }),
      })
      .mockResolvedValueOnce(ok(pending));
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow();
  });

  // Recheck ownership after scheduling so the second mutation cannot act on
  // a moved group or use an unrelated provider path as deletion confirmation.
  it.each([
    { ...group, parent_id: 4 },
    { ...group, full_path: 'production/unrelated' },
    { ...group, id: 92 },
  ])('refuses permanent removal of a changed subgroup: %j', async (scheduled) => {
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce(ok(group))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(ok(scheduled));
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow('Refusing');
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([
    { id: root.id, full_path: 'test', parent_id: null },
    { id: 91, full_path: 'production/lifecycle-test-1791488000000', parent_id: 3 },
    { id: 91, full_path: 'test/unrelated', parent_id: root.id },
  ])('refuses saved groups outside its fixture boundary: %j', async (saved) => {
    await expect(deleteLifecycleGroup(request, apiUrl, token, saved)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses deletion when the live group no longer matches the saved fixture', async () => {
    request.mockResolvedValueOnce(ok(root));
    request.mockResolvedValueOnce(ok({ ...group, parent_id: 4 }));
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reports failed cleanup instead of claiming success', async () => {
    request.mockResolvedValueOnce(ok(root)).mockResolvedValueOnce(ok(group));
    request.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).rejects.toThrow('403');
  });

  // A saved group someone already removed leaves nothing to clean; failing on it would
  // block every later run that finds the same record.
  it('reports a saved group that no longer exists as removed without deleting', async () => {
    request.mockResolvedValueOnce(ok(root)).mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(deleteLifecycleGroup(request, apiUrl, token, group)).resolves.toBe('removed');
    expect(request).toHaveBeenCalledTimes(2);
  });

  describe('a run interrupted before its teardown', () => {
    let dir: string;
    let dataFile: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-stale-test-'));
      dataFile = path.join(dir, 'gitlab-mcp-test-data.json');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('does nothing without a record of a previous run', async () => {
      await expect(cleanupStaleRun(request, apiUrl, token, dataFile)).resolves.toBe('none');
      expect(request).not.toHaveBeenCalled();
    });

    // Dropping the record alone would leave the previous run's group in GitLab for good.
    it('deletes the recorded group before dropping the record', async () => {
      fs.writeFileSync(dataFile, JSON.stringify({ group }));
      request
        .mockResolvedValueOnce(ok(root))
        .mockResolvedValueOnce(ok(group))
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(cleanupStaleRun(request, apiUrl, token, dataFile)).resolves.toBe('removed');
      expect(request.mock.calls.map((call) => call[1].method || 'GET')).toContain('DELETE');
      expect(fs.existsSync(dataFile)).toBe(false);
    });

    // A failed cleanup keeps the only record of the group so it can still be removed.
    it('keeps the record when the recorded group cannot be deleted', async () => {
      fs.writeFileSync(dataFile, JSON.stringify({ group }));
      request
        .mockResolvedValueOnce(ok(root))
        .mockResolvedValueOnce(ok(group))
        .mockResolvedValueOnce({ ok: false, status: 403 });
      await expect(cleanupStaleRun(request, apiUrl, token, dataFile)).rejects.toThrow(
        group.full_path,
      );
      expect(fs.existsSync(dataFile)).toBe(true);
    });

    // A run killed while it wrote its record leaves it cut short: it names no group, and it
    // must not stop every later run (orphans are found by listing the subgroups).
    it('drops an unreadable record', async () => {
      fs.writeFileSync(dataFile, '{"group": {"id": 9');
      await expect(cleanupStaleRun(request, apiUrl, token, dataFile)).resolves.toBe('none');
      expect(request).not.toHaveBeenCalled();
      expect(fs.existsSync(dataFile)).toBe(false);
    });

    // A record written before the run created its group has nothing to clean.
    it('drops a record without a group', async () => {
      fs.writeFileSync(dataFile, JSON.stringify({}));
      await expect(cleanupStaleRun(request, apiUrl, token, dataFile)).resolves.toBe('none');
      expect(request).not.toHaveBeenCalled();
      expect(fs.existsSync(dataFile)).toBe(false);
    });
  });

  // Runs on one machine share the record of their group, so only one runs at a time: a
  // second run must not take the first one's live group for an interrupted run's leftover.
  describe('the integration run lock', () => {
    let dir: string;
    let lockFile: string;
    // No process has this id: the highest a system hands out is far below it.
    const deadPid = 2 ** 30;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-lock-test-'));
      lockFile = path.join(dir, 'gitlab-mcp-integration.lock');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('takes a free lock for the run', () => {
      acquireRunLock(lockFile, 4242);
      expect(fs.readFileSync(lockFile, 'utf8')).toBe('4242');
    });

    it('refuses to start while another live run holds the lock', () => {
      fs.writeFileSync(lockFile, String(process.ppid));
      expect(() => acquireRunLock(lockFile, 4242)).toThrow(String(process.ppid));
      expect(fs.readFileSync(lockFile, 'utf8')).toBe(String(process.ppid));
    });

    // A run killed before its teardown leaves its lock: the next run takes it over and then
    // cleans up after the dead run.
    it('takes over the lock of a run that is no longer running', () => {
      fs.writeFileSync(lockFile, String(deadPid));
      acquireRunLock(lockFile, 4242);
      expect(fs.readFileSync(lockFile, 'utf8')).toBe('4242');
    });

    it('takes over an unreadable lock', () => {
      fs.writeFileSync(lockFile, 'not a process');
      acquireRunLock(lockFile, 4242);
      expect(fs.readFileSync(lockFile, 'utf8')).toBe('4242');
    });

    it('releases only its own lock', () => {
      fs.writeFileSync(lockFile, String(process.ppid));
      releaseRunLock(lockFile, 4242);
      expect(fs.existsSync(lockFile)).toBe(true);
      acquireRunLock(path.join(dir, 'own.lock'), 4242);
      releaseRunLock(path.join(dir, 'own.lock'), 4242);
      expect(fs.existsSync(path.join(dir, 'own.lock'))).toBe(false);
      // Nothing to release is not an error.
      expect(() => releaseRunLock(path.join(dir, 'own.lock'), 4242)).not.toThrow();
    });
  });

  // Orphans are found under the root test group only, across every page, and only
  // the suite's own lifecycle subgroups are returned.
  it('lists lifecycle subgroups of the root test group across pages', async () => {
    const other = { id: 92, full_path: 'test/backend', parent_id: root.id };
    const second = { id: 93, full_path: 'test/lifecycle-test-1791488999999', parent_id: root.id };
    request
      .mockResolvedValueOnce(ok(root))
      .mockResolvedValueOnce({
        ...ok([group, other]),
        headers: new Headers({ 'x-next-page': '2' }),
      })
      .mockResolvedValueOnce({ ...ok([second]), headers: new Headers({ 'x-next-page': '' }) });
    await expect(listLifecycleGroups(request, apiUrl, token)).resolves.toEqual([group, second]);
    expect(request).toHaveBeenNthCalledWith(
      2,
      `${apiUrl}/api/v4/groups/${root.id}/subgroups?search=lifecycle-test&per_page=100&page=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
});
