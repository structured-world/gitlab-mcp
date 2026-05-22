/**
 * Global Test Setup
 *
 * Runs once before all integration tests
 * Validates environment and prepares for data lifecycle chain
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { config } = require('dotenv');

module.exports = async () => {
  // Load .env.test file first (same as setupTests.ts)
  const envTestPath = path.resolve(__dirname, '../../.env.test');
  if (fs.existsSync(envTestPath)) {
    config({ path: envTestPath, quiet: true });
  }

  // Clean up any stale test data from previous interrupted runs
  const testDataFile = path.join(os.tmpdir(), 'gitlab-mcp-test-data.json');
  if (fs.existsSync(testDataFile)) {
    fs.unlinkSync(testDataFile);
    console.log('🧹 Cleaned up stale test data file from previous run');
  }

  console.log('🚀 Starting GitLab Integration Test Suite with Data Lifecycle');
  console.log('📋 Test execution plan:');
  console.log('  1. data-lifecycle.test.ts - Create complete test infrastructure');
  console.log('  2. schemas-dependent/*.test.ts - Test schemas with real data');
  console.log('  3. workitems.test.ts - Test GraphQL with infrastructure');
  console.log('  4. Cleanup all test infrastructure');
  console.log('');

  // Validate required environment variables
  const requiredEnvVars = ['GITLAB_TOKEN', 'GITLAB_API_URL'];
  const missing = requiredEnvVars.filter((env) => !process.env[env]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Detect GitLab tier once. Premium/Ultimate-only test suites use this to
  // skip rather than fail on Free instances. Result lives in a tmp file so
  // each Jest worker can read it synchronously at setup load time, before
  // describeIfTier blocks parse.
  const tierFile = path.join(os.tmpdir(), 'gitlab-mcp-detected-tier.json');
  if (fs.existsSync(tierFile)) fs.unlinkSync(tierFile);

  try {
    const res = await fetch(`${process.env.GITLAB_API_URL}/api/graphql`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ currentLicense { plan } }' }),
    });
    const data = res.ok ? await res.json() : null;
    const plan = (data?.data?.currentLicense?.plan ?? '').toLowerCase();
    let tier = 'free';
    if (plan.includes('ultimate') || plan.includes('gold')) tier = 'ultimate';
    else if (plan.includes('premium') || plan.includes('silver')) tier = 'premium';
    fs.writeFileSync(tierFile, JSON.stringify({ tier, plan }));
    console.log(`🎫 Detected GitLab tier: ${tier}${plan ? ` (plan: ${plan})` : ''}`);
  } catch (err) {
    fs.writeFileSync(tierFile, JSON.stringify({ tier: 'free', plan: '' }));
    console.warn(`⚠️  Tier detection failed (${err.message}) — defaulting to free`);
  }

  console.log('✅ Environment validated - starting test data lifecycle chain');
};
