/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/setupTests.unit.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^../utils/fetch$": "<rootDir>/tests/__mocks__/enhancedFetch.ts",
    "^../../utils/fetch$": "<rootDir>/tests/__mocks__/enhancedFetch.ts",
    "^../../../src/utils/fetch$": "<rootDir>/tests/__mocks__/enhancedFetch.ts",
  },
  testMatch: ["**/tests/unit/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!tests/**/*", "!dist/**/*"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  verbose: false,
  silent: true, // Suppress console.log output in unit tests
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/", "<rootDir>/tests/integration/"],
  moduleDirectories: ["node_modules", "src"],
  testTimeout: 10000, // Standard timeout for unit tests
  maxWorkers: 8, // Parallel execution for unit tests
};