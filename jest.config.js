const fs = require('fs');
const path = require('path');

// Check if .env.test exists to determine if integration tests should run
const envTestPath = path.resolve(__dirname, '.env.test');
const integrationTestsEnabled = fs.existsSync(envTestPath);

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/setupTests.ts"],
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
    "^node-fetch$": "<rootDir>/tests/__mocks__/node-fetch.js",
  },
  testMatch: ["**/tests/**/*.test.ts", "**/?(*.)+(spec|test).ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!tests/**/*", "!dist/**/*"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  testPathIgnorePatterns: integrationTestsEnabled ?
    ["<rootDir>/dist/", "<rootDir>/node_modules/"] :
    ["<rootDir>/dist/", "<rootDir>/node_modules/", "<rootDir>/tests/integration/"],
  moduleDirectories: ["node_modules", "src"],
};
