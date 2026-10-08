const { findTestRoot, deleteLifecycleGroup } = require('../../setup/testNamespace.js');

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
});
