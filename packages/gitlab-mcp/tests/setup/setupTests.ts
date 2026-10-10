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
  config({ path: envTestPath, quiet: true });

  // Set flag to indicate integration tests can run
  process.env.INTEGRATION_TESTS_ENABLED = 'true';

  // Enable feature flags by default if not explicitly set
  if (!process.env.USE_WORKITEMS) process.env.USE_WORKITEMS = 'true';
  if (!process.env.USE_MILESTONE) process.env.USE_MILESTONE = 'true';
  if (!process.env.USE_PIPELINE) process.env.USE_PIPELINE = 'true';
  if (!process.env.USE_GITLAB_WIKI) process.env.USE_GITLAB_WIKI = 'true';

  // A shared test instance answers slower than the production default allows; .env.test
  // can still set its own value.
  if (!process.env.GITLAB_API_HEADERS_TIMEOUT_MS) {
    process.env.GITLAB_API_HEADERS_TIMEOUT_MS = '20000';
  }

  // Integration tests enabled - environment loaded silently
} else {
  console.log('⚠️  .env.test not found - Integration tests disabled');
  console.log('   Create .env.test with GitLab credentials to enable integration tests');
}
