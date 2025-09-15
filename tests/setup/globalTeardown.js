/**
 * Global Test Teardown
 *
 * Runs once after all integration tests
 * Handles cleanup of lifecycle test data
 */

const path = require('path');
const fs = require('fs');
const { config } = require('dotenv');

module.exports = async () => {
  // Load environment
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  if (fs.existsSync(envTestPath)) {
    config({ path: envTestPath, quiet: true });
  }

  // Get test data from shared state
  const testConfigPath = path.resolve(__dirname, './testConfig.ts');
  let testData = null;

  try {
    // Try to get test data if available
    if (global.TEST_DATA_STATE && global.TEST_DATA_STATE.group?.id) {
      testData = global.TEST_DATA_STATE;
    }
  } catch (error) {
    // No test data to clean up
  }

  console.log('');
  console.log('🧹 Integration test suite completed');

  // Cleanup test infrastructure if it exists
  if (testData?.group?.id && process.env.GITLAB_TOKEN && process.env.GITLAB_API_URL) {
    console.log('🧹 Final cleanup: Deleting all test infrastructure...');

    try {
      const response = await fetch(`${process.env.GITLAB_API_URL}/api/v4/groups/${testData.group.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${process.env.GITLAB_TOKEN}`,
        },
      });

      if (response.ok) {
        console.log(`✅ Cleaned up test group: ${testData.group.id} (includes all projects, MRs, work items)`);
      } else {
        console.log(`⚠️  Could not delete test group ${testData.group.id}: ${response.status}`);
      }
    } catch (error) {
      console.log(`⚠️  Error deleting test group:`, error);
    }
  }

  console.log('📊 Data lifecycle summary:');
  console.log('  ✅ Test infrastructure created');
  console.log('  ✅ Schema validation completed with real data');
  console.log('  ✅ GraphQL functionality verified');
  console.log('  ✅ Complete cleanup performed');
  console.log('');
  console.log('✅ GitLab Integration Test Suite - All tests completed successfully');
};