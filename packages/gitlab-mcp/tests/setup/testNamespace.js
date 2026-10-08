// Integration fixtures belong under the existing root "test" group. Cleanup
// verifies the provider's live group before deleting a suite-owned subgroup.
async function findTestRoot(request, apiUrl, token) {
  const response = await request(`${apiUrl}/api/v4/groups/test`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Cannot resolve root test group: ${response.status}`);
  const root = await response.json();
  if (
    !Number.isSafeInteger(root.id) ||
    root.id <= 0 ||
    root.full_path !== 'test' ||
    root.parent_id !== null
  ) {
    throw new Error('Integration fixtures require the existing root test group');
  }
  return root;
}

async function deleteLifecycleGroup(request, apiUrl, token, saved) {
  if (
    !Number.isSafeInteger(saved.id) ||
    saved.id <= 0 ||
    !/^test\/lifecycle-test-\d+$/.test(saved.full_path)
  ) {
    throw new Error('Refusing cleanup outside a suite-owned test lifecycle subgroup');
  }
  const root = await findTestRoot(request, apiUrl, token);
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request(`${apiUrl}/api/v4/groups/${saved.id}`, { headers });
  if (!response.ok) throw new Error(`Cannot verify cleanup group: ${response.status}`);
  const live = await response.json();
  if (live.id !== saved.id || live.full_path !== saved.full_path || live.parent_id !== root.id) {
    throw new Error('Refusing cleanup: live group does not match the suite-owned test subgroup');
  }
  const deleted = await request(`${apiUrl}/api/v4/groups/${saved.id}`, {
    method: 'DELETE',
    headers,
  });
  if (!deleted.ok) throw new Error(`Cannot delete test lifecycle subgroup: ${deleted.status}`);

  // GitLab Groups API, "Delete a group": retention may only schedule the first
  // deletion. Confirm with the provider's updated full_path to bypass retention.
  // https://docs.gitlab.com/api/groups/#delete-a-group
  const scheduledResponse = await request(`${apiUrl}/api/v4/groups/${saved.id}`, { headers });
  if (scheduledResponse.status === 404) return 'removed';
  if (!scheduledResponse.ok) {
    throw new Error(`Cannot verify scheduled test subgroup: ${scheduledResponse.status}`);
  }
  const scheduled = await scheduledResponse.json();
  if (
    scheduled.id !== saved.id ||
    scheduled.parent_id !== root.id ||
    typeof scheduled.full_path !== 'string' ||
    !/^test\/[^/]+$/.test(scheduled.full_path)
  ) {
    throw new Error('Refusing permanent cleanup: subgroup no longer belongs to the test root');
  }
  const removed = await request(`${apiUrl}/api/v4/groups/${saved.id}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_path: scheduled.full_path, permanently_remove: true }),
  });
  if (removed.ok) return 'permanent_removal_accepted';

  // GitLab 18.5 Groups API returns this specific 400 when instance policy
  // forbids bypassing retention. Other failures must still fail teardown.
  // https://gitlab.com/gitlab-org/gitlab/-/blob/v18.5.0-ee/lib/api/groups.rb#L175-198
  if (removed.status === 400) {
    const error = await removed.json();
    if (error.message === '`permanently_remove` option is not permitted on this instance.') {
      const pendingResponse = await request(`${apiUrl}/api/v4/groups/${saved.id}`, { headers });
      if (pendingResponse.status === 404) return 'removed';
      if (!pendingResponse.ok) {
        throw new Error(`Cannot verify pending test subgroup: ${pendingResponse.status}`);
      }
      const pending = await pendingResponse.json();
      if (
        pending.id !== saved.id ||
        pending.parent_id !== root.id ||
        pending.full_path !== scheduled.full_path ||
        typeof pending.marked_for_deletion_on !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(pending.marked_for_deletion_on)
      ) {
        throw new Error(
          'Refusing scheduled cleanup: test subgroup is not verified pending deletion',
        );
      }
      return 'deletion_scheduled';
    }
  }
  throw new Error(`Cannot permanently remove test subgroup: ${removed.status}`);
}

module.exports = { findTestRoot, deleteLifecycleGroup };
