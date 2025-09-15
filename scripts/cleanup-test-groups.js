#!/usr/bin/env node

/**
 * Manual Cleanup Script for Orphaned Test Groups
 *
 * This script finds and cleans up orphaned test groups created by integration tests
 * that weren't properly cleaned up due to test failures or interruptions.
 *
 * Usage:
 *   node scripts/cleanup-test-groups.js [--dry-run] [--force]
 *
 * Options:
 *   --dry-run: Show what would be deleted without actually deleting
 *   --force: Delete groups even if they're not marked for deletion
 */

const fs = require('fs');
const path = require('path');

// Load environment from .env.test if available
const envTestPath = path.resolve(__dirname, '../.env.test');
if (fs.existsSync(envTestPath)) {
  const { config } = require('dotenv');
  config({ path: envTestPath, quiet: true });
}

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_API_URL = process.env.GITLAB_API_URL;

if (!GITLAB_TOKEN || !GITLAB_API_URL) {
  console.error('❌ Error: GITLAB_TOKEN and GITLAB_API_URL are required');
  console.error('   Make sure .env.test file exists with proper credentials');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');

async function findTestGroups() {
  console.log('🔍 Searching for test groups...');

  let allGroups = [];
  let page = 1;

  while (page <= 10) { // Limit to 10 pages to avoid infinite loop
    const response = await fetch(`${GITLAB_API_URL}/api/v4/groups?search=lifecycle-test&page=${page}&per_page=100`, {
      headers: {
        'Authorization': `Bearer ${GITLAB_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch groups: ${response.status} ${response.statusText}`);
    }

    const groups = await response.json();

    if (groups.length === 0) break;
    allGroups = allGroups.concat(groups);
    page++;
  }

  console.log(`📋 Found ${allGroups.length} test groups across ${page - 1} pages`);

  return allGroups;
}

async function deleteGroup(groupId, groupName) {
  console.log(`🗑️  Deleting group: ${groupId} (${groupName})`);

  if (isDryRun) {
    console.log('   [DRY RUN] Would delete this group');
    return { ok: true, status: 'dry-run' };
  }

  const response = await fetch(`${GITLAB_API_URL}/api/v4/groups/${groupId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${GITLAB_TOKEN}`,
    },
  });

  return { ok: response.ok, status: response.status, statusText: response.statusText };
}

async function main() {
  console.log('🧹 GitLab Test Groups Cleanup Script');
  console.log('=====================================');

  if (isDryRun) {
    console.log('🔍 Running in DRY RUN mode - no groups will be deleted');
  }

  if (isForce) {
    console.log('⚠️  Running in FORCE mode - will delete groups even if not marked for deletion');
  }

  console.log('');

  try {
    const groups = await findTestGroups();

    if (groups.length === 0) {
      console.log('✅ No test groups found - cleanup not needed');
      return;
    }

    let deletedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const group of groups) {
      const isMarkedForDeletion = group.marked_for_deletion_on !== null;
      const shouldDelete = isMarkedForDeletion || isForce;

      console.log(`\n📁 Group: ${group.name} (ID: ${group.id})`);
      console.log(`   Created: ${group.created_at}`);
      console.log(`   Marked for deletion: ${group.marked_for_deletion_on || 'No'}`);

      if (!shouldDelete) {
        console.log(`   ⏭️  Skipping - not marked for deletion (use --force to delete anyway)`);
        skippedCount++;
        continue;
      }

      try {
        const result = await deleteGroup(group.id, group.name);

        if (result.ok || result.status === 'dry-run') {
          console.log(`   ✅ ${isDryRun ? 'Would be deleted' : 'Deleted successfully'}`);
          deletedCount++;
        } else {
          console.log(`   ❌ Failed to delete: ${result.status} ${result.statusText}`);
          failedCount++;
        }
      } catch (error) {
        console.log(`   ❌ Error deleting: ${error.message}`);
        failedCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n📊 Cleanup Summary:');
    console.log('===================');
    console.log(`   ${isDryRun ? 'Would delete' : 'Deleted'}: ${deletedCount} groups`);
    console.log(`   Skipped: ${skippedCount} groups`);
    console.log(`   Failed: ${failedCount} groups`);

    if (isDryRun && deletedCount > 0) {
      console.log('\n💡 To actually delete these groups, run without --dry-run flag');
    }

    if (skippedCount > 0 && !isForce) {
      console.log('\n💡 To delete groups not marked for deletion, use --force flag');
    }

  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);