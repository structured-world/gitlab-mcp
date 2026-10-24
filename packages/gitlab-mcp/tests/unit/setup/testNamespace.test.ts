import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import type * as net from 'node:net';
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
    // A port the system just handed out and took back, so free for this test.
    async function freePort(): Promise<number> {
      const probe = await acquireRunLock(0);
      const { port } = probe.address() as net.AddressInfo;
      await releaseRunLock(probe);
      return port;
    }

    // Another run in its own process, holding the lock until it is killed.
    async function runInAnotherProcess(port: number): Promise<ChildProcess> {
      const lockModule = path.resolve(__dirname, '../../setup/testNamespace.js');
      const child = spawn(
        process.execPath,
        [
          '-e',
          `require(${JSON.stringify(lockModule)}).acquireRunLock(${port})` +
            `.then(() => { console.log('held'); setInterval(() => {}, 1000); });`,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      await new Promise<void>((resolve, reject) => {
        child.stdout?.once('data', () => resolve());
        child.once('exit', (code) => reject(new Error(`lock holder exited with ${code}`)));
      });
      return child;
    }

    async function kill(child: ChildProcess): Promise<void> {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }

    it('refuses to start while another run holds the lock', async () => {
      const port = await freePort();
      const other = await runInAnotherProcess(port);
      try {
        await expect(acquireRunLock(port)).rejects.toThrow('Another integration run');
      } finally {
        await kill(other);
      }
    });

    // A run killed before its teardown leaves nothing to take over: the next run starts and
    // then cleans up after the dead run.
    it('is free again once the run holding it is killed', async () => {
      const port = await freePort();
      await kill(await runInAnotherProcess(port));
      const lock = await acquireRunLock(port);
      try {
        expect(lock.listening).toBe(true);
        expect(lock.address()).toMatchObject({ address: '127.0.0.1', port });
      } finally {
        await releaseRunLock(lock);
      }
    });

    it('is free again once the run releases it, and releasing twice is harmless', async () => {
      const port = await freePort();
      const lock = await acquireRunLock(port);
      await expect(acquireRunLock(port)).rejects.toThrow(String(port));
      await releaseRunLock(lock);
      await expect(releaseRunLock(lock)).resolves.toBeUndefined();
      // A setup that failed before taking the lock leaves nothing to release.
      await expect(releaseRunLock(undefined)).resolves.toBeUndefined();
      await releaseRunLock(await acquireRunLock(port));
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
