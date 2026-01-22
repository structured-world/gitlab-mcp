/**
 * Jest setup file for unit tests
 * DOES NOT load .env.test - unit tests should be isolated from environment
 */

// Set timeout for unit tests
jest.setTimeout(10000);

// Prevent any accidental environment loading
process.env.INTEGRATION_TESTS_ENABLED = "false";

// Mock environment variables for unit tests to use predictable values
process.env.GITLAB_BASE_URL = "";
process.env.GITLAB_TOKEN = "";
process.env.GITLAB_API_URL = "";

// Enable all feature flags for unit tests - we need to test all code paths
// Unit tests mock API calls, so there's no risk of accidental real API requests
// Feature flags should only be used for production/integration to disable features

console.log("🧪 Unit test environment initialized - no .env.test loaded");
