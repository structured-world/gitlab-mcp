/**
 * Shared Test Configuration
 *
 * Exports environment variables and test data state for all integration tests.
 * All test files should import from here instead of using process.env directly.
 */

// Environment configuration
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
export const GITLAB_API_URL = process.env.GITLAB_API_URL;
export const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID; // Only for DEFAULT_PROJECT tests

if (!GITLAB_TOKEN || !GITLAB_API_URL) {
  console.warn('⚠️  GITLAB_TOKEN and GITLAB_API_URL are required for integration tests');
}

// Test data state interface
export interface TestDataState {
  group?: any;
  project?: any;
  repository?: {
    branches: any[];
    files: any[];
    tags: any[];
  };
  workItems?: any[];
  mergeRequests?: any[];
  milestones?: any[];
  labels?: any[];
}

// Use global state to share data across all test files in the same Jest process
declare global {
  var TEST_DATA_STATE: TestDataState;
}

// Initialize global state if not exists
if (!global.TEST_DATA_STATE) {
  global.TEST_DATA_STATE = {};
}

export const getTestData = (): TestDataState => global.TEST_DATA_STATE || {};

export const setTestData = (data: TestDataState): void => {
  global.TEST_DATA_STATE = { ...global.TEST_DATA_STATE, ...data };
};

export const updateTestData = (updates: Partial<TestDataState>): void => {
  global.TEST_DATA_STATE = { ...global.TEST_DATA_STATE, ...updates };
};

// Helper functions for common test operations
export const requireTestData = () => {
  const data = getTestData();
  if (!data.project?.id || !data.group?.id) {
    throw new Error(
      'Test data not available. Make sure to run data-lifecycle.test.ts first with --runInBand'
    );
  }
  return data;
};

export const getTestProject = () => {
  const data = requireTestData();
  return data.project;
};

export const getTestGroup = () => {
  const data = requireTestData();
  return data.group;
};