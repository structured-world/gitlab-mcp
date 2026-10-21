// Integration fixtures belong under the existing root "test" group. Cleanup
// verifies the provider's live group before deleting a suite-owned subgroup.
const fs = require('node:fs');

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
  if (response.status === 404) return 'removed';
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

// The record a run keeps of its group outlives a run killed before its teardown; the
// next run deletes that group first, and keeps the record when it cannot.
async function cleanupStaleRun(request, apiUrl, token, dataFile) {
  if (!fs.existsSync(dataFile)) return 'none';
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))?.group;
  } catch {
    // A record cut short by a kill names no group; yarn cleanup:test-groups finds orphans
    // by listing the lifecycle subgroups.
    fs.unlinkSync(dataFile);
    return 'none';
  }
  let result = 'none';
  if (saved?.id) {
    try {
      result = await deleteLifecycleGroup(request, apiUrl, token, saved);
    } catch (error) {
      throw new Error(
        `Cannot clean up ${saved.full_path} left by an interrupted run (${error.message}); ` +
          `its record stays in ${dataFile}. Remove it with yarn cleanup:test-groups.`,
        { cause: error },
      );
    }
  }
  fs.unlinkSync(dataFile);
  return result;
}

// Every lifecycle subgroup of the root test group, for removing the ones no record names.
async function listLifecycleGroups(request, apiUrl, token) {
  const root = await findTestRoot(request, apiUrl, token);
  const headers = { Authorization: `Bearer ${token}` };
  const groups = [];
  // Pages are read one after another: each names the next in its x-next-page header.
  for (let page = 1; page > 0; ) {
    const response = await request(
      `${apiUrl}/api/v4/groups/${root.id}/subgroups?search=lifecycle-test&per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) throw new Error(`Cannot list test subgroups: ${response.status}`);
    for (const group of await response.json()) {
      if (group.parent_id === root.id && /^test\/lifecycle-test-\d+$/.test(group.full_path)) {
        groups.push(group);
      }
    }
    // Empty on the last page; anything but a page number ends the listing.
    const next = Number.parseInt(response.headers.get('x-next-page') ?? '', 10);
    page = Number.isSafeInteger(next) && next > page ? next : 0;
  }
  return groups;
}

module.exports = { findTestRoot, deleteLifecycleGroup, cleanupStaleRun, listLifecycleGroups };
