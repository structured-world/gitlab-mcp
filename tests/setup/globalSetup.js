/**
 * Global Test Setup
 *
 * Runs once before all integration tests
 * Validates environment and prepares for data lifecycle chain
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { config } = require('dotenv');

// Namespace tmp artefacts by checkout root so concurrent runs across multiple
// worktrees (or different machines sharing a tmpdir over NFS) cannot clobber
// each other's tier-detection cache. sha256 here is a cache-key digest, not a
// security primitive — it just needs to be collision-resistant across paths.
const REPO_HASH = crypto
  .createHash('sha256')
  .update(path.resolve(__dirname, '../..'))
  .digest('hex')
  .slice(0, 12);

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
  const tierFile = path.join(os.tmpdir(), `gitlab-mcp-detected-tier-${REPO_HASH}.json`);
  // force:true avoids ENOENT and keeps startup resilient to Windows file locks
  // / EPERM that could otherwise crash the whole integration run.
  fs.rmSync(tierFile, { force: true });

  // Bearer works for BOTH personal access tokens and OAuth tokens against
  // GitLab; PRIVATE-TOKEN would 401 on OAuth tokens and silently default to
  // 'free', incorrectly skipping Premium/Ultimate suites.
  // AbortController guards against a hung connection blocking suite startup
  // (Jest's per-test timeout doesn't apply in globalSetup).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${process.env.GITLAB_API_URL}/api/graphql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ currentLicense { plan } }' }),
      signal: controller.signal,
    });
    // Treat non-2xx and GraphQL errors as DETECTION FAILURE (caught + warned)
    // rather than as a Free-tier response — otherwise auth/network breakage
    // would silently skip every Premium/Ultimate suite.
    if (!res.ok) {
      throw new Error(`Tier detection HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(`Tier detection GraphQL error: ${data.errors[0]?.message ?? 'unknown'}`);
    }
    const plan = (data?.data?.currentLicense?.plan ?? '').toLowerCase();
    let tier = 'free';
    if (plan.includes('ultimate') || plan.includes('gold')) tier = 'ultimate';
    else if (plan.includes('premium') || plan.includes('silver')) tier = 'premium';
    fs.writeFileSync(tierFile, JSON.stringify({ tier, plan }));
    console.log(`🎫 Detected GitLab tier: ${tier}${plan ? ` (plan: ${plan})` : ''}`);
  } catch (err) {
    fs.writeFileSync(tierFile, JSON.stringify({ tier: 'free', plan: '' }));
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  Tier detection failed (${reason}) — defaulting to free`);
  } finally {
    clearTimeout(timeoutId);
  }

  console.log('✅ Environment validated - starting test data lifecycle chain');
};
