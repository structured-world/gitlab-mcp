/**
 * Jest setup file for integration tests
 * Loads environment variables from .env.test if present
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// Check if .env.test exists and load it
const envTestPath = path.resolve(__dirname, '../../.env.test');

if (fs.existsSync(envTestPath)) {
  // Load .env.test file
  config({ path: envTestPath });

  // Set flag to indicate integration tests can run
  process.env.INTEGRATION_TESTS_ENABLED = 'true';

  // Enable feature flags by default if not explicitly set
  if (!process.env.USE_WORKITEMS) process.env.USE_WORKITEMS = 'true';
  if (!process.env.USE_MILESTONE) process.env.USE_MILESTONE = 'true';
  if (!process.env.USE_PIPELINE) process.env.USE_PIPELINE = 'true';
  if (!process.env.USE_GITLAB_WIKI) process.env.USE_GITLAB_WIKI = 'true';

  console.log('✅ Loaded .env.test - Integration tests enabled');

  // Log which GitLab instance we're testing against (without token)
  if (process.env.GITLAB_API_URL) {
    console.log(`🔗 Testing against GitLab instance: ${process.env.GITLAB_API_URL}`);
  }

  // Log feature flags
  const featureFlags: string[] = [];
  if (process.env.USE_WORKITEMS === 'true') featureFlags.push('WorkItems');
  if (process.env.USE_MILESTONE === 'true') featureFlags.push('Milestones');
  if (process.env.USE_PIPELINE === 'true') featureFlags.push('Pipelines');
  if (process.env.USE_GITLAB_WIKI === 'true') featureFlags.push('Wiki');

  if (featureFlags.length > 0) {
    console.log(`🚀 Feature flags enabled: ${featureFlags.join(', ')}`);
  }
} else {
  console.log('⚠️  .env.test not found - Integration tests disabled');
  console.log('   Create .env.test with GitLab credentials to enable integration tests');
}

// Global test timeout for integration tests
if (process.env.INTEGRATION_TESTS_ENABLED === 'true') {
  jest.setTimeout(30000);
}