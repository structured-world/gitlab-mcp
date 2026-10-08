/**
 * Global Test Teardown
 *
 * Runs once after all integration tests
 * Handles cleanup of lifecycle test data
 */

const fs = require('fs');
const { config } = require('dotenv');
const { deleteLifecycleGroup } = require('./testNamespace');

// Use native fetch API (available in Node.js 18+)
// No import needed - fetch is global in modern Node.js

module.exports = async () => {
  // Load environment
  const path = require('path');
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  if (fs.existsSync(envTestPath)) {
    config({ path: envTestPath, quiet: true });
  }

  // Get test data from persistent file storage (globalTeardown runs in separate context)
  const os = require('os');
  const testDataFile = path.join(os.tmpdir(), 'gitlab-mcp-test-data.json');
  let testData = null;

  try {
    // Read test data from persistent file
    if (fs.existsSync(testDataFile)) {
      testData = JSON.parse(fs.readFileSync(testDataFile, 'utf8'));
      console.log(`📋 Found test data file with group ID: ${testData.group?.id}`);
    } else {
      console.log('📋 No test data file found - nothing to clean up');
    }
  } catch (error) {
    console.log('⚠️  Could not read test data file:', error);
  }

  console.log('');
  console.log('🧹 Integration test suite completed');

  // Cleanup test infrastructure if it exists
  if (testData?.group?.id && process.env.GITLAB_TOKEN && process.env.GITLAB_API_URL) {
    console.log('🧹 Final cleanup: Deleting all test infrastructure...');

    // A failed verification/deletion fails teardown and retains the data file
    // for diagnosis rather than claiming that cleanup succeeded.
    await deleteLifecycleGroup(
      fetch,
      process.env.GITLAB_API_URL,
      process.env.GITLAB_TOKEN,
      testData.group,
    );
    console.log(`Cleaned up suite-owned subgroup: ${testData.group.full_path}`);
  } else if (testData?.group?.id) {
    throw new Error('Cannot clean up lifecycle subgroup without test credentials');
  }

  console.log('GitLab integration teardown completed; test results are reported by Jest');

  // Clean up temporary test data file
  try {
    if (fs.existsSync(testDataFile)) {
      fs.unlinkSync(testDataFile);
      console.log('🧹 Cleaned up temporary test data file');
    }
  } catch (error) {
    console.warn('⚠️ Could not clean up test data file:', error);
  }
};
