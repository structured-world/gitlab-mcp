#!/usr/bin/env node
/**
 * Removes lifecycle subgroups that integration runs left under the root "test" group,
 * for example when a run died before writing the record its teardown and the next
 * run's setup clean up from.
 *
 * Usage: node scripts/cleanup-test-groups.js [--dry-run] [--force]
 *   --dry-run  list what would be removed
 *   --force    also remove subgroups younger than MIN_AGE_MS (a run may still use them)
 */

const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');
const { deleteLifecycleGroup, listLifecycleGroups } = require('../tests/setup/testNamespace');

// A full integration run takes about fifteen minutes; a younger group may be in use.
const MIN_AGE_MS = 2 * 60 * 60 * 1000;

async function main() {
  const envTestPath = path.resolve(__dirname, '../.env.test');
  if (fs.existsSync(envTestPath)) config({ path: envTestPath, quiet: true });
  const apiUrl = process.env.GITLAB_API_URL;
  const token = process.env.GITLAB_TOKEN;
  if (!apiUrl || !token) throw new Error('GITLAB_API_URL and GITLAB_TOKEN are required');

  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const groups = await listLifecycleGroups(fetch, apiUrl, token);
  let failed = 0;
  for (const group of groups) {
    // The suite names each group lifecycle-test-<creation time in ms>.
    const age = Date.now() - Number(group.full_path.split('-').pop());
    if (age < MIN_AGE_MS && !force) {
      console.log(`skip ${group.full_path}: younger than two hours, a run may use it`);
      continue;
    }
    if (dryRun) {
      console.log(`would remove ${group.full_path}`);
      continue;
    }
    try {
      console.log(`${group.full_path}: ${await deleteLifecycleGroup(fetch, apiUrl, token, group)}`);
    } catch (error) {
      failed += 1;
      console.error(`${group.full_path}: ${error.message}`);
    }
  }
  console.log(`${groups.length} lifecycle subgroups found, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
